import type { MotionParameters } from "../vendor/purupuru/core/types";

/**
 * X에서 관찰된 실사용 패턴(머리카락·옷자락·가슴·볼)에서 고름 — 스펙 §2.5.
 * demo.html에서 실제 크롭으로 눈으로 맞춘다. 물리 상수를 재유도하지 않는다.
 * fluctuation은 tremorStrength <= 0.223 을 넘지 않게 유지할 것 (스펙 §9).
 * 조정 내역은 docs/superpowers/notes/2026-07-25-measurements.md 에 있다.
 */
export const WEBTOON_PRESETS: Record<"hair" | "cloth" | "chest" | "cheek", MotionParameters> = {
  hair:  { inputStrength: 70, stretch: 85, bounce: 22, damping: 12, cohesion: 20, gravityDirection: "down", gravityStrength: 0.9, fluctuation: 12, maxStretch: 95 },
  cloth: { inputStrength: 62, stretch: 65, bounce: 30, damping: 18, cohesion: 45, gravityDirection: "down", gravityStrength: 1,   fluctuation: 8,  maxStretch: 70 },
  chest: { inputStrength: 82, stretch: 72, bounce: 55, damping: 22, cohesion: 40, gravityDirection: "down", gravityStrength: 1,   fluctuation: 5,  maxStretch: 60 },
  // fluctuation 15 → 10: tremor는 tether 목표를 상시 밀어서 입력을 끊어도 rest로 안 내려온다.
  // 실측 rest 잔차 (640x800, 1200틱): f=15 → 0.02568 (한계 0.02 초과), f=12 → 0.01797, f=10 → 0.01221.
  cheek: { inputStrength: 45, stretch: 40, bounce: 70, damping: 35, cohesion: 65, gravityDirection: "down", gravityStrength: 0.6, fluctuation: 10, maxStretch: 30 },
};
