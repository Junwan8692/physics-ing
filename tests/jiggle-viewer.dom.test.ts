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

describe("텍스처는 크롭 픽셀이어야 한다", () => {
  it("전체 원본이 아니라 크롭 크기의 이미지를 업로드한다", () => {
    // 회귀: 메시 UV는 크롭 기준 0..1인데 전체 이미지를 올리면
    // 원본 전체가 크롭 사각형 안으로 찌그러져 들어간다.
    const drawn: unknown[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: (...args: unknown[]) => drawn.push(args),
    } as unknown as CanvasRenderingContext2D);

    const uploaded: TexImageSource[] = [];
    const viewer = new JiggleViewer({
      adapters: [],
      createRenderer: () => {
        const renderer = new FakeRenderer();
        renderer.setImage = (source: TexImageSource): void => { uploaded.push(source); };
        return renderer;
      },
    });
    const project = painted();
    const source = document.createElement("canvas");
    source.width = project.source.width;
    source.height = project.source.height;

    const element = document.createElement("div");
    document.body.append(element);
    viewer.register("cut", element, project, source);
    viewer.tick(1 / 60);

    expect(uploaded).toHaveLength(1);
    const texture = uploaded[0] as HTMLCanvasElement;
    expect(texture.width).toBe(project.crop.width);
    expect(texture.height).toBe(project.crop.height);
    expect(texture).not.toBe(source);
    viewer.destroy();
  });
});

describe("합성 정합", () => {
  it("풀 캔버스는 컨테이너를 꽉 채우도록 CSS 크기가 잡혀 있다", () => {
    // 회귀: CSS 크기가 없으면 캔버스가 고유 픽셀 크기(crop.width CSS px)로 표시된다.
    // 컨테이너는 배경 이미지의 백분율이라 둘이 어긋나고, 크롭 경계에 이음매가 보인다.
    // 드로잉 버퍼는 크롭 픽셀, CSS 박스는 컨테이너 100% — 이 둘이 정합의 계약이다.
    const viewer = new JiggleViewer({ adapters: [], createRenderer });
    const element = document.createElement("div");
    document.body.append(element);
    const project = painted();
    viewer.register("cut", element, project, document.createElement("canvas"));
    viewer.tick(1 / 60);

    const canvas = element.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.style.width).toBe("100%");
    expect(canvas!.style.height).toBe("100%");
    expect(canvas!.style.display).toBe("block");
    expect(canvas!.width).toBe(project.crop.width);
    expect(canvas!.height).toBe(project.crop.height);
    viewer.destroy();
  });
});
