import { describe, expect, it } from "vitest";
import { selectActive, type SchedulerEntry } from "../src/viewer/scheduler";

const e = (id: string, centerY: number, intersecting = true): SchedulerEntry => ({ id, centerY, intersecting });

describe("selectActive", () => {
  it("returns nothing when the limit is zero", () => expect(selectActive([e("a", 0)], 0, 0)).toEqual([]));
  it("returns nothing when nothing intersects", () => expect(selectActive([e("a",0,false),e("b",10,false)], 0, 2)).toEqual([]));
  it("ignores non-intersecting entries even when closest", () => expect(selectActive([e("far",500),e("near",0,false)], 0, 2)).toEqual(["far"]));
  it("picks the entries closest to the viewport center", () => expect(selectActive([e("a",1000),e("b",100),e("c",-50),e("d",600)], 0, 2)).toEqual(["c","b"]));
  it("respects the limit", () => expect(selectActive([e("a",0),e("b",1),e("c",2),e("d",3)], 0, 2)).toHaveLength(2));
  it("returns everything when the limit exceeds the count", () => expect(selectActive([e("a",0),e("b",1)], 0, 10)).toEqual(["a","b"]));
  it("breaks ties by id so the result is stable", () => expect(selectActive([e("z",100),e("a",-100)], 0, 1)).toEqual(["a"]));
  it("does not mutate the input", () => {
    const entries = [e("a",1000), e("b",0)];
    const before = entries.map((i) => i.id);
    selectActive(entries, 0, 1);
    expect(entries.map((i) => i.id)).toEqual(before);
  });
  it("treats a non-finite centerY as infinitely far", () => expect(selectActive([e("bad",Number.NaN),e("good",900)], 0, 1)).toEqual(["good"]));
  it("stays stable when every distance is infinite", () =>
    expect(selectActive([e("z",Number.NaN),e("a",Number.NaN)], 0, 2)).toEqual(["a","z"]));
});
