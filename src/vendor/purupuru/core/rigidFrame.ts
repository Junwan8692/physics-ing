/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import { clampMagnitude } from "./math";
import type { PhysicsInput, RigidFrameState } from "./types";

export const MAXIMUM_FRAME_TRAVEL = 0.08;
export const MAXIMUM_AUTOMATIC_FRAME_TRAVEL = 0.16;

export function createRigidFrameState(): RigidFrameState {
  return {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
  };
}

export function stepRigidFrame(frame: RigidFrameState, input: PhysicsInput, dt: number): void {
  const travelLimit = input.frameTravelLimit === undefined
    ? MAXIMUM_FRAME_TRAVEL
    : Math.max(MAXIMUM_FRAME_TRAVEL, Math.min(MAXIMUM_AUTOMATIC_FRAME_TRAVEL, input.frameTravelLimit));
  const requestedTarget = input.frameDragging && input.frameTarget
    ? clampMagnitude(input.frameTarget, travelLimit)
    : { x: 0, y: 0 };
  if (input.frameDragging) {
    const previousVelocity = { ...frame.velocity };
    const response = travelLimit > MAXIMUM_FRAME_TRAVEL ? 35 : 70;
    const blend = 1 - Math.exp(-response * dt);
    const nextPosition = {
      x: frame.position.x + (requestedTarget.x - frame.position.x) * blend,
      y: frame.position.y + (requestedTarget.y - frame.position.y) * blend,
    };
    frame.velocity = clampMagnitude({
      x: (nextPosition.x - frame.position.x) / dt,
      y: (nextPosition.y - frame.position.y) / dt,
    }, 3);
    frame.acceleration = clampMagnitude({
      x: (frame.velocity.x - previousVelocity.x) / dt,
      y: (frame.velocity.y - previousVelocity.y) / dt,
    }, 55);
    frame.position = clampMagnitude(nextPosition, travelLimit);
    return;
  }

  const stiffness = 68;
  const damping = 8.5;
  const acceleration = {
    x: (requestedTarget.x - frame.position.x) * stiffness - frame.velocity.x * damping,
    y: (requestedTarget.y - frame.position.y) * stiffness - frame.velocity.y * damping,
  };
  frame.acceleration = clampMagnitude(acceleration, 22);
  frame.velocity.x += frame.acceleration.x * dt;
  frame.velocity.y += frame.acceleration.y * dt;
  frame.velocity = clampMagnitude(frame.velocity, 1.8);
  frame.position.x += frame.velocity.x * dt;
  frame.position.y += frame.velocity.y * dt;
  const releaseTravelLimit = Math.hypot(frame.position.x, frame.position.y) > MAXIMUM_FRAME_TRAVEL + 1e-9
    ? MAXIMUM_AUTOMATIC_FRAME_TRAVEL
    : MAXIMUM_FRAME_TRAVEL;
  const clamped = clampMagnitude(frame.position, releaseTravelLimit);
  if (clamped.x !== frame.position.x || clamped.y !== frame.position.y) {
    const outwardSpeed = frame.velocity.x * clamped.x + frame.velocity.y * clamped.y;
    if (outwardSpeed > 0) {
      const lengthSquared = clamped.x * clamped.x + clamped.y * clamped.y;
      if (lengthSquared > 0) {
        frame.velocity.x -= (outwardSpeed / lengthSquared) * clamped.x;
        frame.velocity.y -= (outwardSpeed / lengthSquared) * clamped.y;
      }
    }
    frame.position = clamped;
  }
}
