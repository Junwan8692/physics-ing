import type { InputAdapterId } from "../core/types";

/** frameTarget은 하나만 채택된다. 명시적 조작이 암묵적 움직임을 이긴다. */
export const FRAME_TARGET_PRIORITY: readonly InputAdapterId[] =
  ["pointer", "devicemotion", "scroll", "auto"];

/** PhysicsSimulator.step()이 거는 값과 동일 (vendor/purupuru/core/simulator.ts:151-152). */
export const LOCAL_ACCELERATION_CLAMP = 8;
export const AUTOMATIC_ACCELERATION_CLAMP = 1;
