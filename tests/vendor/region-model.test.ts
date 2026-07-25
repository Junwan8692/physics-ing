/*
 * Vendored regression test from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only, plus this explicit vitest import
 * (upstream relied on `globals: true`; we do not). No logic changes.
 */
import { describe, expect, it } from "vitest";
import { applyStrokeStrength, EMPTY_REGION, RegionHistory, effectiveStrokeMode, estimateCoverage, strokeStrength, type RegionSnapshot } from "../../src/vendor/purupuru/region/model";

function paintedSnapshot(id: number): RegionSnapshot {
  return {
    ...EMPTY_REGION,
    strokes: [{ id, mode: "paint", operation: "replace", size: 0.06, strength: 0.25, points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] }],
  };
}

describe("RegionHistory", () => {
  it("undoes and redoes immutable normalized strokes", () => {
    const history = new RegionHistory();
    history.commit(paintedSnapshot(1));
    expect(history.current.strokes).toHaveLength(1);
    expect(history.undo().strokes).toHaveLength(0);
    expect(history.redo().strokes[0]?.points[1]).toEqual({ x: 0.4, y: 0.4 });
    expect(history.current.strokes[0]?.strength).toBe(0.25);
  });

  it("creates periodic checkpoints without snapshotting every command", () => {
    const history = new RegionHistory(EMPTY_REGION, 3);
    history.commit(paintedSnapshot(1));
    history.commit(paintedSnapshot(2));
    history.commit(paintedSnapshot(3));
    expect([...history.checkpoints.keys()]).toEqual([0, 3]);
  });

  it("keeps inversion non-destructive and maps editing to effective values", () => {
    const painted = paintedSnapshot(1);
    const inverted = { ...painted, inverted: true };
    expect(painted.strokes).toEqual(inverted.strokes);
    expect(effectiveStrokeMode("paint", true)).toBe("erase");
    expect(estimateCoverage(inverted, 100, 100)).toBeCloseTo(1 - estimateCoverage(painted, 100, 100));
  });

  it("uses coverage times strength and clamps every composition step", () => {
    const paint = { id: 1, mode: "paint" as const, operation: "replace" as const, size: 0.1, strength: 0.5, points: [] };
    const erase = { ...paint, mode: "erase" as const, operation: "subtract" as const };
    expect(applyStrokeStrength(0.9, paint, 0.5)).toBeCloseTo(0.7);
    expect(applyStrokeStrength(0.1, erase, 0.5)).toBe(0);
    expect(strokeStrength({ id: 2, mode: "paint", size: 0.1, points: [] })).toBe(1);
    expect(strokeStrength({ id: 3, mode: "paint", size: 0.1, strength: Number.NaN, points: [] })).toBe(0);
  });
});
