import { describe, expect, it } from "vitest";
import { createProject } from "../src/project/io";
import {
  createEpisode, deserializeEpisode, EpisodeParseError,
  MAX_EPISODE_PROJECTS, parseEpisode, serializeEpisode,
} from "../src/project/episode";

const slice = (index: number) =>
  createProject(
    { src: `cut-${String(index).padStart(3, "0")}.png`, width: 1280, height: 5120 },
    { x: 340, y: 1820, width: 494, height: 394 },
  );

const valid = createEpisode([slice(1), slice(2)]);

describe("parseEpisode", () => {
  const rejects = (patch: object, path: string) => {
    try { parseEpisode({ ...valid, ...patch }); expect.unreachable("should throw"); }
    catch (e) { expect(e).toBeInstanceOf(EpisodeParseError); expect((e as EpisodeParseError).path).toBe(path); }
  };

  it("accepts a round-tripped episode", () => {
    expect(parseEpisode(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });
  it("accepts an episode nobody painted yet", () => {
    expect(parseEpisode(createEpisode([])).projects).toEqual([]);
  });
  it("rejects a wrong format tag", () => rejects({ format: "jiggle-project" }, "format"));
  it("rejects an unknown version", () => rejects({ version: 2 }, "version"));
  it("rejects non-array projects", () => rejects({ projects: { "0": slice(1) } }, "projects"));
  it("rejects a non-object", () => {
    expect(() => parseEpisode(null)).toThrow(EpisodeParseError);
    expect(() => parseEpisode([valid])).toThrow(EpisodeParseError);
  });
  it("rejects more projects than the cap", () => {
    const projects = Array.from({ length: MAX_EPISODE_PROJECTS + 1 }, (_u, i) => slice(i));
    rejects({ projects }, "projects");
  });
  it("locates a malformed inner project by index", () => {
    const broken = { ...slice(2), motion: { ...slice(2).motion, stretch: 140 } };
    rejects({ projects: [slice(1), broken] }, "projects[1].motion.stretch");
  });
  it("locates an inner project that is not an object at all", () => {
    rejects({ projects: [slice(1), "nope"] }, "projects[1]");
  });
  it("rejects two projects for the same slice", () => {
    rejects({ projects: [slice(1), slice(2), slice(1)] }, "projects[2].source.src");
  });
});

describe("episode round trip", () => {
  it("survives serialize then deserialize unchanged", () => {
    const painted = slice(7);
    painted.region.strokes.push({
      id: 1, mode: "paint", size: 0.2, points: [{ x: 0.4, y: 0.4 }, { x: 0.45, y: 0.5 }],
    });
    const episode = createEpisode([painted, slice(11)]);
    expect(deserializeEpisode(serializeEpisode(episode))).toEqual(episode);
  });
  it("throws EpisodeParseError on malformed JSON", () => {
    expect(() => deserializeEpisode("{ not json")).toThrow(EpisodeParseError);
  });
});

describe("createEpisode", () => {
  it("copies the array so later pushes do not leak in", () => {
    const projects = [slice(1)];
    const episode = createEpisode(projects);
    projects.push(slice(2));
    expect(episode.projects).toHaveLength(1);
  });
});
