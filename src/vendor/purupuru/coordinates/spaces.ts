/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import type { Point, Size } from "../core/types";
import {
  invertAffine,
  multiplyAffine,
  scaleAffine,
  transformPoint,
  translationAffine,
  type AffineTransform,
} from "./affine";

export interface Rect extends Point, Size {}

export interface ViewTransform {
  zoom: number;
  pan: Point;
}

export interface SceneTransformOptions {
  imageSize: Size;
  stageSize: Size;
  view?: ViewTransform;
  frameOffset?: Point;
}

function assertSize(size: Size, label: string): void {
  if (!(size.width > 0) || !(size.height > 0)) throw new RangeError(`${label} size must be positive.`);
}

export function computeContainRect(content: Size, container: Size): Rect {
  assertSize(content, "Content");
  assertSize(container, "Container");
  const scale = Math.min(container.width / content.width, container.height / content.height);
  const width = content.width * scale;
  const height = content.height * scale;
  return {
    x: (container.width - width) * 0.5,
    y: (container.height - height) * 0.5,
    width,
    height,
  };
}

export function imageToStageTransform(options: SceneTransformOptions): AffineTransform {
  const contain = computeContainRect(options.imageSize, options.stageSize);
  const view = options.view ?? { zoom: 1, pan: { x: 0, y: 0 } };
  if (!(view.zoom > 0) || !Number.isFinite(view.zoom)) throw new RangeError("View zoom must be positive and finite.");
  const frame = options.frameOffset ?? { x: 0, y: 0 };
  const renderedShortSide = Math.min(contain.width, contain.height);
  const base = multiplyAffine(
    translationAffine(contain.x, contain.y),
    scaleAffine(contain.width, contain.height),
  );
  const frameTranslation = translationAffine(frame.x * renderedShortSide, frame.y * renderedShortSide);
  const centerX = options.stageSize.width * 0.5;
  const centerY = options.stageSize.height * 0.5;
  const viewTransform = multiplyAffine(
    translationAffine(centerX + view.pan.x, centerY + view.pan.y),
    multiplyAffine(scaleAffine(view.zoom), translationAffine(-centerX, -centerY)),
  );
  return multiplyAffine(viewTransform, multiplyAffine(frameTranslation, base));
}

export function imageToStage(point: Point, options: SceneTransformOptions): Point {
  return transformPoint(imageToStageTransform(options), point);
}

export function stageToImage(point: Point, options: SceneTransformOptions): Point {
  return transformPoint(invertAffine(imageToStageTransform(options)), point);
}

export function clientToStage(clientPoint: Point, clientBounds: Rect, stageSize: Size): Point {
  assertSize(clientBounds, "Client bounds");
  assertSize(stageSize, "Stage");
  return {
    x: (clientPoint.x - clientBounds.x) * stageSize.width / clientBounds.width,
    y: (clientPoint.y - clientBounds.y) * stageSize.height / clientBounds.height,
  };
}

export function stageToRecording(point: Point, recordingRect: Rect): Point {
  assertSize(recordingRect, "Recording rectangle");
  return {
    x: (point.x - recordingRect.x) / recordingRect.width,
    y: (point.y - recordingRect.y) / recordingRect.height,
  };
}

export function recordingToStage(point: Point, recordingRect: Rect): Point {
  assertSize(recordingRect, "Recording rectangle");
  return {
    x: recordingRect.x + point.x * recordingRect.width,
    y: recordingRect.y + point.y * recordingRect.height,
  };
}

export function recordingToOutputPixel(point: Point, outputSize: Size): Point {
  assertSize(outputSize, "Output");
  return { x: point.x * outputSize.width, y: point.y * outputSize.height };
}
