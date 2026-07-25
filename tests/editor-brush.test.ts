import { describe, expect, it } from "vitest";
import { beginStroke, extendStroke, nextStrokeId, DEFAULT_BRUSH, BRUSH_MIN } from "../src/editor/brush";
import { GRID_K } from "../src/core/grid";
import { regionWeightAt, EMPTY_REGION } from "../src/vendor/purupuru/region/model";
import { createGridMesh } from "../src/vendor/purupuru/core/mesh";
import { gridForImage } from "../src/core/grid";

describe("brush limits", () => {
  it("derives the minimum from GRID_K", () => expect(BRUSH_MIN).toBeCloseTo(2 / GRID_K));

  it("selects at least one vertex at the minimum size", () => {
    // 실측: 하드코딩한 0.02는 정점을 0개 고른다. 최소값은 격자에서 유도해야 한다.
    const stroke = beginStroke({ size: BRUSH_MIN, strength: 1, mode: "paint" }, 1, { x: 0.5, y: 0.5 });
    const region = { ...EMPTY_REGION, strokes: [stroke] };
    const { columns, rows } = gridForImage(600, 800);
    const mesh = createGridMesh({
      columns, rows, imageWidth: 600, imageHeight: 800,
      weights: (u, v) => regionWeightAt(region, u, v, 600, 800),
    });
    expect(Array.from(mesh.weights).filter((w) => w > 0).length).toBeGreaterThan(0);
  });
});

describe("nextStrokeId", () => {
  it("starts at 1", () => expect(nextStrokeId(EMPTY_REGION)).toBe(1));
  it("is one past the highest id", () => {
    expect(nextStrokeId({ ...EMPTY_REGION, strokes: [
      { id: 3, mode: "paint", size: 0.1, points: [{ x: 0, y: 0 }] },
      { id: 7, mode: "paint", size: 0.1, points: [{ x: 0, y: 0 }] },
    ]})).toBe(8);
  });
});

describe("beginStroke", () => {
  it("carries the brush settings", () => {
    const s = beginStroke({ size: 0.2, strength: 0.6, mode: "paint" }, 1, { x: 0.5, y: 0.5 });
    expect(s.points).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(s.size).toBe(0.2);
    expect(s.strength).toBe(0.6);
    expect(s.operation).toBe("add");
  });
  it("uses subtract for erase", () =>
    expect(beginStroke({ size: 0.2, strength: 1, mode: "erase" }, 1, { x: 0.5, y: 0.5 }).operation).toBe("subtract"));
  it("raises the weight under the brush and nowhere else", () => {
    const region = { ...EMPTY_REGION, strokes: [beginStroke({ size: 0.2, strength: 1, mode: "paint" }, 1, { x: 0.5, y: 0.5 })] };
    expect(regionWeightAt(region, 0.5, 0.5, 800, 800)).toBeGreaterThan(0);
    expect(regionWeightAt(region, 0.05, 0.05, 800, 800)).toBe(0);
  });
});

describe("extendStroke", () => {
  it("appends a far-enough point", () =>
    expect(extendStroke(beginStroke(DEFAULT_BRUSH, 1, { x: 0.5, y: 0.5 }), { x: 0.6, y: 0.6 }).points).toHaveLength(2));
  it("drops a too-close point", () =>
    expect(extendStroke(beginStroke(DEFAULT_BRUSH, 1, { x: 0.5, y: 0.5 }), { x: 0.5001, y: 0.5 }).points).toHaveLength(1));
  it("does not mutate the input", () => {
    const s = beginStroke(DEFAULT_BRUSH, 1, { x: 0.5, y: 0.5 });
    extendStroke(s, { x: 0.9, y: 0.9 });
    expect(s.points).toHaveLength(1);
  });
});
