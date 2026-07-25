import type { JiggleProject, Rect } from "../core/types";
import { MOTION_PRESETS } from "../vendor/purupuru/core/parameters";
import { parseProject, ProjectParseError } from "./schema";

export function createProject(
  source: { src: string; width: number; height: number },
  crop: Rect,
): JiggleProject {
  return {
    format: "jiggle-project", version: 1,
    source: { ...source }, crop: { ...crop },
    region: { baseFill: 0, inverted: false, strokes: [] },
    motion: { ...MOTION_PRESETS.purupuru },
    seed: 1,
  };
}

export const serializeProject = (project: JiggleProject): string => JSON.stringify(project, null, 2);

export function deserializeProject(json: string): JiggleProject {
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch (error) { throw new ProjectParseError("$", `malformed JSON: ${(error as Error).message}`); }
  return parseProject(raw);
}
