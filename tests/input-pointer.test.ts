import { describe, expect, it } from "vitest";
import { createPointerAdapter } from "../src/input/pointer";

// 픽셀 좌표를 쓰므로 정규화 기준을 명시적으로 준다.
const create = () => createPointerAdapter({ readShortSide: () => 800 });

describe("createPointerAdapter", () => {
  it("has the pointer id", () => expect(create().id).toBe("pointer"));

  it("is not dragging before a pointer is set", () => {
    const adapter = create();
    adapter.attach();
    expect(adapter.sample(1 / 60).frameDragging).toBeFalsy();
  });

  it("drags toward a finite target once the pointer moves", () => {
    const adapter = create();
    adapter.attach();
    adapter.setPointer({ x: 100, y: 100 });
    adapter.setPointer({ x: 140, y: 180 });
    const input = adapter.sample(1 / 60);
    expect(input.frameDragging).toBe(true);
    const target = input.frameTarget!;
    expect(Number.isFinite(target.x)).toBe(true);
    expect(Number.isFinite(target.y)).toBe(true);
    expect(Math.hypot(target.x, target.y)).toBeGreaterThan(0);
  });

  it("stops dragging when the pointer is released", () => {
    const adapter = create();
    adapter.attach();
    adapter.setPointer({ x: 100, y: 100 });
    adapter.setPointer({ x: 300, y: 400 });
    adapter.setPointer(null);
    expect(adapter.sample(1 / 60).frameDragging).toBeFalsy();
  });

  it("emits no input while disabled", () => {
    const adapter = create();
    adapter.attach();
    adapter.setPointer({ x: 100, y: 100 });
    adapter.setPointer({ x: 300, y: 400 });
    adapter.enabled = false;
    expect(adapter.sample(1 / 60)).toEqual({});
  });

  it("forgets the drag origin across detach and re-attach", () => {
    const adapter = create();
    adapter.attach();
    adapter.setPointer({ x: 100, y: 100 });
    adapter.setPointer({ x: 300, y: 400 });
    adapter.detach();
    adapter.attach();
    expect(adapter.sample(1 / 60).frameDragging).toBeFalsy();
    // 재부착 후 첫 포인터가 새 원점이 되므로 변위는 0이다.
    adapter.setPointer({ x: 300, y: 400 });
    expect(adapter.sample(1 / 60).frameTarget).toEqual({ x: 0, y: 0 });
  });
});
