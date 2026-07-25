import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  EditorApp,
  cropForRegion,
  fromCropUv,
  regionFromProject,
  regionToCropUv,
  toCropUv,
  toProject,
} from "../src/editor/EditorApp";
import { validateImageFile } from "../src/editor/useImageFile";
import { deserializeProject, serializeProject } from "../src/project/io";
import { ProjectParseError } from "../src/project/schema";
import { MOTION_PRESETS } from "../src/vendor/purupuru/core/parameters";
import { EMPTY_REGION, type RegionSnapshot } from "../src/vendor/purupuru/region/model";
import type { Rect } from "../src/core/types";

const IMAGE = { src: "cut-003.png", width: 1280, height: 5120 };

const painted: RegionSnapshot = {
  baseFill: 0,
  inverted: false,
  strokes: [
    {
      id: 1, mode: "paint", size: 0.12, strength: 1, operation: "add",
      points: [{ x: 0.48, y: 0.38 }, { x: 0.52, y: 0.4 }, { x: 0.55, y: 0.43 }],
    },
  ],
};

const cropFor = (region: RegionSnapshot): Rect => {
  const crop = cropForRegion(region, IMAGE.width, IMAGE.height);
  if (!crop) throw new Error("expected a crop");
  return crop;
};

describe("좌표 변환", () => {
  it("원본 UV ↔ 크롭 UV 가 서로의 역함수다", () => {
    const crop: Rect = { x: 340, y: 1820, width: 494, height: 394 };
    for (const point of [{ x: 0.3, y: 0.37 }, { x: 0.5, y: 0.4 }, { x: 0.61, y: 0.42 }]) {
      const back = fromCropUv(toCropUv(point, crop, IMAGE.width, IMAGE.height), crop, IMAGE.width, IMAGE.height);
      expect(back.x).toBeCloseTo(point.x, 12);
      expect(back.y).toBeCloseTo(point.y, 12);
    }
  });

  it("size 를 짧은 변 비율만큼 다시 잰다", () => {
    const crop = cropFor(painted);
    const converted = regionToCropUv(painted, crop, IMAGE.width, IMAGE.height);
    const expected = 0.12 * Math.min(IMAGE.width, IMAGE.height) / Math.min(crop.width, crop.height);
    expect(converted.strokes[0]?.size).toBeCloseTo(expected, 12);
    expect(converted.strokes[0]?.size).toBeLessThanOrEqual(1);
  });

  it("칠한 획이 크롭 UV 안으로 들어온다", () => {
    const crop = cropFor(painted);
    for (const point of regionToCropUv(painted, crop, IMAGE.width, IMAGE.height).strokes[0]?.points ?? []) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(1);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(1);
    }
  });

  it("크롭에서 완전히 벗어난 획은 버린다", () => {
    const crop = cropFor(painted);
    const withStray: RegionSnapshot = {
      ...painted,
      strokes: [
        ...painted.strokes,
        { id: 2, mode: "erase", size: 0.02, operation: "subtract", points: [{ x: 0.02, y: 0.95 }] },
      ],
    };
    expect(regionToCropUv(withStray, crop, IMAGE.width, IMAGE.height).strokes).toHaveLength(1);
  });
});

describe("프로젝트 왕복", () => {
  it("스트로크·모션·크롭이 저장 후 불러오기에서 살아남는다", () => {
    const crop = cropFor(painted);
    const motion = { ...MOTION_PRESETS.shivery };
    const project = toProject({ source: IMAGE, crop, region: painted, motion, seed: 12345 });

    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.crop).toEqual(crop);
    expect(loaded.motion).toEqual(motion);
    expect(loaded.seed).toBe(12345);

    const back = regionFromProject(loaded);
    expect(back.strokes).toHaveLength(1);
    expect(back.strokes[0]?.size).toBeCloseTo(0.12, 6);
    expect(back.strokes[0]?.mode).toBe("paint");
    expect(back.strokes[0]?.operation).toBe("add");
    back.strokes[0]?.points.forEach((point, index) => {
      const original = painted.strokes[0]?.points[index];
      expect(Math.abs(point.x - (original?.x ?? 0))).toBeLessThan(1e-6);
      expect(Math.abs(point.y - (original?.y ?? 0))).toBeLessThan(1e-6);
    });
  });

  it("빈 마스크에는 크롭이 없다", () => {
    expect(cropForRegion(EMPTY_REGION, IMAGE.width, IMAGE.height)).toBeNull();
  });

  it("손상된 파일은 ProjectParseError 다", () => {
    expect(() => deserializeProject("{ not json")).toThrow(ProjectParseError);
    const crop = cropFor(painted);
    const project = toProject({ source: IMAGE, crop, region: painted, motion: { ...MOTION_PRESETS.purupuru }, seed: 1 });
    const broken = { ...project, motion: { ...project.motion, stretch: 140 } };
    expect(() => deserializeProject(JSON.stringify(broken))).toThrow(ProjectParseError);
  });
});

describe("이미지 파일 검증", () => {
  it("PNG · JPEG · WebP 만 받는다", () => {
    expect(validateImageFile(new File([], "a.png", { type: "image/png" }))).toBeNull();
    expect(validateImageFile(new File([], "a.webp", { type: "image/webp" }))).toBeNull();
    expect(validateImageFile(new File([], "a.gif", { type: "image/gif" }))).toContain("WebP");
  });
});

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
});

describe("EditorApp", () => {
  it("이미지 없이도 렌더된다", async () => {
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);

    const root = createRoot(host);
    await act(async () => { root.render(<EditorApp />); });
    expect(host.querySelector('input[aria-label="원본 이미지"]')).not.toBeNull();
    expect(host.textContent).toContain("이미지를 불러오면");
    await act(async () => { root.unmount(); });
  });
});
