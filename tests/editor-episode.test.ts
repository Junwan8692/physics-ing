import { describe, expect, it } from "vitest";
import {
  applyEpisodeToSlices,
  compareSliceNames,
  episodeFromSlices,
  isPainted,
  sliceToProject,
  type EpisodeSlice,
} from "../src/editor/episode";
import { MOTION_PRESETS } from "../src/vendor/purupuru/core/parameters";
import { EMPTY_REGION, type RegionSnapshot } from "../src/vendor/purupuru/region/model";

// node 환경이라 진짜 <img> 를 만들 수 없다. episode.ts 는 element 를 절대 읽지 않으므로
// 자리끼우개면 충분하다 — 읽기 시작하면 이 캐스트가 먼저 터진다.
const stubElement = null as unknown as HTMLImageElement;

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

const makeSlice = (name: string, region: RegionSnapshot = EMPTY_REGION): EpisodeSlice => ({
  id: `id-${name}`,
  name,
  element: stubElement,
  width: 1280,
  height: 5120,
  region,
  motion: { ...MOTION_PRESETS.purupuru },
  seed: 1,
});

describe("compareSliceNames", () => {
  it("scroll_2 가 scroll_10 앞에 온다 — 문자열 정렬이면 회차가 통째로 섞인다", () => {
    expect(compareSliceNames("scroll_2.jpg", "scroll_10.jpg")).toBeLessThan(0);
    expect(compareSliceNames("scroll_10.jpg", "scroll_2.jpg")).toBeGreaterThan(0);
  });

  it("회차 전체를 번호순으로 정렬한다", () => {
    const names = ["scroll_10.jpg", "scroll_1.jpg", "scroll_9.jpg", "scroll_2.jpg", "scroll_21.jpg"];
    expect([...names].sort(compareSliceNames)).toEqual([
      "scroll_1.jpg", "scroll_2.jpg", "scroll_9.jpg", "scroll_10.jpg", "scroll_21.jpg",
    ]);
  });

  it("0 채움 이름도 같은 순서로 온다", () => {
    expect(["cut-010.png", "cut-002.png"].sort(compareSliceNames)).toEqual(["cut-002.png", "cut-010.png"]);
  });

  it("같은 이름이면 0", () => {
    expect(compareSliceNames("a.png", "a.png")).toBe(0);
  });
});

describe("isPainted", () => {
  it("획이 없으면 false, 있으면 true", () => {
    expect(isPainted(makeSlice("a.png"))).toBe(false);
    expect(isPainted(makeSlice("a.png", painted))).toBe(true);
  });
});

describe("sliceToProject", () => {
  it("안 칠한 슬라이스는 null 이다", () => {
    expect(sliceToProject(makeSlice("a.png"))).toBeNull();
  });

  it("칠한 슬라이스는 크롭 UV 프로젝트가 된다", () => {
    const project = sliceToProject(makeSlice("cut-003.png", painted));
    expect(project).not.toBeNull();
    if (!project) return;
    expect(project.format).toBe("jiggle-project");
    expect(project.source).toEqual({ src: "cut-003.png", width: 1280, height: 5120 });
    // 크롭은 원본보다 작아야 하고, 획 좌표는 그 크롭 안 [0,1] 로 다시 잡혀야 한다.
    expect(project.crop.width).toBeLessThan(1280);
    expect(project.crop.height).toBeLessThan(5120);
    for (const point of project.region.strokes[0]?.points ?? []) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(1);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(1);
    }
    // 원본 UV 그대로였다면 0.12 였을 size 가 크롭 기준으로 커져 있어야 한다.
    expect(project.region.strokes[0]?.size).toBeGreaterThan(0.12);
  });
});

describe("episodeFromSlices", () => {
  it("안 칠한 슬라이스는 파일에 싣지 않는다", () => {
    const episode = episodeFromSlices([
      makeSlice("cut-001.png"),
      makeSlice("cut-002.png", painted),
      makeSlice("cut-003.png"),
    ]);
    expect(episode.format).toBe("jiggle-episode");
    expect(episode.projects).toHaveLength(1);
    expect(episode.projects[0]?.source.src).toBe("cut-002.png");
  });

  it("아무도 안 칠했으면 빈 회차다", () => {
    expect(episodeFromSlices([makeSlice("a.png"), makeSlice("b.png")]).projects).toHaveLength(0);
  });
});

describe("applyEpisodeToSlices", () => {
  it("이름으로 짝지우고, 짝 없는 슬라이스는 건드리지 않는다", () => {
    const episode = episodeFromSlices([{ ...makeSlice("cut-002.png", painted), seed: 777 }]);
    const untouched = makeSlice("cut-001.png");
    const [first, second] = applyEpisodeToSlices(episode, [untouched, makeSlice("cut-002.png")]);

    expect(first).toBe(untouched); // 참조까지 그대로 — 리렌더도 안 나야 한다
    expect(second?.seed).toBe(777);
    expect(second?.region.strokes).toHaveLength(1);
  });

  it("파일에만 있고 슬라이스에 없는 프로젝트는 조용히 버린다", () => {
    const episode = episodeFromSlices([makeSlice("없는파일.png", painted)]);
    const only = makeSlice("cut-001.png");
    expect(applyEpisodeToSlices(episode, [only])).toEqual([only]);
  });
});

describe("왕복", () => {
  it("슬라이스 → 에피소드 → 슬라이스에서 획과 모션이 살아남는다", () => {
    const original: EpisodeSlice[] = [
      makeSlice("scroll_2.jpg", painted),
      { ...makeSlice("scroll_10.jpg", painted), motion: { ...MOTION_PRESETS.shivery }, seed: 12345 },
      makeSlice("scroll_11.jpg"),
    ];

    const restored = applyEpisodeToSlices(episodeFromSlices(original), original.map((slice) => makeSlice(slice.name)));

    expect(restored[2]).toEqual(makeSlice("scroll_11.jpg")); // 안 칠한 장은 기본값 그대로
    expect(restored[1]?.motion).toEqual(MOTION_PRESETS.shivery);
    expect(restored[1]?.seed).toBe(12345);

    for (const index of [0, 1]) {
      const strokes = restored[index]?.region.strokes ?? [];
      expect(strokes).toHaveLength(1);
      expect(strokes[0]?.size).toBeCloseTo(0.12, 6);
      expect(strokes[0]?.mode).toBe("paint");
      expect(strokes[0]?.operation).toBe("add");
      strokes[0]?.points.forEach((point, at) => {
        const source = painted.strokes[0]?.points[at];
        expect(point.x).toBeCloseTo(source?.x ?? 0, 6);
        expect(point.y).toBeCloseTo(source?.y ?? 0, 6);
      });
    }
  });
});
