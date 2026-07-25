import type { InputAdapter } from "../core/types";
import type { PhysicsInput } from "../vendor/purupuru/core/types";
import { POINTER_MAXIMUM_TRAVEL, samplePointerDrag } from "../vendor/purupuru/motion/motion";
import type { MotionVector, PointerDragOptions } from "../vendor/purupuru/motion/types";

export interface PointerAdapterOptions {
  /**
   * 드래그 변위를 나눌 기준 길이. 벤더 `samplePointerDrag`의 3번째 인자다.
   * 기본 1 — setPointer가 이미 정규화된 좌표를 받는다고 본다.
   * 픽셀 좌표를 넣을 거면 요소의 짧은 변을 돌려주는 함수를 준다.
   * (DOM은 읽지 않는다 — src/input에서 DOM은 devicemotion.ts만 만진다.)
   */
  readShortSide?: () => number;
  gain?: number;
  maximumTravel?: number;
}

export type PointerAdapter = InputAdapter & {
  /** 첫 호출이 원점을 고정한다. null이면 드래그 종료. */
  setPointer(position: MotionVector | null): void;
};

export function createPointerAdapter(options: PointerAdapterOptions = {}): PointerAdapter {
  const readShortSide = options.readShortSide ?? (() => 1);
  // exactOptionalPropertyTypes 때문에 undefined를 그대로 실어 보낼 수 없다.
  const dragOptions: PointerDragOptions = {};
  if (options.gain !== undefined) dragOptions.gain = options.gain;
  if (options.maximumTravel !== undefined) dragOptions.maximumTravel = options.maximumTravel;
  const travelLimit = options.maximumTravel ?? POINTER_MAXIMUM_TRAVEL;

  let origin: MotionVector | null = null;
  let current: MotionVector | null = null;

  const reset = (): void => {
    origin = null;
    current = null;
  };

  const adapter: PointerAdapter = {
    id: "pointer",
    enabled: true,
    attach: reset,
    detach: reset,
    setPointer(position: MotionVector | null): void {
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        reset();
        return;
      }
      origin ??= { x: position.x, y: position.y };
      current = { x: position.x, y: position.y };
    },
    sample(): PhysicsInput {
      if (!adapter.enabled || !origin || !current) return {};
      return {
        frameDragging: true,
        frameTarget: samplePointerDrag(origin, current, readShortSide(), dragOptions),
        frameTravelLimit: travelLimit,
      };
    },
  };
  return adapter;
}
