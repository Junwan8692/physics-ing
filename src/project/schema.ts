import type { GravityDirection, MotionParameters } from "../vendor/purupuru/core/types";
import type { Point, RegionSnapshot, RegionStroke } from "../vendor/purupuru/region/model";
import type { JiggleProject, Rect } from "../core/types";

/** 스트로크 폭증한 파일을 로드하다 브라우저가 죽지 않게 하는 상한. */
export const MAX_STROKES = 2000;
export const MAX_POINTS_PER_STROKE = 5000;

/** 이 이상 큰 슬라이스는 어차피 텍스처로 안 올라간다 (스펙 §4.2). */
const MAX_IMAGE_DIMENSION = 65536;

/**
 * 로드한 JSON 은 외부 입력이다 (스펙 §4.7 "신뢰 경계").
 * 실패한 필드의 정확한 경로를 `path` 로 실어 보낸다 — UI 가 그대로 찍는다.
 */
export class ProjectParseError extends Error {
  public constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ProjectParseError";
  }
}

const GRAVITY_DIRECTIONS: readonly GravityDirection[] = ["none", "down", "up", "left", "right"];
const STROKE_OPERATIONS = ["replace", "add", "subtract"] as const;

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectParseError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function requireNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProjectParseError(path, "expected a finite number");
  }
  if (value < min || value > max) {
    throw new ProjectParseError(path, `expected ${min}..${max}, got ${value}`);
  }
  return value;
}

function requireInteger(value: unknown, path: string, min: number, max: number): number {
  const parsed = requireNumber(value, path, min, max);
  if (!Number.isInteger(parsed)) throw new ProjectParseError(path, `expected an integer, got ${parsed}`);
  return parsed;
}

function requireArray(value: unknown, path: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) throw new ProjectParseError(path, "expected an array");
  if (value.length > maxLength) {
    throw new ProjectParseError(path, `expected at most ${maxLength} entries, got ${value.length}`);
  }
  return value as unknown[];
}

/** 정수 픽셀 사각형. crop 은 픽셀 블릿이라 소수점이 있으면 안 된다. */
function parseRect(value: unknown, path: string, bounds: { width: number; height: number }): Rect {
  const raw = requireObject(value, path);
  const x = requireInteger(raw.x, `${path}.x`, 0, bounds.width);
  const y = requireInteger(raw.y, `${path}.y`, 0, bounds.height);
  const width = requireInteger(raw.width, `${path}.width`, 1, bounds.width);
  const height = requireInteger(raw.height, `${path}.height`, 1, bounds.height);
  if (x + width > bounds.width || y + height > bounds.height) {
    throw new ProjectParseError(path, "must lie inside the source image");
  }
  return { x, y, width, height };
}

function parseMotion(value: unknown): MotionParameters {
  const raw = requireObject(value, "motion");
  const direction = raw.gravityDirection;
  if (typeof direction !== "string" || !GRAVITY_DIRECTIONS.includes(direction as GravityDirection)) {
    throw new ProjectParseError("motion.gravityDirection", `expected one of ${GRAVITY_DIRECTIONS.join(", ")}`);
  }
  // 슬라이더 7종은 전부 0~100. resolveParameters 가 여기서 비선형 매핑한다 (스펙 §3.3).
  const motion: MotionParameters = {
    inputStrength: requireNumber(raw.inputStrength, "motion.inputStrength", 0, 100),
    stretch: requireNumber(raw.stretch, "motion.stretch", 0, 100),
    bounce: requireNumber(raw.bounce, "motion.bounce", 0, 100),
    damping: requireNumber(raw.damping, "motion.damping", 0, 100),
    cohesion: requireNumber(raw.cohesion, "motion.cohesion", 0, 100),
    gravityDirection: direction as GravityDirection,
    gravityStrength: requireNumber(raw.gravityStrength, "motion.gravityStrength", 0, 2),
    fluctuation: requireNumber(raw.fluctuation, "motion.fluctuation", 0, 100),
  };
  // maxStretch 는 구버전 스냅샷에 없을 수 있다 (벤더 타입에서 optional).
  if (raw.maxStretch !== undefined) {
    motion.maxStretch = requireNumber(raw.maxStretch, "motion.maxStretch", 0, 100);
  }
  return motion;
}

function parsePoint(value: unknown, path: string): Point {
  const raw = requireObject(value, path);
  return {
    x: requireNumber(raw.x, `${path}.x`, 0, 1),
    y: requireNumber(raw.y, `${path}.y`, 0, 1),
  };
}

function parseStroke(value: unknown, path: string): RegionStroke {
  const raw = requireObject(value, path);
  const mode = raw.mode;
  if (mode !== "paint" && mode !== "erase") {
    throw new ProjectParseError(`${path}.mode`, 'expected "paint" or "erase"');
  }
  const points = requireArray(raw.points, `${path}.points`, MAX_POINTS_PER_STROKE);
  if (points.length === 0) throw new ProjectParseError(`${path}.points`, "expected at least one point");

  const stroke: RegionStroke = {
    id: requireInteger(raw.id, `${path}.id`, 0, Number.MAX_SAFE_INTEGER),
    mode,
    size: requireNumber(raw.size, `${path}.size`, 0, 1),
    points: points.map((point, index) => parsePoint(point, `${path}.points[${index}]`)),
  };
  if (raw.strength !== undefined) {
    stroke.strength = requireNumber(raw.strength, `${path}.strength`, 0, 1);
  }
  if (raw.operation !== undefined) {
    if (!STROKE_OPERATIONS.includes(raw.operation as (typeof STROKE_OPERATIONS)[number])) {
      throw new ProjectParseError(`${path}.operation`, `expected one of ${STROKE_OPERATIONS.join(", ")}`);
    }
    stroke.operation = raw.operation as (typeof STROKE_OPERATIONS)[number];
  }
  if (raw.target !== undefined) {
    stroke.target = requireNumber(raw.target, `${path}.target`, 0, 1);
  }
  return stroke;
}

function parseRegion(value: unknown): RegionSnapshot {
  const raw = requireObject(value, "region");
  const baseFill = requireInteger(raw.baseFill, "region.baseFill", 0, 1);
  if (typeof raw.inverted !== "boolean") throw new ProjectParseError("region.inverted", "expected a boolean");
  const strokes = requireArray(raw.strokes, "region.strokes", MAX_STROKES);
  return {
    baseFill: baseFill === 1 ? 1 : 0,
    inverted: raw.inverted,
    // feather 는 벤더가 삭제한 기능의 묘비다 (스펙 §3.4). 읽되 버린다.
    strokes: strokes.map((stroke, index) => parseStroke(stroke, `region.strokes[${index}]`)),
  };
}

export function parseProject(value: unknown): JiggleProject {
  const raw = requireObject(value, "$");
  if (raw.format !== "jiggle-project") throw new ProjectParseError("format", 'expected "jiggle-project"');
  // version 은 지금 1만 허용. 2가 생기면 여기서 마이그레이션을 태우고 이어서 검증한다.
  if (raw.version !== 1) throw new ProjectParseError("version", "expected version 1");

  const source = requireObject(raw.source, "source");
  if (typeof source.src !== "string" || source.src.length === 0) {
    throw new ProjectParseError("source.src", "expected a non-empty string");
  }
  const width = requireInteger(source.width, "source.width", 1, MAX_IMAGE_DIMENSION);
  const height = requireInteger(source.height, "source.height", 1, MAX_IMAGE_DIMENSION);

  return {
    format: "jiggle-project",
    version: 1,
    source: { src: source.src, width, height },
    crop: parseRect(raw.crop, "crop", { width, height }),
    region: parseRegion(raw.region),
    motion: parseMotion(raw.motion),
    seed: requireInteger(raw.seed, "seed", 0, 0xffffffff),
  };
}
