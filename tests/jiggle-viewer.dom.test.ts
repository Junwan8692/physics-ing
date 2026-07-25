import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 지연 생성 검증을 위해 실물을 감싼 스파이로 바꾼다 — 활성화 전에는 호출되면 안 된다.
vi.mock("../src/core/buildCut", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/buildCut")>();
  return { ...actual, buildCut: vi.fn(actual.buildCut) };
});

import { buildCut } from "../src/core/buildCut";
import { createProject } from "../src/project/io";
import { JiggleViewer, type ViewerRenderer } from "../src/viewer/JiggleViewer";
import type { JiggleProject } from "../src/core/types";
import type { MeshData } from "../src/vendor/purupuru/core/types";

class FakeRenderer implements ViewerRenderer {
  public meshes = 0;
  public images = 0;
  public disposals = 0;
  public readonly renders: ({ frameOffset?: { x: number; y: number } } | undefined)[] = [];
  public setMesh(_mesh: MeshData): void { this.meshes += 1; }
  public setImage(_source: TexImageSource): void { this.images += 1; }
  public render(options?: { frameOffset?: { x: number; y: number } }): void { this.renders.push(options); }
  public dispose(): void { this.disposals += 1; }
}

/** observe하면 즉시 교차 중이라고 알린다. 교차 상태는 테스트가 직접 바꿀 수 있다. */
class FakeIntersectionObserver {
  public static latest: FakeIntersectionObserver | undefined;
  private readonly targets = new Set<Element>();
  public constructor(private readonly callback: (entries: IntersectionObserverEntry[]) => void) {
    FakeIntersectionObserver.latest = this;
  }
  public observe(target: Element): void {
    this.targets.add(target);
    this.emit(target, true);
  }
  public unobserve(target: Element): void { this.targets.delete(target); }
  public disconnect(): void { this.targets.clear(); }
  public emit(target: Element, isIntersecting: boolean): void {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry]);
  }
}

function painted(): JiggleProject {
  const project = createProject({ src: "a.png", width: 800, height: 4000 }, { x: 0, y: 0, width: 120, height: 100 });
  project.region.strokes.push({ id: 1, mode: "paint", size: 0.4, strength: 1, operation: "add", points: [{ x: 0.5, y: 0.5 }] });
  return project;
}

const renderers: FakeRenderer[] = [];
const createRenderer = (): ViewerRenderer => {
  const renderer = new FakeRenderer();
  renderers.push(renderer);
  return renderer;
};

function makeViewer(count: number, options: { activeLimit?: number; reducedMotion?: boolean } = {}) {
  const viewer = new JiggleViewer({ adapters: [], createRenderer, activeLimit: 2, ...options });
  const image = document.createElement("img");
  const elements: HTMLElement[] = [];
  for (let index = 0; index < count; index += 1) {
    const element = document.createElement("div");
    document.body.append(element);
    elements.push(element);
    viewer.register(`cut-${index}`, element, painted(), image);
  }
  return { viewer, elements };
}

beforeEach(() => {
  vi.mocked(buildCut).mockClear();
  renderers.length = 0;
  document.body.innerHTML = "";
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JiggleViewer", () => {
  it("activates no more cuts than the limit", () => {
    const { viewer } = makeViewer(5, { activeLimit: 2 });
    viewer.tick(1 / 60);
    expect(viewer.activeIds).toHaveLength(2);
    viewer.destroy();
  });

  it("activates nothing when motion is reduced", () => {
    const { viewer } = makeViewer(3, { reducedMotion: true });
    viewer.tick(1 / 60);
    expect(viewer.activeIds).toEqual([]);
    expect(buildCut).not.toHaveBeenCalled();
    viewer.destroy();
  });

  it("builds the mesh lazily — registration alone touches nothing", () => {
    const { viewer } = makeViewer(1);
    expect(buildCut).not.toHaveBeenCalled();
    expect(renderers).toHaveLength(0);
    viewer.tick(1 / 60);
    expect(buildCut).toHaveBeenCalledTimes(1);
    viewer.destroy();
  });

  it("discards the mesh when a cut stops intersecting and rebuilds it on return", () => {
    const { viewer, elements } = makeViewer(1);
    viewer.tick(1 / 60);
    expect(viewer.activeIds).toEqual(["cut-0"]);
    FakeIntersectionObserver.latest?.emit(elements[0] as Element, false);
    viewer.tick(1 / 60);
    expect(viewer.activeIds).toEqual([]);
    expect(document.body.querySelector("canvas")).toBeNull();
    FakeIntersectionObserver.latest?.emit(elements[0] as Element, true);
    viewer.tick(1 / 60);
    expect(buildCut).toHaveBeenCalledTimes(2);
    viewer.destroy();
  });

  it("renders each active cut exactly once per tick", () => {
    const { viewer } = makeViewer(3, { activeLimit: 2 });
    viewer.tick(1 / 60);
    viewer.tick(1 / 60);
    viewer.tick(1 / 60);
    const used = renderers.filter((renderer) => renderer.renders.length > 0);
    expect(used).toHaveLength(2);
    for (const renderer of used) expect(renderer.renders).toHaveLength(3);
    viewer.destroy();
  });

  it("always renders with a zero frame offset", () => {
    const { viewer } = makeViewer(2, { activeLimit: 2 });
    for (let index = 0; index < 10; index += 1) viewer.tick(1 / 60);
    const calls = renderers.flatMap((renderer) => renderer.renders);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call?.frameOffset).toEqual({ x: 0, y: 0 });
    viewer.destroy();
  });

  it("keeps every simulator finite over 600 ticks", () => {
    const { viewer } = makeViewer(3, { activeLimit: 2 });
    for (let index = 0; index < 600; index += 1) viewer.tick(1 / 60);
    expect(viewer.isFinite()).toBe(true);
    viewer.destroy();
  });

  it("stops tracking an unregistered cut and takes its canvas away", () => {
    const { viewer } = makeViewer(1);
    viewer.tick(1 / 60);
    expect(document.body.querySelectorAll("canvas")).toHaveLength(1);
    viewer.unregister("cut-0");
    expect(viewer.activeIds).toEqual([]);
    expect(document.body.querySelectorAll("canvas")).toHaveLength(0);
    viewer.tick(1 / 60);
    expect(viewer.activeIds).toEqual([]);
    viewer.destroy();
  });

  it("keeps sampling adapters while nothing is active", () => {
    const adapter = {
      id: "scroll" as const,
      enabled: true,
      sample: vi.fn(() => ({})),
      attach: vi.fn(),
      detach: vi.fn(),
    };
    const viewer = new JiggleViewer({ adapters: [adapter], createRenderer, activeLimit: 2 });
    expect(adapter.attach).toHaveBeenCalledTimes(1);
    viewer.tick(1 / 60);
    expect(viewer.activeIds).toEqual([]);
    expect(adapter.sample).toHaveBeenCalledTimes(1);
    viewer.destroy();
    expect(adapter.detach).toHaveBeenCalledTimes(1);
  });

  it("disposes every renderer it created on destroy", () => {
    const { viewer } = makeViewer(3, { activeLimit: 2 });
    viewer.tick(1 / 60);
    viewer.destroy();
    expect(renderers.length).toBeGreaterThan(0);
    for (const renderer of renderers) expect(renderer.disposals).toBe(1);
  });
});
