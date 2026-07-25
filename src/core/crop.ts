import { regionWeightAt, type RegionSnapshot } from "../vendor/purupuru/region/model";
import { GRID_K } from "./grid";
import type { Rect } from "./types";

/** 실측: 3셀이면 전체격자 대비 진폭 오차 0.5%, 1셀이면 찢어진다. */
export const GUARD_CELLS = 3;

/**
 * margin = GUARD_CELLS * pitch, pitch = cropShort / GRID_K, cropShort = maskShort + 2*margin
 * 를 풀면 margin = maskShort * GUARD_CELLS / (GRID_K - 2*GUARD_CELLS).
 */
export const MARGIN_RATIO = GUARD_CELLS / (GRID_K - 2 * GUARD_CELLS);

export function maskBoundsPx(
  region: RegionSnapshot,
  imageWidth: number,
  imageHeight: number,
  samples = 128,
): Rect | null {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let row = 0; row < samples; row += 1) {
    const v = (row + 0.5) / samples;
    for (let column = 0; column < samples; column += 1) {
      const u = (column + 0.5) / samples;
      if (regionWeightAt(region, u, v, imageWidth, imageHeight) <= 0) continue;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  if (!Number.isFinite(minU)) return null;
  // 셀 중심만 표본하므로 반 셀 넓혀 실제 경계를 놓치지 않는다.
  const halfU = 0.5 / samples;
  const x = Math.max(0, Math.floor((minU - halfU) * imageWidth));
  const y = Math.max(0, Math.floor((minV - halfU) * imageHeight));
  return {
    x, y,
    width: Math.min(imageWidth, Math.ceil((maxU + halfU) * imageWidth)) - x,
    height: Math.min(imageHeight, Math.ceil((maxV + halfU) * imageHeight)) - y,
  };
}

export function cropRectForMask(mask: Rect, imageWidth: number, imageHeight: number): Rect {
  const margin = Math.ceil(MARGIN_RATIO * Math.min(mask.width, mask.height));
  const x = Math.max(0, mask.x - margin);
  const y = Math.max(0, mask.y - margin);
  return {
    x, y,
    width: Math.min(imageWidth, mask.x + mask.width + margin) - x,
    height: Math.min(imageHeight, mask.y + mask.height + margin) - y,
  };
}
