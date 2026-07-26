import {
  DEFAULT_AUTO_MOTION_PERIOD_MS,
  DEFAULT_AUTO_MOTION_STRENGTH,
  MAX_AUTO_MOTION_PERIOD_MS,
  MIN_AUTO_MOTION_PERIOD_MS,
} from "../vendor/purupuru/motion/motion";
import type { AutoMotionId } from "../vendor/purupuru/motion/types";

/** 자동 재생 설정. 미리보기에서만 쓰는 값이라 프로젝트 파일에는 들어가지 않는다. */
export interface AutoMotionSettings {
  enabled: boolean;
  motion: AutoMotionId;
  /** 0~100 퍼센트. 벤더의 mapAutoMotionStrength 곡선을 탄다. */
  strength: number;
  periodMs: number;
}

export const DEFAULT_AUTO_MOTION: AutoMotionSettings = {
  enabled: true,
  motion: "sway",
  strength: DEFAULT_AUTO_MOTION_STRENGTH,
  periodMs: DEFAULT_AUTO_MOTION_PERIOD_MS,
};

/**
 * 벤더가 구현한 세 궤적. 이름만 봐서는 뭐가 다른지 모르니 설명을 붙인다.
 * hop 은 사인파가 아니라 이륙·체공·착지·2차 바운스를 각각 다른 곡선으로 짠 점프다.
 */
const MOTIONS: readonly { id: AutoMotionId; label: string; hint: string }[] = [
  { id: "sway", label: "좌우", hint: "좌우로 흔들린다. 양 끝에서 잠깐 머문다" },
  { id: "hop", label: "위아래", hint: "점프. 이륙·체공·착지·2차 바운스가 따로 잡혀 있다" },
  { id: "orbit", label: "원", hint: "원을 그린다. 위상과 반지름을 비틀어 기계적이지 않다" },
];

export interface AutoMotionControlsProps {
  value: AutoMotionSettings;
  onChange: (next: AutoMotionSettings) => void;
}

const row = { display: "flex", gap: 6, alignItems: "center" } as const;

export function AutoMotionControls({ value, onChange }: AutoMotionControlsProps): React.JSX.Element {
  const patch = (next: Partial<AutoMotionSettings>): void => onChange({ ...value, ...next });

  return (
    <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
      <label style={row}>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => patch({ enabled: event.currentTarget.checked })}
        />
        자동으로 흔들기
      </label>

      {value.enabled && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "#555" }}>
          <div role="radiogroup" aria-label="자동 재생 방향" style={row}>
            방향
            {MOTIONS.map(({ id, label, hint }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={value.motion === id}
                title={hint}
                onClick={() => patch({ motion: id })}
                style={{
                  padding: "2px 8px",
                  border: `1px solid ${value.motion === id ? "#ff3fa4" : "#ccc"}`,
                  background: value.motion === id ? "#ffe6f3" : "#fff",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <label style={row}>
            세기
            <input
              type="range" min={0} max={100} step={1} value={value.strength}
              onChange={(event) => patch({ strength: event.currentTarget.valueAsNumber })}
            />
            <output style={{ width: "2.5rem" }}>{Math.round(value.strength)}%</output>
          </label>

          <label style={row}>
            주기
            <input
              type="range"
              min={MIN_AUTO_MOTION_PERIOD_MS} max={MAX_AUTO_MOTION_PERIOD_MS} step={25}
              value={value.periodMs}
              onChange={(event) => patch({ periodMs: event.currentTarget.valueAsNumber })}
            />
            <output style={{ width: "3rem" }}>{(value.periodMs / 1000).toFixed(2)}s</output>
          </label>
        </div>
      )}
    </div>
  );
}
