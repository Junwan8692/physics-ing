import { describe, expect, it } from "vitest";
import { createScrollAdapter } from "../src/input/scroll";

const scripted = (positions: number[]) => {
  let i = 0;
  return () => positions[Math.min(i++, positions.length - 1)] ?? 0;
};

describe("createScrollAdapter", () => {
  it("has the scroll id", () => expect(createScrollAdapter().id).toBe("scroll"));

  it("reports zero acceleration while the page is still", () => {
    const a = createScrollAdapter({ readScrollY: () => 100 });
    a.attach();
    for (let i = 0; i < 10; i += 1) a.sample(1 / 60);
    expect(Math.abs(a.sample(1 / 60).localAcceleration!.y)).toBeLessThan(1e-6);
  });

  it("produces non-zero acceleration when scrolling starts", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 0, 40, 90, 150]) });
    a.attach();
    let peak = 0;
    for (let i = 0; i < 5; i += 1) peak = Math.max(peak, Math.abs(a.sample(1 / 60).localAcceleration!.y));
    expect(peak).toBeGreaterThan(0);
  });

  it("never exceeds maxAcceleration", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 1e5, 0, 1e5, 0]), maxAcceleration: 8 });
    a.attach();
    for (let i = 0; i < 5; i += 1) {
      expect(Math.abs(a.sample(1 / 60).localAcceleration!.y)).toBeLessThanOrEqual(8 + 1e-9);
    }
  });

  it("decays back toward zero after scrolling stops", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 50, 100, 150]) });
    a.attach();
    let last = 0;
    for (let i = 0; i < 40; i += 1) last = a.sample(1 / 60).localAcceleration!.y;
    expect(Math.abs(last)).toBeLessThan(0.05);
  });

  it("never emits NaN even for a zero dt", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 10, 20]) });
    a.attach();
    a.sample(0);
    expect(Number.isFinite(a.sample(0).localAcceleration!.y)).toBe(true);
  });

  it("emits no input while disabled", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 500, 1000]) });
    a.attach();
    a.enabled = false;
    expect(a.sample(1 / 60)).toEqual({});
  });

  it("exposes gain and smoothing as live knobs", () => {
    const a = createScrollAdapter();
    a.gain = 0.005;
    a.smoothingSeconds = 0.1;
    expect(a.gain).toBe(0.005);
    expect(a.smoothingSeconds).toBe(0.1);
  });
});
