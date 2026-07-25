import { useMemo, type CSSProperties } from "react";
import { cropRectForMask, maskBoundsPx } from "../core/crop";
import { gridForImage } from "../core/grid";
import type { Rect } from "../core/types";
import type { RegionSnapshot } from "../vendor/purupuru/region/model";

export interface CropPreviewProps {
  image: HTMLImageElement;
  /** 원본 이미지 UV 좌표계의 마스크. */
  region: RegionSnapshot;
}

/** 원본 박스에 대한 백분율. 스펙 §4.5의 뷰어 CSS 배치와 같은 식이다. */
const percentBox = (rect: Rect, width: number, height: number): CSSProperties => ({
  position: "absolute",
  left: `${(rect.x / width) * 100}%`,
  top: `${(rect.y / height) * 100}%`,
  width: `${(rect.width / width) * 100}%`,
  height: `${(rect.height / height) * 100}%`,
  pointerEvents: "none",
  boxSizing: "border-box",
});

export function CropPreview({ image, region }: CropPreviewProps) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const bounds = useMemo(
    () => (width > 0 && height > 0 ? maskBoundsPx(region, width, height) : null),
    [region, width, height],
  );
  const crop = useMemo(
    () => (bounds ? cropRectForMask(bounds, width, height) : null),
    [bounds, width, height],
  );

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ position: "relative" }}>
        <img src={image.src} alt="" style={{ display: "block", width: "100%", height: "auto" }} />
        {bounds ? <div style={{ ...percentBox(bounds, width, height), border: "1px solid #ff3fa4" }} /> : null}
        {crop ? <div style={{ ...percentBox(crop, width, height), border: "1px dashed #2f8fff" }} /> : null}
      </div>
      <figcaption style={{ fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
        {crop ? <CropCost crop={crop} /> : "칠한 영역이 없습니다. 먼저 흔들 부분을 칠하세요."}
      </figcaption>
    </figure>
  );
}

/** 저작자가 크롭 비용(해상도·정점 수)을 바로 보게 한다. */
function CropCost({ crop }: { crop: Rect }) {
  const { columns, rows, pitch } = gridForImage(crop.width, crop.height);
  return (
    <>
      크롭 {crop.width}×{crop.height}px · 격자 {columns}×{rows} · pitch {pitch.toFixed(1)}px ·
      {" "}정점 {(columns + 1) * (rows + 1)}개
    </>
  );
}
