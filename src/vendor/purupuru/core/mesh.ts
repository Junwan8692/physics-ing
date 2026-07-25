/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import type { MeshData } from "./types";

export interface GridMeshOptions {
  columns: number;
  rows: number;
  imageWidth: number;
  imageHeight: number;
  weights?: ArrayLike<number> | ((u: number, v: number) => number);
}

export type GridResolutionTier = 64 | 96 | 128;

export function calculateGridDimensions(imageWidth: number, imageHeight: number, tier: GridResolutionTier = 96): { columns: number; rows: number } {
  if (!(imageWidth > 0) || !(imageHeight > 0)) throw new RangeError("Image dimensions must be positive.");
  if (imageWidth >= imageHeight) {
    return { columns: tier, rows: Math.max(4, Math.round(tier * imageHeight / imageWidth)) };
  }
  return { columns: Math.max(4, Math.round(tier * imageWidth / imageHeight)), rows: tier };
}

export function createGridMesh(options: GridMeshOptions): MeshData {
  const { columns, rows, imageWidth, imageHeight } = options;
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError("Grid dimensions must be positive integers.");
  }
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    throw new RangeError("Image dimensions must be positive.");
  }

  const vertexColumns = columns + 1;
  const vertexRows = rows + 1;
  const vertexCount = vertexColumns * vertexRows;
  const restPositions = new Float64Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  const weights = new Float64Array(vertexCount);
  const shortSide = Math.min(imageWidth, imageHeight);
  const physicalWidth = imageWidth / shortSide;
  const physicalHeight = imageHeight / shortSide;

  for (let row = 0; row < vertexRows; row += 1) {
    const v = row / rows;
    for (let column = 0; column < vertexColumns; column += 1) {
      const u = column / columns;
      const vertex = row * vertexColumns + column;
      restPositions[vertex * 2] = (u - 0.5) * physicalWidth;
      restPositions[vertex * 2 + 1] = (v - 0.5) * physicalHeight;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;
      const sourceWeight = typeof options.weights === "function"
        ? options.weights(u, v)
        : options.weights?.[vertex] ?? 0;
      weights[vertex] = Math.min(1, Math.max(0, sourceWeight));
    }
  }

  const indices = new Uint32Array(columns * rows * 6);
  let cursor = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * vertexColumns + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + vertexColumns;
      const bottomRight = bottomLeft + 1;
      indices[cursor++] = topLeft;
      indices[cursor++] = topRight;
      indices[cursor++] = bottomRight;
      indices[cursor++] = topLeft;
      indices[cursor++] = bottomRight;
      indices[cursor++] = bottomLeft;
    }
  }

  return {
    columns,
    rows,
    restPositions,
    positions: restPositions.slice(),
    previousPositions: restPositions.slice(),
    velocities: new Float64Array(vertexCount * 2),
    uvs,
    indices,
    weights,
    inverseMasses: Float64Array.from(weights, (weight) => weight > 0 ? 1 : 0),
  };
}
