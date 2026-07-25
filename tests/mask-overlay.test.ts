import { describe, expect, it } from "vitest";
import { strokeRadiusPx } from "../src/editor/MaskCanvas";
import { strokeContains } from "../src/vendor/purupuru/region/model";
import type { RegionStroke } from "../src/vendor/purupuru/region/model";

/**
 * 벤더의 포함 판정은 축 스케일 {w/short, h/short} 를 곱한 UV 공간에서 잰다.
 * dx_uv·(w/short) = dx_px/short 이므로 그 공간은 픽셀 기준 등방이고,
 * 스트로크는 픽셀 공간에서 반지름 (size/2)·short 인 진짜 원/캡슐이다.
 * 오버레이를 캔버스 경로로 그리려면 이 등가성이 성립해야 한다.
 */
describe("strokeRadiusPx", () => {
  it("짧은 변 기준 반지름을 준다", () => {
    expect(strokeRadiusPx(0.2, 1280, 5120)).toBeCloseTo(0.1 * 1280);
    expect(strokeRadiusPx(0.2, 5120, 1280)).toBeCloseTo(0.1 * 1280);
  });

  it("벤더 포함 판정과 픽셀 공간에서 일치한다", () => {
    const cases: [number, number][] = [[1280, 5120], [800, 800], [3200, 800], [640, 960]];
    for (const [w, h] of cases) {
      const stroke: RegionStroke = {
        id: 1, mode: "paint", size: 0.2, strength: 1, operation: "add",
        points: [{ x: 0.5, y: 0.5 }],
      };
      const radius = strokeRadiusPx(stroke.size, w, h);
      const centerX = 0.5 * w;
      const centerY = 0.5 * h;
      // 반지름 안쪽 바로 앞 / 바깥쪽 바로 뒤를 네 방향으로 찔러 본다.
      for (const [dx, dy] of [[1, 0], [0, 1], [0.7071, 0.7071], [-0.7071, 0.7071]] as [number, number][]) {
        const inside = { x: (centerX + dx * radius * 0.98) / w, y: (centerY + dy * radius * 0.98) / h };
        const outside = { x: (centerX + dx * radius * 1.02) / w, y: (centerY + dy * radius * 1.02) / h };
        expect(strokeContains(stroke, inside, w, h), `${w}x${h} inside ${dx},${dy}`).toBe(true);
        expect(strokeContains(stroke, outside, w, h), `${w}x${h} outside ${dx},${dy}`).toBe(false);
      }
    }
  });
});
