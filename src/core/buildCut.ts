import { createGridMesh } from "../vendor/purupuru/core/mesh";
import { PhysicsSimulator } from "../vendor/purupuru/core/simulator";
import { regionWeightAt } from "../vendor/purupuru/region/model";
import type { SolverQuality } from "../vendor/purupuru/core/types";
import { gridForImage } from "./grid";
import type { BuiltCut, JiggleProject } from "./types";

/**
 * 크롭 이미지 하나가 곧 물리 이미지다.
 * region의 스트로크 좌표는 이미 크롭 기준 UV라 그대로 넘긴다.
 * calculateGridDimensions를 쓰지 않는다 — 스펙 §4.1.
 */
export function buildCut(project: JiggleProject): BuiltCut {
  const { width, height } = project.crop;
  const grid = gridForImage(width, height);
  const mesh = createGridMesh({
    columns: grid.columns,
    rows: grid.rows,
    imageWidth: width,
    imageHeight: height,
    weights: (u, v) => regionWeightAt(project.region, u, v, width, height),
  });
  return { mesh, grid, crop: { ...project.crop } };
}

export function createSimulator(
  built: BuiltCut,
  project: JiggleProject,
  quality: SolverQuality,
): PhysicsSimulator {
  return new PhysicsSimulator({
    mesh: built.mesh,
    parameters: project.motion,
    seed: project.seed,
    quality,
  });
}
