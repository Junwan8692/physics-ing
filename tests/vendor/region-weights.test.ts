/*
 * Vendored regression test from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only, plus this explicit vitest import
 * (upstream relied on `globals: true`; we do not). No logic changes.
 */
import { describe, expect, it } from "vitest";
import { regionWeightAt as evaluateRegionWeightAt, strokeContains } from "../../src/vendor/purupuru/region/model";
import type { RegionSnapshot } from "../../src/vendor/purupuru/region/model";

function regionWeightAt(region: RegionSnapshot, u: number, v: number, imageWidth = 100, imageHeight = 100): number {
  return evaluateRegionWeightAt(region, u, v, imageWidth, imageHeight);
}

describe("region mesh weights", () => {
  it.each([
    { imageWidth: 100, imageHeight: 100 },
    { imageWidth: 100, imageHeight: 200 },
    { imageWidth: 200, imageHeight: 100 },
    { imageWidth: 100, imageHeight: 400 },
    { imageWidth: 400, imageHeight: 100 },
  ])("keeps one-tap brushes circular for $imageWidth x $imageHeight images", ({ imageWidth, imageHeight }) => {
    const region: RegionSnapshot = {
      baseFill: 0,
      inverted: false,
      strokes: [{ id: 1, mode: "paint", size: 0.2, points: [{ x: 0.5, y: 0.5 }] }],
    };
    const shortEdge = Math.min(imageWidth, imageHeight);
    const insideX = 0.08 * shortEdge / imageWidth;
    const insideY = 0.08 * shortEdge / imageHeight;
    const outsideX = 0.12 * shortEdge / imageWidth;
    const outsideY = 0.12 * shortEdge / imageHeight;

    expect(regionWeightAt(region, 0.5 + insideX, 0.5, imageWidth, imageHeight)).toBe(1);
    expect(regionWeightAt(region, 0.5, 0.5 + insideY, imageWidth, imageHeight)).toBe(1);
    expect(regionWeightAt(region, 0.5 + outsideX, 0.5, imageWidth, imageHeight)).toBe(0);
    expect(regionWeightAt(region, 0.5, 0.5 + outsideY, imageWidth, imageHeight)).toBe(0);
  });

  it("measures diagonal stroke distance in short-edge image space", () => {
    const stroke = {
      id: 1,
      mode: "paint" as const,
      size: 0.2,
      points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.35 }],
    };
    const inverseSqrtTwo = 1 / Math.sqrt(2);
    const pointAtPerpendicularDistance = (distance: number) => ({
      x: 0.5 - distance * inverseSqrtTwo,
      y: (1.1 + distance * inverseSqrtTwo) / 4,
    });

    expect(strokeContains(stroke, pointAtPerpendicularDistance(0.08), 100, 400)).toBe(true);
    expect(strokeContains(stroke, pointAtPerpendicularDistance(0.12), 100, 400)).toBe(false);
  });

  it("depends on aspect ratio rather than source resolution", () => {
    const region: RegionSnapshot = {
      baseFill: 0,
      inverted: false,
      strokes: [{ id: 1, mode: "paint", size: 0.2, points: [{ x: 0.5, y: 0.5 }] }],
    };
    const samples = [[0.5, 0.52], [0.59, 0.5], [0.5, 0.53], [0.61, 0.5]] as const;

    expect(samples.map(([u, v]) => regionWeightAt(region, u, v, 100, 400)))
      .toEqual(samples.map(([u, v]) => regionWeightAt(region, u, v, 1000, 4000)));
  });

  it("applies normalized paint strokes and non-destructive inversion", () => {
    const region: RegionSnapshot = {
      baseFill: 0,
      inverted: false,
      strokes: [{ id: 1, mode: "paint", size: 0.2, points: [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }] }],
    };

    expect(regionWeightAt(region, 0.5, 0.5)).toBe(1);
    expect(regionWeightAt(region, 0.1, 0.1)).toBe(0);
    expect(regionWeightAt({ ...region, inverted: true }, 0.5, 0.5)).toBe(0);
    expect(regionWeightAt({ ...region, inverted: true }, 0.1, 0.1)).toBe(1);
  });

  it("replaces with the latest paint strength and subtracts erase strength", () => {
    const point = [{ x: 0.5, y: 0.5 }];
    const region: RegionSnapshot = {
      baseFill: 0,
      inverted: false,
      strokes: [
        { id: 1, mode: "paint", operation: "replace", size: 0.2, strength: 0.25, points: point },
        { id: 2, mode: "paint", operation: "replace", size: 0.2, strength: 0.25, points: point },
      ],
    };
    expect(regionWeightAt(region, 0.5, 0.5)).toBeCloseTo(0.25);
    expect(regionWeightAt({ ...region, strokes: [...region.strokes, { id: 3, mode: "paint", operation: "replace", size: 0.2, strength: 0.75, points: point }] }, 0.5, 0.5)).toBe(0.75);
    expect(regionWeightAt({ ...region, baseFill: 1, strokes: [{ id: 4, mode: "erase", size: 0.2, strength: 0.25, points: point }] }, 0.5, 0.5)).toBeCloseTo(0.75);
    const strongThenWeak = [{ id: 5, mode: "paint" as const, operation: "replace" as const, size: 0.2, strength: 1, points: point }, { id: 6, mode: "paint" as const, operation: "replace" as const, size: 0.2, strength: 0.25, points: point }];
    const weakThenStrong = [...strongThenWeak].reverse();
    expect(regionWeightAt({ ...region, strokes: strongThenWeak }, 0.5, 0.5)).toBe(0.25);
    expect(regionWeightAt({ ...region, strokes: weakThenStrong }, 0.5, 0.5)).toBe(1);
    expect(regionWeightAt({ ...region, baseFill: 1, strokes: [strongThenWeak[1]!] }, 0.5, 0.5)).toBe(0.25);
  });

  it("treats zero and invalid strengths as no-op and clamps out-of-range values", () => {
    const point = [{ x: 0.5, y: 0.5 }];
    const snapshot = (strength: number): RegionSnapshot => ({
      baseFill: 0,
      inverted: false,
      strokes: [{ id: 1, mode: "paint", operation: "replace", size: 0.2, strength, points: point }],
    });
    expect(regionWeightAt(snapshot(0), 0.5, 0.5)).toBe(0);
    expect(regionWeightAt(snapshot(Number.NaN), 0.5, 0.5)).toBe(0);
    expect(regionWeightAt(snapshot(-1), 0.5, 0.5)).toBe(0);
    expect(regionWeightAt(snapshot(2), 0.5, 0.5)).toBe(1);
  });

  it("keeps paint and erase intuitive while inverted", () => {
    const point = [{ x: 0.5, y: 0.5 }];
    const rawHalf: RegionSnapshot = {
      baseFill: 0,
      inverted: true,
      strokes: [
        { id: 1, mode: "paint", size: 0.2, strength: 0.75, points: point },
        { id: 2, mode: "erase", size: 0.2, strength: 0.25, points: point },
      ],
    };
    expect(regionWeightAt(rawHalf, 0.5, 0.5)).toBeCloseTo(0.5);
    const effectivePaint = { id: 3, mode: "paint" as const, operation: "replace" as const, target: 0.25, size: 0.2, strength: 0.75, points: point };
    expect(regionWeightAt({ ...rawHalf, strokes: [...rawHalf.strokes, effectivePaint] }, 0.5, 0.5)).toBeCloseTo(0.75);
    const effectiveErase = { id: 4, mode: "paint" as const, operation: "add" as const, size: 0.2, strength: 0.25, points: point };
    expect(regionWeightAt({ ...rawHalf, strokes: [...rawHalf.strokes, effectiveErase] }, 0.5, 0.5)).toBeCloseTo(0.25);
  });

  it("uses full strength for legacy strokes and inverts only the final weight", () => {
    const legacy: RegionSnapshot = {
      baseFill: 0,
      inverted: false,
      feather: 0.08,
      strokes: [{ id: 1, mode: "paint", size: 0.2, points: [{ x: 0.5, y: 0.5 }] }],
    };
    expect(regionWeightAt(legacy, 0.5, 0.5)).toBe(1);
    expect(regionWeightAt({ ...legacy, inverted: true }, 0.5, 0.5)).toBe(0);
    expect(regionWeightAt({ ...legacy, inverted: true }, 0.1, 0.1)).toBe(1);
    const legacyStrengthStrokes: RegionSnapshot = {
      baseFill: 0,
      inverted: false,
      strokes: [
        { id: 2, mode: "paint", size: 0.2, strength: 0.25, points: [{ x: 0.5, y: 0.5 }] },
        { id: 3, mode: "paint", size: 0.2, strength: 0.25, points: [{ x: 0.5, y: 0.5 }] },
      ],
    };
    expect(regionWeightAt(legacyStrengthStrokes, 0.5, 0.5)).toBe(0.5);
  });
});
