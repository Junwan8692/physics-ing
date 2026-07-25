import type { InputAdapter } from "../core/types";
import type { PhysicsInput } from "../vendor/purupuru/core/types";

export interface ScrollAdapterOptions {
  readScrollY?: () => number;
  gain?: number;
  smoothingSeconds?: number;
  maxAcceleration?: number;
}

/** gain과 smoothingSeconds는 눈으로 맞추는 값이라 런타임 가변이어야 한다. */
export type ScrollAdapter = InputAdapter & { gain: number; smoothingSeconds: number };

export function createScrollAdapter(options: ScrollAdapterOptions = {}): ScrollAdapter {
  // 기본 리더만 브라우저 전역을 읽는다. 비브라우저에서는 0 — readScrollY를 주입할 것.
  const readScrollY = options.readScrollY ?? (() => globalThis.scrollY ?? 0);
  const maxAcceleration = options.maxAcceleration ?? 8;
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
    gain: options.gain ?? 0.0015,
    smoothingSeconds: options.smoothingSeconds ?? 0.04,
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
