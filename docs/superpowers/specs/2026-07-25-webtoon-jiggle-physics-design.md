# 웹툰 런타임 지글 피직스 — 설계 문서

작성일: 2026-07-25 (2차 전면 개정)
상태: 확정
1단계 결과물: 독립 프로토타입 (저작툴 + 뷰어 데모)

> **이 문서의 숫자는 전부 실측입니다.** 벤더 엔진을 실제로 돌려 측정했으며, 근거가 되는
> 실행은 3라운드 · 에이전트 16개 · 도구 호출 547회에 걸쳐 수행되었습니다.
> 추측으로 쓴 값은 없습니다. 측정 없이 바꾸지 마십시오.

---

## 1. 무엇을 만드나

정지 이미지의 일부를 칠하면 그 부분만 물리적으로 출렁이는 시스템. 웹툰 뷰어에서
**독자가 스크롤하는 동안 실시간으로** 반응한다.

- **저작툴**: 이미지 로드 → 브러시로 흔들 영역 칠하기 → 파라미터 조절 → 프로젝트 저장
- **뷰어 데모**: 저장한 프로젝트를 세로 스크롤 웹툰 형태로 재생, 입력 트리거 4종 개별 토글

이번 범위가 **아닌 것**: 실제 서비스 뷰어 통합, 동영상/GIF 내보내기, 자동 세그멘테이션,
다국어, 서버, 계정.

---

## 2. 레퍼런스와 라이선스

### 2.1 원본

[purupuru-maker](https://purupuru-maker.tanosix.com) (ぷるぷるメーカー). 2026년 7월 공개,
X에서 리포스트 1.7만 / 좋아요 4.6만 / 노출 2772만. 제작자 [@grmchn4ai](https://x.com/grmchn4ai).

**소스가 MIT로 공개되어 있다.** → https://github.com/grmchn/purupuru-maker

```
Copyright (c) 2026 Puru-Puru Maker contributors
MIT License
```

물리 엔진 코어 1,246줄. XPBD 구속, 결정론적 스냅샷, 불변식 검사가 이미 구현되어 있고
vitest 테스트가 붙어 있다. **물리 엔진을 새로 작성하지 않는다.**

### 2.2 라이선스 준수 (필수)

- 벤더링한 모든 파일 상단에 원본 저작권 고지 주석 유지
- `licenses/PURUPURU_MAKER_MIT.txt`로 라이선스 전문 포함
- `THIRD_PARTY_NOTICES.md`에 출처·리비전·변경 요약 기재
- 벤더링 파일은 `src/vendor/purupuru/` 아래에만 둔다
- 배포 전 라이선스 검토 대상

원본이 쓰는 `mediabunny`(MPL-2.0)는 내보내기 전용이며 우리는 내보내기를 구현하지 않으므로
벤더링 대상에서 제외한다.

### 2.3 벤더링 매니페스트

이 목록 외에는 가져오지 않는다.

| 원본 경로 | 대상 경로 |
|---|---|
| `src/engine/core/*.ts` (10개) | `src/vendor/purupuru/core/` |
| `src/engine/render/SceneRenderer.ts`, `index.ts` | `src/vendor/purupuru/render/` |
| `src/engine/coordinates/*.ts` (4개) | `src/vendor/purupuru/coordinates/` |
| `src/features/region-editor/model.ts` | `src/vendor/purupuru/region/model.ts` |
| `src/features/region-editor/pointerGestures.ts` | `src/vendor/purupuru/region/` |
| `src/features/play-controls/motion.ts` | `src/vendor/purupuru/motion/motion.ts` |
| `src/features/play-controls/useDeviceMotion.ts` | `src/vendor/purupuru/motion/` |
| `src/features/play-controls/types.ts` | `src/vendor/purupuru/motion/types.ts` (중복 타입 삭제) |
| `tests/{physics,region-model,region-weights,coordinates,motion}.test.ts` | `tests/vendor/` (import 경로만) |
| `LICENSE` | `licenses/PURUPURU_MAKER_MIT.txt` |

**가져오지 않는 것**: `src/engine/export/**`, `src/features/recording/**`, `src/workers/**`,
`src/i18n/**`, `src/app/**`, `src/features/image-input/**`,
`src/features/play-controls/presets.ts`, Playwright 관련 일체.

허용되는 수정은 **import 경로 조정, 저작권 고지 주석 추가, 아래 중복 타입 삭제**뿐이다.
로직을 바꿔야 할 이유가 생기면 벤더링 파일을 고치지 말고 우리 코드에서 감싼다.

#### 중복 `MotionParameters` 함정

원본에는 이름이 같은 타입이 둘 있고 필드 하나가 다르다.

| | `engine/core/types.ts` | `features/play-controls/types.ts` |
|---|---|---|
| 요동 필드 | `fluctuation` | `variation` |

**`fluctuation` 하나로 통일한다.** 정본은 `vendor/purupuru/core/types.ts`.
`motion/types.ts` 벤더링 시 `MotionParameters`, `GravityDirection`, `PresetId`,
`CurrentPresetId` 선언을 삭제하고 `MotionVector`, `AutoMotionId`, `PointerDragOptions`만 남긴다.
`play-controls/presets.ts`는 벤더링하지 않는다 (정본은 `core/parameters.ts`의 `MOTION_PRESETS`).

### 2.4 다른 참고 프로젝트

| 프로젝트 | 라이선스 | 평가 |
|---|---|---|
| [grmchn/purupuru-maker](https://github.com/grmchn/purupuru-maker) | MIT | **주 참조.** 엔진 벤더링 대상 |
| [mikumiku-jp/open-purupuru](https://github.com/mikumiku-jp/open-purupuru) | MIT | 독립 클론. 테스트 아이디어만 |
| [xloveee/jiggle-physics](https://github.com/xloveee/jiggle-physics) | **미표기** | **코드 사용 금지.** 개념만 |
| `purupuru-maker.org/.com/.app` 등 | 미표기 | SEO 클론. 참고 가치 없음 |

### 2.5 X에서 관찰된 실사용 패턴

웹툰 프리셋 튜닝의 근거.

- **캐릭터 일러스트** — 머리카락, 리본, 옷자락, 가슴 (사실상 Live2D 라이트 대용)
- **동물** — 고양이 뱃살, 강아지 귀, 햄스터 볼
- **밈** — 후들거리는 다리, 돌풍 맞은 사물
- **VTuber 프로필 / 리액션 GIF**

→ 웹툰 프리셋은 `머리카락`, `옷자락`, `가슴`, `볼` 4종.

---

## 3. 엔진 구조 (벤더링, 그대로 사용)

### 3.1 메시

고정 격자. 마스크로 삼각분할하지 않는다.

- 좌표계: **짧은 변을 1로 정규화**, 중심 원점. `(u-0.5) × physicalWidth`
- `weights[v]` = 칠한 강도 0~1
- `inverseMasses[v] = weights[v] > 0 ? 1 : 0` — 칠하지 않은 정점은 완전 고정(핀)

핀 고정이 핵심 장점이다. 칠한 영역이 움직여도 주변 픽셀이 늘어날 뿐 구멍이 뚫리지 않는다.

**짧은 변 정규화는 이 문서 전체에서 가장 중요한 사실이다.** `parameters.ts`의
`maximumDisplacement`(0.70), `maximumSpeed`(10.5), `gravityAcceleration`,
`floatingAcceleration`, `inputGain`, 그리고 `rigidFrame.ts`의 `MAXIMUM_FRAME_TRAVEL`(0.08)이
전부 이 단위다. §4.1과 §4.2가 여기서 파생된다.

### 3.2 솔버 — XPBD

`PhysicsSimulator.step()`. 매 스텝:

1. 정점별 가속도 적분 (중력 + 부유 + 요동 + 입력 관성 + 신장 + 진전 + 2차 모션)
2. `iterations`회 반복: `solveTethers` → `solveDistances` → `solveMaximumDistances` → `solveMinimumAreas` → `solveShapeMatching`
3. `solveMaximumDistances`/`solveMinimumAreas`를 **compliance 0**으로 한 번 더 (하드 클램프)
4. 속도 재계산 + 지수 감쇠

| 구속 | 역할 | UI 파라미터 |
|---|---|---|
| Tether | 원위치 + 목표 오프셋으로 복원 | `bounce` |
| Distance | 이웃 간 거리 유지 (구조 + 전단) | `stretch` |
| MaximumDistance | 최대 신장 하드 클램프 | `maxStretch` |
| MinimumArea | 삼각형 면적 하한 (뒤집힘 방지) | (고정) |
| ShapeMatching | 덩어리별 회전 추출 후 강체 정합 | `cohesion` |

`createShapeClusters`는 weight > `SHAPE_CLUSTER_WEIGHT_THRESHOLD`(0.05, **엄격 비교**) 정점을
4방향 flood-fill로 덩어리 분리. 두 군데를 따로 칠하면 따로 논다.
(별개 상수인 `createConstraintSet`의 `minimumAreaRatio` 0.08과 혼동 주의.)

### 3.3 파라미터 매핑

UI 슬라이더 0~100은 `resolveParameters()`에서 비선형 매핑된다.
예: `distanceCompliance = 2e-7 + stretch² × 9e-4`, `shapeStrength = 0.01 + cohesion⁴ × 0.6`.
**손으로 튜닝된 값이며 그대로 가져간다. 재유도하지 않는다.**

원본 프리셋 (시드로 사용):

| id | inputStrength | stretch | bounce | damping | cohesion | gravity | fluctuation | maxStretch |
|---|---|---|---|---|---|---|---|---|
| purupuru | 82 | 90 | 28 | 8 | 8 | down 1.0 | 5 | 100 |
| sloshing | 72 | 55 | 95 | 20 | 50 | down 0.8 | 0 | 85 |
| shivery | 55 | 70 | 88 | 30 | 50 | down 0.9 | 30 | 40 |
| floaty | 46 | 100 | 15 | 0 | 0 | none 0 | 50 | 100 |

### 3.4 마스크 — 스트로크 벡터

비트맵이 아니라 스트로크 목록.

```ts
type RegionStroke = { id, mode: "paint"|"erase", size, strength?,
                      operation?: "replace"|"add"|"subtract", target?, points: Point[] }
type RegionSnapshot = { baseFill: 0|1, inverted: boolean, strokes: RegionStroke[] }
regionWeightAt(region, u, v, w, h): number
```

정점 UV마다 스트로크를 순회해 weight 산출. 해상도 독립, 직렬화가 작다.
프로젝트 파일 포맷도 이걸 그대로 쓴다.

`regionWeightAt`은 **정점 단위 이진 포함 판정**이다 (`d² ≤ (size/2)²`, sqrt 없음).
`applyStrokeStrength`의 `coverage` 인자는 프로덕션에서 한 번도 넘기지 않는다.
`RegionSnapshot.feather`는 벤더가 **의도적으로 삭제한 기능의 묘비**이며
(`tests/app.test.tsx`가 해당 UI 부재를 3개 로케일에서 회귀 테스트로 지킨다) 절대 쓰지 않는다.

### 3.5 입력

`PhysicsInput`은 `frameTarget`(강체 프레임 목표), `localAcceleration`,
`automaticAcceleration`을 받는다. `stepRigidFrame`이 프레임을 스프링으로 끌고,
그 **프레임 가속도의 반작용**이 정점에 관성으로 주입된다
(`inertia = -frame.acceleration × inputGain`).

스크롤 관성은 원본에 없다. 우리가 추가한다 (§4.4).

### 3.6 렌더

WebGL2 `SceneRenderer` (434줄). 격자 정점을 워프해 텍스처 샘플.
**캔버스 하나당 컨텍스트 하나를 생성자에서 직접 만들고, 그 캔버스에서 뗄 수 없다.**
컨텍스트 손실 복구 있음.

---

## 4. 확정된 설계 결정

각 항목은 실측 근거와 함께 기록한다. **근거 없이 뒤집지 않는다.**

### 4.1 격자: 짧은 변을 25칸으로 (`K = 25`)

`calculateGridDimensions`를 **호출하지 않는다.**

```ts
export const GRID_K = 25;

export function gridForImage(width: number, height: number) {
  const short = Math.min(width, height);
  return {
    columns: Math.max(4, Math.round(GRID_K * width / short)),
    rows: Math.max(4, Math.round(GRID_K * height / short)),
    pitch: short / GRID_K,
  };
}
```

**근거.** 엔진의 모든 힘·거리 상수가 짧은 변 정규화 단위(§3.1)이므로, 스텝당 이동 거리를
셀 단위로 잰 값 — 즉 `pitch / short` — 만이 불변량이다. 절대 픽셀 pitch도, tier도 아니다.

동일 마스크(disc r=100), 동일 구동, 600틱, 종횡비 1:1 / 2:3 / 1:3.75 / 1:8 / 4:1 실측:

| 정책 | 최대 변위 (px) | 편차 | 뒤집힌 삼각형 |
|---|---|---|---|
| tier 64 (벤더 기본) | 71.95 / 68.83 / 36.85 / 25.24 / 34.14 | **2.85배** | 1:1에서 169틱 (동시 59개) |
| 고정 pitch 16px | — | — | purupuru 36~242틱, shivery 212~508틱 |
| 고정 pitch 24px | — | — | shivery 247/334/253틱 |
| **short/25** | 52.78 / 50.29 / 50.24 / 50.23 / 53.18 | **5.9%** | **0** (purupuru·shivery 모두) |

- `tier 64`는 `calculateGridDimensions`가 tier를 **긴 변**에 붙이므로 pitch가 이미지 높이의
  함수가 된다. "tier 64는 안 접힌다"는 특정 종횡비에서만 참이다
- 고정 픽셀 pitch는 짧은 변이 달라지면 `pitch/short`가 달라져 같은 문제를 겪는다
- **pitch를 `short/33`(800 기준 24px)보다 곱게 가지 말 것.** 여유를 원하면 `short/25`(32px)

**추가 이득**: 브러시 최소값이 종횡비 독립 상수가 된다 → `brushMin = 2 / K` (§4.6).

### 4.2 저작 시점 bbox 크롭

칠한 뒤 **저작 시점에** 마스크 바운딩박스 + 마진을 계산해 그 영역을 크롭 에셋으로 굽는다.
런타임에 서브렉트를 계산하지 않는다.

```ts
export const GUARD_CELLS = 3;
// margin = GUARD_CELLS * pitch, pitch = bboxShort / K, bboxShort = maskShort + 2*margin
// 풀면 margin = maskShort * GUARD_CELLS / (K - 2*GUARD_CELLS) = maskShort * 3/19
export const MARGIN_RATIO = GUARD_CELLS / (GRID_K - 2 * GUARD_CELLS);  // = 0.15789...

export function cropRectForMask(maskRect: Rect): Rect {
  const margin = Math.ceil(MARGIN_RATIO * Math.min(maskRect.width, maskRect.height));
  return { x: maskRect.x - margin, y: maskRect.y - margin,
           width: maskRect.width + margin * 2, height: maskRect.height + margin * 2 };
}
```

네 변 모두 같은 픽셀 마진. 이미지 경계로 클램프한다.

| 마스크 | 마진 | 크롭 | pitch | 정점 |
|---|---|---|---|---|
| 400×300 (가슴) | 47px | 494×394 | 15.8px | 832 |
| 250×600 (머리카락) | 40px | 330×680 | 13.2px | 676 |
| 700×1400 (전신) | 111px | 922×1622 | 36.9px | 1,144 |

**왜 크롭하나 — 성능이 아니다.** 실측: 핀 정점 36.2ns/step vs dynamic 정점 2,400~3,600ns/step
(91배). 크롭은 핀 정점만 없애므로 속도 이득이 거의 없다 (실제 웹툰 마스크에서 1.04 / 1.01 /
0.82 / 1.05 / 1.01 / 1.04배). 크롭이 사주는 것은 셋이다:

| 이득 | 근거 |
|---|---|
| **텍스처 한도 통과** | `MAX_TEXTURE_SIZE`가 4096인 안드로이드 기기가 여전히 많다. 1280×5120 슬라이스는 **텍스처로 올라가지 않는다.** 크롭은 통과 |
| **해상도 배분** | 1280×5120 통짜는 pitch 51.2px. 400×400 크롭은 pitch 16px |
| **메모리** | 텍스처 25.0MB → 0.6MB. 메시 2,626 → 676 정점 |

**왜 저작 시점인가.** 런타임에 마스크 bbox로 서브렉트를 계산하면, 작가가 같은 컷 다른 곳에
칠하는 순간 bbox가 커지고 pitch가 거칠어져 **손대지 않은 영역의 진폭이 -51% 변한다**(실측).
저작 시점에 확정해 프로젝트 파일에 고정하면 이 결합이 사라진다.

**진폭이 크롭 크기에 비례한다 — 이건 받아들인다.** 짧은 변 정규화 때문에 400px 크롭은
~25px, 800px 크롭은 ~50px 변위가 나온다. 보정(`restPositions`에 k 곱하기)은 벤더 수정 없이
가능하고 실측 오차 0.5%지만, **보정하면 안정성 불변량이 깨진다**: 보정 후 스텝당 이동이
`2.19/k` 셀이 되어 k=0.5에서 4.4셀/스텝, 이는 실측에서 삼각형이 접히는 영역이다.
크기에 비례하는 출렁임은 물리적으로 자연스럽고 저작툴에서 실시간으로 보이므로 놀랄 일이 없다.

### 4.3 솔버 품질: `tickRate: 60`

```ts
export const SOLVER_QUALITY: SolverQuality = { tickRate: 60, iterations: 4, maxCatchUpSteps: 4 };
```

**어떤 격자 변경보다 가치가 큰 한 줄이다.**

`advance()`는 최대 `maxCatchUpSteps`회만 돌고 초과분을 **버린다**
(`if (steps === maxCatchUpSteps && accumulator >= dt) this.accumulator %= dt`).
절벽은 정확히 `maxCatchUpSteps / tickRate`.

| | 절벽 | 30fps에서 | 비용 (활성 2개) |
|---|---|---|---|
| 120Hz / mcs 4 (벤더 기본) | **33.3ms** | **300/300 프레임 clamp** | 3.196 ms/frame |
| **60Hz / mcs 4** | **66.7ms** | 정상 | **1.617 ms/frame** |

120Hz면 독자 기기가 30fps로 떨어지는 순간 물리가 조용히 슬로모션이 되고 스크롤을 못 따라간다.
`tickRate: 60`은 `SolverQuality` 타입이 허용하는 값이라 벤더 수정이 필요 없다.

10fps까지 버티려면 `maxCatchUpSteps: 8` (절벽 133ms), 대신 최악 프레임 2배.

#### 품질 하향 사다리 — 순서가 결과를 가른다

한 티어는 **솔버 설정과 활성 컷 수를 함께** 정한다. 둘 다 프레임 비용에 곱해지기 때문이다.

| 티어 | tickRate | iterations | 활성 컷 | 상대 비용 |
|---|---|---|---|---|
| high | 60 | 4 | 2 | 1.00 |
| medium | 60 | 4 | **1** | 0.50 |
| low | 60 | **3** | 1 | 0.38 |

**활성 컷을 먼저 줄이고, `iterations`는 마지막에 내린다.** 실측 두 가지가 순서를 정한다:

1. `iterations` 4 → 3 은 스텝당 **19~20%만** 아끼는데, 900×1800 크롭을 30% 칠한 상태에서
   **삼각형을 뒤집는다.** 느려서 품질을 낮췄더니 화면이 더 망가지는 구조다
2. 활성 컷 2 → 1 은 비용을 정확히 **절반**으로 줄이면서 컷당 품질 손실이 **0**이다

`tickRate` 60 → 30은 **하지 않는다** (벤더 `SolverQuality` 타입이 허용하지 않음).

렌더러 풀은 `MAX_ACTIVE_LIMIT + 1`로 **고정** 생성한다. 활성 상한이 런타임에 내려가도
풀을 다시 만들 필요가 없고, 남는 렌더러는 놀고 있을 뿐이다.

솔버 설정은 시뮬레이터 생성 시점에 고정되므로, 티어를 내려도 **이미 활성인 컷은
다음 재활성화부터** 새 설정을 쓴다. 티어가 바뀌는 순간 화면이 튀지 않게 하려는 의도다.

**하향 트리거는 기기 스니핑이 아니라 자기 측정**: 최근 30프레임 물리 시간을 재서
2.0ms/frame 초과 시 한 단계 내리고, 120프레임 동안 1.0ms/frame 미만이면 올린다.
하드코딩한 기기 티어는 테스트 안 한 폰에서 반드시 틀린다.

### 4.4 입력 어댑터 4종

전부 하나의 인터페이스로 수렴시킨다.

```ts
interface InputAdapter {
  readonly id: "scroll" | "pointer" | "devicemotion" | "auto";
  enabled: boolean;
  sample(dtSeconds: number): PhysicsInput;
  attach(): void;
  detach(): void;
}
```

- **scroll**: `scrollY` 미분 → 속도 → 미분 → 가속도. rAF에서 샘플링하고 지수 평활(τ≈40ms) 후
  클램프. 세로 성분만. **게인과 평활 시상수는 런타임 가변**(디버그 슬라이더로 눈으로 맞춘다)
- **pointer**: 벤더 `samplePointerDrag` 래핑
- **devicemotion**: 벤더 `processSensorSample` 래핑. iOS는 사용자 제스처 안에서만 권한 요청 가능
- **auto**: 벤더 `sampleAutoMotion` (sway/hop/orbit) 래핑

동시 활성 시 `localAcceleration`은 합산, `frameTarget`은 우선순위
`pointer > devicemotion > scroll > auto`로 하나만 채택. 클램프는 벤더가 `step()`에서 거는 값과
동일하게: `localAcceleration` 크기 8, `automaticAcceleration` 크기 1.

### 4.5 렌더링: 레이어 합성

정적 이미지 위에 크롭 영역만 WebGL 캔버스로 덮는다. `SceneRenderer` 수정 0.

```
[정적] 원본 슬라이스           →  <img>. WebGL 안 씀
[동적] 크롭 + 마스크 + 파라미터 →  WebGL 캔버스를 크롭 위치에 CSS 절대배치
```

**이음매는 구조적으로 안 보인다.** 크롭 가장자리는 안 칠했으니 핀 고정 → 그 픽셀은 원본
그대로 → 아래 정적 이미지와 정확히 일치. 맞추는 게 아니라 어긋날 수 없다.

필수 설정 4개 (전부 실측):

```ts
new SceneRenderer(canvas, {
  alpha: true,
  background: [0, 0, 0, 0],
  padding: 0,             // 기본 0.04는 4.73~10.08 CSS px 어긋남 (~8% 작게 그림)
  blurredBackdrop: false, // true면 크롭 바깥 121% 면적에 불투명 워시 → 아래 이미지 파괴
})
renderer.render({ frameOffset: { x: 0, y: 0 } })
```

`frameOffset`을 0으로 두는 이유: 렌더 시점 균일 이동이라 크롭 슬래브가 통째로 미끄러져
아래 그림과 어긋난다. **`frame.position`을 렌더에 쓰지 않아도 드래그 입력은 살아 있다** —
시뮬레이터는 `frame.acceleration`을 관성으로 쓰기 때문(`simulator.ts:146-149`).

CSS 박스는 닫힌 형태로 나온다: 정적 이미지 박스에 대한 백분율로
`left/top/width/height = crop.x/crop.y/crop.width/crop.height`.
실측 잔차 0.0000px(백킹 스토어가 종횡비를 보존할 때), 최악 0.3798 CSS px(반올림으로
종횡비가 깨질 때 — 그 오차는 핀 가드밴드 안에만 들어가므로 아래 이미지와 동일한 픽셀이다).

### 4.6 저작툴

- 브러시 크기/강도, 페인트/지우개, 되돌리기(`RegionHistory`), 반전, 파라미터 슬라이더, 프리셋
- **브러시 최소값 `2 / K` = 0.08**, 기본 0.12, 최대 0.5.
  실측: 슬라이더 최소 0.02는 **정점을 0개 선택**한다(아무것도 안 움직임).
  `regionWeightAt`은 격자 **정점** 위치만 검사하므로 정점을 못 덮는 브러시는 무효
- 크롭 미리보기 (bbox + 마진 시각화)
- 프로젝트 저장/불러오기
- 입력 트리거 토글 4개 + 스크롤 게인/평활 디버그 슬라이더
- 제거: 녹화, 내보내기, 16개국어 i18n, 공유

### 4.7 프로젝트 파일 포맷

```jsonc
{
  "format": "jiggle-project",
  "version": 1,
  "source": { "src": "cut-003.png", "width": 1280, "height": 5120 },
  "crop":   { "x": 340, "y": 1820, "width": 494, "height": 394 },
  "region": { "baseFill": 0, "inverted": false, "strokes": [ /* RegionStroke[] */ ] },
  "motion": { "inputStrength": 82, "stretch": 90, /* ... fluctuation, 절대 variation 아님 */ },
  "seed": 12345
}
```

- `region`의 스트로크 좌표는 **크롭 기준 UV [0,1]**. 크롭이 곧 물리 이미지다
- `crop`은 원본 슬라이스 안에서의 픽셀 사각형. 뷰어가 CSS 배치에 쓴다
- 격자는 `crop` 크기에서 `gridForImage`로 유도한다. 파일에 격자를 저장하지 않는다
  (K가 ABI이므로 §4.9)
- **신뢰 경계**: 로드한 JSON은 외부 입력으로 간주하고 스키마 검증한다.
  숫자 범위, 배열 길이 상한, 스트로크 개수 상한을 전부 검사

`version` + 로더 마이그레이션 훅. 나중에 자동 세그멘테이션이 붙으면 `region`에
`maskUrl` 소스 종류를 유니온으로 추가할 수 있게 열어둔다.

### 4.8 뷰어 런타임

```ts
class JiggleViewer {
  register(id, element, project, image): void
  unregister(id): void
  tick(elapsedSeconds): void
  destroy(): void
}
```

- `IntersectionObserver`로 뷰포트 밖 컷의 솔버·렌더 정지
- **메시 지연 생성**: 뷰포트 근처에서 만들고 벗어나면 해제.
  실측 메모리 short/25 기준 639 KB/cut → 150개 등록 시 96MB. 전부 미리 만들면 폰이 죽는다
- 활성 상한 기본 **2**. 슬라이스가 세로로 길어 화면에 동시에 들어오는 크롭은 보통 1~2개
- 렌더러 풀 크기 `활성상한 + 1` = 3. `SceneRenderer`는 캔버스마다 컨텍스트를 만들어
  브라우저 상한(보통 16)에 걸리므로 풀에서 빌려 쓰고 반납한다
- 정지 → 재활성 시 rest로 리셋 (누적 상태 폐기)
- 단일 rAF 루프에서 모든 활성 컷을 `advance()`. 컷마다 rAF를 돌리지 않는다
- `prefers-reduced-motion: reduce` → 전체 정지

### 4.9 `K = 25`는 ABI다

pitch를 바꾸면 진폭이 **프리셋마다 다른 배율로, 일부는 비단조로** 움직인다.

실측 (pitch 47.1 → 8 스윕, 최대 변위 배율): purupuru ×2.147, sloshing ×2.720,
shivery ×1.385 **비단조**(1.000 → 0.885 → 0.921 → 0.954 → 1.066 → 1.202 → 1.385),
floaty ×1.945. 시간평균 RMS는 또 다르게 움직인다(purupuru ×2.592, shivery ×0.891).
프리셋 간 비율도 무너진다 (shivery/sloshing 최대변위비 3.35 → 1.70).
단일 게인으로 복구 불가 (최선 오차 9.9%).

**→ 웹툰 프리셋 4종을 만들기 전에 `K`를 확정하고, 이후 바꾸지 않는다.**
바꾸면 프리셋 4종을 전부 다시 만들어야 한다.

---

## 5. 하지 않기로 한 것 (재제안 방지 기록)

### 5.1 웨이트 페더링 — 이 엔진에서 작동하지 않는다

칠한 경계에서 부드럽게 감쇠시키자는 제안. **두 형태 모두, 3라운드 366회 실행으로 반증됨.**

**(a) 스트로크 공간 페더링** (`regionWeightAt`에 거리 기반 coverage 주입)

- 크리즈 지표 개선 **≤ 2.5%**
- 슬라이더가 **비단조**: feather 0.25 → 잔차 0.337, feather 0.5 → 0.571 (안 한 것보다 나쁨)
- 페더링된 **지우개가 클러스터를 병합**한다. weight를 0으로 못 만들어 flood-fill이 다리를
  건넘 → 머리/몸통 분리가 6개 정렬 중 5개에서 실패. `tests/physics.test.ts:77`이 지키는 불변식 위반
- 컷오프(0.06)가 **정상 마스크를 쪼갠다**: 브러시 강도 5%로 칠하면 통째로 핀 고정 → 1클러스터가 2개로
- replace-LERP 때문에 **내부 물결**(획 간격 주기의 밴딩)
- 칠하기가 **멱등이 아니게 됨** (같은 경로 두 번 → dynamic 정점 2배)

**(b) 격자 공간 질량 페더링** (`inverseMasses`를 분수로 덮어쓰기)

메커니즘 자체는 합법이고 벤더 수정도 필요 없다(구속 그래프·클러스터 바이트 동일, 결정론·스냅샷
정상). **그런데 `inverseMass`가 틀린 항이다.**

이 솔버는 deep-compliance XPBD 영역에서 돈다:

```
alpha = compliance / dt²   (60Hz purupuru: 2.63 distance / 8.50 tether)
                           (120Hz purupuru: 10.50 / 33.98)
vs inverseMass ∈ [FLOOR, 1]
```

XPBD 보정은 `Δλ = -C / (Σw + alpha)`, 정점 이동은 `w_i · Δλ`. alpha가 지배하면
그 정점의 **모든** 보정(이웃 드래그, 원위치 복원)이 똑같이 `w_i`로 스케일되어 **평형에서 상쇄**된다.
질량은 전체 진폭을 정하지, 이웃 대비 상대 위치를 정하지 않는다.

- 극한 실험: 마스크 전체 `inverseMass = 0.02` (50배 개입) →
  최대 변위 -71%인데 첫 dynamic 링은 -16% → **경계 단차 0.2575 → 0.7510 (2.9배 악화)**
- bandCells에 대해 **23/24 비단조**, 20/24가 band 8에서 band 0보다 나쁨
- **아이들 상태에서 악화** (독자가 대부분 시간을 보내는 상태): purupuru +31.2%, floaty +73.0%
- 정의역 버그: BFS 미도달 정점 `dist = -1`, `min(1,x)`는 위만 clamp →
  `smoothstep(-1) = 5.0` → `inverseMass = 5` (벤더 최댓값의 5배) → 진폭 +44%, 뒤집힘 66/600틱.
  **이 상태는 우리 에디터의 정상 조작(슬라이더 최대로 세로 3획)으로 도달한다**

**그리고 전제 자체가 틀렸다.** 벤더의 이진 마스크는 한 셀 계단이 아니라 **이미 ~5셀 램프**를
만든다. 링별 최대 변위: `0, 19.7, 36.3, 52.4, 69.3, 75.4, 75.7, 76.6 px`.
가장 가파른 전단은 링 1(2.52)이 아니라 **링 3~4(3.10/3.20)** 에 있다.
경계에 고정한 밴드는 크리즈가 없는 자리를 겨냥한다.

**추가로**, `simulator.ts:222`가 `solveMaximumDistances`를 **compliance 0**으로 호출해
경계를 넘는 엣지를 하드 투영한다. 바깥 끝점은 `w=0`이므로 움직이는 끝점이
**자기 질량과 무관하게** 투영량 100%를 흡수한다. 크리즈는 질량 문제가 아니라 기하 문제다.

**소프트 경계가 정말 필요하면** 평형에 실제로 들어 있는 항을 건드려야 한다:
셀 pitch(§4.1) 또는 `maxStretch`(실측: 20→100 스윕에서 전단 1.072 → 1.487).

### 5.2 런타임 적응형 서브렉트

고정 pitch로 하면 물리적으로는 완벽히 동작한다 — 전체 격자와 **비트 동일**(360틱 최대 편차
0.000000px), "다른 데 칠했더니" 결합 -51% → -0.3%. **하지만 경제적으로 무가치하다.**

실제 웹툰 마스크에서 속도 이득: 1.04 / 1.01 / 0.82 / 1.05 / 1.01 / 1.04배.
전체 최적화의 천장이 8.33ms 예산 중 **0.342ms (4.1%)**, 그것도 작은 단일 blob에서만.
핀 정점이 이미 36.2ns로 거의 공짜이고 `createConstraintSet`이 양쪽 핀인 구속을 이미 건너뛰기 때문.

**저작 시점 크롭(§4.2)이 같은 이득을 훨씬 싸게 준다.**

### 5.3 tier 상향 / 절대 픽셀 pitch 고정

§4.1 표 참조. tier는 긴 변에 붙어 종횡비 의존이고, 절대 픽셀 pitch는 짧은 변이 달라지면
같은 문제를 겪는다. 불변량은 `pitch / short`뿐이다.

### 5.4 진폭 보정 (k-rescale)

§4.2 마지막 문단 참조. 안정성 불변량을 깬다.

---

## 6. 아키텍처

```
src/
  vendor/purupuru/          # MIT 벤더링. 수정 최소화, 저작권 고지 유지
    core/ render/ region/ motion/ coordinates/
  core/
    types.ts                # 계약 파일. 모듈 간 공유 타입 전부
    grid.ts                 # §4.1 gridForImage, GRID_K
    crop.ts                 # §4.2 cropRectForMask, MARGIN_RATIO
    quality.ts              # §4.3 SOLVER_QUALITY + 자기측정 하향 사다리
    buildCut.ts             # crop + region → MeshData + PhysicsSimulator
  input/
    types.ts scroll.ts pointer.ts devicemotion.ts auto.ts combine.ts
  project/
    schema.ts io.ts
  viewer/
    scheduler.ts rendererPool.ts JiggleViewer.ts
  editor/
    brush.ts MaskCanvas.tsx CropPreview.tsx ParameterPanel.tsx EditorApp.tsx
  demo/
    ViewerDemo.tsx TriggerToggles.tsx
  bench/
```

의존 방향은 한 방향: `editor`/`demo` → `viewer` → `core`/`input`/`project` → `vendor`.
`core`/`input`(단 `devicemotion.ts` 제외)/`project`는 **React·DOM에 의존하지 않는다.**
나중에 서비스 뷰어에 그대로 들어가야 하기 때문이다.

**스택**: TypeScript 5.9.3 / Vite 8.1.4 / React 19.2.7 (저작툴 UI만) / Vitest 4.1.10 / WebGL2.
원본과 버전을 맞춰 벤더링 코드가 그대로 컴파일되게 한다.
런타임 의존성은 React 외에 없다.

---

## 7. 테스트 전략

원본 `tests/` 5개를 함께 벤더링해 회귀 기준선으로 삼는다 (벤더링 코드를 건드리지 않았다는 증명).

| 대상 | 검사 |
|---|---|
| grid | 종횡비 1:1 / 2:3 / 1:3.75 / 1:8 / 4:1 에서 짧은 변이 정확히 K칸. 최소 4칸 보장 |
| crop | 마진 = 정확히 3셀(±반올림). 이미지 경계 클램프. 마스크 없으면 null |
| buildCut | 안 칠한 정점 `inverseMass === 0`. 칠한 정점 존재. weight ∈ [0,1] |
| 솔버 불변식 | 중력 켜고 600틱 후 `isFinite()` true, **`hasInvertedTriangles()` false** |
| 수렴 | 중력 끄고 입력 제거 후 1200틱 → 모든 정점이 rest 대비 0.02 이내 |
| 핀 고정 | weight 0 정점 좌표가 시뮬 전후 `===` 동일 |
| 결정론 | 같은 seed + 같은 입력 → `createSnapshot()` 바이트 동일 |
| scroll 어댑터 | 계단 입력에 가속도 클램프 내, NaN 없음, 정지 시 0 수렴 |
| combine | 3개 동시 활성 시 합산 크기가 클램프(8 / 1) 이내 |
| project/schema | 손상 JSON(범위 초과, 스트로크 폭증, 타입 불일치) 전부 거부 |
| viewer | 활성 상한 초과 시 정확히 n개만 `advance()`. reduced-motion에서 0개 |
| brush | 최소 크기 0.08이 정점을 1개 이상 선택 |

E2E는 1단계 범위 밖.

---

## 8. 성능 예산

실측 기준(Apple Silicon, Node 22): 활성 컷 2개 · short/25 · tickRate 60 → **1.617 ms/frame**.

- 중급 폰은 단일스레드 JS가 약 5배 느리다고 가정 → **목표 ≤ 0.8 ms/frame (이 기계 기준)**
- 4배 CPU 스로틀링에서 활성 2개 기준 프레임당 **4ms 이내**
- 메모리 639 KB/cut → 지연 생성 필수 (§4.8)

미달 시 §4.3 하향 사다리. **벤더 솔버 로직은 건드리지 않는다.**

---

## 9. 위험 요소

| 위험 | 영향 | 대응 |
|---|---|---|
| 마스크 크기가 진폭을 4.83배 흔든다 (r=50→350) | 프리셋이 컷마다 다르게 보임 | **격자와 무관한 항.** 저작 파라미터로 받아들이고 저작툴에서 실시간 확인. 정규화가 필요해지면 dynamic 정점 수 기준으로 우리 호출부에서 한 번만 |
| 스크롤 관성이 부자연스러움 | 핵심 UX 실패 | 게인·평활을 디버그 슬라이더로 노출해 손으로 맞춘다 |
| `shivery` 계열이 접힘 | 시각적 파손 | `tremorStrength ≤ 0.223` (pitch=short/25 기준 실측 상한). 프리셋 튜닝 시 검증 |
| MIT 고지 누락 | 법적 리스크 | 벤더 디렉토리 분리 + 라이선스 파일 + 배포 전 라이선스 검토 |
| 마스크 저작 생산성 | 파이프라인 병목 | 1단계 범위 밖. 포맷을 열어두어 나중에 자동 검출로 교체 |

---

## 10. 이후 단계 (범위 밖)

1. 실제 뷰어 통합 + 성능 예산 승인
2. 마스크 자동 검출 모델 → `region` 소스 유니온에 추가
3. 필요 시 GIF/MP4 내보내기.
   **주의**: 원본 export 프로토콜(`PhysicsReplaySnapshot.mesh`)은
   `{columns, rows, imageWidth, imageHeight, weights}`만 나른다. 크롭 원점도, 스케일도 없다.
   크롭 기반 물리를 내보내려면 벤더 `types.ts` + `runtime-adapter.ts` 포크가 필요하다
