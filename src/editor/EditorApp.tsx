import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { cropRectForMask, maskBoundsPx } from "../core/crop";
import type { JiggleProject, Rect } from "../core/types";
import { createProject, deserializeProject, serializeProject } from "../project/io";
import { ProjectParseError } from "../project/schema";
import { MOTION_PRESETS } from "../vendor/purupuru/core/parameters";
import type { MotionParameters } from "../vendor/purupuru/core/types";
import {
  EMPTY_REGION,
  type Point,
  type RegionSnapshot,
  type RegionStroke,
} from "../vendor/purupuru/region/model";
import { BRUSH_MAX, BRUSH_MIN, DEFAULT_BRUSH, type BrushSettings } from "./brush";
import { CropPreview } from "./CropPreview";
import { MaskCanvas } from "./MaskCanvas";
import { LivePreview } from "./LivePreview";
import { ParameterPanel } from "./ParameterPanel";
import { useImageFile } from "./useImageFile";

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
// 셸
// ─────────────────────────────────────────────────────────────────────────────

const panelStyle = { border: "1px solid #d5d5d5", borderRadius: 6, padding: 12, display: "grid", gap: 8 } as const;
const rowStyle = { display: "grid", gridTemplateColumns: "4.5rem 1fr 3.5rem", alignItems: "center", gap: 8 } as const;

export function EditorApp() {
  const { image, error: imageError, loadFile } = useImageFile();
  const [region, setRegion] = useState<RegionSnapshot>(EMPTY_REGION);
  const [motion, setMotion] = useState<MotionParameters>({ ...MOTION_PRESETS.purupuru });
  const [brush, setBrush] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [seed, setSeed] = useState(1);
  const [mode, setMode] = useState<"paint" | "crop" | "preview">("paint");
  const [message, setMessage] = useState<string | null>(null);

  /** 미리보기·저장이 같은 경로를 쓰도록 프로젝트를 한 곳에서 만든다. */
  const previewProject = useMemo((): JiggleProject | null => {
    if (!image) return null;
    const crop = cropForRegion(region, image.width, image.height);
    if (!crop) return null;
    return toProject({
      source: { src: image.name, width: image.width, height: image.height },
      crop, region, motion, seed,
    });
  }, [image, region, motion, seed]);

  useEffect(() => {
    if (mode === "preview" && previewProject === null) setMode("paint");
  }, [mode, previewProject]);

  const pickImage = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) loadFile(file);
  };

  const saveProject = (): void => {
    if (!image) { setMessage("이미지를 먼저 불러오세요."); return; }
    const crop = cropForRegion(region, image.width, image.height);
    if (!crop) { setMessage("칠한 영역이 없어 크롭을 정할 수 없습니다."); return; }

    const project = toProject({
      source: { src: image.name, width: image.width, height: image.height },
      crop, region, motion, seed,
    });
    const url = URL.createObjectURL(new Blob([serializeProject(project)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${image.name.replace(/\.[^.]+$/, "")}.jiggle.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`저장했습니다 — 크롭 ${crop.width}×${crop.height}px, 획 ${project.region.strokes.length}개`);
  };

  const loadProject = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    void file.text().then((text) => {
      try {
        const project = deserializeProject(text);
        setRegion(regionFromProject(project));
        setMotion(project.motion);
        setSeed(project.seed);
        setMessage(
          image
            ? `불러왔습니다 — ${project.source.src}`
            : `불러왔습니다 — 원본 이미지 ${project.source.src} 도 함께 열어 주세요.`,
        );
      } catch (error) {
        setMessage(
          error instanceof ProjectParseError
            ? `프로젝트 파일이 잘못되었습니다 — ${error.message}`
            : "프로젝트 파일을 읽지 못했습니다.",
        );
      }
    });
  };

  return (
    <main style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 22rem", gap: 16, padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="원본 이미지" onChange={pickImage} />
          {image ? (
            <div role="group" aria-label="편집 모드" style={{ display: "flex", gap: 6 }}>
              <button type="button" aria-pressed={mode === "paint"} onClick={() => setMode("paint")}>칠하기</button>
              <button type="button" aria-pressed={mode === "crop"} onClick={() => setMode("crop")}>크롭 확인</button>
              <button
                type="button" aria-pressed={mode === "preview"}
                disabled={previewProject === null}
                title={previewProject === null ? "먼저 흔들 영역을 칠하세요." : undefined}
                onClick={() => setMode("preview")}
              >
                미리보기
              </button>
            </div>
          ) : null}
        </div>
        {imageError ? <p role="alert" style={{ color: "#c00", margin: 0 }}>{imageError}</p> : null}
        {!image ? <p style={{ margin: 0, color: "#666" }}>이미지를 불러오면 칠할 수 있습니다.</p> : null}
        {image && mode === "crop" ? <CropPreview image={image.element} region={region} /> : null}
        {image && mode === "paint" ? (
          <MaskCanvas image={image.element} region={region} brush={brush} onRegionChange={setRegion} />
        ) : null}
        {image && mode === "preview" && previewProject ? (
          <LivePreview image={image.element} project={previewProject} />
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 12, alignContent: "start", fontSize: 13 }}>
        <section aria-label="브러시" style={panelStyle}>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" aria-pressed={brush.mode === "paint"} onClick={() => setBrush({ ...brush, mode: "paint" })}>칠하기</button>
            <button type="button" aria-pressed={brush.mode === "erase"} onClick={() => setBrush({ ...brush, mode: "erase" })}>지우개</button>
          </div>
          <label style={rowStyle}>
            <span>크기</span>
            <input
              type="range" min={BRUSH_MIN} max={BRUSH_MAX} step={0.005} value={brush.size}
              onChange={(event) => setBrush({ ...brush, size: event.currentTarget.valueAsNumber })}
            />
            <output>{brush.size.toFixed(3)}</output>
          </label>
          <label style={rowStyle}>
            <span>강도</span>
            <input
              type="range" min={0.05} max={1} step={0.05} value={brush.strength}
              onChange={(event) => setBrush({ ...brush, strength: event.currentTarget.valueAsNumber })}
            />
            <output>{brush.strength.toFixed(2)}</output>
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {/*
              ponytail: RegionHistory 대신 "획 하나 되돌리기". MaskCanvas 가 점마다 region 을
              올려주고 제스처 끝을 알려주지 않아서, 히스토리에 커밋하면 되돌리기가 점 하나만
              되돌린다. 제스처 경계가 필요해지면 그때 RegionHistory 로 올린다.
            */}
            <button type="button" disabled={region.strokes.length === 0} onClick={() => setRegion({ ...region, strokes: region.strokes.slice(0, -1) })}>
              획 되돌리기
            </button>
            <button type="button" aria-pressed={region.inverted} onClick={() => setRegion({ ...region, inverted: !region.inverted })}>
              반전
            </button>
            <button type="button" disabled={region.strokes.length === 0} onClick={() => setRegion(EMPTY_REGION)}>
              전체 지우기
            </button>
          </div>
          <span style={{ color: "#666" }}>획 {region.strokes.length}개</span>
        </section>

        <div style={panelStyle}>
          <ParameterPanel motion={motion} onMotionChange={setMotion} />
        </div>

        <section aria-label="프로젝트" style={panelStyle}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={saveProject}>프로젝트 저장</button>
            <input type="file" accept="application/json,.json" aria-label="프로젝트 불러오기" onChange={loadProject} />
          </div>
          <label style={rowStyle}>
            <span>시드</span>
            <input
              type="number" min={0} max={0xffffffff} step={1} value={seed}
              onChange={(event) => setSeed(Math.max(0, Math.round(event.currentTarget.valueAsNumber || 0)))}
            />
            <output />
          </label>
          {message ? <p role="status" style={{ margin: 0, color: "#333" }}>{message}</p> : null}
        </section>
      </div>
    </main>
  );
}
