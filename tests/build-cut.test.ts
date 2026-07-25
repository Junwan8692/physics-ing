import { describe, expect, it } from "vitest";
import { buildCut, createSimulator } from "../src/core/buildCut";
import { createProject } from "../src/project/io";
import { GRID_K } from "../src/core/grid";
import { SOLVER_QUALITY } from "../src/core/quality";
import type { JiggleProject } from "../src/core/types";

function painted(cropWidth = 494, cropHeight = 394): JiggleProject {
  const project = createProject(
    { src: "a.png", width: 1280, height: 5120 },
    { x: 340, y: 1820, width: cropWidth, height: cropHeight },
  );
  project.region.strokes.push({ id: 1, mode: "paint", size: 0.4, strength: 1, operation: "add", points: [{ x: 0.5, y: 0.5 }] });
  return project;
}

describe("buildCut", () => {
  it("sizes the grid from the crop, short side at GRID_K", () => {
    const { grid, crop } = buildCut(painted());
    expect(crop.width <= crop.height ? grid.columns : grid.rows).toBe(GRID_K);
  });
  it("pins every unpainted vertex", () => {
    const { mesh } = buildCut(painted());
    expect(mesh.inverseMasses[0]).toBe(0);
  });
  it("makes at least one vertex dynamic", () => {
    const { mesh } = buildCut(painted());
    expect(Array.from(mesh.weights).some((w) => w > 0)).toBe(true);
  });
  it("keeps every weight inside 0..1", () => {
    const { mesh } = buildCut(painted());
    for (const w of mesh.weights) {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

describe("createSimulator", () => {
  it("stays finite and un-inverted under hard driving", () => {
    const project = painted();
    const sim = createSimulator(buildCut(project), project, SOLVER_QUALITY);
    for (let i = 0; i < 900; i += 1) sim.step({ localAcceleration: { x: 4, y: 6 } });
    expect(sim.isFinite()).toBe(true);
    expect(sim.hasInvertedTriangles()).toBe(false);
  });
  it("never moves a pinned vertex", () => {
    const project = painted();
    const built = buildCut(project);
    const pinned: number[] = [];
    for (let v = 0; v < built.mesh.weights.length; v += 1) if ((built.mesh.inverseMasses[v] ?? 0) === 0) pinned.push(v);
    expect(pinned.length).toBeGreaterThan(0);
    const sim = createSimulator(built, project, SOLVER_QUALITY);
    for (let i = 0; i < 300; i += 1) sim.step({ localAcceleration: { x: 5, y: 5 } });
    for (const v of pinned) {
      expect(built.mesh.positions[v * 2]).toBe(built.mesh.restPositions[v * 2]);
      expect(built.mesh.positions[v * 2 + 1]).toBe(built.mesh.restPositions[v * 2 + 1]);
    }
  });
  it("is deterministic for the same seed and inputs", () => {
    const run = (): string => {
      const project = painted();
      const sim = createSimulator(buildCut(project), project, SOLVER_QUALITY);
      for (let i = 0; i < 200; i += 1) sim.step({ localAcceleration: { x: Math.sin(i / 7) * 3, y: Math.cos(i / 11) * 3 } });
      return JSON.stringify(sim.createSnapshot());
    };
    expect(run()).toBe(run());
  });
  it("settles back to rest when the input stops and gravity is off", () => {
    const project = painted();
    project.motion = { ...project.motion, gravityDirection: "none", gravityStrength: 0 };
    const built = buildCut(project);
    const sim = createSimulator(built, project, SOLVER_QUALITY);
    for (let i = 0; i < 120; i += 1) sim.step({ localAcceleration: { x: 4, y: 4 } });
    for (let i = 0; i < 1200; i += 1) sim.step({});
    let maximum = 0;
    for (let i = 0; i < built.mesh.positions.length; i += 1) {
      maximum = Math.max(maximum, Math.abs((built.mesh.positions[i] ?? 0) - (built.mesh.restPositions[i] ?? 0)));
    }
    expect(maximum).toBeLessThan(0.02);
  });
});
