/**
 * 고정 크기 LRU 풀.
 *
 * SceneRenderer는 생성자에 넘긴 캔버스에 WebGL2 컨텍스트를 만들고 뗄 수 없다.
 * 컨텍스트는 브라우저당 보통 16개가 상한이므로 컷마다 만들면 긴 슬라이스에서 죽는다.
 * 그래서 리소스를 id에 빌려주고 반납받는다. 고갈되면 가장 오래 전에 빌려간 보유자를 축출한다.
 */
export class ResourcePool<T> {
  private readonly free: T[] = [];
  private readonly held = new Map<string, T>();
  private readonly created: T[] = [];
  /** 보유 중인 id. 앞이 오래된 것. */
  private readonly order: string[] = [];

  public constructor(
    private readonly size: number,
    private readonly factory: () => T,
    private readonly disposer: (resource: T) => void,
  ) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new RangeError("Pool size must be a positive integer.");
    }
  }

  public has(id: string): boolean {
    return this.held.has(id);
  }

  /** 보유 중인 id를 오래된 순으로. 복사본이라 밖에서 흔들어도 풀이 안 깨진다. */
  public get activeIds(): string[] {
    return [...this.order];
  }

  public acquire(id: string): T {
    const existing = this.held.get(id);
    if (existing !== undefined) {
      this.touch(id);
      return existing;
    }
    const resource = this.take();
    this.held.set(id, resource);
    this.order.push(id);
    return resource;
  }

  /** 모르는 id는 조용히 무시한다 — 비활성화 경로가 멱등해야 한다. */
  public release(id: string): void {
    const resource = this.held.get(id);
    if (resource === undefined) return;
    this.held.delete(id);
    const position = this.order.indexOf(id);
    if (position >= 0) this.order.splice(position, 1);
    this.free.push(resource);
  }

  public dispose(): void {
    for (const resource of this.created) this.disposer(resource);
    this.created.length = 0;
    this.free.length = 0;
    this.held.clear();
    this.order.length = 0;
  }

  private take(): T {
    const reused = this.free.pop();
    if (reused !== undefined) return reused;
    if (this.created.length < this.size) {
      const made = this.factory();
      this.created.push(made);
      return made;
    }
    const victim = this.order[0];
    if (victim === undefined) throw new Error("Resource pool is exhausted.");
    this.release(victim);
    const recycled = this.free.pop();
    if (recycled === undefined) throw new Error("Resource pool is exhausted.");
    return recycled;
  }

  private touch(id: string): void {
    const position = this.order.indexOf(id);
    if (position >= 0) this.order.splice(position, 1);
    this.order.push(id);
  }
}
