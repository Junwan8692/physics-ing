import { describe, expect, it } from "vitest";
import { combineInputs } from "../src/input/combine";
import type { TaggedInput } from "../src/core/types";

describe("combineInputs", () => {
  it("returns an empty input for no samples", () => expect(combineInputs([])).toEqual({}));

  it("sums localAcceleration", () => {
    expect(combineInputs([
      { id: "scroll", input: { localAcceleration: { x: 1, y: 2 } } },
      { id: "devicemotion", input: { localAcceleration: { x: 3, y: 1 } } },
    ]).localAcceleration).toEqual({ x: 4, y: 3 });
  });

  it("clamps summed localAcceleration to magnitude 8", () => {
    const samples: TaggedInput[] = Array.from({ length: 5 }, () =>
      ({ id: "scroll" as const, input: { localAcceleration: { x: 10, y: 0 } } }));
    const c = combineInputs(samples).localAcceleration!;
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(8);
  });

  it("clamps summed automaticAcceleration to magnitude 1", () => {
    const c = combineInputs([
      { id: "auto", input: { automaticAcceleration: { x: 5, y: 0 } } },
      { id: "auto", input: { automaticAcceleration: { x: 5, y: 0 } } },
    ]).automaticAcceleration!;
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(1);
  });

  it("prefers the pointer frameTarget over everything", () => {
    expect(combineInputs([
      { id: "auto", input: { frameDragging: true, frameTarget: { x: 0.9, y: 0.9 } } },
      { id: "scroll", input: { frameDragging: true, frameTarget: { x: 0.5, y: 0.5 } } },
      { id: "pointer", input: { frameDragging: true, frameTarget: { x: 0.1, y: 0.1 } } },
    ]).frameTarget).toEqual({ x: 0.1, y: 0.1 });
  });

  it("falls through the priority order", () => {
    expect(combineInputs([
      { id: "auto", input: { frameDragging: true, frameTarget: { x: 0.9, y: 0.9 } } },
      { id: "scroll", input: { frameDragging: true, frameTarget: { x: 0.5, y: 0.5 } } },
    ]).frameTarget).toEqual({ x: 0.5, y: 0.5 });
  });

  it("ignores a frameTarget whose adapter is not dragging", () => {
    expect(combineInputs([
      { id: "pointer", input: { frameDragging: false, frameTarget: { x: 0.1, y: 0.1 } } },
      { id: "scroll", input: { frameDragging: true, frameTarget: { x: 0.5, y: 0.5 } } },
    ]).frameTarget).toEqual({ x: 0.5, y: 0.5 });
  });

  it("drops non-finite contributions instead of poisoning the sum", () => {
    expect(combineInputs([
      { id: "scroll", input: { localAcceleration: { x: Number.NaN, y: 1 } } },
      { id: "auto", input: { localAcceleration: { x: 2, y: 1 } } },
    ]).localAcceleration).toEqual({ x: 2, y: 2 });
  });
});
