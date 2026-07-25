import type { MeshData, MotionParameters, PhysicsInput } from "../vendor/purupuru/core/types";
import type { RegionSnapshot } from "../vendor/purupuru/region/model";

/** 픽셀 사각형. 원본 이미지 좌표계. */
export interface Rect { x: number; y: number; width: number; height: number; }

export interface GridSize { columns: number; rows: number; pitch: number; }

export type InputAdapterId = "scroll" | "pointer" | "devicemotion" | "auto";

export interface InputAdapter {
  readonly id: InputAdapterId;
  enabled: boolean;
  sample(dtSeconds: number): PhysicsInput;
  attach(): void;
  detach(): void;
}

export interface TaggedInput { id: InputAdapterId; input: PhysicsInput; }

export type QualityTierId = "high" | "medium" | "low";

export interface JiggleProject {
  format: "jiggle-project";
  version: 1;
  /** 원본 슬라이스. 뷰어가 정적 배경으로 깐다. */
  source: { src: string; width: number; height: number };
  /** 원본 안에서 물리가 적용되는 픽셀 사각형. */
  crop: Rect;
  /** 스트로크 좌표는 crop 기준 UV [0,1]. */
  region: RegionSnapshot;
  motion: MotionParameters;
  seed: number;
}

/** buildCut의 산출물. 시뮬레이터에 넘길 준비가 된 메시. */
export interface BuiltCut { mesh: MeshData; grid: GridSize; crop: Rect; }
