/*
 * Vendored regression test from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only, plus this explicit vitest import
 * (upstream relied on `globals: true`; we do not). No logic changes.
 *
 * 삭제한 케이스 3개 — 전부 벤더링하지 않는 `play-controls/presets.ts`
 * (`MOTION_PRESETS as UI_PRESETS`, `getPreset`) 에만 의존한다. 스펙 §2.3에 따라
 * 프리셋 정본은 `core/parameters.ts`의 `MOTION_PRESETS`이고 UI 프리셋 테이블은
 * `variation` 필드를 쓰므로 가져오지 않는다:
 *   - "defines the four retained presets with fixed visible values"
 *   - "falls back legacy preset IDs to current purupuru parameters"
 *   - "keeps the four UI and engine presets aligned"
 */
import { describe, expect, it } from "vitest";
import { MOTION_PRESETS as ENGINE_PRESETS, PhysicsSimulator, createGridMesh, meanActiveSelectionResponse, resolveParameters } from "../../src/vendor/purupuru/core";
import {
  combineMotionVectors,
  AUTO_FRAME_TRAVEL,
  AUTO_MOTION_SPEED,
  DEFAULT_AUTO_MOTION_PERIOD_MS,
  DEFAULT_AUTO_MOTION_STRENGTH,
  MAX_AUTO_MOTION_PERIOD_MS,
  MIN_AUTO_MOTION_PERIOD_MS,
  SENSOR_MAXIMUM_FRAME_TRAVEL,
  deviceToStageAcceleration,
  mapAutoMotionStrength,
  getHopTimeline,
  processSensorSample,
  selectFrameInput,
  sampleAutoMotion,
  samplePointerDrag,
  EMPTY_SENSOR_FILTER,
} from "../../src/vendor/purupuru/motion/motion";

describe("motion controls", () => {
  const autoIds = ["sway", "hop", "orbit"] as const;
  const automaticFrameInput = (id: typeof autoIds[number], tick: number, amplitude: number, periodMs?: number, frameScale = 1) => {
    // exactOptionalPropertyTypes 대응: 명시적 undefined 대신 키를 빼서 넘긴다.
    // sampleAutoMotion 은 `options.periodSeconds === undefined` 로 분기하므로 동작은 동일하다.
    const trajectory = sampleAutoMotion(id, tick / 120, { amplitude, speed: AUTO_MOTION_SPEED, ...(periodMs === undefined ? {} : { periodSeconds: periodMs / 1000 }), seed: 42 });
    return {
      frameDragging: amplitude > 0,
      frameTarget: { x: trajectory.x * AUTO_FRAME_TRAVEL * frameScale, y: trajectory.y * AUTO_FRAME_TRAVEL * frameScale },
      frameTravelLimit: AUTO_FRAME_TRAVEL,
      automaticAcceleration: { x: 0, y: 0 },
    };
  };

  it("keeps automatic motion deterministic", () => {
    const first = sampleAutoMotion("sway", 1.25, { amplitude: 0.8, speed: 1.2, seed: 42 });
    const second = sampleAutoMotion("sway", 1.25, { amplitude: 0.8, speed: 1.2, seed: 42 });
    expect(second).toEqual(first);
  });

  it("maps 0-100 percent monotonically while making the default 50 use 60 percent amplitude", () => {
    const expected = new Map([
      [0, 0],
      [25, 0.3],
      [50, 0.6],
      [80, 0.84],
      [100, 1],
    ]);
    for (const [percent, amplitude] of expected) {
      expect(mapAutoMotionStrength(percent)).toBeCloseTo(amplitude, 12);
    }
    const allSteps = Array.from({ length: 101 }, (_, percent) => mapAutoMotionStrength(percent));
    for (let index = 1; index < allSteps.length; index += 1) {
      expect(allSteps[index]).toBeGreaterThan(allSteps[index - 1] ?? -1);
    }
    expect(DEFAULT_AUTO_MOTION_STRENGTH).toBe(50);
    expect(mapAutoMotionStrength(DEFAULT_AUTO_MOTION_STRENGTH)).toBe(0.6);
  });

  it("samples every automatic path at the selected period", () => {
    for (const periodMs of [MIN_AUTO_MOTION_PERIOD_MS, DEFAULT_AUTO_MOTION_PERIOD_MS, MAX_AUTO_MOTION_PERIOD_MS]) {
      const periodSeconds = periodMs / 1000;
      for (const id of autoIds) {
        const options = { amplitude: 0.8, speed: AUTO_MOTION_SPEED, periodSeconds, seed: 42 } as const;
        for (const time of [0, 0.071, periodSeconds * 0.43, periodSeconds * 3.17]) {
          const current = sampleAutoMotion(id, time, options);
          const next = sampleAutoMotion(id, time + periodSeconds * (id === "orbit" ? 2 : 1), options);
          expect(next.x, `${id} x at ${periodMs}ms`).toBeCloseTo(current.x, 9);
          expect(next.y, `${id} y at ${periodMs}ms`).toBeCloseTo(current.y, 9);
          expect(Number.isFinite(next.x)).toBe(true);
          expect(Number.isFinite(next.y)).toBe(true);
        }
      }
    }
  });

  it("extends hop hang time slightly and ground time mostly without stretching active physics", () => {
    const base = getHopTimeline(DEFAULT_AUTO_MOTION_PERIOD_MS / 1000);
    const long = getHopTimeline(MAX_AUTO_MOTION_PERIOD_MS / 1000);
    const added = long.period - base.period;
    expect(long.takeoffEnd).toBeCloseTo(base.takeoffEnd, 12);
    expect((long.hangEnd - long.takeoffEnd) - (base.hangEnd - base.takeoffEnd)).toBeCloseTo(added * 0.25, 12);
    expect((long.period - long.settleEnd) - (base.period - base.settleEnd)).toBeCloseTo(added * 0.75, 12);

    const baseOptions = { amplitude: 1, speed: AUTO_MOTION_SPEED, periodSeconds: base.period, seed: 7 } as const;
    const longOptions = { amplitude: 1, speed: AUTO_MOTION_SPEED, periodSeconds: long.period, seed: 7 } as const;
    const hangShift = long.hangEnd - base.hangEnd;
    for (const baseTime of [0.02, base.hangEnd + 0.03, base.fallEnd + 0.02, base.compressionEnd + 0.025, base.secondRecoilEnd + 0.03]) {
      const longTime = baseTime < base.takeoffEnd ? baseTime : baseTime + hangShift;
      expect(sampleAutoMotion("hop", longTime, longOptions).y).toBeCloseTo(sampleAutoMotion("hop", baseTime, baseOptions).y, 10);
    }
  });

  it("keeps timed hop position and velocity continuous at every supported-period boundary", () => {
    for (const periodSeconds of [MIN_AUTO_MOTION_PERIOD_MS / 1000, DEFAULT_AUTO_MOTION_PERIOD_MS / 1000, MAX_AUTO_MOTION_PERIOD_MS / 1000]) {
      const timeline = getHopTimeline(periodSeconds);
      const options = { amplitude: 1, speed: AUTO_MOTION_SPEED, periodSeconds, seed: 7 } as const;
      const h = 1e-6;
      for (const boundary of [0, timeline.takeoffEnd, timeline.hangEnd, timeline.fallEnd, timeline.compressionEnd, timeline.firstRecoilEnd, timeline.secondRecoilEnd, timeline.settleEnd, timeline.period]) {
        const before = sampleAutoMotion("hop", boundary - h, options).y;
        const at = sampleAutoMotion("hop", boundary, options).y;
        const after = sampleAutoMotion("hop", boundary + h, options).y;
        expect(Math.abs(after - before)).toBeLessThan(6e-5);
        expect((after - at) / h).toBeCloseTo((at - before) / h, 1);
      }
    }
  });

  it("keeps the 50 percent trajectory visibly below 100 percent on all three paths", () => {
    const responseEnergy = (id: typeof autoIds[number], amplitude: number) => {
      let sum = 0;
      for (let tick = 0; tick < 720; tick += 1) {
        const vector = sampleAutoMotion(id, tick / 120, { amplitude, speed: 0.8, seed: 42 });
        sum += vector.x * vector.x + vector.y * vector.y;
      }
      return Math.sqrt(sum / 720);
    };
    for (const id of autoIds) {
      const middle = responseEnergy(id, mapAutoMotionStrength(50));
      const maximum = responseEnergy(id, mapAutoMotionStrength(100));
      expect(middle).toBeCloseTo(maximum * 0.6, 10);
    }
  });

  it("fully stops at zero and preserves three distinct trajectory signatures", () => {
    const signatures = new Set<string>();
    for (const id of autoIds) {
      for (const time of [0, 0.37, 0.81, 1.43]) {
        expect(sampleAutoMotion(id, time, { amplitude: mapAutoMotionStrength(0), speed: 0.8, seed: 7 })).toEqual({ x: 0, y: 0 });
      }
      const signature = [0.17, 0.53, 0.91].map((time) => {
        const vector = sampleAutoMotion(id, time, { amplitude: mapAutoMotionStrength(50), speed: 0.8, seed: 7 });
        return [vector.x.toFixed(5), vector.y.toFixed(5)];
      });
      signatures.add(JSON.stringify(signature));
    }
    expect(signatures.size).toBe(3);
  });

  it("uses eased horizontal endpoints, an asymmetric jump, and a circular orbit", () => {
    const dt = 1 / 1_000;
    const endpointSpeed = Math.abs(
      sampleAutoMotion("sway", dt, { amplitude: 1, speed: 1, seed: 7 }).x
      - sampleAutoMotion("sway", 0, { amplitude: 1, speed: 1, seed: 7 }).x
    ) / dt;
    const middleSpeed = Math.abs(
      sampleAutoMotion("sway", 0.25 + dt, { amplitude: 1, speed: 1, seed: 7 }).x
      - sampleAutoMotion("sway", 0.25, { amplitude: 1, speed: 1, seed: 7 }).x
    ) / dt;
    expect(endpointSpeed).toBeLessThan(middleSpeed * 0.02);

    const takeoff = sampleAutoMotion("hop", 0.1, { amplitude: 1, speed: 1, seed: 7 }).y;
    const airborne = sampleAutoMotion("hop", 0.18, { amplitude: 1, speed: 1, seed: 7 }).y;
    const landing = sampleAutoMotion("hop", 0.54, { amplitude: 1, speed: 1, seed: 7 }).y;
    expect(takeoff).toBeLessThan(-0.8);
    expect(airborne).toBeLessThan(-0.85);
    expect(landing).toBeGreaterThan(0.15);

    const radii: number[] = [];
    for (const time of [0, 0.17, 0.42, 0.83, 1.17]) {
      const point = sampleAutoMotion("orbit", time, { amplitude: 0.7, speed: 1, seed: 7 });
      radii.push(Math.hypot(point.x, point.y));
    }
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(0.7 * 0.78);
    expect(Math.max(...radii)).toBeLessThanOrEqual(0.7);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.08);
  });

  it("keeps trajectory cycle and hop boundaries position/velocity continuous", () => {
    const derivative = (id: typeof autoIds[number], time: number, side: -1 | 1) => {
      const h = 1e-5;
      const a = sampleAutoMotion(id, time + (side < 0 ? -h : 0), { amplitude: 1, speed: 1, seed: 7 });
      const b = sampleAutoMotion(id, time + (side < 0 ? 0 : h), { amplitude: 1, speed: 1, seed: 7 });
      return { x: (b.x - a.x) / h, y: (b.y - a.y) / h };
    };
    const swayStart = sampleAutoMotion("sway", 0, { amplitude: 1, speed: 1, seed: 7 });
    const swayEnd = sampleAutoMotion("sway", 1, { amplitude: 1, speed: 1, seed: 7 });
    expect(swayEnd.x).toBeCloseTo(swayStart.x, 12);
    expect(derivative("sway", 1, -1).x).toBeCloseTo(derivative("sway", 1, 1).x, 3);
    for (const boundary of [0, 0.14, 0.24, 0.48, 0.56, 0.66, 0.74, 0.84, 1]) {
      const before = derivative("hop", boundary, -1);
      const after = derivative("hop", boundary, 1);
      expect(after.x).toBeCloseTo(before.x, 2);
      expect(after.y).toBeCloseTo(before.y, 2);
    }
  });

  it("keeps hop boundary continuity across supported amplitudes and speeds", () => {
    const boundaries = [0, 0.14, 0.24, 0.48, 0.56, 0.66, 0.74, 0.84, 1];
    for (const amplitude of [0.5, 1]) {
      for (const speed of [0.5, 1, 1.6, 3]) {
        const epsilon = 1e-6 / speed;
        for (const progress of boundaries) {
          const time = progress / speed;
          const before = sampleAutoMotion("hop", time - epsilon, { amplitude, speed, seed: 7 });
          const at = sampleAutoMotion("hop", time, { amplitude, speed, seed: 7 });
          const after = sampleAutoMotion("hop", time + epsilon, { amplitude, speed, seed: 7 });
          const velocityBefore = { x: (at.x - before.x) / epsilon, y: (at.y - before.y) / epsilon };
          const velocityAfter = { x: (after.x - at.x) / epsilon, y: (after.y - at.y) / epsilon };
          expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(amplitude * 2e-5);
          const velocityScale = Math.max(1, Math.hypot(velocityBefore.x, velocityBefore.y), Math.hypot(velocityAfter.x, velocityAfter.y));
          expect(Math.hypot(velocityAfter.x - velocityBefore.x, velocityAfter.y - velocityBefore.y) / velocityScale)
            .toBeLessThan(0.01);
        }
      }
    }
  });

  it("carries fall velocity through contact into damped landing recoil", () => {
    const options = { amplitude: 1, speed: 1, seed: 7 } as const;
    const y = (time: number) => sampleAutoMotion("hop", time, options).y;
    const h = 1e-4;
    const velocity = (time: number) => (y(time + h) - y(time - h)) / (2 * h);
    const acceleration = (time: number) => (y(time + h) - 2 * y(time) + y(time - h)) / (h * h);

    expect(y(0.48)).toBeCloseTo(0, 12);
    expect(velocity(0.48 - h * 2)).toBeGreaterThan(5.8);
    expect(velocity(0.48 + h * 2)).toBeGreaterThan(5.8);
    expect(velocity(0.48 - h * 2)).toBeCloseTo(velocity(0.48 + h * 2), 1);
    expect(y(0.56)).toBeCloseTo(0.22, 12);
    expect(y(0.66)).toBeCloseTo(-0.065, 12);
    expect(y(0.74)).toBeCloseTo(0.035, 12);
    expect(y(0.84)).toBeCloseTo(0, 12);
    expect(Math.abs(velocity(0.84))).toBeLessThan(0.002);

    for (let time = 0.45; time <= 0.85; time += 0.002) {
      expect(Number.isFinite(velocity(time))).toBe(true);
      expect(Number.isFinite(acceleration(time))).toBe(true);
      expect(Math.abs(velocity(time))).toBeLessThan(9);
      expect(Math.abs(acceleration(time))).toBeLessThan(250);
    }

    const peakSpeed = (start: number, end: number) => {
      let peak = 0;
      for (let time = start; time <= end; time += 0.0005) peak = Math.max(peak, Math.abs(velocity(time)));
      return peak;
    };
    const incident = velocity(0.48);
    const reboundSpeeds = [peakSpeed(0.56, 0.66), peakSpeed(0.66, 0.74), peakSpeed(0.74, 0.84)];
    expect(incident).toBeGreaterThan(5.9);
    expect(reboundSpeeds[0]).toBeLessThan(incident * 0.8);
    expect(reboundSpeeds[1]).toBeLessThan(reboundSpeeds[0] ?? 0);
    expect(reboundSpeeds[2]).toBeLessThan(reboundSpeeds[1] ?? 0);
    expect((0.56 - 0.48) / AUTO_MOTION_SPEED).toBeGreaterThanOrEqual(0.05);
  });

  it("keeps the hop trajectory finite, bounded, and periodic over long runtimes", () => {
    const options = { amplitude: 1, speed: AUTO_MOTION_SPEED, seed: 42 } as const;
    for (let tick = 0; tick < 120 * 60 * 10; tick += 17) {
      const point = sampleAutoMotion("hop", tick / 120, options);
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(1.001);
    }
    const period = 1 / AUTO_MOTION_SPEED;
    for (const time of [0, 0.083, 0.301, 12.7]) {
      expect(sampleAutoMotion("hop", time + period * 10_000, options).y)
        .toBeCloseTo(sampleAutoMotion("hop", time, options).y, 8);
    }
  });

  it("keeps the doubled automatic travel budget and the one-second default period without sustained acceleration clamp", () => {
    expect(AUTO_FRAME_TRAVEL).toBeCloseTo(0.08 * 2, 12);
    expect(AUTO_MOTION_SPEED).toBe(1);
    expect(DEFAULT_AUTO_MOTION_PERIOD_MS).toBe(1000);
    expect((DEFAULT_AUTO_MOTION_PERIOD_MS - MIN_AUTO_MOTION_PERIOD_MS))
      .toBe(MAX_AUTO_MOTION_PERIOD_MS - DEFAULT_AUTO_MOTION_PERIOD_MS);
    for (const id of autoIds) {
      const mesh = createGridMesh({ columns: 4, rows: 4, imageWidth: 1, imageHeight: 1, weights: () => 1 });
      const simulator = new PhysicsSimulator({ mesh, parameters: ENGINE_PRESETS.purupuru, seed: 11 });
      let clampHits = 0;
      let consecutiveClampHits = 0;
      let maximumConsecutiveClampHits = 0;
      let positionPlateauTicks = 0;
      for (let tick = 0; tick < 720; tick += 1) {
        simulator.step(automaticFrameInput(id, tick, mapAutoMotionStrength(50)));
        if (Math.hypot(simulator.frame.acceleration.x, simulator.frame.acceleration.y) >= 54.999) {
          clampHits += 1;
          consecutiveClampHits += 1;
          maximumConsecutiveClampHits = Math.max(maximumConsecutiveClampHits, consecutiveClampHits);
        } else {
          consecutiveClampHits = 0;
        }
        if (Math.hypot(simulator.frame.position.x, simulator.frame.position.y) >= AUTO_FRAME_TRAVEL - 1e-6) positionPlateauTicks += 1;
      }
      expect(clampHits / 720, id).toBeLessThan(0.07);
      expect(maximumConsecutiveClampHits, id).toBeLessThanOrEqual(3);
      expect(positionPlateauTicks, id).toBe(0);
    }
  });

  it("keeps every path finite across the full 0.20-1.80 second period range", () => {
    for (const periodMs of [MIN_AUTO_MOTION_PERIOD_MS, DEFAULT_AUTO_MOTION_PERIOD_MS, MAX_AUTO_MOTION_PERIOD_MS]) {
      for (const id of autoIds) {
        const mesh = createGridMesh({ columns: 4, rows: 4, imageWidth: 1, imageHeight: 1, weights: () => 1 });
        const simulator = new PhysicsSimulator({ mesh, parameters: ENGINE_PRESETS.purupuru, seed: 11 });
        for (let tick = 0; tick < 720; tick += 1) {
          simulator.step(automaticFrameInput(id, tick, mapAutoMotionStrength(50), periodMs));
          expect(Number.isFinite(simulator.frame.position.x), `${id} ${periodMs}ms x`).toBe(true);
          expect(Number.isFinite(simulator.frame.position.y), `${id} ${periodMs}ms y`).toBe(true);
          expect(Math.hypot(simulator.frame.position.x, simulator.frame.position.y)).toBeLessThan(AUTO_FRAME_TRAVEL);
        }
      }
    }
  });

  it("scales automatic frame travel by mean region response while preserving 100 percent", () => {
    const peaks = [0.1, 0.5, 1].map((weight) => {
      const mesh = createGridMesh({
        columns: 6,
        rows: 6,
        imageWidth: 1,
        imageHeight: 1,
        weights: (u, v) => (u > 0 && u < 1 && v > 0 && v < 1 ? weight : 0),
      });
      const frameScale = meanActiveSelectionResponse(mesh.weights);
      const simulator = new PhysicsSimulator({ mesh, parameters: ENGINE_PRESETS.shivery, seed: 11 });
      let peak = 0;
      for (let tick = 0; tick < 720; tick += 1) {
        simulator.step(automaticFrameInput("sway", tick, mapAutoMotionStrength(50), DEFAULT_AUTO_MOTION_PERIOD_MS, frameScale));
        peak = Math.max(peak, Math.hypot(simulator.frame.position.x, simulator.frame.position.y));
      }
      return peak;
    });
    expect(peaks[0]).toBeLessThan((peaks[2] ?? 0) * 0.1);
    expect(peaks[1]).toBeLessThan((peaks[2] ?? 0) * 0.5);
    expect(peaks[2]).toBeCloseTo(0.09575849765694598, 12);
  });

  it("keeps sustained frame travel at 50 visibly below 100", () => {
    const responseRms = (amplitude: number) => {
      const mesh = createGridMesh({
        columns: 6,
        rows: 6,
        imageWidth: 1,
        imageHeight: 1,
        weights: (u, v) => u > 0 && u < 1 && v > 0 && v < 1 ? 1 : 0,
      });
      const simulator = new PhysicsSimulator({
        mesh,
        parameters: { ...ENGINE_PRESETS.purupuru, gravityDirection: "none", gravityStrength: 0, fluctuation: 0 },
        seed: 11,
      });
      let square = 0;
      let count = 0;
      for (let tick = 0; tick < 720; tick += 1) {
        simulator.step(automaticFrameInput("sway", tick, amplitude));
        if (tick >= 120) {
          square += simulator.frame.position.x ** 2 + simulator.frame.position.y ** 2;
          count += 1;
        }
      }
      return Math.sqrt(square / count);
    };
    const middle = responseRms(mapAutoMotionStrength(50));
    const maximum = responseRms(mapAutoMotionStrength(100));
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(maximum * 0.8);
  });

  it("moves the whole frame and derives local deformation from frame inertia only", () => {
    for (const id of autoIds) {
      const mesh = createGridMesh({
        columns: 8,
        rows: 8,
        imageWidth: 1,
        imageHeight: 1,
        weights: (u, v) => u > 0 && u < 1 && v > 0 && v < 1 ? 1 : 0,
      });
      const simulator = new PhysicsSimulator({
        mesh,
        parameters: { ...ENGINE_PRESETS.purupuru, gravityDirection: "down", gravityStrength: 0, fluctuation: 0 },
        seed: 11,
      });
      let framePeak = 0;
      let localPeak = 0;
      for (let tick = 0; tick < 720; tick += 1) {
        const input = automaticFrameInput(id, tick, mapAutoMotionStrength(50));
        expect(input.automaticAcceleration).toEqual({ x: 0, y: 0 });
        simulator.step(input);
        framePeak = Math.max(framePeak, Math.hypot(simulator.frame.position.x, simulator.frame.position.y));
        const displacements: { x: number; y: number }[] = [];
        for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
          if ((mesh.weights[vertex] ?? 0) <= 0) continue;
          displacements.push({
            x: (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0),
            y: (mesh.positions[vertex * 2 + 1] ?? 0) - (mesh.restPositions[vertex * 2 + 1] ?? 0),
          });
        }
        const mean = displacements.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
        mean.x /= displacements.length;
        mean.y /= displacements.length;
        const rms = Math.sqrt(displacements.reduce((sum, point) => sum + (point.x - mean.x) ** 2 + (point.y - mean.y) ** 2, 0) / displacements.length);
        localPeak = Math.max(localPeak, rms);
      }
      expect(framePeak, id).toBeGreaterThan(0.085);
      expect(framePeak, id).toBeLessThanOrEqual(AUTO_FRAME_TRAVEL + 1e-12);
      expect(localPeak, id).toBeGreaterThan(0.001);
      for (let tick = 0; tick < 360; tick += 1) simulator.step();
      expect(Math.hypot(simulator.frame.position.x, simulator.frame.position.y), id).toBeLessThan(1e-5);
    }
  });

  it("maps device axes into the downward-positive stage for every screen angle", () => {
    expect(deviceToStageAcceleration({ x: 1, y: 0 }, 0)).toEqual({ x: 1, y: -0 });
    expect(deviceToStageAcceleration({ x: 0, y: 1 }, 0)).toEqual({ x: 0, y: -1 });
    expect(deviceToStageAcceleration({ x: 1, y: 0 }, 90)).toEqual({ x: -0, y: -1 });
    expect(deviceToStageAcceleration({ x: 0, y: 1 }, 90)).toEqual({ x: -1, y: -0 });
    expect(deviceToStageAcceleration({ x: 1, y: 0 }, 180)).toEqual({ x: -1, y: 0 });
    expect(deviceToStageAcceleration({ x: 0, y: 1 }, 180)).toEqual({ x: -0, y: 1 });
    expect(deviceToStageAcceleration({ x: 1, y: 0 }, 270)).toEqual({ x: 0, y: 1 });
    expect(deviceToStageAcceleration({ x: 0, y: 1 }, 270)).toEqual({ x: 1, y: 0 });
  });

  it("calibrates the first gravity sample without creating a false shake", () => {
    const first = processSensorSample(
      { x: 0, y: -9.81, includesGravity: true, screenAngle: 0, intervalSeconds: 1 / 60 },
      EMPTY_SENSOR_FILTER,
      1,
    );
    const second = processSensorSample(
      { x: 0, y: -9.81, includesGravity: true, screenAngle: 0, intervalSeconds: 1 / 60 },
      first.state,
      1,
    );
    expect(first.vector).toEqual({ x: 0, y: 0 });
    expect(second.vector).toEqual({ x: 0, y: 0 });
  });

  it("turns larger directional shakes into larger bounded virtual-handle travel", () => {
    const peakFor = (acceleration: number, hz = 60) => {
      let state = EMPTY_SENSOR_FILTER;
      let peak = 0;
      for (let tick = 0; tick < hz; tick += 1) {
        const result = processSensorSample(
          { x: tick < hz * 0.4 ? acceleration : 0, y: 0, includesGravity: false, screenAngle: 0, intervalSeconds: 1 / hz },
          state,
          1,
        );
        state = result.state;
        peak = Math.max(peak, Math.hypot(result.vector.x, result.vector.y));
        if (tick < hz * 0.4) expect(result.vector.x).toBeGreaterThanOrEqual(0);
      }
      return peak;
    };
    const small = peakFor(0.8);
    const large = peakFor(4);
    expect(large).toBeGreaterThan(small * 4);
    expect(large).toBeLessThanOrEqual(SENSOR_MAXIMUM_FRAME_TRAVEL);
  });

  it("keeps virtual-handle response stable across sensor event rates and recenters", () => {
    const simulate = (hz: number) => {
      let state = EMPTY_SENSOR_FILTER;
      let peak = 0;
      for (let tick = 0; tick < hz * 3; tick += 1) {
        const result = processSensorSample(
          { x: tick < hz * 0.4 ? 3 : 0, y: 0, includesGravity: false, screenAngle: 0, intervalSeconds: 1 / hz },
          state,
          1,
        );
        state = result.state;
        peak = Math.max(peak, Math.abs(result.vector.x));
      }
      return { peak, final: Math.hypot(state.position.x, state.position.y) };
    };
    const results = [30, 60, 120].map(simulate);
    expect(Math.max(...results.map(({ peak }) => peak)) - Math.min(...results.map(({ peak }) => peak))).toBeLessThan(0.006);
    for (const result of results) expect(result.final).toBeLessThan(0.0002);
  });

  it("routes sensor travel through the rigid frame between manual and automatic priority", () => {
    const sensor = { x: 0.04, y: -0.02 };
    const automatic = { x: 0.12, y: 0 };
    expect(selectFrameInput(undefined, sensor, automatic, true)).toMatchObject({
      source: "sensor",
      dragging: true,
      target: sensor,
    });
    expect(selectFrameInput({ x: -0.03, y: 0 }, sensor, automatic, true)).toMatchObject({
      source: "manual",
      target: { x: -0.03, y: 0 },
    });
    expect(selectFrameInput(undefined, { x: 0, y: 0 }, automatic, true)).toMatchObject({
      source: "automatic",
      target: automatic,
      travelLimit: AUTO_FRAME_TRAVEL,
    });
  });

  it("moves the rigid frame in both shake directions and produces local inertia", () => {
    const mesh = createGridMesh({ columns: 4, rows: 4, imageWidth: 1, imageHeight: 1, weights: () => 1 });
    const simulator = new PhysicsSimulator({ mesh, parameters: ENGINE_PRESETS.purupuru, seed: 17 });
    let sensorState = EMPTY_SENSOR_FILTER;
    let sensorTarget = { x: 0, y: 0 };
    let minimumFrameX = 0;
    let maximumFrameX = 0;
    let localPeak = 0;
    for (let tick = 0; tick < 240; tick += 1) {
      if (tick % 2 === 0) {
        const time = tick / 120;
        const acceleration = time < 0.4 ? 4 : time < 0.8 ? -4 : 0;
        const result = processSensorSample(
          { x: acceleration, y: 0, includesGravity: false, screenAngle: 0, intervalSeconds: 1 / 60 },
          sensorState,
          1,
        );
        sensorState = result.state;
        sensorTarget = result.vector;
      }
      const selected = selectFrameInput(undefined, sensorTarget, { x: 0, y: 0 }, false);
      simulator.step({ frameDragging: selected.dragging, frameTarget: selected.target });
      minimumFrameX = Math.min(minimumFrameX, simulator.frame.position.x);
      maximumFrameX = Math.max(maximumFrameX, simulator.frame.position.x);
      for (let vertex = 0; vertex < mesh.weights.length; vertex += 1) {
        localPeak = Math.max(localPeak, Math.hypot(
          (mesh.positions[vertex * 2] ?? 0) - (mesh.restPositions[vertex * 2] ?? 0),
          (mesh.positions[vertex * 2 + 1] ?? 0) - (mesh.restPositions[vertex * 2 + 1] ?? 0),
        ));
      }
    }
    expect(maximumFrameX).toBeGreaterThan(0.01);
    expect(minimumFrameX).toBeLessThan(-0.01);
    expect(Math.max(Math.abs(minimumFrameX), maximumFrameX)).toBeLessThanOrEqual(SENSOR_MAXIMUM_FRAME_TRAVEL);
    expect(localPeak).toBeGreaterThan(0.001);
  });

  it("maps pointer displacement directly and independently of event frequency", () => {
    const origin = { x: 100, y: 80 };
    const direct = samplePointerDrag(origin, { x: 120, y: 80 }, 200);
    const repeated = Array.from({ length: 20 }, (_, index) =>
      samplePointerDrag(origin, { x: 101 + index, y: 80 }, 200)).at(-1);
    expect(direct).toEqual({ x: 0.032, y: 0 });
    expect(repeated).toEqual(direct);
  });

  it("clamps pointer travel without changing its direction", () => {
    const target = samplePointerDrag({ x: 0, y: 0 }, { x: 300, y: 400 }, 100);
    expect(Math.hypot(target.x, target.y)).toBeCloseTo(0.08, 12);
    expect(target.y / target.x).toBeCloseTo(4 / 3, 12);
  });

  it("combines automatic and sensor input with a stable unit clamp", () => {
    expect(combineMotionVectors({ x: 0.8, y: 0 }, { x: 0.8, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(combineMotionVectors({ x: Number.NaN, y: 0.25 })).toEqual({ x: 0, y: 0.25 });
  });

  it("keeps cohesion weak through the middle and rises steeply near 100", () => {
    const base = { ...ENGINE_PRESETS.sloshing, damping: 35 };
    const samples = [0, 25, 50, 75, 100].map((cohesion) => resolveParameters({ ...base, cohesion }));
    const expectedShape = [
      0.01,
      0.01234375,
      0.0475,
      0.19984375,
      0.61,
    ];
    samples.forEach((sample, index) => expect(sample.shapeStrength).toBeCloseTo(expectedShape[index]!, 12));
    const dampingBase = 0.25 + 0.35 ** 2 * 18;
    const expectedDamping = [
      dampingBase * 0.04,
      dampingBase * 0.055,
      dampingBase * 0.16,
      dampingBase * 0.445,
      dampingBase,
    ];
    samples.forEach((sample, index) => expect(sample.dampingRate).toBeCloseTo(expectedDamping[index]!, 12));
    const legacyShapeAt50 = 0.01 + 0.5 ** 2 * 0.6;
    const legacyDampingAt50 = dampingBase * (0.04 + 0.5 ** 1.4 * 0.96);
    expect(samples[2]!.shapeStrength).toBeLessThan(legacyShapeAt50 * 0.3);
    expect(samples[2]!.dampingRate).toBeLessThan(legacyDampingAt50 * 0.4);
    expect(samples[4]!.shapeStrength).toBe(legacyShapeAt50 + 0.45);
    expect(samples[4]!.dampingRate).toBe(dampingBase);
  });

  it("keeps all trajectories and presets finite for sixty seconds at maximum combined input", { timeout: 30_000 }, () => {
    for (const [presetIndex, parameters] of Object.values(ENGINE_PRESETS).entries()) {
      for (const id of autoIds) {
        const mesh = createGridMesh({ columns: 4, rows: 4, imageWidth: 1, imageHeight: 1, weights: () => 1 });
        const simulator = new PhysicsSimulator({ mesh, parameters, seed: 100 + presetIndex });
        for (let tick = 0; tick < 60 * 120; tick += 1) {
          simulator.step({
            ...automaticFrameInput(id, tick, mapAutoMotionStrength(100)),
            localAcceleration: combineMotionVectors({ x: 0.8, y: -0.6 }),
          });
        }
        expect(simulator.isFinite(), `${id} preset ${presetIndex}`).toBe(true);
        expect(simulator.hasInvertedTriangles(), `${id} preset ${presetIndex}`).toBe(false);
      }
    }
  });
});
