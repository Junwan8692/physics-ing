/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import { EPSILON } from "./math";
import type { MeshData } from "./types";

export interface ShapeCluster {
  vertices: Uint32Array;
  restCenterX: number;
  restCenterY: number;
  previousRotation: number;
}

export const SHAPE_CLUSTER_WEIGHT_THRESHOLD = 0.05;

export function createShapeClusters(mesh: MeshData, threshold = SHAPE_CLUSTER_WEIGHT_THRESHOLD): ShapeCluster[] {
  const vertexColumns = mesh.columns + 1;
  const visited = new Uint8Array(mesh.weights.length);
  const clusters: ShapeCluster[] = [];
  const neighbors = (vertex: number): number[] => {
    const row = Math.floor(vertex / vertexColumns);
    const column = vertex % vertexColumns;
    const result: number[] = [];
    if (column > 0) result.push(vertex - 1);
    if (column < mesh.columns) result.push(vertex + 1);
    if (row > 0) result.push(vertex - vertexColumns);
    if (row < mesh.rows) result.push(vertex + vertexColumns);
    return result;
  };

  for (let start = 0; start < mesh.weights.length; start += 1) {
    if ((visited[start] ?? 0) !== 0 || (mesh.weights[start] ?? 0) <= threshold) continue;
    const queue = [start];
    const members: number[] = [];
    visited[start] = 1;
    while (queue.length > 0) {
      const vertex = queue.pop();
      if (vertex === undefined) break;
      members.push(vertex);
      for (const neighbor of neighbors(vertex)) {
        if ((visited[neighbor] ?? 0) !== 0 || (mesh.weights[neighbor] ?? 0) <= threshold) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    let weightSum = 0;
    let restCenterX = 0;
    let restCenterY = 0;
    for (const vertex of members) {
      const weight = mesh.weights[vertex] ?? 0;
      weightSum += weight;
      restCenterX += (mesh.restPositions[vertex * 2] ?? 0) * weight;
      restCenterY += (mesh.restPositions[vertex * 2 + 1] ?? 0) * weight;
    }
    clusters.push({
      vertices: Uint32Array.from(members),
      restCenterX: restCenterX / Math.max(weightSum, EPSILON),
      restCenterY: restCenterY / Math.max(weightSum, EPSILON),
      previousRotation: 0,
    });
  }
  return clusters;
}

export function solveShapeMatching(mesh: MeshData, clusters: ShapeCluster[], strength: number): void {
  for (const cluster of clusters) {
    let weightSum = 0;
    let centerX = 0;
    let centerY = 0;
    for (const vertex of cluster.vertices) {
      const weight = mesh.weights[vertex] ?? 0;
      weightSum += weight;
      centerX += (mesh.positions[vertex * 2] ?? 0) * weight;
      centerY += (mesh.positions[vertex * 2 + 1] ?? 0) * weight;
    }
    if (weightSum < EPSILON) continue;
    centerX /= weightSum;
    centerY /= weightSum;

    let covariance00 = 0;
    let covariance01 = 0;
    let covariance10 = 0;
    let covariance11 = 0;
    for (const vertex of cluster.vertices) {
      const weight = mesh.weights[vertex] ?? 0;
      const px = (mesh.positions[vertex * 2] ?? 0) - centerX;
      const py = (mesh.positions[vertex * 2 + 1] ?? 0) - centerY;
      const qx = (mesh.restPositions[vertex * 2] ?? 0) - cluster.restCenterX;
      const qy = (mesh.restPositions[vertex * 2 + 1] ?? 0) - cluster.restCenterY;
      covariance00 += weight * px * qx;
      covariance01 += weight * px * qy;
      covariance10 += weight * py * qx;
      covariance11 += weight * py * qy;
    }

    const numerator = covariance10 - covariance01;
    const denominator = covariance00 + covariance11;
    const rotation = Math.abs(numerator) + Math.abs(denominator) > EPSILON
      ? Math.atan2(numerator, denominator)
      : cluster.previousRotation;
    cluster.previousRotation = rotation;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    for (const vertex of cluster.vertices) {
      const weight = mesh.weights[vertex] ?? 0;
      const qx = (mesh.restPositions[vertex * 2] ?? 0) - cluster.restCenterX;
      const qy = (mesh.restPositions[vertex * 2 + 1] ?? 0) - cluster.restCenterY;
      const goalX = centerX + cosine * qx - sine * qy;
      const goalY = centerY + sine * qx + cosine * qy;
      const blend = strength * weight;
      mesh.positions[vertex * 2] = (mesh.positions[vertex * 2] ?? 0) + (goalX - (mesh.positions[vertex * 2] ?? 0)) * blend;
      mesh.positions[vertex * 2 + 1] = (mesh.positions[vertex * 2 + 1] ?? 0) + (goalY - (mesh.positions[vertex * 2 + 1] ?? 0)) * blend;
    }
  }
}
