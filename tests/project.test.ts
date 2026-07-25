import { describe, expect, it } from "vitest";
import { parseProject, ProjectParseError, MAX_STROKES } from "../src/project/schema";
import { serializeProject, deserializeProject, createProject } from "../src/project/io";

const valid = createProject(
  { src: "cut-003.png", width: 1280, height: 5120 },
  { x: 340, y: 1820, width: 494, height: 394 },
);

describe("parseProject", () => {
  const rejects = (patch: object, path: string) => {
    try { parseProject({ ...valid, ...patch }); expect.unreachable("should throw"); }
    catch (e) { expect(e).toBeInstanceOf(ProjectParseError); expect((e as ProjectParseError).path).toBe(path); }
  };

  it("accepts a round-tripped project", () => {
    expect(() => parseProject(JSON.parse(JSON.stringify(valid)))).not.toThrow();
  });
  it("rejects a wrong format tag", () => rejects({ format: "nope" }, "format"));
  it("rejects an unknown version", () => rejects({ version: 99 }, "version"));
  it("rejects non-positive source dimensions", () => rejects({ source: { ...valid.source, width: 0 } }, "source.width"));
  it("rejects a crop outside the source", () => rejects({ crop: { x: 1200, y: 0, width: 500, height: 100 } }, "crop"));
  it("rejects a non-integral crop", () => rejects({ crop: { ...valid.crop, x: 3.5 } }, "crop.x"));
  it("rejects a motion value outside 0..100", () => rejects({ motion: { ...valid.motion, stretch: 140 } }, "motion.stretch"));
  it("rejects NaN in a motion value", () => rejects({ motion: { ...valid.motion, bounce: Number.NaN } }, "motion.bounce"));
  it("rejects an unknown gravity direction", () => rejects({ motion: { ...valid.motion, gravityDirection: "sideways" } }, "motion.gravityDirection"));
  it("rejects a stroke count above the cap", () => {
    const strokes = Array.from({ length: MAX_STROKES + 1 }, (_u, i) =>
      ({ id: i, mode: "paint", size: 0.1, points: [{ x: 0.5, y: 0.5 }] }));
    rejects({ region: { ...valid.region, strokes } }, "region.strokes");
  });
  it("rejects a stroke with no points", () =>
    rejects({ region: { ...valid.region, strokes: [{ id: 1, mode: "paint", size: 0.1, points: [] }] } }, "region.strokes[0].points"));
  it("rejects a stroke point outside the unit square", () =>
    rejects({ region: { ...valid.region, strokes: [{ id: 1, mode: "paint", size: 0.1, points: [{ x: 3, y: 0.5 }] }] } }, "region.strokes[0].points[0].x"));
  it("rejects a non-object", () => {
    expect(() => parseProject(null)).toThrow(ProjectParseError);
    expect(() => parseProject("nope")).toThrow(ProjectParseError);
  });
});

describe("round trip", () => {
  it("survives serialize then deserialize unchanged", () => {
    const p = createProject({ src: "a.png", width: 800, height: 1200 }, { x: 10, y: 20, width: 300, height: 240 });
    p.region.strokes.push({ id: 1, mode: "paint", size: 0.2, strength: 0.7, operation: "add", points: [{ x: 0.4, y: 0.4 }, { x: 0.45, y: 0.5 }] });
    expect(deserializeProject(serializeProject(p))).toEqual(p);
  });
  it("throws ProjectParseError on malformed JSON", () =>
    expect(() => deserializeProject("{ not json")).toThrow(ProjectParseError));
});

describe("createProject", () => {
  it("uses the purupuru preset with fluctuation", () => {
    expect(valid.motion.fluctuation).toBe(5);
    expect(valid.motion).not.toHaveProperty("variation");
  });
  it("starts with an empty region", () => expect(valid.region.strokes).toEqual([]));
});
