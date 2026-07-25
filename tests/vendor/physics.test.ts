/*
 * Vendored regression test from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only, plus this explicit vitest import
 * (upstream relied on `globals: true`; we do not). No logic changes.
 */
import { describe, expect, it } from "vitest";
import {
  MOTION_PRESETS,
  PhysicsSimulator,
  SeededRandom,
  calculateGridDimensions,
  createGridMesh,
  createShapeClusters,
  gravityOnsetMultiplier,
  meanActiveSelectionResponse,
  selectionResponseForWeight,
  createRigidFrameState,
  stepRigidFrame,
  signedTriangleArea,
  solveShapeMatching,
  type MotionParameters,
} from "../../src/vendor/purupuru/core";

function selectedMesh(columns = 8, rows = 8) {
  return createGridMesh({
    columns,
    rows,
    imageWidth: 4,
    imageHeight: 3,
    weights: (u, v) => (u > 0 && u < 1 && v > 0 && v < 1 ? 1 : 0),
  });
}

describe("SeededRandom", () => {
  it("replays the exact unsigned sequence from a state", () => {
    const first = new SeededRandom(0x12345678);
    first.nextUint32();
    const state = first.getState();
    const expected = Array.from({ length: 12 }, () => first.nextUint32());
    const replay = new SeededRandom(0);
    replay.setState(state);
    expect(Array.from({ length: 12 }, () => replay.nextUint32())).toEqual(expected);
  });
});

describe("adaptive grid", () => {
  it("keeps the short direction usable for extreme aspect ratios", () => {
    expect(calculateGridDimensions(10_000, 100, 64)).toEqual({ columns: 64, rows: 4 });
    expect(calculateGridDimensions(900, 1600, 96)).toEqual({ columns: 54, rows: 96 });
  });
});

describe("rigid shape matching", () => {
  it("is invariant under a rigid translation and rotation", () => {
    const mesh = createGridMesh({ columns: 3, rows: 3, imageWidth: 1, imageHeight: 1, weights: () => 1 });
    const angle = 0.73;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
      const x = mesh.restPositions[vertex * 2] ?? 0;
      const y = mesh.restPositions[vertex * 2 + 1] ?? 0;
      mesh.positions[vertex * 2] = cosine * x - sine * y + 0.42;
      mesh.positions[vertex * 2 + 1] = sine * x + cosine * y - 0.17;
    }
    const before = mesh.positions.slice();
    solveShapeMatching(mesh, createShapeClusters(mesh), 1);
    for (let index = 0; index < before.length; index += 1) {
      expect(mesh.positions[index]).toBeCloseTo(before[index] ?? 0, 14);
    }
  });

  it("builds independent clusters for disconnected selected regions", () => {
    const mesh = createGridMesh({
      columns: 8,
      rows: 2,
      imageWidth: 4,
      imageHeight: 1,
      weights: (u) => (u < 0.26 || u > 0.74 ? 1 : 0),
    });
    expect(createShapeClusters(mesh)).toHaveLength(2);
  });

  it("does not join strong regions through a one-percent ghost bridge", () => {
    const mesh = createGridMesh({
      columns: 8,
      rows: 2,
      imageWidth: 4,
      imageHeight: 1,
      weights: (u) => (u < 0.26 || u > 0.74 ? 1 : 0.01),
    });
    expect(createShapeClusters(mesh)).toHaveLength(2);
  });
});

describe("PhysicsSimulator", () => {
  const inputAt = (tick: number) => ({
    frameDragging: tick % 180 < 120,
    frameTarget: { x: Math.sin(tick * 0.071) * 0.2, y: Math.cos(tick * 0.053) * 0.2 },
    localAcceleration: { x: Math.sin(tick * 0.031) * 8, y: Math.cos(tick * 0.043) * 8 },
  });

  const meanDisplacement = (simulator: PhysicsSimulator) => {
    let x = 0;
    let y = 0;
    let count = 0;
    for (let vertex = 0; vertex < simulator.mesh.weights.length; vertex += 1) {
      if ((simulator.mesh.weights[vertex] ?? 0) <= 0) continue;
      x += (simulator.mesh.positions[vertex * 2] ?? 0) - (simulator.mesh.restPositions[vertex * 2] ?? 0);
      y += (simulator.mesh.positions[vertex * 2 + 1] ?? 0) - (simulator.mesh.restPositions[vertex * 2 + 1] ?? 0);
      count += 1;
    }
    return { x: x / count, y: y / count };
  };

  it("keeps 25, 50, and 100 percent selection responses monotonic", () => {
    const responseRms = (weight: number) => {
      const mesh = createGridMesh({ columns: 6, rows: 6, imageWidth: 1, imageHeight: 1, weights: () => weight });
      const simulator = new PhysicsSimulator({
        mesh,
        parameters: { ...MOTION_PRESETS.purupuru, gravityDirection: "down", gravityStrength: 0, fluctuation: 0 },
        seed: 3,
      });
      let peak = 0;
      for (let tick = 0; tick < 120; tick += 1) {
        simulator.step({ localAcceleration: tick < 20 ? { x: 8, y: 3 } : { x: 0, y: 0 } });
        let squareSum = 0;
        for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
          const dx = (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0);
          const dy = (mesh.positions[vertex * 2 + 1] ?? 0) - (mesh.restPositions[vertex * 2 + 1] ?? 0);
          squareSum += dx * dx + dy * dy;
        }
        peak = Math.max(peak, Math.sqrt(squareSum / mesh.weights.length));
      }
      return peak;
    };
    const responses = [0.25, 0.5, 1].map(responseRms);
    expect(responses[0]).toBeGreaterThan(0);
    expect(responses[1]).toBeGreaterThan(responses[0] ?? 0);
    expect(responses[2]).toBeGreaterThan(responses[1] ?? 0);
  });

  it("expands intermediate brush response differences while preserving exact endpoints", () => {
    expect(selectionResponseForWeight(0)).toBe(0);
    expect(selectionResponseForWeight(0.25)).toBeCloseTo(0.125189208984375, 15);
    expect(selectionResponseForWeight(0.5)).toBeCloseTo(0.39716796875, 15);
    expect(selectionResponseForWeight(0.75)).toBeCloseTo(0.744525146484375, 15);
    expect(selectionResponseForWeight(0.8)).toBe(0.8);
    expect(selectionResponseForWeight(0.9)).toBe(0.9);
    expect(selectionResponseForWeight(1)).toBe(1);
    const values = Array.from({ length: 101 }, (_, percent) => selectionResponseForWeight(percent / 100));
    expect(values.every((value, index) => index === 0 || value > (values[index - 1] ?? -1))).toBe(true);
    expect(meanActiveSelectionResponse(new Float64Array())).toBe(0);
    expect(meanActiveSelectionResponse(new Float64Array([0, 1, 1]))).toBe(1);
    expect(meanActiveSelectionResponse(new Float64Array([0, 0.1, 1])))
      .toBeCloseTo((selectionResponseForWeight(0.1) + 1) / 2, 15);
  });

  it("keeps the established 100 percent selection peak unchanged", () => {
    const mesh = createGridMesh({
      columns: 12,
      rows: 12,
      imageWidth: 1,
      imageHeight: 1,
      weights: (u, v) => (u >= 0.2 && u <= 0.8 && v >= 0.2 && v <= 0.8 ? 1 : 0),
    });
    const simulator = new PhysicsSimulator({
      mesh,
      parameters: { ...MOTION_PRESETS.purupuru, gravityDirection: "none", gravityStrength: 0, fluctuation: 0 },
      seed: 3,
    });
    let peak = 0;
    for (let tick = 0; tick < 240; tick += 1) {
      simulator.step({ localAcceleration: tick < 20 ? { x: 8, y: 3 } : { x: 0, y: 0 } });
      let square = 0;
      let count = 0;
      for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
        if ((mesh.weights[vertex] ?? 0) <= 0) continue;
        const dx = (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0);
        const dy = (mesh.positions[vertex * 2 + 1] ?? 0) - (mesh.restPositions[vertex * 2 + 1] ?? 0);
        square += dx * dx + dy * dy;
        count += 1;
      }
      peak = Math.max(peak, Math.sqrt(square / count));
    }
    expect(peak).toBeCloseTo(0.03460509907292265, 14);
  });

  it("keeps the gravity onset force in the configured direction", () => {
    const samples = Array.from({ length: 241 }, (_value, tick) => gravityOnsetMultiplier(tick / 120));
    expect(samples[0]).toBe(23);
    expect(samples.every((value) => value >= 1)).toBe(true);
    expect(samples.every((value, index) => index === 0 || value <= (samples[index - 1] ?? value))).toBe(true);
    expect(samples.at(-1)).toBeLessThan(1.002);
  });

  it("tracks a dragged frame promptly while preserving the fixed tick", () => {
    const frame = createRigidFrameState();
    for (let tick = 0; tick < 5; tick += 1) {
      stepRigidFrame(frame, { frameDragging: true, frameTarget: { x: 0.08, y: 0 } }, 1 / 120);
    }
    expect(frame.position.x).toBeGreaterThan(0.072);
    expect(frame.position.x).toBeLessThanOrEqual(0.08);
    const release: number[] = [];
    for (let tick = 0; tick < 240; tick += 1) {
      stepRigidFrame(frame, {}, 1 / 120);
      release.push(frame.position.x);
    }
    const firstTrough = Math.min(...release);
    const firstTroughIndex = release.indexOf(firstTrough);
    const secondPeak = Math.max(...release.slice(firstTroughIndex));
    expect(firstTrough).toBeLessThan(-0.005);
    expect(secondPeak).toBeGreaterThan(0.0008);
    expect(Math.abs(frame.position.x)).toBeLessThan(2e-5);
  });

  it("keeps automatic motion zero-net while increasing selected deformation", () => {
    const create = () => {
      const mesh = createGridMesh({ columns: 8, rows: 8, imageWidth: 1, imageHeight: 1, weights: () => 1 });
      const simulator = new PhysicsSimulator({
        mesh,
        parameters: { ...MOTION_PRESETS.purupuru, gravityDirection: "down", gravityStrength: 0, fluctuation: 0 },
        seed: 1,
      });
      return { mesh, simulator };
    };
    const automatic = create();
    const legacyUniform = create();
    let automaticDeformationPeak = 0;
    let legacyDeformationPeak = 0;
    let automaticCentroidPeak = 0;
    const deformation = (mesh: ReturnType<typeof createGridMesh>) => {
      let centerX = 0;
      let centerY = 0;
      for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
        centerX += (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0);
        centerY += (mesh.positions[vertex * 2 + 1] ?? 0) - (mesh.restPositions[vertex * 2 + 1] ?? 0);
      }
      centerX /= mesh.weights.length;
      centerY /= mesh.weights.length;
      let square = 0;
      for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
        const dx = (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0) - centerX;
        const dy = (mesh.positions[vertex * 2 + 1] ?? 0) - (mesh.restPositions[vertex * 2 + 1] ?? 0) - centerY;
        square += dx * dx + dy * dy;
      }
      return { centroid: Math.hypot(centerX, centerY), rms: Math.sqrt(square / mesh.weights.length) };
    };
    for (let tick = 0; tick < 720; tick += 1) {
      const value = { x: Math.sin(tick / 120 * Math.PI * 2 * 0.8) * 0.88, y: 0 };
      automatic.simulator.step({ automaticAcceleration: value });
      legacyUniform.simulator.step({ localAcceleration: value });
      const automaticValue = deformation(automatic.mesh);
      const legacyValue = deformation(legacyUniform.mesh);
      automaticDeformationPeak = Math.max(automaticDeformationPeak, automaticValue.rms);
      legacyDeformationPeak = Math.max(legacyDeformationPeak, legacyValue.rms);
      automaticCentroidPeak = Math.max(automaticCentroidPeak, automaticValue.centroid);
    }
    expect(automatic.simulator.frame.position).toEqual({ x: 0, y: 0 });
    expect(automaticCentroidPeak).toBeLessThan(0.001);
    expect(automaticDeformationPeak).toBeGreaterThan(0.0008);
    expect(automaticDeformationPeak).toBeGreaterThan(legacyDeformationPeak * 0.7);
  });

  it("keeps the three fixed presets physically distinct", () => {
    const spanPeak = (parameters: MotionParameters, driven = true) => {
      const mesh = selectedMesh();
      const simulator = new PhysicsSimulator({
        mesh,
        parameters: { ...parameters, gravityDirection: "down", gravityStrength: 0, fluctuation: driven ? 0 : parameters.fluctuation },
        seed: 5,
      });
      let peak = 0;
      for (let tick = 0; tick < 1_200; tick += 1) {
        simulator.step({ localAcceleration: driven && tick < 12 ? { x: 7, y: 0 } : { x: 0, y: 0 } });
        let minimum = Number.POSITIVE_INFINITY;
        let maximum = Number.NEGATIVE_INFINITY;
        for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
          if ((mesh.weights[vertex] ?? 0) <= 0) continue;
          const displacement = (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0);
          minimum = Math.min(minimum, displacement);
          maximum = Math.max(maximum, displacement);
        }
        peak = Math.max(peak, maximum - minimum);
      }
      return peak;
    };
    const shivery = spanPeak(MOTION_PRESETS.shivery, false);
    const purupuru = spanPeak(MOTION_PRESETS.purupuru);
    const floaty = spanPeak(MOTION_PRESETS.floaty);
    expect(shivery).toBeGreaterThan(0.025);
    expect(purupuru).toBeGreaterThan(0.07);
    expect(floaty).toBeGreaterThan(0.01);
  });

  it("settles more slowly as cohesion decreases", () => {
    const settleTick = (cohesion: number) => {
      const mesh = selectedMesh();
      const simulator = new PhysicsSimulator({
        mesh,
        parameters: {
          ...MOTION_PRESETS.purupuru,
          stretch: 65,
          bounce: 60,
          damping: 35,
          cohesion,
          gravityStrength: 0,
          fluctuation: 0,
        },
        seed: 17,
      });
      let lastMovingTick = 0;
      for (let tick = 0; tick < 2_400; tick += 1) {
        simulator.step({ localAcceleration: tick < 8 ? { x: 7, y: 0 } : { x: 0, y: 0 } });
        let square = 0;
        let count = 0;
        for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
          if ((mesh.weights[vertex] ?? 0) <= 0) continue;
          const vx = mesh.velocities[vertex * 2] ?? 0;
          const vy = mesh.velocities[vertex * 2 + 1] ?? 0;
          square += vx * vx + vy * vy;
          count += 1;
        }
        if (Math.sqrt(square / count) > 2e-4) lastMovingTick = tick;
      }
      return lastMovingTick;
    };
    const loose = settleTick(5);
    const cohesive = settleTick(90);
    expect(loose).toBeGreaterThan(cohesive * 1.5);
  });

  it("gives shivery a visible deterministic 8-12Hz zero-net tremor", () => {
    const mesh = selectedMesh();
    const simulator = new PhysicsSimulator({
      mesh,
      parameters: { ...MOTION_PRESETS.shivery, gravityDirection: "down", gravityStrength: 0 },
      seed: 5,
    });
    let spanPeak = 0;
    let centroidPeak = 0;
    let crossings = 0;
    let previousSign = 0;
    for (let tick = 0; tick < 1_200; tick += 1) {
      simulator.step();
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      const center = meanDisplacement(simulator);
      centroidPeak = Math.max(centroidPeak, Math.hypot(center.x, center.y));
      for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
        if ((mesh.weights[vertex] ?? 0) <= 0) continue;
        const displacement = (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0);
        minimum = Math.min(minimum, displacement);
        maximum = Math.max(maximum, displacement);
      }
      spanPeak = Math.max(spanPeak, maximum - minimum);
      const sample = (mesh.positions[40 * 2] ?? 0) - (mesh.restPositions[40 * 2] ?? 0);
      const sign = Math.abs(sample) > 1e-5 ? Math.sign(sample) : 0;
      if (sign && previousSign && sign !== previousSign) crossings += 1;
      if (sign) previousSign = sign;
    }
    expect(spanPeak).toBeGreaterThan(0.02);
    expect(crossings).toBeGreaterThan(180);
    expect(crossings).toBeLessThan(240);
    expect(centroidPeak).toBeLessThan(spanPeak * 0.3);
    expect(simulator.hasInvertedTriangles()).toBe(false);
  });

  it("gives bain-bain a strong, regular, decaying spring overshoot", () => {
    const simulator = new PhysicsSimulator({
      mesh: selectedMesh(),
      parameters: { ...MOTION_PRESETS.sloshing, gravityStrength: 0, fluctuation: 0 },
      seed: 9,
    });
    const response: number[] = [];
    let spanPeak = 0;
    for (let tick = 0; tick < 1_200; tick += 1) {
      simulator.step({ localAcceleration: tick < 3 ? { x: 0, y: 7 } : { x: 0, y: 0 } });
      response.push(meanDisplacement(simulator).y);
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (let vertex = 0; vertex < simulator.mesh.weights.length; vertex += 1) {
        if ((simulator.mesh.weights[vertex] ?? 0) <= 0) continue;
        const displacement = (simulator.mesh.positions[vertex * 2 + 1] ?? 0) - (simulator.mesh.restPositions[vertex * 2 + 1] ?? 0);
        minimum = Math.min(minimum, displacement);
        maximum = Math.max(maximum, displacement);
      }
      spanPeak = Math.max(spanPeak, maximum - minimum);
    }
    const peak = Math.max(...response);
    const peakIndex = response.indexOf(peak);
    const trough = Math.min(...response.slice(peakIndex));
    const troughIndex = response.indexOf(trough, peakIndex);
    const secondPeak = Math.max(...response.slice(troughIndex));
    const secondPeakIndex = response.indexOf(secondPeak, troughIndex);
    const secondTrough = Math.min(...response.slice(secondPeakIndex));
    expect(peak).toBeGreaterThan(0.00143);
    expect(trough).toBeLessThan(-0.000288);
    expect(secondPeak).toBeGreaterThan(0.000129);
    expect(secondTrough).toBeLessThan(-0.000047);
    expect(spanPeak).toBeGreaterThan(0.01);
    expect(Math.abs(trough)).toBeLessThan(peak);
    expect(secondPeak).toBeLessThan(Math.abs(trough));
    expect(Math.abs(secondTrough)).toBeLessThan(secondPeak);
    expect(Math.abs(response.at(-1) ?? 1)).toBeLessThan(1e-5);
    expect(simulator.isFinite()).toBe(true);
    expect(simulator.hasInvertedTriangles()).toBe(false);
  });

  it("produces identical state for the same seed, mesh, parameters and inputs", () => {
    const first = new PhysicsSimulator({ mesh: selectedMesh(), parameters: MOTION_PRESETS.purupuru, seed: 72 });
    const second = new PhysicsSimulator({ mesh: selectedMesh(), parameters: MOTION_PRESETS.purupuru, seed: 72 });
    for (let tick = 0; tick < 480; tick += 1) {
      first.step(inputAt(tick));
      second.step(inputAt(tick));
    }
    expect(first.createSnapshot()).toEqual(second.createSnapshot());
  });

  it("continues bit-identically after restoring a serialized snapshot", () => {
    const original = new PhysicsSimulator({ mesh: selectedMesh(), parameters: MOTION_PRESETS.purupuru, seed: 9182 });
    for (let tick = 0; tick < 233; tick += 1) original.step(inputAt(tick));
    const serialized = JSON.stringify(original.createSnapshot());
    const replay = new PhysicsSimulator({ mesh: selectedMesh(), parameters: MOTION_PRESETS.purupuru, seed: 0 });
    replay.restoreSnapshot(JSON.parse(serialized) as ReturnType<PhysicsSimulator["createSnapshot"]>);
    for (let tick = 233; tick < 600; tick += 1) {
      original.step(inputAt(tick));
      replay.step(inputAt(tick));
    }
    expect(replay.createSnapshot()).toEqual(original.createSnapshot());
  });

  it("replays gravity direction and strength from a snapshot", () => {
    const parameters = { ...MOTION_PRESETS.purupuru, gravityDirection: "left" as const, gravityStrength: 2, fluctuation: 0 };
    const original = new PhysicsSimulator({ mesh: selectedMesh(), parameters, seed: 22 });
    for (let tick = 0; tick < 120; tick += 1) original.step();
    const replay = new PhysicsSimulator({ mesh: selectedMesh(), parameters: MOTION_PRESETS.floaty, seed: 0 });
    replay.restoreSnapshot(original.createSnapshot());
    expect(replay.createSnapshot().parameters).toEqual(parameters);
    for (let tick = 0; tick < 240; tick += 1) {
      original.step();
      replay.step();
    }
    expect(replay.createSnapshot()).toEqual(original.createSnapshot());
  });

  it("applies none, four gravity directions, and a visible 0-2G strength range", () => {
    const simulate = (gravityDirection: MotionParameters["gravityDirection"], gravityStrength: number) => {
      const simulator = new PhysicsSimulator({
        mesh: selectedMesh(),
        parameters: { ...MOTION_PRESETS.purupuru, gravityDirection, gravityStrength, fluctuation: 0 },
        seed: 1,
      });
      for (let tick = 0; tick < 360; tick += 1) simulator.step();
      return meanDisplacement(simulator);
    };
    const none = simulate("none", 0);
    const down1 = simulate("down", 1);
    const down2 = simulate("down", 2);
    const up = simulate("up", 1);
    const left = simulate("left", 1);
    const right = simulate("right", 1);
    expect(Math.hypot(none.x, none.y)).toBeGreaterThan(1e-4);
    expect(Math.abs(none.y)).toBeLessThan(down1.y * 0.4);
    expect(down1.y).toBeGreaterThanOrEqual(0.01);
    expect(down2.y).toBeGreaterThan(down1.y * 1.7);
    expect(up.y).toBeLessThanOrEqual(-0.01);
    expect(left.x).toBeLessThanOrEqual(-0.01);
    expect(right.x).toBeGreaterThanOrEqual(0.01);
  });

  it("applies gravity immediately, then settles through damped overshoot", () => {
    const simulator = new PhysicsSimulator({
      mesh: selectedMesh(),
      parameters: { ...MOTION_PRESETS.purupuru, gravityDirection: "down", gravityStrength: 1, fluctuation: 0 },
      seed: 1,
    });
    const response: number[] = [];
    for (let tick = 0; tick < 720; tick += 1) {
      simulator.step();
      response.push(meanDisplacement(simulator).y);
    }
    const equilibrium = response.slice(-120).reduce((sum, value) => sum + value, 0) / 120;
    const peak = Math.max(...response);
    const peakIndex = response.indexOf(peak);
    const trough = Math.min(...response.slice(peakIndex));
    const troughIndex = response.indexOf(trough, peakIndex);
    const secondPeak = Math.max(...response.slice(troughIndex));
    expect(response[0]).toBeGreaterThan(0.0005);
    expect(peakIndex).toBeLessThan(30);
    expect(peak).toBeGreaterThan(equilibrium * 1.5);
    expect(trough).toBeLessThan(equilibrium);
    expect(Math.abs(secondPeak - equilibrium)).toBeLessThan(Math.abs(peak - equilibrium));
    expect(Math.abs((response.at(-1) ?? 0) - equilibrium)).toBeLessThan(1e-9);
  });

  it("restarts the gravity onset when direction changes", () => {
    const simulator = new PhysicsSimulator({
      mesh: selectedMesh(),
      parameters: { ...MOTION_PRESETS.purupuru, gravityDirection: "down", gravityStrength: 1, fluctuation: 0 },
      seed: 3,
    });
    for (let tick = 0; tick < 360; tick += 1) simulator.step();
    expect(simulator.createSnapshot().gravityElapsedSeconds).toBeCloseTo(3, 12);
    simulator.setParameters({ ...MOTION_PRESETS.purupuru, gravityDirection: "up", gravityStrength: 1, fluctuation: 0 });
    expect(simulator.createSnapshot().gravityElapsedSeconds).toBe(0);
    const before = meanDisplacement(simulator).y;
    for (let tick = 0; tick < 6; tick += 1) simulator.step();
    expect(meanDisplacement(simulator).y).toBeLessThan(before);
  });

  it("does not restart the gravity onset while changing only its strength", () => {
    const simulator = new PhysicsSimulator({
      mesh: selectedMesh(),
      parameters: { ...MOTION_PRESETS.purupuru, gravityDirection: "down", gravityStrength: 1, fluctuation: 0 },
      seed: 4,
    });
    for (let tick = 0; tick < 120; tick += 1) simulator.step();
    const elapsed = simulator.createSnapshot().gravityElapsedSeconds;
    simulator.setParameters({ ...MOTION_PRESETS.purupuru, gravityDirection: "down", gravityStrength: 1.1, fluctuation: 0 });
    expect(simulator.createSnapshot().gravityElapsedSeconds).toBe(elapsed);
  });

  it("creates deterministic, bounded two-axis floating motion without gravity", () => {
    const create = () => new PhysicsSimulator({
      mesh: selectedMesh(),
      parameters: { ...MOTION_PRESETS.floaty, gravityDirection: "none", gravityStrength: 0, fluctuation: 0 },
      seed: 91,
    });
    const first = create();
    const replay = create();
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let tick = 0; tick < 2_400; tick += 1) {
      first.step();
      replay.step();
      const point = meanDisplacement(first);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    expect(first.createSnapshot()).toEqual(replay.createSnapshot());
    expect(minX).toBeLessThan(-0.0005);
    expect(maxX).toBeGreaterThan(0.0005);
    expect(minY).toBeLessThan(-0.0003);
    expect(maxY).toBeGreaterThan(0.0003);
    expect(first.isFinite()).toBe(true);
    expect(first.hasInvertedTriangles()).toBe(false);
  });

  it("gives purupuru delayed overshoot, secondary decay, and local phase differences", () => {
    const simulator = new PhysicsSimulator({
      mesh: selectedMesh(),
      parameters: { ...MOTION_PRESETS.purupuru, gravityDirection: "down", gravityStrength: 0, fluctuation: 0 },
      seed: 1,
    });
    const response: number[] = [];
    const secondaryResponse: number[] = [];
    let phaseSplit = false;
    for (let tick = 0; tick < 600; tick += 1) {
      simulator.step({ localAcceleration: tick < 2 ? { x: 0, y: 7 } : { x: 0, y: 0 } });
      response.push(meanDisplacement(simulator).y);
      const secondaryY = simulator.createSnapshot().secondaryOffsets.filter((_value, index) => index % 2 === 1);
      secondaryResponse.push(secondaryY.reduce((sum, value) => sum + value, 0) / secondaryY.length);
      phaseSplit ||= Math.min(...secondaryY) < -1e-5 && Math.max(...secondaryY) > 1e-5;
    }
    const peak = Math.max(...response);
    const peakIndex = response.indexOf(peak);
    const trough = Math.min(...response.slice(peakIndex));
    const troughIndex = response.indexOf(trough, peakIndex);
    const secondPeak = Math.max(...response.slice(troughIndex));
    const secondPeakIndex = response.indexOf(secondPeak, troughIndex);
    const secondTrough = Math.min(...response.slice(secondPeakIndex));
    const secondaryPeakIndex = secondaryResponse.indexOf(Math.max(...secondaryResponse));
    expect(peakIndex).toBeGreaterThanOrEqual(2);
    expect(secondaryPeakIndex).toBeGreaterThan(2);
    expect(peak).toBeGreaterThan(0.0005);
    expect(trough).toBeLessThan(-0.00015);
    expect(secondPeak).toBeGreaterThan(0.0001);
    expect(secondTrough).toBeLessThan(-0.00008);
    expect(phaseSplit).toBe(true);
    expect(Math.abs(response.at(-1) ?? 1)).toBeLessThan(5e-5);
  });

  it("uses a capped fixed-tick accumulator after a long tab suspension", () => {
    const simulator = new PhysicsSimulator({ mesh: selectedMesh(3, 3), parameters: MOTION_PRESETS.floaty, seed: 1 });
    expect(simulator.advance(1)).toBe(4);
    expect(simulator.tick).toBe(4);
    expect(simulator.advance(1 / 120)).toBe(1);
    expect(simulator.tick).toBe(5);
  });

  it("keeps unselected vertices exactly fixed", () => {
    const mesh = selectedMesh();
    const simulator = new PhysicsSimulator({ mesh, parameters: MOTION_PRESETS.purupuru, seed: 13 });
    for (let tick = 0; tick < 300; tick += 1) simulator.step(inputAt(tick));
    for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
      if ((mesh.weights[vertex] ?? 0) !== 0) continue;
      expect(mesh.positions[vertex * 2]).toBe(mesh.restPositions[vertex * 2]);
      expect(mesh.positions[vertex * 2 + 1]).toBe(mesh.restPositions[vertex * 2 + 1]);
    }
  });

  it("keeps disconnected regions dynamically independent", () => {
    const mesh = createGridMesh({
      columns: 10,
      rows: 4,
      imageWidth: 2,
      imageHeight: 1,
      weights: (u, v) => ((u < 0.3 || u > 0.7) && v > 0 && v < 1 ? 1 : 0),
    });
    const simulator = new PhysicsSimulator({ mesh, parameters: { ...MOTION_PRESETS.floaty, gravityDirection: "down", gravityStrength: 0, fluctuation: 0 }, seed: 0 });
    for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
      const u = mesh.uvs[vertex * 2] ?? 0;
      if ((mesh.weights[vertex] ?? 0) > 0 && u < 0.3) mesh.velocities[vertex * 2 + 1] = 2;
    }
    for (let tick = 0; tick < 240; tick += 1) simulator.step();
    let rightMaximumDisplacement = 0;
    for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
      if ((mesh.uvs[vertex * 2] ?? 0) <= 0.7 || (mesh.weights[vertex] ?? 0) <= 0) continue;
      rightMaximumDisplacement = Math.max(rightMaximumDisplacement, Math.hypot(
        (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0),
        (mesh.positions[vertex * 2 + 1] ?? 0) - (mesh.restPositions[vertex * 2 + 1] ?? 0),
      ));
    }
    expect(rightMaximumDisplacement).toBeLessThan(1e-12);
  });

  it("uses safe rotation fallbacks for thin and degenerate regions", () => {
    const masks = [
      (_u: number, v: number) => (Math.abs(v - 0.5) < 0.01 ? 1 : 0),
      (u: number, v: number) => (Math.abs(u - 0.5) < 0.01 && Math.abs(v - 0.5) < 0.01 ? 1 : 0),
      (u: number, v: number) => (u > 0.25 && u < 0.75 && v > 0.25 && v < 0.75 ? 1 : 0),
    ];
    for (const [index, weights] of masks.entries()) {
      const simulator = new PhysicsSimulator({
        mesh: createGridMesh({ columns: 8, rows: 8, imageWidth: 1, imageHeight: 1, weights }),
        parameters: MOTION_PRESETS.purupuru,
        seed: index,
      });
      for (let tick = 0; tick < 1_200; tick += 1) simulator.step(inputAt(tick));
      expect(simulator.isFinite()).toBe(true);
      expect(simulator.hasInvertedTriangles()).toBe(false);
    }
  });

  it("survives sixty simulated seconds at parameter and input extremes", { timeout: 30_000 }, () => {
    const extremes: MotionParameters[] = [
      { inputStrength: 100, stretch: 100, bounce: 100, damping: 0, cohesion: 0, gravityDirection: "down", gravityStrength: 2, fluctuation: 100, maxStretch: 100 },
      { inputStrength: 100, stretch: 0, bounce: 0, damping: 100, cohesion: 100, gravityDirection: "left", gravityStrength: 2, fluctuation: 100, maxStretch: 0 },
      ...Object.values(MOTION_PRESETS),
    ];
    for (const [caseIndex, parameters] of extremes.entries()) {
      const simulator = new PhysicsSimulator({ mesh: selectedMesh(6, 6), parameters, seed: 0xabc000 + caseIndex });
      for (let tick = 0; tick < 60 * 120; tick += 1) simulator.step(inputAt(tick));
      expect(simulator.isFinite(), `finite case ${caseIndex}`).toBe(true);
      expect(simulator.hasInvertedTriangles(), `inversion case ${caseIndex}`).toBe(false);
      expect(Math.hypot(simulator.frame.position.x, simulator.frame.position.y)).toBeLessThanOrEqual(0.0800000001);
      for (const { a, b, c } of simulator.constraints.areas) {
        expect(signedTriangleArea(
          simulator.mesh.positions[a * 2] ?? 0,
          simulator.mesh.positions[a * 2 + 1] ?? 0,
          simulator.mesh.positions[b * 2] ?? 0,
          simulator.mesh.positions[b * 2 + 1] ?? 0,
          simulator.mesh.positions[c * 2] ?? 0,
          simulator.mesh.positions[c * 2 + 1] ?? 0,
        )).toBeGreaterThan(0);
      }
    }
  });
});
