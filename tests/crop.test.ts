import { describe, expect, it } from "vitest";
import { maskBoundsPx, cropRectForMask, GUARD_CELLS } from "../src/core/crop";
import { gridForImage } from "../src/core/grid";
import type { RegionSnapshot } from "../src/vendor/purupuru/region/model";

const blob: RegionSnapshot = {
  baseFill: 0, inverted: false,
  strokes: [{ id: 1, mode: "paint", size: 0.2, strength: 1, operation: "add", points: [{ x: 0.5, y: 0.5 }] }],
};
const empty: RegionSnapshot = { baseFill: 0, inverted: false, strokes: [] };

describe("maskBoundsPx", () => {
  it("returns null for an empty mask", () => {
    expect(maskBoundsPx(empty, 800, 800)).toBeNull();
  });

  it("brackets a central blob inside the image", () => {
    const b = maskBoundsPx(blob, 800, 800)!;
    expect(b.x).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThan(0);
    expect(b.x + b.width).toBeLessThan(800);
    expect(b.y + b.height).toBeLessThan(800);
  });
});

describe("cropRectForMask", () => {
  it("puts exactly GUARD_CELLS of margin around the mask", () => {
    const mask = { x: 300, y: 300, width: 400, height: 300 };
    const crop = cropRectForMask(mask, 2000, 2000);
    const { pitch } = gridForImage(crop.width, crop.height);
    expect((mask.x - crop.x) / pitch).toBeCloseTo(GUARD_CELLS, 0);
    expect((mask.y - crop.y) / pitch).toBeCloseTo(GUARD_CELLS, 0);
  });

  // 네 변 대칭은 이미지 경계에 안 닿는 마스크에서만 성립한다. 그래서 2000×2000 안의
  // 작은 마스크를 쓴다. 경계 클램프 시 비대칭은 의도된 동작이다.
  it("uses the same pixel margin on all four sides", () => {
    const mask = { x: 300, y: 300, width: 400, height: 300 };
    const crop = cropRectForMask(mask, 2000, 2000);
    expect(mask.x - crop.x).toBe(crop.x + crop.width - (mask.x + mask.width));
    expect(mask.y - crop.y).toBe(crop.y + crop.height - (mask.y + mask.height));
  });

  it("clamps to the image", () => {
    const crop = cropRectForMask({ x: 0, y: 0, width: 300, height: 300 }, 400, 400);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(400);
    expect(crop.y + crop.height).toBeLessThanOrEqual(400);
  });

  it("stays integral so the crop can be a pixel blit", () => {
    const crop = cropRectForMask({ x: 301, y: 307, width: 401, height: 303 }, 2000, 2000);
    for (const value of [crop.x, crop.y, crop.width, crop.height]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
