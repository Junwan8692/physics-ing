import type { InputAdapter } from "../core/types";
import type { PhysicsInput } from "../vendor/purupuru/core/types";

export interface ScrollAdapterOptions {
  readScrollY?: () => number;
  gain?: number;
  smoothingSeconds?: number;
  maxAcceleration?: number;
}

/**
 * 아래 세 기본값은 실측으로 정했다. 임의로 올리면 메시가 접힌다.
 *
 * 구동 세기 한계: 웹툰 프리셋 4종 × 크롭 3종 × 600틱에서 세기 2 이하는 뒤집힌 삼각형 0,
 * 3부터 나타나고 8에서는 최대 218/600틱이 접힌다. 그래서 클램프가 2다.
 *
 * 평활이 진짜 지렛대다. 가속도는 위치의 2차 미분이라 스크롤이 시작되는 순간 저크가 튄다.
 * 0.04s 로는 그 스파이크가 그대로 통과해서 보통 읽기 속도에서 이미 클램프에 붙었고
 * (천천히 3.62 → 세게 8.00, 동적 범위 2.2배) 결과적으로 모든 스크롤이 같은 세기로 느껴졌다.
 * 0.25s 로 늘리면 천천히 0.23 / 보통 0.52 / 빠름 1.04 / 플릭 2.32 로 20배 범위가 살아난다.
 *
 * 읽는 동안은 은은하고 플릭에서 눈에 띄는 게 의도다 — 스크롤 내내 세게 출렁이면 읽기 방해다.
 */
export const DEFAULT_SCROLL_GAIN = 0.0004;
export const DEFAULT_SCROLL_SMOOTHING_SECONDS = 0.25;
export const DEFAULT_SCROLL_MAX_ACCELERATION = 2;

/** gain과 smoothingSeconds는 눈으로 맞추는 값이라 런타임 가변이어야 한다. */
export type ScrollAdapter = InputAdapter & { gain: number; smoothingSeconds: number };

export function createScrollAdapter(options: ScrollAdapterOptions = {}): ScrollAdapter {
  // 기본 리더만 브라우저 전역을 읽는다. 비브라우저에서는 0 — readScrollY를 주입할 것.
  const readScrollY = options.readScrollY ?? (() => globalThis.scrollY ?? 0);
  const maxAcceleration = options.maxAcceleration ?? DEFAULT_SCROLL_MAX_ACCELERATION;
  let previousY: number | null = null;
  let velocity = 0;
  let acceleration = 0;

  const reset = (): void => {
    previousY = null;
    velocity = 0;
    acceleration = 0;
  };
  const clamp = (value: number): number =>
    Number.isFinite(value) ? Math.max(-maxAcceleration, Math.min(maxAcceleration, value)) : 0;

  const adapter: ScrollAdapter = {
    id: "scroll",
    enabled: true,
    gain: options.gain ?? DEFAULT_SCROLL_GAIN,
    smoothingSeconds: options.smoothingSeconds ?? DEFAULT_SCROLL_SMOOTHING_SECONDS,
    attach: reset,
    detach: reset,
    sample(dtSeconds: number): PhysicsInput {
      if (!adapter.enabled) return {};
      // dt가 비정상이면 상태를 굴리지 않고 직전 값을 낸다.
      if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
        return { localAcceleration: { x: 0, y: clamp(acceleration * adapter.gain) } };
      }
      const y = readScrollY();
      if (previousY === null || !Number.isFinite(y)) {
        previousY = Number.isFinite(y) ? y : 0;
        return { localAcceleration: { x: 0, y: 0 } };
      }
      const rawVelocity = (y - previousY) / dtSeconds;
      previousY = y;
      const smoothing = 1 - Math.exp(-dtSeconds / Math.max(1e-4, adapter.smoothingSeconds));
      const nextVelocity = velocity + (rawVelocity - velocity) * smoothing;
      const rawAcceleration = (nextVelocity - velocity) / dtSeconds;
      velocity = nextVelocity;
      acceleration += (rawAcceleration - acceleration) * smoothing;
      return { localAcceleration: { x: 0, y: clamp(acceleration * adapter.gain) } };
    },
  };
  return adapter;
}
