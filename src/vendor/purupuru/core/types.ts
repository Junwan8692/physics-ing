/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type GravityDirection = "none" | "down" | "up" | "left" | "right";

export interface MotionParameters {
  inputStrength: number;
  stretch: number;
  bounce: number;
  damping: number;
  cohesion: number;
  gravityDirection: GravityDirection;
  gravityStrength: number;
  fluctuation: number;
  maxStretch?: number;
}

export interface SolverQuality {
  tickRate: 60 | 120;
  iterations: 3 | 4 | 6;
  maxCatchUpSteps: number;
}

export interface PhysicsInput {
  frameDragging?: boolean;
  frameTarget?: Point;
  frameTravelLimit?: number;
  /** Sensor or other uniform local acceleration. */
  localAcceleration?: Point;
  /** Zero-net deformation input used by automatic motion. */
  automaticAcceleration?: Point;
}

export interface RigidFrameState {
  position: Point;
  velocity: Point;
  acceleration: Point;
}

export interface MeshData {
  columns: number;
  rows: number;
  restPositions: Float64Array;
  positions: Float64Array;
  previousPositions: Float64Array;
  velocities: Float64Array;
  uvs: Float32Array;
  indices: Uint32Array;
  weights: Float64Array;
  inverseMasses: Float64Array;
}

export interface PhysicsSnapshot {
  version: 1;
  seed: number;
  tick: number;
  accumulator: number;
  randomState: number;
  gravityElapsedSeconds: number;
  parameters: MotionParameters;
  quality: SolverQuality;
  positions: number[];
  previousPositions: number[];
  velocities: number[];
  secondaryOffsets: number[];
  secondaryVelocities: number[];
  frame: RigidFrameState;
  constraintLambdas: {
    tetherX: number[];
    tetherY: number[];
    distance: number[];
    maximumDistance: number[];
    area: number[];
  };
  clusterRotations: number[];
}
