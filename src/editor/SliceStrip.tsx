import { isPainted, type EpisodeSlice } from "./episode";

export interface SliceStripProps {
  slices: readonly EpisodeSlice[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

const THUMBNAIL_WIDTH = 56;

/**
 * 회차 슬라이스 목록. 60~70장이 세로로 늘어서므로 스크롤 컨테이너 안에 둔다.
 *
 * 썸네일도 원본 <img> 그대로다 — 축소본을 캔버스로 굽는 순간 장당 25MB 디코드가 고정된다.
 * loading="lazy" + 고정 종횡비면 브라우저가 보이는 것만 디코드하고 나머지는 회수한다.
 */
export function SliceStrip({ slices, activeIndex, onSelect }: SliceStripProps): React.JSX.Element {
  return (
    <ul
      aria-label="슬라이스 목록"
      style={{
        listStyle: "none", margin: 0, padding: 4, display: "grid", gap: 4,
        maxHeight: "70vh", overflowY: "auto", border: "1px solid #d5d5d5", borderRadius: 6,
      }}
    >
      {slices.map((slice, index) => {
        const active = index === activeIndex;
        const painted = isPainted(slice);
        return (
          <li key={slice.id}>
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(index)}
              style={{
                width: "100%", display: "grid", gridTemplateColumns: `2rem ${THUMBNAIL_WIDTH}px 1fr`,
                alignItems: "center", gap: 8, padding: 4, textAlign: "left", cursor: "pointer",
                font: "inherit", fontSize: 12,
                // 선택은 테두리만으로 알리면 고대비 모드에서 사라진다. 배경까지 같이 바꾼다.
                border: active ? "2px solid #1a6dd6" : "1px solid #ddd",
                background: active ? "#e8f1fd" : "#fff",
                borderRadius: 4,
              }}
            >
              <span style={{ color: "#666", fontVariantNumeric: "tabular-nums" }}>{index + 1}</span>
              <img
                src={slice.element.src}
                alt=""
                loading="lazy"
                decoding="async"
                // 비율을 미리 박아야 lazy 로딩 중에 목록이 튀지 않는다.
                style={{ width: "100%", display: "block", aspectRatio: `${slice.width} / ${slice.height}`, objectFit: "cover", maxHeight: 96 }}
              />
              <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slice.name}</span>
                <span style={{ color: painted ? "#1a7f37" : "#999" }}>
                  {painted ? `● 칠함 · 획 ${slice.region.strokes.length}개` : "○ 안 칠함"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
