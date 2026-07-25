import { buildCut, createSimulator } from "../core/buildCut";
import { MAX_ACTIVE_LIMIT, activeLimitForTier, qualityForTier, SOLVER_QUALITY } from "../core/quality";
import type { InputAdapter, JiggleProject, QualityTierId, Rect } from "../core/types";
import { combineInputs } from "../input/combine";
import type { MeshData, PhysicsInput } from "../vendor/purupuru/core/types";
import type { PhysicsSimulator } from "../vendor/purupuru/core/simulator";
import { SceneRenderer } from "../vendor/purupuru/render/SceneRenderer";
import { ResourcePool } from "./rendererPool";
import { selectActive, type SchedulerEntry } from "./scheduler";

/** SceneRenderer 중 우리가 쓰는 면. 테스트가 가짜를 끼워 넣는 구멍이기도 하다. */
export interface ViewerRenderer {
  setMesh(mesh: MeshData): void;
  setImage(source: TexImageSource): void;
  render(options?: { frameOffset?: { x: number; y: number } }): void;
  dispose(): void;
}

export interface JiggleViewerOptions {
  adapters: InputAdapter[];
  activeLimit?: number;
  reducedMotion?: boolean;
  createRenderer?: (canvas: HTMLCanvasElement) => ViewerRenderer;
}

interface CutRuntime {
  simulator: PhysicsSimulator;
  renderer: ViewerRenderer;
  canvas: HTMLCanvasElement;
}

interface CutEntry {
  element: HTMLElement;
  project: JiggleProject;
  image: TexImageSource;
  intersecting: boolean;
  /** 활성일 때만 존재한다. 비활성화하면 버린다 — 639 KB/cut × 150 = 96MB. */
  runtime: CutRuntime | undefined;
  /** 크롭만 잘라낸 텍스처. 첫 활성화에서 만들고 재활성화 때 재사용한다. */
  texture: TexImageSource | undefined;
}

interface PooledRenderer {
  renderer: ViewerRenderer;
  canvas: HTMLCanvasElement;
}

/** 스펙 §4.5. padding 기본 0.04는 ~8% 작게 그리고, blurredBackdrop은 아래 그림을 덮는다. */
const defaultCreateRenderer = (canvas: HTMLCanvasElement): ViewerRenderer =>
  new SceneRenderer(canvas, {
    alpha: true,
    background: [0, 0, 0, 0],
    padding: 0,
    blurredBackdrop: false,
  });

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 정적 이미지 위에 크롭 영역만 WebGL 캔버스로 덮는 레이어 합성 뷰어.
 *
 * 캔버스는 컷이 아니라 렌더러가 소유한다 — SceneRenderer는 생성자 캔버스에서 뗄 수 없으므로
 * 풀이 { renderer, canvas } 쌍을 들고, 활성화된 컷 엘리먼트에 그 캔버스를 붙였다 뗀다.
 */
export class JiggleViewer {
  private readonly cuts = new Map<string, CutEntry>();
  private readonly pool: ResourcePool<PooledRenderer>;
  private readonly adapters: InputAdapter[];
  private activeLimit: number;
  private readonly reducedMotion: boolean;
  private readonly observer: IntersectionObserver | undefined;
  /** 시뮬레이터 생성 시점에 고정되므로 활성화 순간의 값이 그 컷의 품질이 된다. */
  private solverQuality = SOLVER_QUALITY;

  public constructor(options: JiggleViewerOptions) {
    this.adapters = options.adapters;
    this.activeLimit = options.activeLimit ?? MAX_ACTIVE_LIMIT;
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion();
    const createRenderer = options.createRenderer ?? defaultCreateRenderer;
    // 풀은 가능한 최대 활성 수 + 1로 고정한다. 활성 상한이 런타임에 내려가도
    // 풀을 다시 만들 필요가 없고, 남는 렌더러는 free 목록에 놀고 있을 뿐이다.
    this.pool = new ResourcePool<PooledRenderer>(
      Math.max(this.activeLimit, MAX_ACTIVE_LIMIT) + 1,
      () => {
        const canvas = document.createElement("canvas");
        return { canvas, renderer: createRenderer(canvas) };
      },
      ({ renderer }) => renderer.dispose(),
    );
    this.observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => this.onIntersection(entries))
      : undefined;
    for (const adapter of this.adapters) adapter.attach();
  }

  /** 메시를 만들지 않는다. 엘리먼트와 프로젝트만 등록하고 관찰을 시작한다. */
  public register(id: string, element: HTMLElement, project: JiggleProject, image: TexImageSource): void {
    this.unregister(id);
    // 관찰자가 없는 환경(SSR·테스트)에서는 등록만으로 보이는 것으로 친다.
    this.cuts.set(id, { element, project, image, intersecting: this.observer === undefined, runtime: undefined, texture: undefined });
    this.observer?.observe(element);
  }

  public unregister(id: string): void {
    const cut = this.cuts.get(id);
    if (!cut) return;
    this.deactivate(id);
    this.observer?.unobserve(cut.element);
    this.cuts.delete(id);
  }

  /**
   * 품질 하향 사다리의 1단계. 상한을 줄이면 다음 tick에서 초과분이 비활성화된다.
   * 솔버 설정은 시뮬레이터 생성 시점에 고정되므로, 이미 활성인 컷은 다음 재활성화부터
   * 새 티어를 쓴다 — 티어가 바뀌는 순간 화면이 튀지 않게 하려는 의도다.
   */
  public setQualityTier(id: QualityTierId): void {
    this.activeLimit = activeLimitForTier(id);
    this.solverQuality = qualityForTier(id);
  }

  public get activeIds(): string[] {
    return [...this.cuts].filter(([, cut]) => cut.runtime !== undefined).map(([id]) => id);
  }

  public tick(elapsedSeconds: number): void {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return;
    if (this.reducedMotion) {
      for (const id of this.activeIds) this.deactivate(id);
      return;
    }
    const active = this.select();
    const wanted = new Set(active);
    for (const id of this.activeIds) if (!wanted.has(id)) this.deactivate(id);
    for (const id of active) this.activate(id);

    // 활성 컷이 없어도 매 틱 샘플한다. 어댑터가 미분 상태(스크롤 속도)를 들고 있어서
    // 건너뛰면 재활성 첫 프레임에 그동안 밀린 이동량이 스파이크로 들어온다.
    const input = combineInputs(
      this.adapters
        .filter((adapter) => adapter.enabled)
        .map((adapter) => ({ id: adapter.id, input: adapter.sample(elapsedSeconds) })),
    );
    if (active.length === 0) return;
    const inputForTick = (): PhysicsInput => input;
    for (const id of active) {
      const runtime = this.cuts.get(id)?.runtime;
      if (!runtime) continue;
      runtime.simulator.advance(elapsedSeconds, inputForTick);
      // frameOffset은 항상 0. 렌더 시점 균일 이동은 크롭 슬래브를 통째로 미끄러뜨려
      // 아래 정적 이미지와 어긋난다. 드래그 입력은 frame.acceleration으로 이미 살아 있다.
      runtime.renderer.render({ frameOffset: { x: 0, y: 0 } });
    }
  }

  /** 테스트용. 활성 시뮬레이터가 전부 유한한가. */
  public isFinite(): boolean {
    for (const cut of this.cuts.values()) {
      if (cut.runtime && !cut.runtime.simulator.isFinite()) return false;
    }
    return true;
  }

  public destroy(): void {
    for (const id of this.activeIds) this.deactivate(id);
    this.observer?.disconnect();
    this.cuts.clear();
    this.pool.dispose();
    for (const adapter of this.adapters) adapter.detach();
  }

  private select(): string[] {
    const entries: SchedulerEntry[] = [];
    for (const [id, cut] of this.cuts) {
      // 보이는 컷만 레이아웃을 읽는다. 등록만 150개 되어 있어도 리플로우가 안 터진다.
      if (!cut.intersecting) continue;
      const box = cut.element.getBoundingClientRect();
      entries.push({ id, centerY: box.top + box.height / 2, intersecting: true });
    }
    const viewportCenterY = typeof window === "undefined" ? 0 : window.innerHeight / 2;
    return selectActive(entries, viewportCenterY, this.activeLimit);
  }

  private activate(id: string): void {
    const cut = this.cuts.get(id);
    if (!cut || cut.runtime) return;
    const built = buildCut(cut.project);
    const simulator = createSimulator(built, cut.project, this.solverQuality);
    const { renderer, canvas } = this.pool.acquire(id);
    canvas.width = built.crop.width;
    canvas.height = built.crop.height;
    renderer.setImage(this.textureFor(cut, built.crop));
    renderer.setMesh(built.mesh);
    cut.element.append(canvas);
    cut.runtime = { simulator, renderer, canvas };
  }

  /**
   * 메시 UV는 크롭 기준 0..1이므로 텍스처도 크롭 픽셀이어야 한다.
   * 원본 전체를 올리면 이미지가 통째로 크롭 사각형 안에 찌그러져 들어간다.
   * 원본을 그대로 올리면 MAX_TEXTURE_SIZE(4096 기기 다수)에도 걸린다 — 스펙 §4.2.
   */
  private textureFor(cut: CutEntry, crop: Rect): TexImageSource {
    if (cut.texture) return cut.texture;
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext("2d");
    // 2D 컨텍스트가 없는 환경에서는 원본을 올린다. 화면은 틀리지만 죽지는 않는다.
    if (!context) return cut.image;
    context.drawImage(
      cut.image as CanvasImageSource,
      crop.x, crop.y, crop.width, crop.height,
      0, 0, crop.width, crop.height,
    );
    cut.texture = canvas;
    return canvas;
  }

  private deactivate(id: string): void {
    const cut = this.cuts.get(id);
    if (!cut?.runtime) return;
    cut.runtime.canvas.remove();
    this.pool.release(id);
    // 시뮬레이터와 메시를 버린다. 재활성 시 rest에서 새로 만든다.
    cut.runtime = undefined;
  }

  private onIntersection(entries: readonly IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      for (const cut of this.cuts.values()) {
        if (cut.element === entry.target) cut.intersecting = entry.isIntersecting;
      }
    }
  }
}
