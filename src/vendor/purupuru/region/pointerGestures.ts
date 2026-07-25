/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
export type ScreenPoint = { x: number; y: number };

export function pointerCentroid(pointers: ReadonlyMap<number, ScreenPoint>): ScreenPoint | undefined {
  if (pointers.size === 0) return undefined;
  let x = 0;
  let y = 0;
  for (const point of pointers.values()) {
    x += point.x;
    y += point.y;
  }
  return { x: x / pointers.size, y: y / pointers.size };
}
