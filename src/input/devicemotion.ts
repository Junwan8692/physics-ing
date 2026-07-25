import type { InputAdapter } from "../core/types";
import type { PhysicsInput } from "../vendor/purupuru/core/types";
import {
  EMPTY_SENSOR_FILTER,
  SENSOR_ACTIVE_THRESHOLD,
  SENSOR_MAXIMUM_FRAME_TRAVEL,
  processSensorSample,
  type SensorFilterState,
} from "../vendor/purupuru/motion/motion";
import type { MotionVector } from "../vendor/purupuru/motion/types";

/**
 * src/input에서 DOM을 만지는 유일한 파일이다 (스펙 §6).
 * 실기기 없이 의미 있는 단위 테스트가 안 나오므로 Task 12의 실기기 확인으로 미룬다.
 */

export type DeviceMotionStatus = "off" | "active" | "denied" | "unsupported";
export type DeviceMotionPermission = "granted" | "denied" | "unsupported";

export interface DeviceMotionAdapterOptions {
  /** 실물 센서는 기기마다 다르게 읽힌다. 벤더가 0.25~2로 클램프한다. */
  sensitivity?: number;
}

export type DeviceMotionAdapter = InputAdapter & {
  readonly status: DeviceMotionStatus;
  requestPermission(): Promise<DeviceMotionPermission>;
};

type DeviceMotionConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function createDeviceMotionAdapter(options: DeviceMotionAdapterOptions = {}): DeviceMotionAdapter {
  const sensitivity = options.sensitivity ?? 1;
  const supported = typeof window !== "undefined" && "DeviceMotionEvent" in window;

  let status: DeviceMotionStatus = supported ? "off" : "unsupported";
  let granted = false;
  let filter: SensorFilterState = EMPTY_SENSOR_FILTER;
  let target: MotionVector = { x: 0, y: 0 };
  let previousEventMs = 0;

  const onMotion = (event: DeviceMotionEvent): void => {
    const direct = event.acceleration;
    const includingGravity = event.accelerationIncludingGravity;
    const source = direct?.x != null || direct?.y != null ? direct : includingGravity;
    if (!source) return;
    const now = performance.now();
    const measured = previousEventMs > 0 ? (now - previousEventMs) / 1000 : 0;
    const reported = Number.isFinite(event.interval) && event.interval > 0 ? event.interval / 1000 : 0;
    previousEventMs = now;
    const result = processSensorSample(
      {
        x: source.x,
        y: source.y,
        includesGravity: source === includingGravity,
        screenAngle: screen.orientation?.angle ?? 0,
        intervalSeconds: measured || reported || 1 / 60,
      },
      filter,
      sensitivity,
    );
    filter = result.state;
    target = result.vector;
  };

  const clearState = (): void => {
    filter = EMPTY_SENSOR_FILTER;
    target = { x: 0, y: 0 };
    previousEventMs = 0;
  };

  const adapter: DeviceMotionAdapter = {
    id: "devicemotion",
    enabled: true,
    get status(): DeviceMotionStatus {
      return status;
    },
    // 권한을 받기 전에는 아무것도 붙이지 않는다. 리스너를 붙이는 건 requestPermission이다.
    attach(): void {
      if (!supported || !granted) return;
      clearState();
      window.removeEventListener("devicemotion", onMotion);
      window.addEventListener("devicemotion", onMotion);
      status = "active";
    },
    detach(): void {
      if (supported) window.removeEventListener("devicemotion", onMotion);
      clearState();
      if (status === "active") status = "off";
    },
    async requestPermission(): Promise<DeviceMotionPermission> {
      if (!supported) {
        status = "unsupported";
        return "unsupported";
      }
      // iOS만 제스처 안에서의 명시적 승인을 요구한다. 없으면 바로 시작.
      const constructor = DeviceMotionEvent as DeviceMotionConstructor;
      try {
        const permission = constructor.requestPermission ? await constructor.requestPermission() : "granted";
        if (permission !== "granted") {
          granted = false;
          status = "denied";
          return "denied";
        }
      } catch {
        granted = false;
        status = "denied";
        return "denied";
      }
      granted = true;
      adapter.attach();
      return "granted";
    },
    sample(): PhysicsInput {
      if (!adapter.enabled || status !== "active") return {};
      if (Math.hypot(target.x, target.y) <= SENSOR_ACTIVE_THRESHOLD) return {};
      return {
        frameDragging: true,
        frameTarget: { x: target.x, y: target.y },
        frameTravelLimit: SENSOR_MAXIMUM_FRAME_TRAVEL,
      };
    },
  };
  return adapter;
}
