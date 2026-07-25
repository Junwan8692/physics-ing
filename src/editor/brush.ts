import { GRID_K } from "../core/grid";
import type { RegionSnapshot, RegionStroke } from "../vendor/purupuru/region/model";

export interface BrushSettings { size: number; strength: number; mode: "paint" | "erase"; }

/**
 * regionWeightAt은 격자 정점 위치만 검사한다. 정점을 못 덮는 브러시는 아무것도 안 움직인다.
 * 정점 간격이 짧은 변의 1/K 이므로 지름이 2/K 이면 최악의 정렬에서도 정점을 문다.
 * 실측: 하드코딩한 0.02는 정점을 0개 고른다. GRID_K에서 유도할 것 — 스펙 §4.6.
 */
export const BRUSH_MIN = 2 / GRID_K;
export const BRUSH_MAX = 0.5;
export const DEFAULT_BRUSH: BrushSettings = { size: 0.12, strength: 1, mode: "paint" };

/** 점을 촘촘히 쌓으면 regionWeightAt이 느려진다. */
const DEFAULT_MINIMUM_SPACING = 0.004;

export const nextStrokeId = (region: RegionSnapshot): number =>
  region.strokes.reduce((highest, stroke) => Math.max(highest, stroke.id), 0) + 1;

export function beginStroke(settings: BrushSettings, id: number, point: { x: number; y: number }): RegionStroke {
  return {
    id, mode: settings.mode,
    size: Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, settings.size)),
    strength: settings.strength,
    operation: settings.mode === "paint" ? "add" : "subtract",
    points: [{ ...point }],
  };
}

export function extendStroke(
  stroke: RegionStroke,
  point: { x: number; y: number },
  minimumSpacing = DEFAULT_MINIMUM_SPACING,
): RegionStroke {
  const last = stroke.points[stroke.points.length - 1];
  const points = stroke.points.map((item) => ({ ...item }));
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minimumSpacing) return { ...stroke, points };
  return { ...stroke, points: [...points, { ...point }] };
}
