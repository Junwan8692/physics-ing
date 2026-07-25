/*
 * Vendored regression test from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only, plus this explicit vitest import
 * (upstream relied on `globals: true`; we do not). No logic changes.
 */
import { describe, expect, it } from "vitest";
import {
  clientToStage,
  computeContainRect,
  imageToStage,
  recordingToOutputPixel,
  recordingToStage,
  stageToImage,
  stageToRecording,
} from "../../src/vendor/purupuru/coordinates";

describe("coordinate spaces", () => {
  it("contains landscape content without changing its aspect ratio", () => {
    expect(computeContainRect(
      { width: 1600, height: 900 },
      { width: 800, height: 800 },
    )).toEqual({ x: 0, y: 175, width: 800, height: 450 });
  });

  it("round-trips image coordinates through frame, pan and zoom", () => {
    const options = {
      imageSize: { width: 4032, height: 3024 },
      stageSize: { width: 960, height: 540 },
      view: { zoom: 2.3, pan: { x: -71, y: 33 } },
      frameOffset: { x: 0.057, y: -0.021 },
    };
    const source = { x: 0.173, y: 0.827 };
    const result = stageToImage(imageToStage(source, options), options);
    expect(result.x).toBeCloseTo(source.x, 12);
    expect(result.y).toBeCloseTo(source.y, 12);
  });

  it("keeps viewport conversion separate from recording coordinates", () => {
    const stage = clientToStage(
      { x: 450, y: 325 },
      { x: 50, y: 100, width: 800, height: 450 },
      { width: 1600, height: 900 },
    );
    expect(stage).toEqual({ x: 800, y: 450 });
    const recordingRect = { x: 320, y: 180, width: 960, height: 540 };
    const normalized = stageToRecording(stage, recordingRect);
    expect(recordingToStage(normalized, recordingRect)).toEqual(stage);
    expect(recordingToOutputPixel(normalized, { width: 1280, height: 720 })).toEqual({ x: 640, y: 360 });
  });
});
