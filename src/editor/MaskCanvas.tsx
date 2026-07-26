import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RegionSnapshot } from "../vendor/purupuru/region/model";
import { beginStroke, extendStroke, nextStrokeId, type BrushSettings } from "./brush";

export interface MaskCanvasProps {
  image: HTMLImageElement;
  /** 저작 중 좌표계는 원본 이미지 UV [0,1]. 크롭 UV 변환은 저장 시점에 한다 (스펙 §4.7). */
  region: RegionSnapshot;
  brush: BrushSettings;
  onRegionChange: (region: RegionSnapshot) => void;
}

/** 백킹 스토어 상한. 1280×5120 슬라이스를 원본 크기로 올릴 이유가 없다. */
const MAX_BACKING = 1024;

const imageSize = (image: HTMLImageElement): { width: number; height: number } => ({
  width: image.naturalWidth || image.width,
  height: image.naturalHeight || image.height,
});

/**
 * 스트로크의 픽셀 반지름.
 *
 * 벤더의 포함 판정은 축 스케일 {w/short, h/short} 를 곱한 UV 공간에서 거리를 잰다.
 * dx_uv·(w/short) = dx_px/short 이므로 그 공간은 픽셀 기준 등방이고, 결국 스트로크는
 * 픽셀 공간에서 반지름 (size/2)·short 인 진짜 원 — 즉 둥근 캡 폴리라인이다.
 * 그래서 표본 격자로 훑을 필요 없이 캔버스 경로로 바로 그릴 수 있다.
 */
export const strokeRadiusPx = (size: number, imageWidth: number, imageHeight: number): number =>
  (size / 2) * Math.min(imageWidth, imageHeight);

export function MaskCanvas({ image, region, brush, onRegionChange }: MaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  /** 마스크 합성용 오프스크린. 리드로우마다 새로 만들지 않는다. */
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  /** 포인터가 캔버스 위에 있을 때의 UV. 벗어나면 null 이라 커서가 사라진다. */
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

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

    // 마스크는 알파 채널로만 쌓고 마지막에 한 번 합성한다.
    // 획마다 본 캔버스에 바로 그리면 겹친 곳이 진해져 강도를 못 읽는다.
    const mask = maskRef.current ?? (maskRef.current = document.createElement("canvas"));
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskContext = mask.getContext("2d");
    if (!maskContext) return;

    maskContext.lineCap = "round";
    maskContext.lineJoin = "round";
    maskContext.strokeStyle = "#ff3fa4";
    maskContext.fillStyle = "#ff3fa4";

    for (const stroke of region.strokes) {
      const erasing = (stroke.operation ?? (stroke.mode === "paint" ? "add" : "subtract")) === "subtract";
      // 지우개는 알파를 깎는다. 벤더의 weight 합성과 정확히 같지는 않지만
      // 겹침 순서와 강도가 눈에 그대로 보이는 쪽을 택했다.
      maskContext.globalCompositeOperation = erasing ? "destination-out" : "source-over";
      // 약한 획도 보이도록 바닥을 깔아 준다. 0.05 강도가 안 보이면 칠한 줄도 모른다.
      maskContext.globalAlpha = Math.min(1, 0.3 + (stroke.strength ?? 1) * 0.7);
      const radius = strokeRadiusPx(stroke.size, width, height) * scale;
      const first = stroke.points[0];
      if (!first) continue;
      if (stroke.points.length === 1) {
        maskContext.beginPath();
        maskContext.arc(first.x * canvas.width, first.y * canvas.height, radius, 0, Math.PI * 2);
        maskContext.fill();
        continue;
      }
      maskContext.lineWidth = radius * 2;
      maskContext.beginPath();
      maskContext.moveTo(first.x * canvas.width, first.y * canvas.height);
      for (let index = 1; index < stroke.points.length; index += 1) {
        const point = stroke.points[index];
        if (point) maskContext.lineTo(point.x * canvas.width, point.y * canvas.height);
      }
      maskContext.stroke();
    }

    maskContext.globalCompositeOperation = "source-over";
    maskContext.globalAlpha = 1;
    context.globalAlpha = 0.62;
    context.drawImage(mask, 0, 0);
    context.globalAlpha = 1;
  }, [image, region]);

  // 브러시 커서는 전용 오버레이에 그린다. 포인터가 움직일 때마다 이미지와 마스크를
  // 다시 그릴 이유가 없다 — 여기는 원 하나만 지웠다 그린다.
  useEffect(() => {
    const cursor = cursorRef.current;
    const base = canvasRef.current;
    if (!cursor || !base) return;
    cursor.width = base.width;
    cursor.height = base.height;
    const context = cursor.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, cursor.width, cursor.height);
    if (!hover) return;

    const { width, height } = imageSize(image);
    const scale = Math.min(1, MAX_BACKING / Math.max(width, height));
    const radius = strokeRadiusPx(brush.size, width, height) * scale;
    const x = hover.x * cursor.width;
    const y = hover.y * cursor.height;

    // 어떤 그림 위에서도 보이도록 흰 테두리 안에 검은 테두리를 겹친다.
    // 지우개는 점선으로 구분한다 — 색만으로는 칠하기와 헷갈린다.
    context.setLineDash(brush.mode === "erase" ? [6, 5] : []);
    context.lineWidth = 3;
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(0, 0, 0, 0.85)";
    context.stroke();
    context.setLineDash([]);

    // 가운데 점은 브러시 강도. 진할수록 세게 칠해진다.
    context.fillStyle = `rgba(255, 63, 164, ${0.25 + brush.strength * 0.75})`;
    context.beginPath();
    context.arc(x, y, Math.max(1.5, radius * 0.06), 0, Math.PI * 2);
    context.fill();
  }, [image, brush, hover]);

  const uvFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: box.width > 0 ? (event.clientX - box.left) / box.width : 0,
      y: box.height > 0 ? (event.clientY - box.top) / box.height : 0,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setHover(uvFromEvent(event));
    paintingRef.current = true;
    onRegionChange({
      ...region,
      strokes: [...region.strokes, beginStroke(brush, nextStrokeId(region), uvFromEvent(event))],
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    setHover(uvFromEvent(event));
    if (!paintingRef.current) return;
    const last = region.strokes[region.strokes.length - 1];
    if (!last) return;
    const extended = extendStroke(last, uvFromEvent(event));
    // 최소 간격에 걸려 점이 안 늘었으면 리렌더도 시키지 않는다.
    if (extended.points.length === last.points.length) return;
    onRegionChange({ ...region, strokes: [...region.strokes.slice(0, -1), extended] });
  };

  const handleLeave = (): void => {
    // 칠하는 중에 캔버스를 벗어나도 획은 계속된다(포인터 캡처). 커서만 감춘다.
    if (!paintingRef.current) setHover(null);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    paintingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div style={{ position: "relative", lineHeight: 0 }}>
      <canvas
        ref={canvasRef}
        aria-label="흔들 영역 칠하기"
        role="img"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => { handleLeave(); }}
        style={{
          display: "block", width: "100%", height: "auto",
          touchAction: "none",
          // 커서 원이 곧 브러시 크기라 기본 커서는 숨긴다. 두 개가 보이면 헷갈린다.
          cursor: hover ? "none" : "crosshair",
        }}
      />
      <canvas
        ref={cursorRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
    </div>
  );
}
