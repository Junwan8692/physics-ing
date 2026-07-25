import type { GridSize } from "./types";

/**
 * 짧은 변을 몇 칸으로 나눌지. 이 값이 ABI다 — 스펙 §4.9.
 * 엔진의 모든 힘·거리 상수가 짧은 변 정규화 단위이므로 pitch/short 만이 불변량이다.
 * 실측: 종횡비 1:1~8:1 에서 진폭 편차 5.9%, 뒤집힌 삼각형 0.
 * short/33 보다 곱게 가면 접힌다.
 */
export const GRID_K = 25;

export function gridForImage(width: number, height: number): GridSize {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError("Image dimensions must be finite positive numbers.");
  }
  const short = Math.min(width, height);
  return {
    columns: Math.max(4, Math.round(GRID_K * width / short)),
    rows: Math.max(4, Math.round(GRID_K * height / short)),
    pitch: short / GRID_K,
  };
}
