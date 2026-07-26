import type { JiggleProject } from "../core/types";
import { parseProject, ProjectParseError } from "./schema";

/**
 * 한 회차는 슬라이스 60~70장이고 그중 칠한 것만 여기 담긴다.
 * 상한은 넉넉하되, 손상된 파일이 무한 루프를 태우지 못하게 막는 선 (스펙 §4.7 "신뢰 경계").
 */
export const MAX_EPISODE_PROJECTS = 200;

export interface JiggleEpisode {
  format: "jiggle-episode";
  version: 1;
  /** 칠한 슬라이스만 담는다. source.src 로 이미지 파일과 다시 짝지운다. */
  projects: JiggleProject[];
}

/** ProjectParseError 와 같은 계약: 실패한 필드의 경로를 실어 보낸다 — UI 가 그대로 찍는다. */
export class EpisodeParseError extends Error {
  public constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "EpisodeParseError";
  }
}

export function parseEpisode(value: unknown): JiggleEpisode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EpisodeParseError("$", "expected an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.format !== "jiggle-episode") throw new EpisodeParseError("format", 'expected "jiggle-episode"');
  // version 은 지금 1만 허용. jiggle-project 의 version 과 독립적으로 올라간다.
  if (raw.version !== 1) throw new EpisodeParseError("version", "expected version 1");

  if (!Array.isArray(raw.projects)) throw new EpisodeParseError("projects", "expected an array");
  const entries = raw.projects as unknown[];
  if (entries.length > MAX_EPISODE_PROJECTS) {
    throw new EpisodeParseError("projects", `expected at most ${MAX_EPISODE_PROJECTS} entries, got ${entries.length}`);
  }

  const seen = new Set<string>();
  const projects = entries.map((entry, index) => {
    const base = `projects[${index}]`;
    let project: JiggleProject;
    try {
      project = parseProject(entry);
    } catch (error) {
      if (!(error instanceof ProjectParseError)) throw error;
      // message 는 이미 "path: reason" 이라 접두사를 걷어내고 에피소드 경로로 다시 붙인다.
      const reason = error.message.slice(error.path.length + 2);
      throw new EpisodeParseError(error.path === "$" ? base : `${base}.${error.path}`, reason);
    }
    // 같은 슬라이스에 프로젝트가 둘이면 어느 쪽이 이기는지 정의되지 않는다. 로드 시점에 잡는다.
    if (seen.has(project.source.src)) {
      throw new EpisodeParseError(`${base}.source.src`, `duplicate source.src "${project.source.src}"`);
    }
    seen.add(project.source.src);
    return project;
  });

  return { format: "jiggle-episode", version: 1, projects };
}

export const serializeEpisode = (episode: JiggleEpisode): string => JSON.stringify(episode, null, 2);

export function deserializeEpisode(json: string): JiggleEpisode {
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch (error) { throw new EpisodeParseError("$", `malformed JSON: ${(error as Error).message}`); }
  return parseEpisode(raw);
}

/** 아직 아무도 안 칠한 회차도 정상이다 — 빈 배열로 시작한다. */
export function createEpisode(projects: JiggleProject[]): JiggleEpisode {
  return { format: "jiggle-episode", version: 1, projects: [...projects] };
}
