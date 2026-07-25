import { describe, expect, it } from "vitest";
import { createAutoAdapter } from "../src/input/auto";
import type { AutoMotionId } from "../src/vendor/purupuru/motion/types";

describe("createAutoAdapter", () => {
  it("has the auto id", () => expect(createAutoAdapter().id).toBe("auto"));

  it("stays finite for 240 frames", () => {
    const adapter = createAutoAdapter();
    adapter.attach();
    for (let frame = 0; frame < 240; frame += 1) {
      const vector = adapter.sample(1 / 60).automaticAcceleration!;
      expect(Number.isFinite(vector.x)).toBe(true);
      expect(Number.isFinite(vector.y)).toBe(true);
    }
  });

  it("actually moves during one period", () => {
    const adapter = createAutoAdapter();
    adapter.attach();
    let peak = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const vector = adapter.sample(1 / 60).automaticAcceleration!;
      peak = Math.max(peak, Math.hypot(vector.x, vector.y));
    }
    expect(peak).toBeGreaterThan(0);
  });

  it("runs every motion id without throwing", () => {
    for (const motion of ["sway", "hop", "orbit"] satisfies AutoMotionId[]) {
      const adapter = createAutoAdapter({ motion });
      adapter.attach();
      expect(() => {
        for (let frame = 0; frame < 120; frame += 1) adapter.sample(1 / 60);
      }).not.toThrow();
    }
  });

  it("is silent at zero strength", () => {
    const adapter = createAutoAdapter({ strength: 0 });
    adapter.attach();
    let peak = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      const vector = adapter.sample(1 / 60).automaticAcceleration!;
      peak = Math.max(peak, Math.hypot(vector.x, vector.y));
    }
    expect(peak).toBeCloseTo(0);
  });

  it("emits no input while disabled", () => {
    const adapter = createAutoAdapter();
    adapter.attach();
    adapter.enabled = false;
    expect(adapter.sample(1 / 60)).toEqual({});
  });
});
