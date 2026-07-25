import { MOTION_PRESETS } from "../vendor/purupuru/core/parameters";
import type { GravityDirection, MotionParameters } from "../vendor/purupuru/core/types";
import { WEBTOON_PRESETS } from "./webtoonPresets";

export interface ParameterPanelProps {
  motion: MotionParameters;
  onMotionChange: (motion: MotionParameters) => void;
}

/** 0~100 슬라이더 7개. resolveParameters가 비선형 매핑을 맡는다 (스펙 §3.3). */
const PERCENT_FIELDS = [
  ["inputStrength", "반응 세기"],
  ["stretch", "늘어남"],
  ["bounce", "탄성"],
  ["damping", "가라앉음"],
  ["cohesion", "뭉침"],
  ["fluctuation", "요동"],
  ["maxStretch", "최대 늘어남"],
] as const;

type PercentField = (typeof PERCENT_FIELDS)[number][0];

const GRAVITY_LABELS: Record<GravityDirection, string> = {
  none: "없음", down: "아래", up: "위", left: "왼쪽", right: "오른쪽",
};

const PRESET_LABELS: Record<keyof typeof MOTION_PRESETS, string> = {
  purupuru: "푸루푸루", sloshing: "출렁", shivery: "떨림", floaty: "둥실",
};

const WEBTOON_PRESET_LABELS: Record<keyof typeof WEBTOON_PRESETS, string> = {
  hair: "머리카락", cloth: "옷자락", chest: "가슴", cheek: "볼",
};

const rowStyle = { display: "grid", gridTemplateColumns: "6.5rem 1fr 3rem", alignItems: "center", gap: 8 } as const;

export function ParameterPanel({ motion, onMotionChange }: ParameterPanelProps) {
  const setPercent = (field: PercentField, value: number): void => {
    onMotionChange({ ...motion, [field]: value });
  };

  return (
    <section aria-label="모션 파라미터" style={{ display: "grid", gap: 10, fontSize: 13 }}>
      <div role="group" aria-label="원본 프리셋" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(PRESET_LABELS) as (keyof typeof MOTION_PRESETS)[]).map((id) => (
          <button key={id} type="button" onClick={() => onMotionChange({ ...MOTION_PRESETS[id] })}>
            {PRESET_LABELS[id]}
          </button>
        ))}
      </div>

      <div role="group" aria-label="웹툰 프리셋" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(WEBTOON_PRESET_LABELS) as (keyof typeof WEBTOON_PRESETS)[]).map((id) => (
          <button key={id} type="button" onClick={() => onMotionChange({ ...WEBTOON_PRESETS[id] })}>
            {WEBTOON_PRESET_LABELS[id]}
          </button>
        ))}
      </div>

      {PERCENT_FIELDS.map(([field, label]) => (
        <label key={field} style={rowStyle}>
          <span>{label}</span>
          <input
            type="range" min={0} max={100} step={1}
            value={motion[field] ?? 100}
            onChange={(event) => setPercent(field, event.currentTarget.valueAsNumber)}
          />
          <output>{motion[field] ?? 100}</output>
        </label>
      ))}

      <label style={rowStyle}>
        <span>중력 방향</span>
        <select
          value={motion.gravityDirection}
          onChange={(event) => onMotionChange({ ...motion, gravityDirection: event.currentTarget.value as GravityDirection })}
        >
          {(Object.keys(GRAVITY_LABELS) as GravityDirection[]).map((direction) => (
            <option key={direction} value={direction}>{GRAVITY_LABELS[direction]}</option>
          ))}
        </select>
        <output />
      </label>

      <label style={rowStyle}>
        <span>중력 세기</span>
        <input
          type="range" min={0} max={2} step={0.05}
          value={motion.gravityStrength}
          onChange={(event) => onMotionChange({ ...motion, gravityStrength: event.currentTarget.valueAsNumber })}
        />
        <output>{motion.gravityStrength.toFixed(2)}</output>
      </label>
    </section>
  );
}
