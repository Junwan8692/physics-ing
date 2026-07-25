import { clampMagnitude } from "../vendor/purupuru/core/math";
import type { PhysicsInput, Point } from "../vendor/purupuru/core/types";
import type { TaggedInput } from "../core/types";
import { AUTOMATIC_ACCELERATION_CLAMP, FRAME_TARGET_PRIORITY, LOCAL_ACCELERATION_CLAMP } from "./types";

/** 성분 단위로 거른다. 한 축이 NaN이라고 멀쩡한 다른 축까지 버리지 않는다. */
const addFinite = (total: Point, value: Point): Point => ({
  x: total.x + (Number.isFinite(value.x) ? value.x : 0),
  y: total.y + (Number.isFinite(value.y) ? value.y : 0),
});

export function combineInputs(samples: readonly TaggedInput[]): PhysicsInput {
  if (samples.length === 0) return {};
  let local: Point = { x: 0, y: 0 };
  let automatic: Point = { x: 0, y: 0 };
  let sawLocal = false;
  let sawAutomatic = false;

  for (const { input } of samples) {
    if (input.localAcceleration) {
      local = addFinite(local, input.localAcceleration);
      sawLocal = true;
    }
    if (input.automaticAcceleration) {
      automatic = addFinite(automatic, input.automaticAcceleration);
      sawAutomatic = true;
    }
  }

  const combined: PhysicsInput = {};
  if (sawLocal) combined.localAcceleration = clampMagnitude(local, LOCAL_ACCELERATION_CLAMP);
  if (sawAutomatic) combined.automaticAcceleration = clampMagnitude(automatic, AUTOMATIC_ACCELERATION_CLAMP);

  for (const id of FRAME_TARGET_PRIORITY) {
    const winner = samples.find(
      (sample) => sample.id === id && sample.input.frameDragging === true && sample.input.frameTarget !== undefined,
    )?.input;
    // 위 술어가 이미 보장하지만 exactOptionalPropertyTypes 때문에 좁히기가 한 번 더 필요하다.
    if (!winner?.frameTarget) continue;
    combined.frameDragging = true;
    combined.frameTarget = winner.frameTarget;
    if (winner.frameTravelLimit !== undefined) combined.frameTravelLimit = winner.frameTravelLimit;
    break;
  }
  return combined;
}
