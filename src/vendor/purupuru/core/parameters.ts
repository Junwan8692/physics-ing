/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import { clamp } from "./math";
import type { MotionParameters } from "./types";

export interface ResolvedPhysicsParameters {
  inputGain: number;
  distanceCompliance: number;
  tetherCompliance: number;
  shapeStrength: number;
  dampingRate: number;
  gravityAcceleration: number;
  gravityTargetDisplacement: number;
  floatingAcceleration: number;
  fluctuationAcceleration: number;
  maximumStretchRatio: number;
  maximumDisplacement: number;
  maximumSpeed: number;
  secondaryMotionStrength: number;
  secondaryFrequency: number;
  secondaryDampingRatio: number;
  secondaryVerticalBias: number;
  secondaryPhaseSpread: number;
  elongationStrength: number;
  tremorStrength: number;
  tremorFrequency: number;
}

const normalized = (value: number): number => clamp(value, 0, 100) / 100;

export function resolveParameters(parameters: MotionParameters): ResolvedPhysicsParameters {
  const stretch = normalized(parameters.stretch);
  const bounce = normalized(parameters.bounce);
  const damping = normalized(parameters.damping);
  const cohesion = normalized(parameters.cohesion);
  const input = normalized(parameters.inputStrength);
  const fluctuation = normalized(parameters.fluctuation);
  const maximumStretch = parameters.maxStretch === undefined
    ? 1.12 + stretch * 0.68
    : 1.02 + normalized(parameters.maxStretch) * 0.98;
  const secondaryRaw = bounce * bounce * (1 - damping) * (0.25 + stretch)
    + (1 - cohesion) ** 4 * (1 - damping);
  const secondaryMotionStrength = clamp((secondaryRaw - 0.08) * 2.1, 0, 1);
  const elongationStrength = stretch * stretch
    * (1 - cohesion) ** 1.2
    * (0.65 + stretch * 1.8)
    * (1 + bounce * 1.4)
    * 1.33;
  const tremorStrength = clamp(
    fluctuation * fluctuation * (1 - stretch) * (0.4 + bounce * 0.6) * 20,
    0,
    1,
  );

  return {
    inputGain: 0.6 + input * 4.8,
    distanceCompliance: 2e-7 + stretch * stretch * 9e-4,
    tetherCompliance: 1e-6 + (1 - bounce) ** 2 * 3.2e-3 + secondaryMotionStrength * 7e-4,
    shapeStrength: 0.01 + cohesion ** 4 * 0.6,
    dampingRate: (0.25 + damping * damping * 18) * (0.04 + cohesion ** 3 * 0.96),
    gravityAcceleration: clamp(parameters.gravityStrength, 0, 2) * 0.6,
    gravityTargetDisplacement: clamp(parameters.gravityStrength, 0, 2) * 0.035,
    floatingAcceleration: (3.5 + stretch * 5) * (1 - damping * 0.45),
    fluctuationAcceleration: fluctuation * 0.08,
    maximumStretchRatio: maximumStretch,
    maximumDisplacement: 0.16 + stretch * 0.6,
    maximumSpeed: 3.5 + stretch * 7,
    secondaryMotionStrength,
    secondaryFrequency: 1.7 + bounce * 1.1,
    secondaryDampingRatio: 0.025 + damping * 0.18 + cohesion * 0.18,
    secondaryVerticalBias: 0.65 + secondaryMotionStrength * 0.25,
    secondaryPhaseSpread: 0.025 + secondaryMotionStrength * 0.13 + fluctuation * 0.025,
    elongationStrength,
    tremorStrength,
    tremorFrequency: 8 + cohesion * 2 + bounce * 1.5,
  };
}

export const MOTION_PRESETS = {
  purupuru: { inputStrength: 82, stretch: 90, bounce: 28, damping: 8, cohesion: 8, gravityDirection: "down", gravityStrength: 1, fluctuation: 5, maxStretch: 100 },
  sloshing: { inputStrength: 72, stretch: 55, bounce: 95, damping: 20, cohesion: 50, gravityDirection: "down", gravityStrength: 0.8, fluctuation: 0, maxStretch: 85 },
  shivery: { inputStrength: 55, stretch: 70, bounce: 88, damping: 30, cohesion: 50, gravityDirection: "down", gravityStrength: 0.9, fluctuation: 30, maxStretch: 40 },
  floaty: { inputStrength: 46, stretch: 100, bounce: 15, damping: 0, cohesion: 0, gravityDirection: "none", gravityStrength: 0, fluctuation: 50, maxStretch: 100 },
} as const satisfies Record<string, MotionParameters>;
