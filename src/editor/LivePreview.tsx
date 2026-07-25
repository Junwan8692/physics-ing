import { useEffect, useMemo, useRef, useState } from "react";
import { JiggleViewer } from "../viewer/JiggleViewer";
import { createAutoAdapter } from "../input/auto";
import { createPointerAdapter } from "../input/pointer";
import type { JiggleProject } from "../core/types";

export interface LivePreviewProps {
  image: HTMLImageElement;
  /** 저작 화면에서 만든 프로젝트. 크롭·마스크·파라미터가 바뀌면 새 객체로 들어온다. */
  project: JiggleProject;
}

/**
 * 저작 화면과 같은 자리에서 도는 실시간 미리보기.
 *
 * 물리·합성·풀링을 다시 짜지 않고 JiggleViewer 를 컷 하나짜리로 쓴다.
 * 뷰어에서 보이는 것과 미리보기가 갈라질 여지를 없애려는 의도이기도 하다.
 */
export function LivePreview({ image, project }: LivePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cutRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<JiggleViewer | null>(null);
  const [auto, setAuto] = useState(true);

  const pointer = useMemo(() => createPointerAdapter(), []);
  const autoAdapter = useMemo(() => createAutoAdapter(), []);

  // 뷰어는 한 번만 만든다. reducedMotion 은 미리보기에서 무시한다 —
  // 여기서 안 움직이면 파라미터를 맞출 방법이 없기 때문.
  useEffect(() => {
    const viewer = new JiggleViewer({
      adapters: [pointer, autoAdapter],
      activeLimit: 1,
      reducedMotion: false,
    });
    viewerRef.current = viewer;

    let frame = 0;
    let previous = performance.now();
    const loop = (now: number): void => {
      viewer.tick(Math.min((now - previous) / 1000, 0.1));
      previous = now;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [pointer, autoAdapter]);

  // 마스크나 파라미터가 바뀌면 컷을 다시 등록한다.
  // register 는 메시를 만들지 않고, 실제 빌드는 다음 tick 의 활성화에서 일어난다.
  useEffect(() => {
    const viewer = viewerRef.current;
    const element = cutRef.current;
    if (!viewer || !element) return;
    viewer.register("preview", element, project, image);
    return () => viewer.unregister("preview");
  }, [project, image]);

  useEffect(() => { autoAdapter.enabled = auto; }, [auto, autoAdapter]);

  /** 포인터 좌표를 호스트 박스 기준 0..1 로 넘긴다. 뷰어가 강체 프레임 목표로 쓴다. */
  const toLocal = (event: React.PointerEvent): { x: number; y: number } => {
    const box = hostRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0.5, y: 0.5 };
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };

  const { crop, source } = project;
  const percent = (value: number, total: number): string => `${(value / total) * 100}%`;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.currentTarget.checked)} />
          자동으로 흔들기
        </label>
        <span style={{ color: "#666" }}>이미지를 끌면 그 방향으로 흔들립니다.</span>
      </div>

      <div
        ref={hostRef}
        style={{ position: "relative", lineHeight: 0, touchAction: "none", cursor: "grab" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.setPointer(toLocal(event));
        }}
        onPointerMove={(event) => { if (event.buttons > 0) pointer.setPointer(toLocal(event)); }}
        onPointerUp={() => pointer.setPointer(null)}
        onPointerCancel={() => pointer.setPointer(null)}
        onPointerLeave={() => pointer.setPointer(null)}
      >
        <img src={image.src} alt="미리보기 원본" style={{ width: "100%", display: "block" }} />
        {/* 캔버스는 여기에 없다. JiggleViewer 가 풀에서 빌린 캔버스를 붙였다 뗀다. */}
        <div
          ref={cutRef}
          style={{
            position: "absolute",
            left: percent(crop.x, source.width),
            top: percent(crop.y, source.height),
            width: percent(crop.width, source.width),
            height: percent(crop.height, source.height),
          }}
        />
      </div>
    </div>
  );
}
