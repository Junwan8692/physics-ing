import { cropRectForMask, maskBoundsPx } from "../core/crop";
import type { JiggleProject, Rect } from "../core/types";
import { createEpisode, type JiggleEpisode } from "../project/episode";
import { createProject } from "../project/io";
import type { MotionParameters } from "../vendor/purupuru/core/types";
import type { Point, RegionSnapshot, RegionStroke } from "../vendor/purupuru/region/model";

// ─────────────────────────────────────────────────────────────────────────────
// 좌표계 변환 — 저작 중에는 원본 이미지 UV, 저장 포맷은 크롭 UV다 (스펙 §4.7).
// 저장과 불러오기가 같은 두 함수를 쓴다. 한쪽만 고치면 왕복이 깨진다.
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** 원본 UV → 크롭 UV. */
export const toCropUv = (point: Point, crop: Rect, imageWidth: number, imageHeight: number): Point => ({
  x: (point.x * imageWidth - crop.x) / crop.width,
  y: (point.y * imageHeight - crop.y) / crop.height,
});

/** 크롭 UV → 원본 UV. `toCropUv`의 정확한 역함수. */
export const fromCropUv = (point: Point, crop: Rect, imageWidth: number, imageHeight: number): Point => ({
  x: (point.x * crop.width + crop.x) / imageWidth,
  y: (point.y * crop.height + crop.y) / imageHeight,
});

/**
 * 스트로크 `size`는 **짧은 변으로 정규화된 지름**이다 (`regionWeightAt`의 `imageAxisScales`).
 * 좌표계가 바뀌면 기준 짧은 변도 바뀌므로 같은 비율로 다시 재야 한다.
 */
const sizeScaleToCrop = (crop: Rect, imageWidth: number, imageHeight: number): number =>
  Math.min(imageWidth, imageHeight) / Math.min(crop.width, crop.height);

function mapRegion(region: RegionSnapshot, map: (point: Point) => Point, sizeScale: number): RegionSnapshot {
  return {
    ...region,
    strokes: region.strokes.map((stroke) => ({
      ...stroke,
      // 크롭이 마스크에서 유도되므로 정상 작업에서 1을 넘지 않는다.
      // 나중에 통째로 지워진 획만 넘길 수 있어 스키마 범위로 클램프한다.
      size: clamp01(stroke.size * sizeScale),
      points: stroke.points.map((point) => {
        const mapped = map(point);
        return { x: clamp01(mapped.x), y: clamp01(mapped.y) };
      }),
    })),
  };
}

/**
 * 저작 region(원본 UV) → 저장 region(크롭 UV).
 *
 * ponytail: 크롭 밖으로 완전히 벗어난 획만 버린다. 걸친 획은 좌표를 [0,1]로 클램프한다
 * (스키마가 요구하는 범위). 정확히 하려면 폴리라인을 크롭 사각형에 클리핑해야 하지만,
 * 크롭 가장자리 3셀은 정의상 가중치 0인 가드밴드라 클램프 오차가 마스크에 보이지 않는다.
 * 큰 브러시로 크롭을 가로지르는 지우개가 문제가 되면 그때 클리핑으로 올린다.
 */
export function regionToCropUv(
  region: RegionSnapshot,
  crop: Rect,
  imageWidth: number,
  imageHeight: number,
): RegionSnapshot {
  const map = (point: Point): Point => toCropUv(point, crop, imageWidth, imageHeight);
  const sizeScale = sizeScaleToCrop(crop, imageWidth, imageHeight);

  const touchesCrop = (stroke: RegionStroke): boolean => {
    // 반지름은 짧은 변 기준이라 긴 축에서는 과대평가된다 — 덜 버리는 쪽으로 안전하다.
    const half = (stroke.size * sizeScale) / 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of stroke.points) {
      const { x, y } = map(point);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return maxX + half >= 0 && minX - half <= 1 && maxY + half >= 0 && minY - half <= 1;
  };

  return mapRegion({ ...region, strokes: region.strokes.filter(touchesCrop) }, map, sizeScale);
}

/** 저장 region(크롭 UV) → 저작 region(원본 UV). */
export function regionFromCropUv(
  region: RegionSnapshot,
  crop: Rect,
  imageWidth: number,
  imageHeight: number,
): RegionSnapshot {
  return mapRegion(
    region,
    (point) => fromCropUv(point, crop, imageWidth, imageHeight),
    1 / sizeScaleToCrop(crop, imageWidth, imageHeight),
  );
}

export interface EditorSnapshot {
  source: { src: string; width: number; height: number };
  crop: Rect;
  /** 원본 이미지 UV. */
  region: RegionSnapshot;
  motion: MotionParameters;
  seed: number;
}

export function toProject(snapshot: EditorSnapshot): JiggleProject {
  const project = createProject(snapshot.source, snapshot.crop);
  project.region = regionToCropUv(snapshot.region, snapshot.crop, snapshot.source.width, snapshot.source.height);
  project.motion = { ...snapshot.motion };
  project.seed = snapshot.seed;
  return project;
}

/** 불러온 프로젝트의 마스크를 저작 좌표계(원본 UV)로 되돌린다. */
export const regionFromProject = (project: JiggleProject): RegionSnapshot =>
  regionFromCropUv(project.region, project.crop, project.source.width, project.source.height);

/** 칠한 게 없으면 null. 128×128 표본이라 매 획마다 돌리지 않고 저장·미리보기에서만 부른다. */
export function cropForRegion(region: RegionSnapshot, imageWidth: number, imageHeight: number): Rect | null {
  const bounds = maskBoundsPx(region, imageWidth, imageHeight);
  return bounds ? cropRectForMask(bounds, imageWidth, imageHeight) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 슬라이스 — 한 회차는 60~70장이고 저작 상태는 장마다 따로 산다.
// ─────────────────────────────────────────────────────────────────────────────

export interface EpisodeSlice {
  id: string;
  name: string;
  element: HTMLImageElement;
  width: number;
  height: number;
  /** 원본 이미지 UV. 크롭 UV 변환은 프로젝트로 내보낼 때만 한다. */
  region: RegionSnapshot;
  motion: MotionParameters;
  seed: number;
}

/**
 * 웹툰 슬라이스 이름은 번호로 이어진다. 그냥 문자열 정렬하면 scroll_10 이 scroll_2 앞에
 * 서면서 회차 전체가 조용히 섞인다. Intl.Collator 의 numeric 이 그 자리를 정확히 메운다.
 * 로케일은 en 으로 못 박는다 — 기본 로케일에 따라 정렬이 바뀌면 재현이 안 된다.
 */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const compareSliceNames = (a: string, b: string): number => collator.compare(a, b);

/**
 * 획이 하나라도 있으면 "칠했다"로 본다 — 썸네일 스트립이 매 렌더마다 부르는 값이라
 * 128×128 표본(`cropForRegion`)을 여기서 돌릴 수는 없다. 실제로 크롭이 잡히는지는
 * `sliceToProject` 가 판정한다 (지우개만 그은 슬라이스는 여기서 true, 거기서 null).
 */
export const isPainted = (slice: EpisodeSlice): boolean => slice.region.strokes.length > 0;

/** 안 칠했으면 null — 크롭을 정할 수 없는 슬라이스는 프로젝트가 될 수 없다. */
export function sliceToProject(slice: EpisodeSlice): JiggleProject | null {
  const crop = cropForRegion(slice.region, slice.width, slice.height);
  if (!crop) return null;
  return toProject({
    source: { src: slice.name, width: slice.width, height: slice.height },
    crop,
    region: slice.region,
    motion: slice.motion,
    seed: slice.seed,
  });
}

/** 칠한 슬라이스만 담는다. 안 칠한 60장은 파일에 실을 이유가 없다. */
export function episodeFromSlices(slices: readonly EpisodeSlice[]): JiggleEpisode {
  const projects: JiggleProject[] = [];
  for (const slice of slices) {
    const project = sliceToProject(slice);
    if (project) projects.push(project);
  }
  return createEpisode(projects);
}

/**
 * 파일의 프로젝트를 이름(`source.src`)으로 슬라이스에 되붙인다.
 * 짝이 없는 슬라이스는 그대로 둔다 — 회차 일부만 담긴 파일을 불러도 나머지 작업이 안 날아간다.
 */
export function applyEpisodeToSlices(
  episode: JiggleEpisode,
  slices: readonly EpisodeSlice[],
): EpisodeSlice[] {
  const byName = new Map(episode.projects.map((project) => [project.source.src, project]));
  return slices.map((slice) => {
    const project = byName.get(slice.name);
    if (!project) return slice;
    return { ...slice, region: regionFromProject(project), motion: { ...project.motion }, seed: project.seed };
  });
}
