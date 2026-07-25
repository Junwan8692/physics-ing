import { describe, expect, it } from "vitest";
import { ResourcePool } from "../src/viewer/rendererPool";

function makePool(size = 2) {
  let created = 0;
  const disposed: string[] = [];
  const pool = new ResourcePool<string>(size, () => `r${created++}`, (resource) => disposed.push(resource));
  return { pool, disposed, createdCount: () => created };
}

describe("ResourcePool", () => {
  it("rejects a non-positive size", () => {
    expect(() => new ResourcePool(0, () => 1, () => {})).toThrow(RangeError);
    expect(() => new ResourcePool(-1, () => 1, () => {})).toThrow(RangeError);
  });

  it("never creates more than size resources", () => {
    const { pool, createdCount } = makePool(2);
    pool.acquire("a");
    pool.acquire("b");
    pool.acquire("c");
    expect(createdCount()).toBe(2);
  });

  it("hands the same resource back for the same id", () => {
    const { pool, createdCount } = makePool(2);
    expect(pool.acquire("a")).toBe(pool.acquire("a"));
    expect(createdCount()).toBe(1);
  });

  it("evicts the least recently acquired holder when exhausted", () => {
    const { pool } = makePool(2);
    pool.acquire("a");
    pool.acquire("b");
    pool.acquire("c");
    expect(pool.has("a")).toBe(false);
    expect(pool.has("b")).toBe(true);
    expect(pool.has("c")).toBe(true);
  });

  it("spares a holder that was re-acquired recently", () => {
    const { pool } = makePool(2);
    pool.acquire("a");
    pool.acquire("b");
    pool.acquire("a");
    pool.acquire("c");
    expect(pool.has("a")).toBe(true);
    expect(pool.has("b")).toBe(false);
  });

  it("reuses a released resource instead of making a new one", () => {
    const { pool, createdCount } = makePool(2);
    const first = pool.acquire("a");
    pool.release("a");
    expect(pool.acquire("b")).toBe(first);
    expect(createdCount()).toBe(1);
  });

  it("reports the ids it is holding, oldest first", () => {
    const { pool } = makePool(3);
    pool.acquire("a");
    pool.acquire("b");
    pool.acquire("a");
    expect(pool.activeIds).toEqual(["b", "a"]);
    pool.release("b");
    expect(pool.activeIds).toEqual(["a"]);
  });

  it("disposes each created resource exactly once", () => {
    const { pool, disposed } = makePool(2);
    pool.acquire("a");
    pool.acquire("b");
    pool.release("b");
    pool.dispose();
    expect(disposed.sort()).toEqual(["r0", "r1"]);
    pool.dispose();
    expect(disposed).toHaveLength(2);
  });

  it("ignores a release for an unknown id", () => {
    const { pool } = makePool(2);
    pool.acquire("a");
    expect(() => pool.release("ghost")).not.toThrow();
    expect(pool.activeIds).toEqual(["a"]);
  });
});
