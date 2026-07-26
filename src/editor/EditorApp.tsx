import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { deserializeEpisode, EpisodeParseError, serializeEpisode } from "../project/episode";
import { EMPTY_REGION, type RegionSnapshot } from "../vendor/purupuru/region/model";
import type { MotionParameters } from "../vendor/purupuru/core/types";
import { BRUSH_MAX, BRUSH_MIN, DEFAULT_BRUSH, type BrushSettings } from "./brush";
import { CropPreview } from "./CropPreview";
import {
  applyEpisodeToSlices, episodeFromSlices, isPainted, sliceToProject, type EpisodeSlice,
} from "./episode";
import { EpisodePreview, type PreviewSlice } from "./EpisodePreview";
import { LivePreview } from "./LivePreview";
import { MaskCanvas } from "./MaskCanvas";
import { ParameterPanel } from "./ParameterPanel";
import { SliceStrip } from "./SliceStrip";
import { useImageFiles } from "./useImageFile";

const panelStyle = { border: "1px solid #d5d5d5", borderRadius: 6, padding: 12, display: "grid", gap: 8 } as const;
const rowStyle = { display: "grid", gridTemplateColumns: "4.5rem 1fr 3.5rem", alignItems: "center", gap: 8 } as const;

type Mode = "paint" | "crop" | "preview" | "episode";

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function EditorApp() {
  const { slices: loaded, error: imageError, loadFiles } = useImageFiles();
  const [slices, setSlices] = useState<EpisodeSlice[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // 브러시는 도구지 슬라이스 데이터가 아니다 — 슬라이스를 바꿔도 손에 든 붓은 그대로다.
  const [brush, setBrush] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [mode, setMode] = useState<Mode>("paint");
  const [message, setMessage] = useState<string | null>(null);

  // 훅이 새 배치를 올리면 저작 상태를 통째로 갈아엎는다. 이전 배치의 오브젝트 URL 은
  // 이미 회수된 뒤라 옛 슬라이스를 붙들고 있어봐야 깨진 <img> 다.
  useEffect(() => {
    setSlices(loaded);
    setActiveIndex(0);
  }, [loaded]);

  const active = slices[activeIndex] ?? null;
  const anyPainted = slices.some(isPainted);

  /** 미리보기·저장이 같은 경로를 쓰도록 프로젝트를 한 곳에서 만든다. */
  const activeProject = useMemo(() => (active ? sliceToProject(active) : null), [active]);

  // 회차 전체 크롭 계산은 128×128 표본 × 장수라 싸지 않다. 에피소드 미리보기에 들어갈 때만 돈다.
  const previewSlices = useMemo((): PreviewSlice[] => {
    if (mode !== "episode") return [];
    return slices.map((slice) => {
      const project = sliceToProject(slice);
      // exactOptionalPropertyTypes: project 는 있거나 아예 없어야 한다.
      return project ? { id: slice.id, image: slice.element, project } : { id: slice.id, image: slice.element };
    });
  }, [mode, slices]);

  useEffect(() => {
    if (mode === "preview" && activeProject === null) setMode("paint");
    if (mode === "episode" && !anyPainted) setMode("paint");
  }, [mode, activeProject, anyPainted]);

  /** 활성 슬라이스만 고친다. 파라미터 패널도 칠하기도 전부 이 문을 지난다. */
  const updateActive = (patch: Partial<EpisodeSlice>): void => {
    setSlices((current) => current.map((slice, index) => (index === activeIndex ? { ...slice, ...patch } : slice)));
  };
  const setRegion = (region: RegionSnapshot): void => updateActive({ region });
  const setMotion = (motion: MotionParameters): void => updateActive({ motion });

  const pickImages = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length > 0) loadFiles(files);
  };

  const saveEpisode = (): void => {
    const episode = episodeFromSlices(slices);
    if (episode.projects.length === 0) {
      setMessage("칠한 슬라이스가 없어 저장할 게 없습니다.");
      return;
    }
    download(serializeEpisode(episode), "episode.jiggle.json");
    setMessage(`저장했습니다 — 칠한 슬라이스 ${episode.projects.length} / ${slices.length}장`);
  };

  const loadEpisode = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    void file.text().then((text) => {
      try {
        const episode = deserializeEpisode(text);
        setSlices(applyEpisodeToSlices(episode, slices));
        const matched = episode.projects.filter((project) =>
          slices.some((slice) => slice.name === project.source.src),
        ).length;
        setMessage(
          matched === episode.projects.length
            ? `불러왔습니다 — 프로젝트 ${matched}개를 슬라이스에 붙였습니다.`
            : `불러왔습니다 — 프로젝트 ${episode.projects.length}개 중 ${matched}개만 짝을 찾았습니다. 나머지 원본 이미지도 함께 열어 주세요.`,
        );
      } catch (error) {
        setMessage(
          error instanceof EpisodeParseError
            ? `에피소드 파일이 잘못되었습니다 — ${error.message}`
            : "에피소드 파일을 읽지 못했습니다.",
        );
      }
    });
  };

  return (
    <main style={{ display: "grid", gridTemplateColumns: "16rem minmax(0, 1fr) 22rem", gap: 16, padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
        <input
          type="file" multiple accept="image/png,image/jpeg,image/webp"
          aria-label="슬라이스 이미지" onChange={pickImages}
        />
        {slices.length > 0 ? (
          <SliceStrip slices={slices} activeIndex={activeIndex} onSelect={setActiveIndex} />
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
        {active ? (
          <div role="group" aria-label="편집 모드" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" aria-pressed={mode === "paint"} onClick={() => setMode("paint")}>칠하기</button>
            <button type="button" aria-pressed={mode === "crop"} onClick={() => setMode("crop")}>크롭 확인</button>
            <button
              type="button" aria-pressed={mode === "preview"}
              disabled={activeProject === null}
              title={activeProject === null ? "먼저 이 슬라이스에서 흔들 영역을 칠하세요." : undefined}
              onClick={() => setMode("preview")}
            >
              미리보기
            </button>
            <button
              type="button" aria-pressed={mode === "episode"}
              disabled={!anyPainted}
              title={!anyPainted ? "회차에 칠한 슬라이스가 아직 없습니다." : undefined}
              onClick={() => setMode("episode")}
            >
              에피소드 미리보기
            </button>
          </div>
        ) : null}
        {imageError ? <p role="alert" style={{ color: "#c00", margin: 0 }}>{imageError}</p> : null}
        {!active ? <p style={{ margin: 0, color: "#666" }}>슬라이스 이미지를 불러오면 칠할 수 있습니다.</p> : null}
        {active && mode === "crop" ? <CropPreview image={active.element} region={active.region} /> : null}
        {active && mode === "paint" ? (
          <MaskCanvas image={active.element} region={active.region} brush={brush} onRegionChange={setRegion} />
        ) : null}
        {active && mode === "preview" && activeProject ? (
          <LivePreview image={active.element} project={activeProject} />
        ) : null}
        {mode === "episode" ? <EpisodePreview slices={previewSlices} /> : null}
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
            <button
              type="button" disabled={!active || active.region.strokes.length === 0}
              onClick={() => active && setRegion({ ...active.region, strokes: active.region.strokes.slice(0, -1) })}
            >
              획 되돌리기
            </button>
            <button
              type="button" aria-pressed={active?.region.inverted ?? false} disabled={!active}
              onClick={() => active && setRegion({ ...active.region, inverted: !active.region.inverted })}
            >
              반전
            </button>
            <button
              type="button" disabled={!active || active.region.strokes.length === 0}
              onClick={() => setRegion(EMPTY_REGION)}
            >
              전체 지우기
            </button>
          </div>
          <span style={{ color: "#666" }}>획 {active?.region.strokes.length ?? 0}개</span>
        </section>

        {active ? (
          <div style={panelStyle}>
            <ParameterPanel motion={active.motion} onMotionChange={setMotion} />
          </div>
        ) : null}

        <section aria-label="에피소드" style={panelStyle}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={saveEpisode}>에피소드 저장</button>
            <input type="file" accept="application/json,.json" aria-label="에피소드 불러오기" onChange={loadEpisode} />
          </div>
          <label style={rowStyle}>
            <span>시드</span>
            <input
              type="number" min={0} max={0xffffffff} step={1} disabled={!active} value={active?.seed ?? 1}
              onChange={(event) => updateActive({ seed: Math.max(0, Math.round(event.currentTarget.valueAsNumber || 0)) })}
            />
            <output />
          </label>
          {message ? <p role="status" style={{ margin: 0, color: "#333" }}>{message}</p> : null}
        </section>
      </div>
    </main>
  );
}
