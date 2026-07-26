import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { JiggleProject } from "../core/types";
import { createAutoAdapter } from "../input/auto";
import { createDeviceMotionAdapter } from "../input/devicemotion";
import { createPointerAdapter } from "../input/pointer";
import { createScrollAdapter } from "../input/scroll";
import { deserializeProject } from "../project/io";
import { JiggleViewer } from "../viewer/JiggleViewer";
import { TriggerToggles } from "./TriggerToggles";

interface Slice {
  id: string;
  project: JiggleProject;
  image: HTMLImageElement;
}

// ponytail: objectURL을 해제하지 않는다. 데모 페이지 수명이 곧 URL 수명이고,
// 정적 <img>와 WebGL 텍스처가 같은 URL을 공유해서 해제 시점을 잡는 게 더 비싸다.
/**
 * decode() 가 아니라 onload 로 기다린다.
 * 디코드된 1280×5120 슬라이스는 25MB고, 회차 한 편이면 수십 장이다. decode() 는 그걸
 * 전부 즉시 래스터화해서 브라우저가 뷰포트 밖 비트맵을 회수하지 못하게 만든다.
 * onload 면 크기는 읽히고 래스터화 시점은 브라우저가 정한다 — 웹툰 뷰어와 같은 조건.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`${file.name} 이미지를 읽지 못했습니다.`));
    image.src = URL.createObjectURL(file);
  });
}

/** 프로젝트 JSON과 이미지를 한 번에 고르게 한다. 매칭은 `source.src`의 파일명. */
async function loadSlices(files: readonly File[]): Promise<Slice[]> {
  const images = new Map<string, File>();
  const projectFiles: File[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".json")) projectFiles.push(file);
    else images.set(file.name, file);
  }
  if (projectFiles.length === 0) throw new Error("프로젝트 JSON(.json)을 함께 선택하세요.");

  // 이미지가 하나뿐이면 이름이 안 맞아도 그걸 쓴다 (저작툴에서 이름이 바뀌는 경우가 흔하다).
  const onlyImage: File | undefined = images.size === 1 ? [...images.values()][0] : undefined;

  const slices: Slice[] = [];
  for (const [index, file] of projectFiles.entries()) {
    const project = deserializeProject(await file.text());
    const basename = project.source.src.split("/").pop() ?? project.source.src;
    const imageFile = images.get(basename) ?? onlyImage;
    if (!imageFile) throw new Error(`${project.source.src} 이미지 파일을 함께 선택하세요.`);
    slices.push({ id: `${index}-${file.name}`, project, image: await loadImage(imageFile) });
  }
  return slices;
}

export function ViewerDemo() {
  const adapters = useMemo(() => {
    const scroll = createScrollAdapter();
    const pointer = createPointerAdapter({
      // setPointer에 뷰포트 픽셀 좌표를 그대로 넣으므로 짧은 변으로 정규화한다.
      readShortSide: () => Math.min(window.innerWidth, window.innerHeight),
    });
    const devicemotion = createDeviceMotionAdapter();
    const auto = createAutoAdapter();
    auto.enabled = false; // 자동 루프는 기본 꺼짐.
    return { scroll, pointer, devicemotion, auto };
  }, []);

  const [slices, setSlices] = useState<Slice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const viewerRef = useRef<JiggleViewer | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>()).current;
  const dragging = useRef(false);

  const reducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 뷰어 + rAF 루프는 한 번만. 컷마다 rAF를 돌리지 않는다 (스펙 §4.8).
  useEffect(() => {
    const viewer = new JiggleViewer({
      adapters: [adapters.scroll, adapters.pointer, adapters.devicemotion, adapters.auto],
      activeLimit: 2,
    });
    viewerRef.current = viewer;

    let frame = 0;
    let previous = performance.now();
    const step = (now: number): void => {
      // 탭 복귀 같은 거대 dt는 자른다. 솔버의 catch-up 절벽(66.7ms)을 넘겨봐야 버려진다.
      const dtSeconds = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      viewer.tick(dtSeconds);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      viewerRef.current = null;
      viewer.destroy();
    };
  }, [adapters]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const slice of slices) {
      const element = elements.get(slice.id);
      if (element) viewer.register(slice.id, element, slice.project, slice.image);
    }
    return () => {
      for (const slice of slices) viewer.unregister(slice.id);
    };
  }, [slices, elements]);

  const movePointer = (event: ReactPointerEvent<HTMLElement>): void => {
    adapters.pointer.setPointer({ x: event.clientX, y: event.clientY });
  };
  const endDrag = (): void => {
    dragging.current = false;
    adapters.pointer.setPointer(null);
  };

  return (
    <main
      style={{ maxWidth: 720, margin: "0 auto", padding: "0 0 40vh", fontFamily: "system-ui, sans-serif" }}
      onPointerDown={(event) => {
        dragging.current = true;
        movePointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) movePointer(event);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
    >
      <TriggerToggles {...adapters} />

      <header style={{ display: "grid", gap: 8, padding: 12, fontSize: 13 }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>웹툰 지글 뷰어 데모</h1>
        <p style={{ margin: 0 }}>
          저작툴에서 저장한 프로젝트 JSON과 원본 이미지를 <strong>함께</strong> 선택하세요.
          여러 컷을 한 번에 고르면 세로로 이어 붙입니다.
        </p>
        <input
          type="file"
          multiple
          accept="application/json,.json,image/*"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            setError(null);
            void loadSlices(files)
              .then(setSlices)
              .catch((cause: unknown) => {
                setSlices([]);
                setError(cause instanceof Error ? cause.message : String(cause));
              });
          }}
        />
        {error !== null && <p style={{ margin: 0, color: "#b00" }}>{error}</p>}
        {reducedMotion && (
          <p style={{ margin: 0, color: "#b60" }}>
            시스템이 &quot;동작 줄이기&quot;로 설정되어 있어 물리가 전부 정지합니다 (스펙 §4.8).
          </p>
        )}
      </header>

      {slices.map((slice) => (
        <div key={slice.id} style={{ position: "relative" }}>
          <img src={slice.image.src} alt="" style={{ width: "100%", display: "block" }} />
          {/* 크롭 컨테이너는 정적 이미지 박스에 대한 백분율. 확대·축소해도 어긋나지 않는다 (스펙 §4.5). */}
          <div
            className="jiggle-cut"
            ref={(node) => {
              if (node) elements.set(slice.id, node);
              else elements.delete(slice.id);
            }}
            style={{
              position: "absolute",
              left: `${(slice.project.crop.x / slice.project.source.width) * 100}%`,
              top: `${(slice.project.crop.y / slice.project.source.height) * 100}%`,
              width: `${(slice.project.crop.width / slice.project.source.width) * 100}%`,
              height: `${(slice.project.crop.height / slice.project.source.height) * 100}%`,
            }}
          />
        </div>
      ))}
    </main>
  );
}
