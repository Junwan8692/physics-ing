import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { JiggleProject } from "../core/types";
import { createAutoAdapter } from "../input/auto";
import { createPointerAdapter } from "../input/pointer";
import { createScrollAdapter } from "../input/scroll";
import { JiggleViewer } from "../viewer/JiggleViewer";

export interface PreviewSlice {
  id: string;
  image: HTMLImageElement;
  /** 칠한 게 없으면 undefined — 정적으로만 쌓인다. */
  project?: JiggleProject;
}

export interface EpisodePreviewProps {
  slices: readonly PreviewSlice[];
  /** 뷰어 폭 제한. 기본 480px — 폰 뷰어 폭에 맞춰 본다. */
  maxWidth?: number;
}

const percent = (value: number, total: number): string => `${(value / total) * 100}%`;

/**
 * 에피소드 전체를 독자가 보는 대로 세로로 쌓아 보여준다.
 *
 * LivePreview 의 다중 슬라이스 형제. 물리·합성·풀링은 JiggleViewer 하나가 전부 맡고,
 * 여기서는 레이아웃과 입력만 붙인다. 60~70장을 들고 있어야 하므로 슬라이스는
 * 끝까지 <img> 로만 둔다 — 캔버스에 그리거나 ImageBitmap 으로 만들면 브라우저가
 * 디코드된 비트맵을 버리지 못해 25MB × 장수가 그대로 쌓인다.
 */
export function EpisodePreview({ slices, maxWidth = 480 }: EpisodePreviewProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<JiggleViewer | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>()).current;
  const dragging = useRef(false);
  const [auto, setAuto] = useState(true);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  // 이미지가 늦게 로드되면 그때 비율을 알게 되므로 한 번 더 그린다.
  const [, redraw] = useReducer((count: number) => count + 1, 0);

  const adapters = useMemo(() => {
    const pointer = createPointerAdapter();
    // 이 미리보기는 창이 아니라 자기 컨테이너 안에서 스크롤한다.
    const scroll = createScrollAdapter({ readScrollY: () => scrollRef.current?.scrollTop ?? 0 });
    return { pointer, scroll, auto: createAutoAdapter() };
  }, []);

  const painted = useMemo(() => slices.filter((slice) => slice.project !== undefined), [slices]);

  // 에피소드 전체에 뷰어 하나, rAF 하나. 활성 컷 상한·메시 지연 생성·렌더러 풀은
  // 전부 JiggleViewer 안에 있다. reducedMotion 은 미리보기에서 무시한다 —
  // 여기서 안 움직이면 작가가 파라미터를 맞출 방법이 없기 때문.
  useEffect(() => {
    const viewer = new JiggleViewer({
      adapters: [adapters.pointer, adapters.scroll, adapters.auto],
      reducedMotion: false,
    });
    viewerRef.current = viewer;

    let frame = 0;
    let previous = performance.now();
    const step = (now: number): void => {
      // 탭 복귀 같은 거대 dt는 자른다. 솔버의 catch-up 절벽을 넘겨봐야 버려진다.
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

  // 칠한 슬라이스만 등록한다. register 는 메시를 만들지 않으므로 70장을 등록해도
  // 비용은 관찰자 등록뿐이고, 실제 빌드는 뷰포트에 들어온 컷에서만 일어난다.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const slice of painted) {
      const element = elements.get(slice.id);
      if (element && slice.project) viewer.register(slice.id, element, slice.project, slice.image);
    }
    return () => {
      for (const slice of painted) viewer.unregister(slice.id);
    };
  }, [painted, elements]);

  useEffect(() => { adapters.auto.enabled = auto; }, [auto, adapters]);
  useEffect(() => { adapters.scroll.enabled = scrollEnabled; }, [scrollEnabled, adapters]);

  /** 포인터 좌표를 스크롤 컬럼 기준 0..1 로 넘긴다 (LivePreview 와 같은 규약). */
  const movePointer = (event: ReactPointerEvent<HTMLElement>): void => {
    const box = scrollRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    adapters.pointer.setPointer({
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    });
  };
  const endDrag = (): void => {
    dragging.current = false;
    adapters.pointer.setPointer(null);
  };

  return (
    <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.currentTarget.checked)} />
          자동으로 흔들기
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={scrollEnabled}
            onChange={(event) => setScrollEnabled(event.currentTarget.checked)}
          />
          스크롤 관성
        </label>
        <span style={{ color: "#666" }}>칠한 슬라이스 {painted.length} / {slices.length}</span>
      </div>

      <div
        ref={scrollRef}
        style={{
          width: "100%",
          maxWidth,
          height: "70vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
          background: "#000",
        }}
        onPointerDown={(event) => { dragging.current = true; movePointer(event); }}
        onPointerMove={(event) => { if (dragging.current) movePointer(event); }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        {slices.map((slice) => {
          const { image, project } = slice;
          // 비율을 미리 박아야 lazy 로딩 중에도 페이지가 튀지 않는다.
          // 아직 안 로드됐으면 프로젝트가 아는 원본 크기를 쓴다.
          const width = image.naturalWidth || project?.source.width;
          const height = image.naturalHeight || project?.source.height;
          return (
            <div key={slice.id} style={{ position: "relative", lineHeight: 0 }}>
              <img
                src={image.src}
                alt=""
                loading="lazy"
                decoding="async"
                onLoad={redraw}
                style={{
                  width: "100%",
                  display: "block",
                  ...(width && height ? { aspectRatio: `${width} / ${height}` } : {}),
                }}
              />
              {/* 크롭 컨테이너는 정적 이미지 박스에 대한 백분율 (스펙 §4.5).
                  캔버스는 여기에 없다 — JiggleViewer 가 풀에서 빌린 캔버스를 붙였다 뗀다. */}
              {project && (
                <div
                  ref={(node) => {
                    if (node) elements.set(slice.id, node);
                    else elements.delete(slice.id);
                  }}
                  style={{
                    position: "absolute",
                    left: percent(project.crop.x, project.source.width),
                    top: percent(project.crop.y, project.source.height),
                    width: percent(project.crop.width, project.source.width),
                    height: percent(project.crop.height, project.source.height),
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
