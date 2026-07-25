import type { QualityTierId } from "./types";
import type { SolverQuality } from "../vendor/purupuru/core/types";

/** 한 티어는 솔버 설정과 동시 활성 컷 수를 함께 정한다. 둘 다 프레임 비용을 정하기 때문. */
export interface QualityTier {
  solver: SolverQuality;
  /** 동시에 시뮬레이션할 컷 수. 비용에 선형으로 곱해진다. */
  activeLimit: number;
}

/**
 * tickRate 60은 어떤 격자 변경보다 가치가 크다 — 스펙 §4.3.
 * advance()는 maxCatchUpSteps회만 돌고 초과분을 버린다. 절벽 = mcs / tickRate.
 * 120Hz/4 = 33.3ms 이므로 독자 기기가 30fps로 떨어지면 매 프레임 clamp되어
 * 물리가 조용히 슬로모션이 된다. 60Hz/4 = 66.7ms 이고 비용도 1.93배 싸다.
 *
 * 하향 순서가 중요하다. 실측 두 가지가 순서를 정한다:
 *  (1) iterations 4→3 은 스텝당 19~20%만 아끼는데, 900x1800 크롭을 30% 칠한 상태에서
 *      삼각형을 뒤집는다 — 느려서 품질을 낮췄더니 화면이 더 망가지는 구조.
 *  (2) 활성 컷 2→1 은 비용을 정확히 절반으로 줄이면서 컷당 품질 손실이 0이다.
 * 그래서 medium은 솔버를 그대로 두고 활성 컷만 줄이고, iterations는 low에서 마지막에 내린다.
 */
export const QUALITY_TIERS: Record<QualityTierId, QualityTier> = {
  high:   { solver: { tickRate: 60, iterations: 4, maxCatchUpSteps: 4 }, activeLimit: 2 },
  medium: { solver: { tickRate: 60, iterations: 4, maxCatchUpSteps: 4 }, activeLimit: 1 },
  low:    { solver: { tickRate: 60, iterations: 3, maxCatchUpSteps: 8 }, activeLimit: 1 },
};

export const DEFAULT_QUALITY_TIER: QualityTierId = "high";
export const MAX_ACTIVE_LIMIT = Math.max(...Object.values(QUALITY_TIERS).map((t) => t.activeLimit));
export const SOLVER_QUALITY: SolverQuality = QUALITY_TIERS.high.solver;

export const tierFor = (id: QualityTierId): QualityTier => ({
  solver: { ...QUALITY_TIERS[id].solver },
  activeLimit: QUALITY_TIERS[id].activeLimit,
});

export const qualityForTier = (id: QualityTierId): SolverQuality => ({ ...QUALITY_TIERS[id].solver });
export const activeLimitForTier = (id: QualityTierId): number => QUALITY_TIERS[id].activeLimit;

const DEGRADE: Record<QualityTierId, QualityTierId> = { high: "medium", medium: "low", low: "low" };
const UPGRADE: Record<QualityTierId, QualityTierId> = { low: "medium", medium: "high", high: "high" };
export const degradeTier = (id: QualityTierId): QualityTierId => DEGRADE[id];

/**
 * 기기 스니핑이 아니라 자기 측정으로 품질을 조절한다.
 * 테스트 안 한 폰에서 하드코딩한 기기 티어는 반드시 틀린다.
 * ponytail: 고정 임계값. 히스테리시스가 부족하면 창 길이부터 늘릴 것.
 */
export class QualityGovernor {
  private readonly window: number[] = [];
  private fastFrames = 0;
  private current: QualityTierId = DEFAULT_QUALITY_TIER;

  public constructor(
    private readonly slowMs = 2.0,
    private readonly fastMs = 1.0,
    private readonly windowSize = 30,
    private readonly recoveryFrames = 120,
  ) {}

  public get tier(): QualityTierId { return this.current; }
  public get quality(): SolverQuality { return qualityForTier(this.current); }
  public get activeLimit(): number { return activeLimitForTier(this.current); }

  /** 프레임마다 그 프레임의 물리 소요 시간(ms)을 넣는다. */
  public record(physicsMs: number): void {
    if (!Number.isFinite(physicsMs)) return;
    this.window.push(physicsMs);
    if (this.window.length > this.windowSize) this.window.shift();

    if (physicsMs < this.fastMs) this.fastFrames += 1; else this.fastFrames = 0;

    if (this.window.length === this.windowSize) {
      const mean = this.window.reduce((sum, value) => sum + value, 0) / this.window.length;
      if (mean > this.slowMs) {
        this.current = DEGRADE[this.current];
        this.window.length = 0;
        this.fastFrames = 0;
        return;
      }
    }
    if (this.fastFrames >= this.recoveryFrames) {
      this.current = UPGRADE[this.current];
      this.fastFrames = 0;
    }
  }
}
