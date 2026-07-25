import { describe, expect, it } from "vitest";
import { createGridMesh, MOTION_PRESETS, PhysicsSimulator } from "../vendor/purupuru/core";
import { gridForImage } from "../core/grid";
import { qualityForTier } from "../core/quality";
import type { QualityTierId } from "../core/types";

/**
 * 솔버 벤치. 측정 도구지 게이트가 아니다 — 시간에 대한 단언은 하지 않는다.
 * 기계마다 다르고 CI에서 흔들린다. 숫자 읽는 법은 src/bench/README.md.
 *
 * 단언하는 건 발산뿐이다 (`isFinite`). 뒤집힘은 단언하지 않고 표에 열로 찍는다 —
 * 이 합성 구동은 스펙 §4.1이 잰 구동과 다르므로 여기서 뒤집혔다고 §4.1이 틀린 게 아니다.
 */

/** 스펙 §4.2의 실측 크롭 크기대. */
const CROPS = [
  { label: "400x400", width: 400, height: 400 },
  { label: "640x800", width: 640, height: 800 },
  { label: "900x1800", width: 900, height: 1800 },
] as const;

/** 칠한 면적 비율 (크롭 면적 대비). */
const FILLS = [0.02, 0.1, 0.3] as const;

const TIERS: readonly QualityTierId[] = ["high", "medium", "low"];

const WARMUP_STEPS = 60;
const MEASURED_STEPS = 600;

/** 뷰어 기본 활성 컷 상한 — 스펙 §4.8. tickRate 60 이므로 60fps 에서 컷당 프레임당 1스텝. */
const ACTIVE_CUTS = 2;
/** 스펙 §8: 이 기계(Apple Silicon) 기준 활성 2개 합계 목표. 중급폰 5배 느림 가정. */
const FRAME_BUDGET_MS = 0.8;

interface BenchRow {
  crop: string;
  fillPercent: number;
  tier: QualityTierId;
  vertices: number;
  dynamicVertices: number;
  microsPerStep: number;
  msPerFrame: number;
  /** 측정 끝 시점의 뒤집힘 여부. 관측값이지 게이트가 아니다 — README 참고. */
  inverted: boolean;
}

/**
 * 크롭 면적의 fill 비율만큼 칠한 중심 원.
 * 물리 좌표(짧은 변 정규화)에서 원이므로 종횡비가 달라도 진짜 원이고,
 * 면적 비율은 pi*r^2 / (W*H) = fill 로 정확히 맞는다.
 */
function buildMesh(width: number, height: number, fill: number) {
  const { columns, rows } = gridForImage(width, height);
  const short = Math.min(width, height);
  const physicalWidth = width / short;
  const physicalHeight = height / short;
  const radius = Math.sqrt((fill * physicalWidth * physicalHeight) / Math.PI);
  return createGridMesh({
    columns,
    rows,
    imageWidth: width,
    imageHeight: height,
    weights: (u, v) =>
      Math.hypot((u - 0.5) * physicalWidth, (v - 0.5) * physicalHeight) <= radius ? 1 : 0,
  });
}

/**
 * 구동 가속도 크기. 엔진이 step()에서 거는 상한은 8이므로 그 안의 중간 세기다.
 * 3.0으로 올리면 30% 마스크가 iterations 3에서 접힌다 (관측). 벤치는 시간 재는 게 목적이라
 * 접히지 않는 구간을 쓴다.
 */
const DRIVE_ACCELERATION = 1.5;

/** 감쇠하는 과도 상태가 아니라 정상 상태를 재도록 계속 도는 입력. */
const driveInput = (tick: number) => ({
  localAcceleration: {
    x: DRIVE_ACCELERATION * Math.cos(tick * 0.05),
    y: DRIVE_ACCELERATION * Math.sin(tick * 0.05),
  },
});

function measure(crop: (typeof CROPS)[number], fill: number, tier: QualityTierId): BenchRow {
  const mesh = buildMesh(crop.width, crop.height, fill);
  const simulator = new PhysicsSimulator({
    mesh,
    parameters: MOTION_PRESETS.purupuru,
    seed: 1,
    quality: qualityForTier(tier),
  });

  for (let tick = 0; tick < WARMUP_STEPS; tick += 1) simulator.step(driveInput(tick));

  const started = performance.now();
  for (let tick = 0; tick < MEASURED_STEPS; tick += 1) {
    simulator.step(driveInput(WARMUP_STEPS + tick));
  }
  const elapsedMs = performance.now() - started;

  expect(simulator.isFinite()).toBe(true);

  const msPerStep = elapsedMs / MEASURED_STEPS;
  let dynamicVertices = 0;
  for (const weight of mesh.weights) if (weight > 0) dynamicVertices += 1;

  return {
    crop: crop.label,
    fillPercent: fill * 100,
    tier,
    vertices: mesh.weights.length,
    dynamicVertices,
    microsPerStep: msPerStep * 1000,
    msPerFrame: msPerStep * ACTIVE_CUTS,
    inverted: simulator.hasInvertedTriangles(),
  };
}

function printTable(rows: readonly BenchRow[]): void {
  const columns: readonly [string, number, (row: BenchRow) => string][] = [
    ["crop", 9, (row) => row.crop],
    ["fill%", 6, (row) => row.fillPercent.toFixed(0)],
    ["tier", 7, (row) => row.tier],
    ["verts", 6, (row) => String(row.vertices)],
    ["dyn", 6, (row) => String(row.dynamicVertices)],
    ["us/step", 9, (row) => row.microsPerStep.toFixed(1)],
    [`ms/frame x${ACTIVE_CUTS}`, 14, (row) => row.msPerFrame.toFixed(3)],
    ["vs budget", 10, (row) => (row.msPerFrame <= FRAME_BUDGET_MS ? "ok" : "over")],
    ["inverted", 9, (row) => (row.inverted ? "YES" : "-")],
  ];

  const line = (cells: readonly string[]) =>
    cells.map((cell, index) => cell.padEnd(columns[index]?.[1] ?? 0)).join("");

  console.log("");
  console.log(`solver bench — purupuru preset, ${MEASURED_STEPS} steps averaged (warmup ${WARMUP_STEPS})`);
  console.log(
    `tickRate 60 => 60fps 에서 컷당 프레임당 1 스텝. 활성 ${ACTIVE_CUTS}개 = 프레임당 ${ACTIVE_CUTS} 스텝.`,
  );
  console.log(`budget: <= ${FRAME_BUDGET_MS} ms/frame on this machine (spec §8). 숫자 읽는 법은 src/bench/README.md.`);
  console.log(line(columns.map(([heading]) => heading)));
  console.log("-".repeat(columns.reduce((total, [, width]) => total + width, 0)));
  for (const row of rows) console.log(line(columns.map(([, , cell]) => cell(row))));
  console.log("");
}

describe("solver bench", () => {
  it(
    "measures step cost across crop size, painted area and quality tier",
    { timeout: 600_000 },
    () => {
      const rows: BenchRow[] = [];
      for (const crop of CROPS) {
        for (const fill of FILLS) {
          for (const tier of TIERS) rows.push(measure(crop, fill, tier));
        }
      }
      printTable(rows);
      expect(rows).toHaveLength(CROPS.length * FILLS.length * TIERS.length);
      for (const row of rows) {
        expect(row.dynamicVertices).toBeGreaterThan(0);
        expect(Number.isFinite(row.microsPerStep)).toBe(true);
      }
    },
  );
});
