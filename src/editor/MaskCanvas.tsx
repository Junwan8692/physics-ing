import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { regionWeightAt, type RegionSnapshot } from "../vendor/purupuru/region/model";
import { beginStroke, extendStroke, nextStrokeId, type BrushSettings } from "./brush";

export interface MaskCanvasProps {
  image: HTMLImageElement;
  /** 저작 중 좌표계는 원본 이미지 UV [0,1]. 크롭 UV 변환은 저장 시점에 한다 (스펙 §4.7). */
  region: RegionSnapshot;
  brush: BrushSettings;
  onRegionChange: (region: RegionSnapshot) => void;
}

/** 오버레이 표본 해상도. 눈으로 보는 미리보기라 격자보다 곱게 갈 이유가 없다. */
const OVERLAY_SAMPLES = 128;
/** 백킹 스토어 상한. 1280×5120 슬라이스를 원본 크기로 올릴 이유가 없다. */
const MAX_BACKING = 1024;

const imageSize = (image: HTMLImageElement): { width: number; height: number } => ({
  width: image.naturalWidth || image.width,
  height: image.naturalHeight || image.height,
});

export function MaskCanvas({ image, region, brush, onRegionChange }: MaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const { width, height } = imageSize(image);
    if (!canvas || !(width > 0) || !(height > 0)) return;

    const scale = Math.min(1, MAX_BACKING / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    // ponytail: 표본 × 스트로크 × 점 을 매 리드로우마다 전부 훑는다.
    // 획이 수백 개로 늘어 눈에 띄게 느려지면 그때 오프스크린 캔버스에 캐시한다.
    const cellWidth = canvas.width / OVERLAY_SAMPLES;
    const cellHeight = canvas.height / OVERLAY_SAMPLES;
    context.fillStyle = "#ff3fa4";
    for (let row = 0; row < OVERLAY_SAMPLES; row += 1) {
      const v = (row + 0.5) / OVERLAY_SAMPLES;
      for (let column = 0; column < OVERLAY_SAMPLES; column += 1) {
        const weight = regionWeightAt(region, (column + 0.5) / OVERLAY_SAMPLES, v, width, height);
        if (weight <= 0) continue;
        // 강도가 그대로 보여야 저작자가 브러시 strength를 눈으로 맞출 수 있다.
        context.globalAlpha = 0.2 + weight * 0.45;
        context.fillRect(column * cellWidth, row * cellHeight, cellWidth + 1, cellHeight + 1);
      }
    }
    context.globalAlpha = 1;
  }, [image, region]);

  const uvFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: box.width > 0 ? (event.clientX - box.left) / box.width : 0,
      y: box.height > 0 ? (event.clientY - box.top) / box.height : 0,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paintingRef.current = true;
    onRegionChange({
      ...region,
      strokes: [...region.strokes, beginStroke(brush, nextStrokeId(region), uvFromEvent(event))],
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!paintingRef.current) return;
    const last = region.strokes[region.strokes.length - 1];
    if (!last) return;
    const extended = extendStroke(last, uvFromEvent(event));
    // 최소 간격에 걸려 점이 안 늘었으면 리렌더도 시키지 않는다.
    if (extended.points.length === last.points.length) return;
    onRegionChange({ ...region, strokes: [...region.strokes.slice(0, -1), extended] });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    paintingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      aria-label="흔들 영역 칠하기"
      role="img"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ display: "block", width: "100%", height: "auto", touchAction: "none", cursor: "crosshair" }}
    />
  );
}
