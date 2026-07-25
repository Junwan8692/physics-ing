import { useReducer } from "react";
import type { InputAdapter } from "../core/types";
import type { AutoAdapter } from "../input/auto";
import type { DeviceMotionAdapter, DeviceMotionStatus } from "../input/devicemotion";
import type { PointerAdapter } from "../input/pointer";
import type { ScrollAdapter } from "../input/scroll";

export interface TriggerTogglesProps {
  scroll: ScrollAdapter;
  pointer: PointerAdapter;
  devicemotion: DeviceMotionAdapter;
  auto: AutoAdapter;
}

const STATUS_LABELS: Record<DeviceMotionStatus, string> = {
  off: "꺼짐",
  active: "동작 중",
  denied: "거부됨",
  unsupported: "미지원",
};

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "5.5rem 1fr 3.5rem",
  alignItems: "center",
  gap: 6,
} as const;

/**
 * 어댑터를 상태로 복제하지 않는다. 어댑터 객체 자체가 상태이고(enabled/gain/smoothingSeconds가
 * 런타임 가변) rAF 루프가 매 프레임 그 값을 읽으므로, 여기서는 직접 쓰고 리렌더만 걸면 된다.
 */
export function TriggerToggles({ scroll, pointer, devicemotion, auto }: TriggerTogglesProps) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const triggers: { label: string; adapter: InputAdapter }[] = [
    { label: "스크롤", adapter: scroll },
    { label: "포인터", adapter: pointer },
    { label: "기기 모션", adapter: devicemotion },
    { label: "자동 루프", adapter: auto },
  ];

  return (
    <section
      aria-label="입력 트리거"
      style={{
        position: "fixed", top: 12, right: 12, zIndex: 10, width: 260,
        display: "grid", gap: 8, padding: 12, fontSize: 13, lineHeight: 1.4,
        background: "rgba(255,255,255,0.94)", border: "1px solid #ccc", borderRadius: 8,
      }}
    >
      <strong>입력 트리거</strong>

      {triggers.map(({ label, adapter }) => (
        <label key={adapter.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={adapter.enabled}
            onChange={(event) => {
              adapter.enabled = event.currentTarget.checked;
              rerender();
            }}
          />
          <span>{label}</span>
        </label>
      ))}

      <hr style={{ width: "100%", border: 0, borderTop: "1px solid #ddd", margin: 0 }} />

      {/* 스펙 §4.4·§9: 스크롤 관성은 눈으로 맞추는 값이다. 이 두 슬라이더가 그 손잡이다. */}
      <label style={rowStyle}>
        <span>게인</span>
        <input
          type="range" min={0.0001} max={0.01} step={0.0001}
          value={scroll.gain}
          onChange={(event) => {
            scroll.gain = event.currentTarget.valueAsNumber;
            rerender();
          }}
        />
        <output>{scroll.gain.toFixed(4)}</output>
      </label>

      <label style={rowStyle}>
        <span>평활(초)</span>
        <input
          type="range" min={0.005} max={0.3} step={0.005}
          value={scroll.smoothingSeconds}
          onChange={(event) => {
            scroll.smoothingSeconds = event.currentTarget.valueAsNumber;
            rerender();
          }}
        />
        <output>{scroll.smoothingSeconds.toFixed(3)}</output>
      </label>

      <hr style={{ width: "100%", border: 0, borderTop: "1px solid #ddd", margin: 0 }} />

      {/* iOS는 사용자 제스처 안에서만 권한을 물을 수 있다 — 그래서 버튼이다 (스펙 §4.4). */}
      <button type="button" onClick={() => void devicemotion.requestPermission().then(rerender)}>
        센서 권한 요청
      </button>
      <div>
        센서 상태: <output>{STATUS_LABELS[devicemotion.status]}</output>
      </div>
    </section>
  );
}
