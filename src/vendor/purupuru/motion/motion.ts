/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import type { AutoMotionId, MotionVector, PointerDragOptions } from "./types";

export interface AutoMotionOptions {
  amplitude: number;
  speed: number;
  seed: number;
  periodSeconds?: number;
}

export interface SensorFilterState {
  gravity: MotionVector;
  gravityInitialized: boolean;
  smoothed: MotionVector;
  velocity: MotionVector;
  position: MotionVector;
}

export interface SensorSample {
  x: number | null;
  y: number | null;
  includesGravity: boolean;
  screenAngle: number;
  intervalSeconds?: number;
}

const TAU = Math.PI * 2;
export const DEFAULT_AUTO_MOTION_STRENGTH = 50;
export const DEFAULT_AUTO_MOTION_PERIOD_MS = 1000;
export const MIN_AUTO_MOTION_PERIOD_MS = 200;
export const MAX_AUTO_MOTION_PERIOD_MS = 1800;
export const AUTO_MOTION_PERIOD_STEP_MS = 25;
export const AUTO_FRAME_TRAVEL = 0.16;
export const AUTO_MOTION_SPEED = 1000 / DEFAULT_AUTO_MOTION_PERIOD_MS;
export const POINTER_DRAG_GAIN = 0.32;
export const POINTER_MAXIMUM_TRAVEL = 0.08;
export const SENSOR_MAXIMUM_FRAME_TRAVEL = 0.08;
export const SENSOR_ACTIVE_THRESHOLD = 0.0005;

export type FrameInputSource = "manual" | "sensor" | "automatic" | "none";

export interface SelectedFrameInput {
  source: FrameInputSource;
  dragging: boolean;
  target: MotionVector;
  travelLimit?: number;
}

export function selectFrameInput(
  manualTarget: MotionVector | undefined,
  sensorTarget: MotionVector,
  automaticTarget: MotionVector,
  automaticEnabled: boolean,
): SelectedFrameInput {
  if (manualTarget) return { source: "manual", dragging: true, target: manualTarget };
  if (Math.hypot(sensorTarget.x, sensorTarget.y) > SENSOR_ACTIVE_THRESHOLD) {
    return { source: "sensor", dragging: true, target: sensorTarget };
  }
  if (automaticEnabled) {
    return { source: "automatic", dragging: true, target: automaticTarget, travelLimit: AUTO_FRAME_TRAVEL };
  }
  return { source: "none", dragging: false, target: { x: 0, y: 0 } };
}

const AUTO_STRENGTH_CURVE = [
  { percent: 0, amplitude: 0 },
  { percent: 25, amplitude: 0.3 },
  { percent: 50, amplitude: 0.6 },
  { percent: 80, amplitude: 0.84 },
  { percent: 100, amplitude: 1 },
] as const;

export function mapAutoMotionStrength(strengthPercent: number): number {
  const percent = Number.isFinite(strengthPercent)
    ? Math.max(0, Math.min(100, strengthPercent))
    : 0;
  for (let index = 1; index < AUTO_STRENGTH_CURVE.length; index += 1) {
    const upper = AUTO_STRENGTH_CURVE[index];
    const lower = AUTO_STRENGTH_CURVE[index - 1];
    if (!upper || !lower || percent > upper.percent) continue;
    const progress = (percent - lower.percent) / (upper.percent - lower.percent);
    return lower.amplitude + (upper.amplitude - lower.amplitude) * progress;
  }
  return 1;
}

export function samplePointerDrag(
  origin: MotionVector,
  current: MotionVector,
  viewportShortSide: number,
  options: PointerDragOptions = {},
): MotionVector {
  if (!(viewportShortSide > 0) || !Number.isFinite(viewportShortSide)) {
    return { x: 0, y: 0 };
  }
  const gain = Number.isFinite(options.gain) ? Math.max(0, options.gain ?? POINTER_DRAG_GAIN) : POINTER_DRAG_GAIN;
  const maximumTravel = Number.isFinite(options.maximumTravel)
    ? Math.max(0, options.maximumTravel ?? POINTER_MAXIMUM_TRAVEL)
    : POINTER_MAXIMUM_TRAVEL;
  const target = {
    x: ((current.x - origin.x) / viewportShortSide) * gain,
    y: ((current.y - origin.y) / viewportShortSide) * gain,
  };
  const magnitude = Math.hypot(target.x, target.y);
  if (!Number.isFinite(magnitude)) return { x: 0, y: 0 };
  if (magnitude <= maximumTravel || magnitude === 0) return target;
  const scale = maximumTravel / magnitude;
  return { x: target.x * scale, y: target.y * scale };
}

export function combineMotionVectors(...vectors: readonly MotionVector[]): MotionVector {
  const combined = vectors.reduce<MotionVector>((sum, vector) => ({
    x: sum.x + (Number.isFinite(vector.x) ? vector.x : 0),
    y: sum.y + (Number.isFinite(vector.y) ? vector.y : 0),
  }), { x: 0, y: 0 });
  const magnitude = Math.hypot(combined.x, combined.y);
  if (magnitude <= 1 || magnitude === 0) return combined;
  return { x: combined.x / magnitude, y: combined.y / magnitude };
}

function hashNoise(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value / 0xffffffff;
}

function sampleHermiteSegment(
  progress: number,
  startProgress: number,
  endProgress: number,
  startPosition: number,
  endPosition: number,
  startVelocity: number,
  endVelocity: number,
): number {
  const duration = endProgress - startProgress;
  const t = (progress - startProgress) / duration;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * startPosition
    + (t3 - 2 * t2 + t) * duration * startVelocity
    + (-2 * t3 + 3 * t2) * endPosition
    + (t3 - t2) * duration * endVelocity;
}

interface HopTimeline {
  period: number;
  takeoffEnd: number;
  hangEnd: number;
  fallEnd: number;
  compressionEnd: number;
  firstRecoilEnd: number;
  secondRecoilEnd: number;
  settleEnd: number;
}

const BASE_HOP_TIMELINE: HopTimeline = {
  period: 0.625,
  takeoffEnd: 0.14 / 1.6,
  hangEnd: 0.24 / 1.6,
  fallEnd: 0.48 / 1.6,
  compressionEnd: 0.56 / 1.6,
  firstRecoilEnd: 0.66 / 1.6,
  secondRecoilEnd: 0.74 / 1.6,
  settleEnd: 0.84 / 1.6,
};

export function getHopTimeline(periodSeconds: number): HopTimeline {
  const period = Math.max(MIN_AUTO_MOTION_PERIOD_MS / 1000, Math.min(MAX_AUTO_MOTION_PERIOD_MS / 1000, periodSeconds));
  const minimumUnscaledPeriod = 0.5;
  if (period < minimumUnscaledPeriod) {
    const scale = period / minimumUnscaledPeriod;
    const minimumTimeline = getHopTimeline(minimumUnscaledPeriod);
    return {
      period,
      takeoffEnd: minimumTimeline.takeoffEnd * scale,
      hangEnd: minimumTimeline.hangEnd * scale,
      fallEnd: minimumTimeline.fallEnd * scale,
      compressionEnd: minimumTimeline.compressionEnd * scale,
      firstRecoilEnd: minimumTimeline.firstRecoilEnd * scale,
      secondRecoilEnd: minimumTimeline.secondRecoilEnd * scale,
      settleEnd: minimumTimeline.settleEnd * scale,
    };
  }
  const difference = period - BASE_HOP_TIMELINE.period;
  const hangAdjustment = difference >= 0
    ? difference * 0.25
    : Math.min(0, difference + (BASE_HOP_TIMELINE.period - BASE_HOP_TIMELINE.settleEnd));
  return {
    period,
    takeoffEnd: BASE_HOP_TIMELINE.takeoffEnd,
    hangEnd: BASE_HOP_TIMELINE.hangEnd + hangAdjustment,
    fallEnd: BASE_HOP_TIMELINE.fallEnd + hangAdjustment,
    compressionEnd: BASE_HOP_TIMELINE.compressionEnd + hangAdjustment,
    firstRecoilEnd: BASE_HOP_TIMELINE.firstRecoilEnd + hangAdjustment,
    secondRecoilEnd: BASE_HOP_TIMELINE.secondRecoilEnd + hangAdjustment,
    settleEnd: BASE_HOP_TIMELINE.settleEnd + hangAdjustment,
  };
}

function sampleTimedHop(timeSeconds: number, periodSeconds: number): number {
  const timeline = getHopTimeline(periodSeconds);
  const progress = ((timeSeconds % timeline.period) + timeline.period) % timeline.period;
  const referenceContactVelocity = 6 * 1.6;
  const contactVelocity = timeline.period < 0.5
    ? referenceContactVelocity * (0.5 / timeline.period)
    : referenceContactVelocity;
  if (progress < timeline.takeoffEnd) {
    const takeoff = progress / timeline.takeoffEnd;
    return -(takeoff ** 3 * (takeoff * (takeoff * 6 - 15) + 10));
  }
  if (progress < timeline.hangEnd) {
    const hang = (progress - timeline.takeoffEnd) / (timeline.hangEnd - timeline.takeoffEnd);
    return -1 + (1 - Math.cos(hang * Math.PI)) * 0.04;
  }
  if (progress < timeline.fallEnd) {
    return sampleHermiteSegment(progress, timeline.hangEnd, timeline.fallEnd, -0.92, 0, 0, contactVelocity);
  }
  if (progress < timeline.compressionEnd) {
    return sampleHermiteSegment(progress, timeline.fallEnd, timeline.compressionEnd, 0, 0.22, contactVelocity, 0);
  }
  if (progress < timeline.firstRecoilEnd) {
    return sampleHermiteSegment(progress, timeline.compressionEnd, timeline.firstRecoilEnd, 0.22, -0.065, 0, 0);
  }
  if (progress < timeline.secondRecoilEnd) {
    return sampleHermiteSegment(progress, timeline.firstRecoilEnd, timeline.secondRecoilEnd, -0.065, 0.035, 0, 0);
  }
  if (progress < timeline.settleEnd) {
    return sampleHermiteSegment(progress, timeline.secondRecoilEnd, timeline.settleEnd, 0.035, 0, 0, 0);
  }
  return 0;
}

export function sampleAutoMotion(
  id: AutoMotionId,
  timeSeconds: number,
  options: AutoMotionOptions,
): MotionVector {
  const amplitude = Math.max(0, Math.min(1, options.amplitude));
  if (amplitude === 0) return { x: 0, y: 0 };
  const speed = Math.max(0.1, Math.min(3, options.speed));
  const periodSeconds = options.periodSeconds === undefined
    ? 1 / speed
    : Math.max(MIN_AUTO_MOTION_PERIOD_MS / 1000, Math.min(MAX_AUTO_MOTION_PERIOD_MS / 1000, options.periodSeconds));
  const phase = timeSeconds / periodSeconds * TAU;

  if (id === "hop") {
    if (options.periodSeconds !== undefined) {
      const lateral = Math.sin(phase) * (hashNoise(options.seed, 0) - 0.5) * 0.025;
      return { x: lateral * amplitude, y: sampleTimedHop(timeSeconds, periodSeconds) * amplitude };
    }
    const progress = ((timeSeconds * speed) % 1 + 1) % 1;
    let jump = 0;
    if (progress < 0.14) {
      const takeoff = progress / 0.14;
      const easedTakeoff = takeoff ** 3 * (takeoff * (takeoff * 6 - 15) + 10);
      jump = -easedTakeoff;
    } else if (progress < 0.24) {
      const hang = (progress - 0.14) / 0.1;
      jump = -1 + (1 - Math.cos(hang * Math.PI)) * 0.04;
    } else if (progress < 0.48) {
      jump = sampleHermiteSegment(progress, 0.24, 0.48, -0.92, 0, 0, 6);
    } else if (progress < 0.56) {
      jump = sampleHermiteSegment(progress, 0.48, 0.56, 0, 0.22, 6, 0);
    } else if (progress < 0.66) {
      jump = sampleHermiteSegment(progress, 0.56, 0.66, 0.22, -0.065, 0, 0);
    } else if (progress < 0.74) {
      jump = sampleHermiteSegment(progress, 0.66, 0.74, -0.065, 0.035, 0, 0);
    } else if (progress < 0.84) {
      jump = sampleHermiteSegment(progress, 0.74, 0.84, 0.035, 0, 0, 0);
    }
    const lateral = Math.sin(phase) * (hashNoise(options.seed, 0) - 0.5) * 0.025;
    return { x: lateral * amplitude, y: jump * amplitude };
  }

  if (id === "orbit") {
    const warpedPhase = phase + Math.sin(phase) * 0.22;
    const radius = amplitude * (0.89 + Math.sin(phase * 0.5) * 0.11);
    return {
      x: Math.cos(warpedPhase) * radius,
      y: Math.sin(warpedPhase) * radius,
    };
  }

  return {
    x: -Math.tanh(Math.cos(phase) * 2.2) / Math.tanh(2.2) * amplitude,
    y: 0,
  };
}

export function deviceToStageAcceleration(vector: MotionVector, angle: number): MotionVector {
  const normalized = ((angle % 360) + 360) % 360;
  const screen = normalized === 90
    ? { x: -vector.y, y: vector.x }
    : normalized === 180
      ? { x: -vector.x, y: -vector.y }
      : normalized === 270
        ? { x: vector.y, y: -vector.x }
        : vector;
  return { x: screen.x, y: -screen.y };
}

function applyRadialDeadZone(vector: MotionVector, deadZone: number): MotionVector {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(magnitude) || magnitude <= deadZone) return { x: 0, y: 0 };
  const adjustedMagnitude = Math.min(1, (magnitude - deadZone) / (1 - deadZone));
  const scale = adjustedMagnitude / magnitude;
  return { x: vector.x * scale, y: vector.y * scale };
}

function clampVector(vector: MotionVector, maximum: number): MotionVector {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(magnitude)) return { x: 0, y: 0 };
  if (magnitude <= maximum || magnitude === 0) return vector;
  const scale = maximum / magnitude;
  return { x: vector.x * scale, y: vector.y * scale };
}

export function processSensorSample(
  sample: SensorSample,
  previous: SensorFilterState,
  sensitivity: number,
): { vector: MotionVector; state: SensorFilterState } {
  const raw = { x: sample.x ?? 0, y: sample.y ?? 0 };
  const intervalSeconds = Number.isFinite(sample.intervalSeconds)
    ? Math.max(1 / 240, Math.min(0.1, sample.intervalSeconds ?? 1 / 60))
    : 1 / 60;
  const gravityRetention = Math.exp(-intervalSeconds / 0.22);
  const gravity = sample.includesGravity
    ? previous.gravityInitialized
      ? {
          x: previous.gravity.x * gravityRetention + raw.x * (1 - gravityRetention),
          y: previous.gravity.y * gravityRetention + raw.y * (1 - gravityRetention),
        }
      : raw
    : previous.gravity;
  const linear = sample.includesGravity
    ? previous.gravityInitialized
      ? { x: raw.x - gravity.x, y: raw.y - gravity.y }
      : { x: 0, y: 0 }
    : raw;
  const stage = deviceToStageAcceleration(linear, sample.screenAngle);
  const scale = Math.max(0.25, Math.min(2, sensitivity)) / 9.81;
  const normalized = clampVector({ x: stage.x * scale, y: stage.y * scale }, 1);
  const deadZoned = applyRadialDeadZone(normalized, 0.045);
  const smoothing = 1 - Math.exp(-intervalSeconds / 0.04);
  const smoothed = {
    x: previous.smoothed.x + (deadZoned.x - previous.smoothed.x) * smoothing,
    y: previous.smoothed.y + (deadZoned.y - previous.smoothed.y) * smoothing,
  };
  const drive = 10;
  const spring = 24;
  const damping = 5.5;
  const acceleration = {
    x: smoothed.x * drive - previous.position.x * spring - previous.velocity.x * damping,
    y: smoothed.y * drive - previous.position.y * spring - previous.velocity.y * damping,
  };
  const velocity = {
    x: previous.velocity.x + acceleration.x * intervalSeconds,
    y: previous.velocity.y + acceleration.y * intervalSeconds,
  };
  const unclampedPosition = {
    x: previous.position.x + velocity.x * intervalSeconds,
    y: previous.position.y + velocity.y * intervalSeconds,
  };
  const position = clampVector(unclampedPosition, SENSOR_MAXIMUM_FRAME_TRAVEL);
  if (position.x !== unclampedPosition.x || position.y !== unclampedPosition.y) {
    const outwardSpeed = velocity.x * position.x + velocity.y * position.y;
    if (outwardSpeed > 0) {
      const lengthSquared = position.x * position.x + position.y * position.y;
      if (lengthSquared > 0) {
        velocity.x -= (outwardSpeed / lengthSquared) * position.x;
        velocity.y -= (outwardSpeed / lengthSquared) * position.y;
      }
    }
  }

  return {
    vector: position,
    state: {
      gravity,
      gravityInitialized: previous.gravityInitialized || sample.includesGravity,
      smoothed,
      velocity,
      position,
    },
  };
}

export const EMPTY_SENSOR_FILTER: SensorFilterState = {
  gravity: { x: 0, y: 0 },
  gravityInitialized: false,
  smoothed: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  position: { x: 0, y: 0 },
};
