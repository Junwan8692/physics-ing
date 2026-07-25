import { describe, expect, it } from "vitest";
import { MOTION_PRESETS, createGridMesh, PhysicsSimulator } from "../src/vendor/purupuru/core";
import { EMPTY_REGION } from "../src/vendor/purupuru/region/model";
import type { JiggleProject } from "../src/core/types";

describe("contracts", () => {
  it("MOTION_PRESETS uses fluctuation, never variation", () => {
    expect(MOTION_PRESETS.purupuru).toHaveProperty("fluctuation");
    expect(MOTION_PRESETS.purupuru).not.toHaveProperty("variation");
  });

  it("a JiggleProject literal type-checks against vendor types", () => {
    const project: JiggleProject = {
      format: "jiggle-project", version: 1,
      source: { src: "cut.png", width: 1280, height: 5120 },
      crop: { x: 340, y: 1820, width: 494, height: 394 },
      region: EMPTY_REGION, motion: MOTION_PRESETS.purupuru, seed: 1,
    };
    expect(project.motion.fluctuation).toBe(5);
  });

  it("the simulator runs and stays sane on a contract-path mesh", () => {
    const mesh = createGridMesh({
      columns: 25, rows: 25, imageWidth: 400, imageHeight: 400,
      weights: (u, v) => (u > 0.35 && u < 0.65 && v > 0.35 && v < 0.65 ? 1 : 0),
    });
    const sim = new PhysicsSimulator({
      mesh, parameters: MOTION_PRESETS.purupuru, seed: 1,
      quality: { tickRate: 60, iterations: 4, maxCatchUpSteps: 4 },
    });
    for (let i = 0; i < 300; i += 1) sim.step({ localAcceleration: { x: 2, y: 3 } });
    expect(sim.isFinite()).toBe(true);
    expect(sim.hasInvertedTriangles()).toBe(false);
  });
});
