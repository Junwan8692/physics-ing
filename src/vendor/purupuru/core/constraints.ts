/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import { EPSILON, signedTriangleArea } from "./math";
import type { MeshData } from "./types";

export interface DistanceConstraint {
  a: number;
  b: number;
  restLength: number;
}

export interface AreaConstraint {
  a: number;
  b: number;
  c: number;
  minimumArea: number;
}

export interface ConstraintSet {
  distances: DistanceConstraint[];
  areas: AreaConstraint[];
  tetherX: Float64Array;
  tetherY: Float64Array;
  distanceLambdas: Float64Array;
  maximumDistanceLambdas: Float64Array;
  areaLambdas: Float64Array;
}

function vertexDistance(positions: Float64Array, a: number, b: number): number {
  const ax = positions[a * 2] ?? 0;
  const ay = positions[a * 2 + 1] ?? 0;
  const bx = positions[b * 2] ?? 0;
  const by = positions[b * 2 + 1] ?? 0;
  return Math.hypot(ax - bx, ay - by);
}

export function createConstraintSet(mesh: MeshData, minimumAreaRatio = 0.08): ConstraintSet {
  const distances: DistanceConstraint[] = [];
  const areas: AreaConstraint[] = [];
  const vertexColumns = mesh.columns + 1;

  const addDistance = (a: number, b: number): void => {
    if ((mesh.inverseMasses[a] ?? 0) <= 0 && (mesh.inverseMasses[b] ?? 0) <= 0) return;
    distances.push({ a, b, restLength: vertexDistance(mesh.restPositions, a, b) });
  };

  for (let row = 0; row <= mesh.rows; row += 1) {
    for (let column = 0; column <= mesh.columns; column += 1) {
      const vertex = row * vertexColumns + column;
      if (column < mesh.columns) addDistance(vertex, vertex + 1);
      if (row < mesh.rows) addDistance(vertex, vertex + vertexColumns);
      if (column < mesh.columns && row < mesh.rows) {
        addDistance(vertex, vertex + vertexColumns + 1);
        addDistance(vertex + 1, vertex + vertexColumns);

        const topRight = vertex + 1;
        const bottomLeft = vertex + vertexColumns;
        const bottomRight = bottomLeft + 1;
        const addArea = (a: number, b: number, c: number): void => {
          if (
            (mesh.inverseMasses[a] ?? 0) <= 0
            && (mesh.inverseMasses[b] ?? 0) <= 0
            && (mesh.inverseMasses[c] ?? 0) <= 0
          ) return;
          const area = signedTriangleArea(
            mesh.restPositions[a * 2] ?? 0,
            mesh.restPositions[a * 2 + 1] ?? 0,
            mesh.restPositions[b * 2] ?? 0,
            mesh.restPositions[b * 2 + 1] ?? 0,
            mesh.restPositions[c * 2] ?? 0,
            mesh.restPositions[c * 2 + 1] ?? 0,
          );
          areas.push({ a, b, c, minimumArea: area * minimumAreaRatio });
        };
        addArea(vertex, topRight, bottomRight);
        addArea(vertex, bottomRight, bottomLeft);
      }
    }
  }

  return {
    distances,
    areas,
    tetherX: new Float64Array(mesh.weights.length),
    tetherY: new Float64Array(mesh.weights.length),
    distanceLambdas: new Float64Array(distances.length),
    maximumDistanceLambdas: new Float64Array(distances.length),
    areaLambdas: new Float64Array(areas.length),
  };
}

export function resetConstraintLambdas(constraints: ConstraintSet): void {
  constraints.tetherX.fill(0);
  constraints.tetherY.fill(0);
  constraints.distanceLambdas.fill(0);
  constraints.maximumDistanceLambdas.fill(0);
  constraints.areaLambdas.fill(0);
}

export function solveTethers(
  mesh: MeshData,
  constraints: ConstraintSet,
  compliance: number,
  dt: number,
  targetOffsets?: Float64Array,
): void {
  const alpha = compliance / (dt * dt);
  for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
    const inverseMass = mesh.inverseMasses[vertex] ?? 0;
    if (inverseMass <= 0) continue;
    const offset = vertex * 2;
    const solveAxis = (axis: 0 | 1, lambdas: Float64Array): void => {
      const index = offset + axis;
      const target = (mesh.restPositions[index] ?? 0) + (targetOffsets?.[index] ?? 0);
      const constraint = (mesh.positions[index] ?? 0) - target;
      const delta = (-constraint - alpha * (lambdas[vertex] ?? 0)) / (inverseMass + alpha);
      lambdas[vertex] = (lambdas[vertex] ?? 0) + delta;
      mesh.positions[index] = (mesh.positions[index] ?? 0) + inverseMass * delta;
    };
    solveAxis(0, constraints.tetherX);
    solveAxis(1, constraints.tetherY);
  }
}

export function solveDistances(mesh: MeshData, constraints: ConstraintSet, compliance: number, dt: number): void {
  const alpha = compliance / (dt * dt);
  for (let index = 0; index < constraints.distances.length; index += 1) {
    const constraint = constraints.distances[index];
    if (!constraint) continue;
    const { a, b, restLength } = constraint;
    const ax = mesh.positions[a * 2] ?? 0;
    const ay = mesh.positions[a * 2 + 1] ?? 0;
    const bx = mesh.positions[b * 2] ?? 0;
    const by = mesh.positions[b * 2 + 1] ?? 0;
    const dx = ax - bx;
    const dy = ay - by;
    const length = Math.hypot(dx, dy);
    if (length < EPSILON) continue;
    const inverseMassA = mesh.inverseMasses[a] ?? 0;
    const inverseMassB = mesh.inverseMasses[b] ?? 0;
    const denominator = inverseMassA + inverseMassB + alpha;
    if (denominator < EPSILON) continue;
    const lambda = constraints.distanceLambdas[index] ?? 0;
    const deltaLambda = (-(length - restLength) - alpha * lambda) / denominator;
    constraints.distanceLambdas[index] = lambda + deltaLambda;
    const nx = dx / length;
    const ny = dy / length;
    mesh.positions[a * 2] = ax + inverseMassA * nx * deltaLambda;
    mesh.positions[a * 2 + 1] = ay + inverseMassA * ny * deltaLambda;
    mesh.positions[b * 2] = bx - inverseMassB * nx * deltaLambda;
    mesh.positions[b * 2 + 1] = by - inverseMassB * ny * deltaLambda;
  }
}

export function solveMaximumDistances(mesh: MeshData, constraints: ConstraintSet, maximumRatio: number, compliance: number, dt: number): void {
  const alpha = compliance / (dt * dt);
  for (let index = 0; index < constraints.distances.length; index += 1) {
    const constraint = constraints.distances[index];
    if (!constraint) continue;
    const { a, b, restLength } = constraint;
    const ax = mesh.positions[a * 2] ?? 0;
    const ay = mesh.positions[a * 2 + 1] ?? 0;
    const bx = mesh.positions[b * 2] ?? 0;
    const by = mesh.positions[b * 2 + 1] ?? 0;
    const dx = ax - bx;
    const dy = ay - by;
    const length = Math.hypot(dx, dy);
    if (length < EPSILON) continue;
    const c = restLength * maximumRatio - length;
    const inverseMassA = mesh.inverseMasses[a] ?? 0;
    const inverseMassB = mesh.inverseMasses[b] ?? 0;
    const denominator = inverseMassA + inverseMassB + alpha;
    const lambda = constraints.maximumDistanceLambdas[index] ?? 0;
    if (c >= 0 && lambda <= 0) continue;
    const candidate = Math.max(0, lambda + (-c - alpha * lambda) / denominator);
    const deltaLambda = candidate - lambda;
    constraints.maximumDistanceLambdas[index] = candidate;
    const gradientX = -dx / length;
    const gradientY = -dy / length;
    mesh.positions[a * 2] = ax + inverseMassA * gradientX * deltaLambda;
    mesh.positions[a * 2 + 1] = ay + inverseMassA * gradientY * deltaLambda;
    mesh.positions[b * 2] = bx - inverseMassB * gradientX * deltaLambda;
    mesh.positions[b * 2 + 1] = by - inverseMassB * gradientY * deltaLambda;
  }
}

export function solveMinimumAreas(mesh: MeshData, constraints: ConstraintSet, compliance: number, dt: number): void {
  const alpha = compliance / (dt * dt);
  for (let index = 0; index < constraints.areas.length; index += 1) {
    const constraint = constraints.areas[index];
    if (!constraint) continue;
    const { a, b, c, minimumArea } = constraint;
    const ax = mesh.positions[a * 2] ?? 0;
    const ay = mesh.positions[a * 2 + 1] ?? 0;
    const bx = mesh.positions[b * 2] ?? 0;
    const by = mesh.positions[b * 2 + 1] ?? 0;
    const cx = mesh.positions[c * 2] ?? 0;
    const cy = mesh.positions[c * 2 + 1] ?? 0;
    const value = signedTriangleArea(ax, ay, bx, by, cx, cy) - minimumArea;
    const lambda = constraints.areaLambdas[index] ?? 0;
    if (value >= 0 && lambda <= 0) continue;

    const gradients = [
      0.5 * (by - cy), 0.5 * (cx - bx),
      0.5 * (cy - ay), 0.5 * (ax - cx),
      0.5 * (ay - by), 0.5 * (bx - ax),
    ];
    const wa = mesh.inverseMasses[a] ?? 0;
    const wb = mesh.inverseMasses[b] ?? 0;
    const wc = mesh.inverseMasses[c] ?? 0;
    const denominator = wa * ((gradients[0] ?? 0) ** 2 + (gradients[1] ?? 0) ** 2)
      + wb * ((gradients[2] ?? 0) ** 2 + (gradients[3] ?? 0) ** 2)
      + wc * ((gradients[4] ?? 0) ** 2 + (gradients[5] ?? 0) ** 2)
      + alpha;
    if (denominator < EPSILON) continue;
    const candidate = Math.max(0, lambda + (-value - alpha * lambda) / denominator);
    const deltaLambda = candidate - lambda;
    constraints.areaLambdas[index] = candidate;
    const vertices = [a, b, c];
    const masses = [wa, wb, wc];
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
      const vertex = vertices[vertexIndex];
      if (vertex === undefined) continue;
      const mass = masses[vertexIndex] ?? 0;
      mesh.positions[vertex * 2] = (mesh.positions[vertex * 2] ?? 0) + mass * (gradients[vertexIndex * 2] ?? 0) * deltaLambda;
      mesh.positions[vertex * 2 + 1] = (mesh.positions[vertex * 2 + 1] ?? 0) + mass * (gradients[vertexIndex * 2 + 1] ?? 0) * deltaLambda;
    }
  }
}
