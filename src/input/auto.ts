import type { InputAdapter } from "../core/types";
import type { PhysicsInput } from "../vendor/purupuru/core/types";
import {
  AUTO_FRAME_TRAVEL,
  DEFAULT_AUTO_MOTION_PERIOD_MS,
  DEFAULT_AUTO_MOTION_STRENGTH,
  mapAutoMotionStrength,
  sampleAutoMotion,
} from "../vendor/purupuru/motion/motion";
import type { AutoMotionId } from "../vendor/purupuru/motion/types";

export interface AutoAdapterOptions {
  motion?: AutoMotionId;
  /** 0~100 퍼센트. 벤더의 mapAutoMotionStrength 곡선을 탄다. */
  strength?: number;
  periodMs?: number;
  seed?: number;
}

/** 셋 다 저작툴 슬라이더로 만지는 값이라 런타임 가변이다. */
export type AutoAdapter = InputAdapter & {
  motion: AutoMotionId;
  strength: number;
  periodMs: number;
};

export function createAutoAdapter(options: AutoAdapterOptions = {}): AutoAdapter {
  const seed = options.seed ?? 1;
  let elapsedSeconds = 0;
  const reset = (): void => {
    elapsedSeconds = 0;
  };

  const adapter: AutoAdapter = {
    id: "auto",
    enabled: true,
    motion: options.motion ?? "sway",
    strength: options.strength ?? DEFAULT_AUTO_MOTION_STRENGTH,
    periodMs: options.periodMs ?? DEFAULT_AUTO_MOTION_PERIOD_MS,
    attach: reset,
    detach: reset,
    sample(dtSeconds: number): PhysicsInput {
      if (!adapter.enabled) return {};
      if (Number.isFinite(dtSeconds) && dtSeconds > 0) elapsedSeconds += dtSeconds;
      // periodMs는 슬라이더 값이다. NaN이 들어오면 벤더 클램프를 그대로 통과하므로 여기서 막는다.
      const periodMs = Number.isFinite(adapter.periodMs) ? adapter.periodMs : DEFAULT_AUTO_MOTION_PERIOD_MS;
      const periodSeconds = Math.max(1e-3, periodMs / 1000);
      const vector = sampleAutoMotion(adapter.motion, elapsedSeconds, {
        amplitude: mapAutoMotionStrength(adapter.strength),
        speed: 1 / periodSeconds,
        seed,
        periodSeconds,
      });
      return {
        automaticAcceleration: vector,
        frameDragging: true,
        frameTarget: vector,
        frameTravelLimit: AUTO_FRAME_TRAVEL,
      };
    },
  };
  return adapter;
}
