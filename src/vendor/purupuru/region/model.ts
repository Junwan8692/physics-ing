/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
export type Point = { x: number; y: number };
export type StrokeMode = "paint" | "erase";
export type RegionStroke = {
  id: number;
  mode: StrokeMode;
  size: number;
  /** Missing only in snapshots created before strength controls were introduced. */
  strength?: number;
  /** Explicit composition used by strength-aware strokes. Missing values use mode-compatible fallback behavior. */
  operation?: "replace" | "add" | "subtract";
  /** Raw target weight for replace operations, accounting for inversion at gesture creation time. */
  target?: number;
  points: Point[];
};
export type RegionSnapshot = {
  baseFill: 0 | 1;
  inverted: boolean;
  /** Ignored legacy field kept so old serialized snapshots remain readable. */
  feather?: number;
  strokes: RegionStroke[];
};

export const EMPTY_REGION: RegionSnapshot = { baseFill: 0, inverted: false, strokes: [] };

export function strokeStrength(stroke: RegionStroke): number {
  if (stroke.strength === undefined) return 1;
  if (!Number.isFinite(stroke.strength)) return 0;
  return Math.max(0, Math.min(1, stroke.strength));
}

export function applyStrokeStrength(weight: number, stroke: RegionStroke, coverage = 1): number {
  const normalizedCoverage = Number.isFinite(coverage) ? Math.max(0, Math.min(1, coverage)) : 0;
  const strength = strokeStrength(stroke);
  const operation = stroke.operation ?? (stroke.mode === "paint" ? "add" : "subtract");
  if (operation === "replace") {
    const target = stroke.target === undefined
      ? strength
      : Number.isFinite(stroke.target) ? Math.max(0, Math.min(1, stroke.target)) : 0;
    return Math.max(0, Math.min(1, weight + (target - weight) * normalizedCoverage));
  }
  const delta = strength * normalizedCoverage * (operation === "add" ? 1 : -1);
  return Math.max(0, Math.min(1, weight + delta));
}

function imageAxisScales(imageWidth: number, imageHeight: number): Point {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) {
    throw new RangeError("Region image dimensions must be finite positive numbers.");
  }
  const shortEdge = Math.min(imageWidth, imageHeight);
  return { x: imageWidth / shortEdge, y: imageHeight / shortEdge };
}

function squaredDistanceToSegment(point: Point, start: Point, end: Point, axisScales: Point): number {
  const dx = (end.x - start.x) * axisScales.x;
  const dy = (end.y - start.y) * axisScales.y;
  const pointDx = (point.x - start.x) * axisScales.x;
  const pointDy = (point.y - start.y) * axisScales.y;
  if (dx === 0 && dy === 0) return pointDx ** 2 + pointDy ** 2;
  const ratio = Math.max(0, Math.min(1, (pointDx * dx + pointDy * dy) / (dx * dx + dy * dy)));
  const nearestDx = pointDx - dx * ratio;
  const nearestDy = pointDy - dy * ratio;
  return nearestDx ** 2 + nearestDy ** 2;
}

function strokeContainsWithScales(stroke: RegionStroke, point: Point, axisScales: Point): boolean {
  const radiusSquared = (stroke.size / 2) ** 2;
  if (stroke.points.length === 1) {
    const first = stroke.points[0];
    return first ? squaredDistanceToSegment(point, first, first, axisScales) <= radiusSquared : false;
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    const start = stroke.points[index - 1];
    const end = stroke.points[index];
    if (start && end && squaredDistanceToSegment(point, start, end, axisScales) <= radiusSquared) return true;
  }
  return false;
}

export function strokeContains(stroke: RegionStroke, point: Point, imageWidth: number, imageHeight: number): boolean {
  return strokeContainsWithScales(stroke, point, imageAxisScales(imageWidth, imageHeight));
}

export function regionWeightAt(region: RegionSnapshot, u: number, v: number, imageWidth: number, imageHeight: number): number {
  const axisScales = imageAxisScales(imageWidth, imageHeight);
  let weight: number = region.baseFill;
  for (const stroke of region.strokes) {
    if (strokeContainsWithScales(stroke, { x: u, y: v }, axisScales)) weight = applyStrokeStrength(weight, stroke);
  }
  return region.inverted ? 1 - weight : weight;
}

export class RegionHistory {
  private entries: RegionSnapshot[];
  private cursor = 0;
  readonly checkpoints = new Map<number, RegionSnapshot>();

  constructor(initial: RegionSnapshot = EMPTY_REGION, private readonly checkpointInterval = 12) {
    this.entries = [cloneSnapshot(initial)];
    this.checkpoints.set(0, cloneSnapshot(initial));
  }

  get current(): RegionSnapshot {
    return cloneSnapshot(this.entries[this.cursor] ?? EMPTY_REGION);
  }

  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.entries.length - 1; }

  commit(next: RegionSnapshot): RegionSnapshot {
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(cloneSnapshot(next));
    this.cursor += 1;
    if (this.cursor % this.checkpointInterval === 0) this.checkpoints.set(this.cursor, cloneSnapshot(next));
    return this.current;
  }

  undo(): RegionSnapshot {
    if (this.canUndo) this.cursor -= 1;
    return this.current;
  }

  redo(): RegionSnapshot {
    if (this.canRedo) this.cursor += 1;
    return this.current;
  }
}

export function cloneSnapshot(snapshot: RegionSnapshot): RegionSnapshot {
  return { ...snapshot, strokes: snapshot.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })) };
}

export function effectiveStrokeMode(mode: StrokeMode, inverted: boolean): StrokeMode {
  if (!inverted) return mode;
  return mode === "paint" ? "erase" : "paint";
}

export function estimateCoverage(snapshot: RegionSnapshot, imageWidth: number, imageHeight: number): number {
  const samplesPerAxis = 32;
  let total = 0;
  for (let row = 0; row < samplesPerAxis; row += 1) {
    for (let column = 0; column < samplesPerAxis; column += 1) {
      total += regionWeightAt(snapshot, (column + 0.5) / samplesPerAxis, (row + 0.5) / samplesPerAxis, imageWidth, imageHeight);
    }
  }
  return total / (samplesPerAxis * samplesPerAxis);
}
