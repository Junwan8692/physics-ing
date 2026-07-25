/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_SENSOR_FILTER,
  processSensorSample,
  type SensorFilterState,
} from "./motion";
import type { MotionVector } from "./types";

type PermissionResult = "granted" | "denied";
type DeviceMotionConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionResult>;
};

export type DeviceMotionStatus = "off" | "requesting" | "active" | "denied" | "unsupported" | "waiting";
export type DeviceMotionSource = "none" | "linear-acceleration" | "gravity-fallback";

export interface DeviceMotionDebug {
  eventHz: number;
  screenAngle: number;
  source: DeviceMotionSource;
}

export interface DeviceMotionController {
  status: DeviceMotionStatus;
  frameTarget: MotionVector;
  debug: DeviceMotionDebug;
  enable: () => Promise<void>;
  disable: () => void;
}

export function useDeviceMotion(sensitivity = 1): DeviceMotionController {
  const supported = typeof window !== "undefined" && "DeviceMotionEvent" in window;
  const [status, setStatus] = useState<DeviceMotionStatus>(supported ? "off" : "unsupported");
  const [frameTarget, setFrameTarget] = useState<MotionVector>({ x: 0, y: 0 });
  const [debug, setDebug] = useState<DeviceMotionDebug>({ eventHz: 0, screenAngle: 0, source: "none" });
  const filterRef = useRef<SensorFilterState>(EMPTY_SENSOR_FILTER);
  const lastEventRef = useRef(0);
  const previousEventRef = useRef(0);

  const onMotion = useCallback(
    (event: DeviceMotionEvent) => {
      const direct = event.acceleration;
      const includingGravity = event.accelerationIncludingGravity;
      const source = direct?.x != null || direct?.y != null ? direct : includingGravity;
      if (!source) return;
      const now = performance.now();
      const measuredInterval = previousEventRef.current > 0 ? (now - previousEventRef.current) / 1000 : 0;
      const reportedInterval = Number.isFinite(event.interval) && event.interval > 0 ? event.interval / 1000 : 0;
      const intervalSeconds = measuredInterval || reportedInterval || 1 / 60;
      const screenAngle = window.screen.orientation?.angle ?? window.orientation ?? 0;

      const result = processSensorSample(
        {
          x: source.x,
          y: source.y,
          includesGravity: source === includingGravity,
          screenAngle,
          intervalSeconds,
        },
        filterRef.current,
        sensitivity,
      );
      filterRef.current = result.state;
      lastEventRef.current = now;
      previousEventRef.current = now;
      setFrameTarget(result.vector);
      setDebug({
        eventHz: 1 / Math.max(1 / 240, intervalSeconds),
        screenAngle,
        source: source === includingGravity ? "gravity-fallback" : "linear-acceleration",
      });
      setStatus("active");
    },
    [sensitivity],
  );

  const disable = useCallback(() => {
    window.removeEventListener("devicemotion", onMotion);
    filterRef.current = EMPTY_SENSOR_FILTER;
    previousEventRef.current = 0;
    setFrameTarget({ x: 0, y: 0 });
    setDebug({ eventHz: 0, screenAngle: 0, source: "none" });
    setStatus(supported ? "off" : "unsupported");
  }, [onMotion, supported]);

  const enable = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting");
    const constructor = DeviceMotionEvent as DeviceMotionConstructor;
    try {
      const permission = constructor.requestPermission
        ? await constructor.requestPermission()
        : "granted";
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      filterRef.current = EMPTY_SENSOR_FILTER;
      previousEventRef.current = 0;
      setFrameTarget({ x: 0, y: 0 });
      setDebug({ eventHz: 0, screenAngle: 0, source: "none" });
      lastEventRef.current = performance.now();
      setStatus("waiting");
      window.addEventListener("devicemotion", onMotion);
    } catch {
      setStatus("denied");
    }
  }, [onMotion, supported]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) disable();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [disable, onMotion]);

  useEffect(() => {
    if (status !== "active") return;
    const timer = window.setInterval(() => {
      if (performance.now() - lastEventRef.current <= 500) return;
      filterRef.current = EMPTY_SENSOR_FILTER;
      previousEventRef.current = 0;
      setFrameTarget({ x: 0, y: 0 });
      setDebug((current) => ({ ...current, eventHz: 0 }));
      setStatus("waiting");
    }, 250);
    return () => window.clearInterval(timer);
  }, [status]);

  return { status, frameTarget, debug, enable, disable };
}
