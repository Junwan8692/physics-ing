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

describe("자동 재생 방향", () => {
  /** 한 주기 동안 각 축의 최대 진폭을 잰다. */
  const amplitude = (motion: "sway" | "hop" | "orbit"): { x: number; y: number } => {
    const adapter = createAutoAdapter({ motion, periodMs: 1000 });
    adapter.attach();
    let x = 0, y = 0;
    for (let i = 0; i < 120; i += 1) {
      const v = adapter.sample(1 / 60).automaticAcceleration!;
      x = Math.max(x, Math.abs(v.x));
      y = Math.max(y, Math.abs(v.y));
    }
    return { x, y };
  };

  it("sway 는 좌우로만 움직인다", () => {
    const { x, y } = amplitude("sway");
    expect(x).toBeGreaterThan(0.1);
    expect(y).toBe(0);
  });

  it("hop 은 세로가 지배적이다", () => {
    // 배선이 틀려 sway 가 그대로 나오면 y 가 0 이라 여기서 걸린다.
    const { x, y } = amplitude("hop");
    expect(y).toBeGreaterThan(0.1);
    expect(y).toBeGreaterThan(x * 4);
  });

  it("orbit 은 두 축을 비슷하게 쓴다", () => {
    const { x, y } = amplitude("orbit");
    expect(x).toBeGreaterThan(0.1);
    expect(y).toBeGreaterThan(0.1);
    expect(Math.max(x, y) / Math.min(x, y)).toBeLessThan(2);
  });

  it("세기 0 이면 어떤 방향이든 멈춘다", () => {
    for (const motion of ["sway", "hop", "orbit"] as const) {
      const adapter = createAutoAdapter({ motion, strength: 0 });
      adapter.attach();
      for (let i = 0; i < 60; i += 1) {
        const v = adapter.sample(1 / 60).automaticAcceleration!;
        expect(Math.hypot(v.x, v.y), motion).toBeLessThan(1e-9);
      }
    }
  });
});
