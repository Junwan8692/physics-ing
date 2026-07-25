import { describe, expect, it } from "vitest";
import {
  QUALITY_TIERS, qualityForTier, activeLimitForTier, degradeTier,
  DEFAULT_QUALITY_TIER, MAX_ACTIVE_LIMIT, QualityGovernor,
} from "../src/core/quality";

const TIER_IDS = ["high", "medium", "low"] as const;

describe("quality tiers", () => {
  it("defaults to 60 Hz, not the vendor's 120", () => {
    expect(qualityForTier(DEFAULT_QUALITY_TIER).tickRate).toBe(60);
  });
  it("keeps the catch-up cliff at or above 66 ms in every tier", () => {
    for (const { solver } of Object.values(QUALITY_TIERS)) {
      expect(solver.maxCatchUpSteps / solver.tickRate).toBeGreaterThanOrEqual(0.066);
    }
  });
  it("only uses values the vendor SolverQuality type allows", () => {
    for (const { solver } of Object.values(QUALITY_TIERS)) {
      expect([60, 120]).toContain(solver.tickRate);
      expect([3, 4, 6]).toContain(solver.iterations);
    }
  });
  it("orders tiers by strictly descending frame cost", () => {
    // 프레임 비용은 활성 컷 수에 선형이다. iterations만 보면 medium과 low가 같아 보인다.
    const cost = (id: (typeof TIER_IDS)[number]) =>
      QUALITY_TIERS[id].solver.tickRate * QUALITY_TIERS[id].solver.iterations * QUALITY_TIERS[id].activeLimit;
    expect(cost("high")).toBeGreaterThan(cost("medium"));
    expect(cost("medium")).toBeGreaterThan(cost("low"));
  });
  it("sheds active cuts before it sheds solver iterations", () => {
    // 실측: iterations 4→3은 큰 마스크에서 삼각형을 뒤집는다. 활성 컷을 줄이는 쪽이
    // 비용을 절반으로 줄이면서 컷당 품질 손실이 0이므로 먼저 와야 한다.
    expect(QUALITY_TIERS.medium.solver.iterations).toBe(QUALITY_TIERS.high.solver.iterations);
    expect(QUALITY_TIERS.medium.activeLimit).toBeLessThan(QUALITY_TIERS.high.activeLimit);
    expect(QUALITY_TIERS.low.solver.iterations).toBeLessThan(QUALITY_TIERS.medium.solver.iterations);
  });
  it("never lets a tier exceed MAX_ACTIVE_LIMIT (the renderer pool is sized from it)", () => {
    for (const id of TIER_IDS) expect(activeLimitForTier(id)).toBeLessThanOrEqual(MAX_ACTIVE_LIMIT);
  });
  it("degrades downward and stops at low", () => {
    expect(degradeTier("high")).toBe("medium");
    expect(degradeTier("medium")).toBe("low");
    expect(degradeTier("low")).toBe("low");
  });
});

describe("QualityGovernor exposes both levers", () => {
  it("reports the active limit for its current tier", () => {
    const governor = new QualityGovernor();
    expect(governor.activeLimit).toBe(activeLimitForTier(DEFAULT_QUALITY_TIER));
    for (let i = 0; i < 30; i += 1) governor.record(3.0);
    expect(governor.tier).toBe("medium");
    expect(governor.activeLimit).toBe(1);
    expect(governor.quality.iterations).toBe(4); // 아직 솔버는 안 내린다
  });
});

describe("QualityGovernor", () => {
  it("degrades after a sustained slow window", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 30; i += 1) g.record(3.0);
    expect(g.tier).toBe("medium");
  });
  it("does not degrade on a single slow frame", () => {
    const g = new QualityGovernor();
    g.record(50);
    for (let i = 0; i < 29; i += 1) g.record(0.2);
    expect(g.tier).toBe("high");
  });
  it("recovers only after a long fast run", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 30; i += 1) g.record(3.0);
    for (let i = 0; i < 119; i += 1) g.record(0.5);
    expect(g.tier).toBe("medium");
    g.record(0.5);
    expect(g.tier).toBe("high");
  });
});
