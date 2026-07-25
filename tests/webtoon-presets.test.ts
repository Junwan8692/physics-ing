import { describe, expect, it } from "vitest";
import { WEBTOON_PRESETS } from "../src/editor/webtoonPresets";
import { buildCut, createSimulator } from "../src/core/buildCut";
import { createProject } from "../src/project/io";
import { SOLVER_QUALITY } from "../src/core/quality";
import { resolveParameters } from "../src/vendor/purupuru/core/parameters";
import type { JiggleProject, Rect } from "../src/core/types";
import type { MotionParameters } from "../src/vendor/purupuru/core/types";

type PresetId = keyof typeof WEBTOON_PRESETS;

const PRESET_IDS: readonly PresetId[] = ["hair", "cloth", "chest", "cheek"];

const PERCENT_FIELDS = [
  "inputStrength", "stretch", "bounce", "damping", "cohesion", "fluctuation", "maxStretch",
] as const;

/** 스펙 §4.2의 실측 크롭 크기대. 벤치(src/bench)가 쓰는 것과 같은 3종. */
const CROPS: readonly Rect[] = [
  { x: 0, y: 0, width: 400, height: 400 },
  { x: 0, y: 0, width: 640, height: 800 },
  { x: 0, y: 0, width: 900, height: 1800 },
];

/**
 * 스펙 §9의 실측 상한. shivery 계열(요동이 센 프리셋)이 이 위에서 접힌다.
 * pitch = short/25 기준이며 GRID_K가 ABI인 이유이기도 하다 (§4.9).
 */
const TREMOR_LIMIT = 0.223;

/** 크롭 중앙에 짧은 변 기준 지름 0.4의 덩어리 하나. 크롭 종횡비와 무관하게 원이다. */
function projectFor(motion: MotionParameters, crop: Rect): JiggleProject {
  const project = createProject({ src: "cut.png", width: 1280, height: 5120 }, crop);
  project.motion = { ...motion };
  project.region.strokes.push({
    id: 1, mode: "paint", size: 0.4, strength: 1, operation: "add",
    points: [{ x: 0.5, y: 0.45 }, { x: 0.5, y: 0.55 }],
  });
  return project;
}

/** 스크롤 플릭을 흉내낸 구동. 세로가 세고 가로가 따라 흔들린다. 엔진 상한은 8. */
const drive = (tick: number) => ({
  localAcceleration: {
    x: 3 * Math.sin(tick * 0.11),
    y: 6 * Math.sin(tick * 0.07),
  },
});

describe("WEBTOON_PRESETS", () => {
  it("has the four presets from the observed usage patterns", () => {
    expect(Object.keys(WEBTOON_PRESETS).sort()).toEqual([...PRESET_IDS].sort());
  });

  it("uses fluctuation, never variation", () => {
    for (const id of PRESET_IDS) {
      expect(WEBTOON_PRESETS[id]).toHaveProperty("fluctuation");
      expect(WEBTOON_PRESETS[id]).not.toHaveProperty("variation");
    }
  });

  it("keeps every percent field inside 0..100", () => {
    for (const id of PRESET_IDS) {
      for (const field of PERCENT_FIELDS) {
        const value = WEBTOON_PRESETS[id][field];
        expect(value, `${id}.${field}`).toBeTypeOf("number");
        expect(value, `${id}.${field}`).toBeGreaterThanOrEqual(0);
        expect(value, `${id}.${field}`).toBeLessThanOrEqual(100);
      }
      expect(WEBTOON_PRESETS[id].gravityStrength).toBeGreaterThanOrEqual(0);
      expect(WEBTOON_PRESETS[id].gravityStrength).toBeLessThanOrEqual(2);
    }
  });

  it("stays under the measured tremor ceiling", () => {
    for (const id of PRESET_IDS) {
      expect(resolveParameters(WEBTOON_PRESETS[id]).tremorStrength, id)
        .toBeLessThanOrEqual(TREMOR_LIMIT);
    }
  });
});

describe.each(PRESET_IDS)("%s under load", (id) => {
  it.each(CROPS.map((crop) => [`${crop.width}x${crop.height}`, crop] as const))(
    "stays finite and un-inverted for 900 ticks at %s",
    (_label, crop) => {
      const project = projectFor(WEBTOON_PRESETS[id], crop);
      const simulator = createSimulator(buildCut(project), project, SOLVER_QUALITY);
      for (let tick = 0; tick < 900; tick += 1) simulator.step(drive(tick));
      expect(simulator.isFinite()).toBe(true);
      expect(simulator.hasInvertedTriangles()).toBe(false);
    },
  );

  it("settles back to rest once the input stops and gravity is off", () => {
    const project = projectFor(WEBTOON_PRESETS[id], CROPS[1]!);
    project.motion = { ...project.motion, gravityDirection: "none", gravityStrength: 0 };
    const built = buildCut(project);
    const simulator = createSimulator(built, project, SOLVER_QUALITY);
    for (let tick = 0; tick < 120; tick += 1) simulator.step(drive(tick));
    for (let tick = 0; tick < 1200; tick += 1) simulator.step({});

    let maximum = 0;
    for (let i = 0; i < built.mesh.positions.length; i += 1) {
      maximum = Math.max(maximum, Math.abs((built.mesh.positions[i] ?? 0) - (built.mesh.restPositions[i] ?? 0)));
    }
    expect(maximum).toBeLessThan(0.02);
  });
});
