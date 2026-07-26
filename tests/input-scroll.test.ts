import { describe, expect, it } from "vitest";
import {
  createScrollAdapter,
  DEFAULT_SCROLL_SMOOTHING_SECONDS,
  DEFAULT_SCROLL_MAX_ACCELERATION,
} from "../src/input/scroll";

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
    // 감쇠는 평활 시상수에 비례한다. 창을 시상수의 8배로 잡아야 상수를 바꿔도 의미가 유지된다
    // (8τ 면 e^-8 ≈ 0.0003 배까지 떨어진다). 고정 프레임 수로 두면 τ 를 올릴 때 헛되이 깨진다.
    const smoothingSeconds = DEFAULT_SCROLL_SMOOTHING_SECONDS;
    const a = createScrollAdapter({ readScrollY: scripted([0, 50, 100, 150]) });
    a.attach();
    let last = 0;
    for (let i = 0; i < Math.ceil(smoothingSeconds * 8 * 60); i += 1) {
      last = a.sample(1 / 60).localAcceleration!.y;
    }
    expect(Math.abs(last)).toBeLessThan(0.05);
  });

  it("보통 읽기 속도에서 클램프에 붙지 않는다", () => {
    // 회귀: 예전 기본값(gain 0.0015 / 평활 0.04s)은 900px/s 스크롤에서 이미 최대치에 붙어
    // 모든 스크롤이 같은 세기가 됐고, 그 세기가 메시를 접었다.
    const positions: number[] = [];
    let y = 0;
    for (let i = 0; i < 90; i += 1) {
      const t = i / 60;
      const v = t < 0.15 ? 900 * (t / 0.15) : t < 0.6 ? 900 : t < 0.85 ? 900 * (1 - (t - 0.6) / 0.25) : 0;
      y += v / 60;
      positions.push(y);
    }
    let index = 0;
    const a = createScrollAdapter({ readScrollY: () => positions[Math.min(index, positions.length - 1)] ?? 0 });
    a.attach();
    let peak = 0;
    for (; index < positions.length; index += 1) {
      peak = Math.max(peak, Math.abs(a.sample(1 / 60).localAcceleration!.y));
    }
    expect(peak).toBeGreaterThan(0.1);                                  // 보이긴 해야 한다
    expect(peak).toBeLessThan(DEFAULT_SCROLL_MAX_ACCELERATION * 0.9);   // 포화는 아니어야 한다
  });

  it("아무리 세게 튕겨도 접힘 한계(2)를 넘지 않는다", () => {
    // 실측: 구동 세기 2 이하는 뒤집힌 삼각형 0, 3부터 접히기 시작한다.
    const a = createScrollAdapter({ readScrollY: scripted([0, 1e5, 2e5, 3e5, 4e5]) });
    a.attach();
    for (let i = 0; i < 20; i += 1) {
      expect(Math.abs(a.sample(1 / 60).localAcceleration!.y)).toBeLessThanOrEqual(2 + 1e-9);
    }
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
