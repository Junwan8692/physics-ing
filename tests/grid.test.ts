import { describe, expect, it } from "vitest";
import { gridForImage, GRID_K } from "../src/core/grid";

// noUncheckedIndexedAccess 아래에서 number[][] 를 구조분해하면 number|undefined 가 되므로
// 케이스 목록을 튜플로 못박는다.
type Case = readonly [number, number];

describe("gridForImage", () => {
  it("gives the short side exactly GRID_K cells", () => {
    const cases: readonly Case[] = [[400, 400], [600, 900], [800, 3000], [800, 6400], [3200, 800]];
    for (const [w, h] of cases) {
      const { columns, rows } = gridForImage(w, h);
      expect(w <= h ? columns : rows).toBe(GRID_K);
    }
  });

  it("keeps cells square within rounding", () => {
    const cases: readonly Case[] = [[400, 400], [600, 900], [800, 3000], [1280, 5120]];
    for (const [w, h] of cases) {
      const { columns, rows } = gridForImage(w, h);
      const cw = w / columns, ch = h / rows;
      expect(Math.max(cw, ch) / Math.min(cw, ch)).toBeLessThan(1.1);
    }
  });

  it("reports pitch as short side over GRID_K", () => {
    expect(gridForImage(800, 3000).pitch).toBeCloseTo(800 / 25);
    expect(gridForImage(3200, 800).pitch).toBeCloseTo(800 / 25);
  });

  it("never goes below 4 cells on either axis", () => {
    const { columns, rows } = gridForImage(100, 100000);
    expect(columns).toBeGreaterThanOrEqual(4);
    expect(rows).toBeGreaterThanOrEqual(4);
  });

  it("rejects non-positive dimensions", () => {
    expect(() => gridForImage(0, 100)).toThrow(RangeError);
    expect(() => gridForImage(100, Number.NaN)).toThrow(RangeError);
  });
});
