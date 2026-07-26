# CLAUDE.md

이 파일은 새 세션이 이 저장소에서 바로 일할 수 있게 하려고 있습니다.
**코딩 전에 이 파일을 끝까지 읽으세요.** 여기 적힌 것 대부분은 이미 한 번 틀렸다가 실측으로 고친 내용입니다.

---

## 0. 30초 요약

정지 이미지의 **칠한 부분만** 실시간으로 출렁이는 시스템. 세로 스크롤 웹툰 뷰어에서
독자가 스크롤·터치·기기 기울임에 반응하는 런타임이 목표입니다.

물리 엔진은 **새로 짜지 않았습니다.** MIT인 [grmchn/purupuru-maker](https://github.com/grmchn/purupuru-maker)를
`src/vendor/purupuru/`에 **수정 없이** 벤더링하고, 그 위에 웹툰 레이어만 올렸습니다.

```
저작툴 (index.html)   에피소드 임포트 → 칠하기 → 크롭 자동 → 미리보기 → 저장
뷰어 데모 (demo.html)  저장한 에피소드를 세로 스크롤로 재생
```

현재 상태: **254개 테스트 통과 · 타입체크 클린 · 빌드 성공.** 원격 `Junwan8692/physics-ing`.

---

## 1. 먼저 읽을 문서

| 문서 | 왜 |
|---|---|
| `docs/superpowers/specs/2026-07-25-webtoon-jiggle-physics-design.md` **§4** | 확정된 설계 결정과 각각의 실측 근거 |
| 같은 문서 **§5** | **시도했다가 측정으로 기각된 접근들.** 다시 제안하기 전에 반드시 |
| `docs/superpowers/notes/2026-07-25-measurements.md` | 원본 측정치 (벤치, K 스윕, 스크롤 튜닝) |
| `docs/superpowers/plans/2026-07-25-webtoon-jiggle-physics.md` | 구현 계획 (대부분 완료) |

---

## 2. 절대 규칙

1. **`src/vendor/purupuru/**` 는 수정 금지.** 허용되는 건 import 경로, 저작권 주석,
   스펙 §2.3에 명시된 중복 타입 삭제뿐입니다. 로직을 바꿔야 하면 **우리 코드에서 감싸세요.**
   `createGridMesh`가 돌려주는 `MeshData`는 가변이라, 시뮬레이터에 넘기기 전에
   우리 코드에서 배열을 손대는 건 벤더 수정이 아닙니다. 이 우회로를 씁니다.
   - 무결성 확인: 저작권 헤더를 뺀 벤더 파일은 업스트림 `a1202d10`과 **바이트 동일**해야 합니다
   - `tests/vendor/` 76개가 통과하는 것이 런타임 쪽 증거입니다

2. **`src/core/types.ts` 는 계약 파일입니다. 수정 금지.** 새 타입은 다른 파일에 두세요.

3. **`calculateGridDimensions` 를 호출하지 마세요.** tier를 긴 변에 붙이는 함수라
   세로로 긴 웹툰 컷에서 격자가 무너집니다. 우리는 `gridForImage`를 씁니다.

4. **런타임 의존성은 `react` / `react-dom` 둘뿐.** 추가하지 마세요.

5. **`src/core/**`, `src/input/**`(단 `devicemotion.ts` 제외), `src/project/**` 는
   DOM·React 미참조.** 나중에 서비스 뷰어에 그대로 이식해야 합니다.
   `window`나 `document`가 등장하면 설계 위반입니다.

6. **측정 없이 상수를 바꾸지 마세요.** 아래 상수는 전부 실측으로 나온 값입니다.

---

## 3. 실측으로 확정된 상수

| 상수 | 값 | 위치 | 바꾸면 |
|---|---|---|---|
| `GRID_K` | **25** | `core/grid.ts` | **ABI입니다.** pitch가 바뀌면 프리셋 4종이 전부 무효 |
| `GUARD_CELLS` | 3 | `core/crop.ts` | 1이면 크롭 경계가 찢어짐 |
| `SOLVER_QUALITY.tickRate` | **60** | `core/quality.ts` | 120이면 30fps 기기에서 물리가 슬로모션 |
| `DEFAULT_SCROLL_GAIN` | 0.0004 | `input/scroll.ts` | 올리면 메시가 접힘 |
| `DEFAULT_SCROLL_SMOOTHING_SECONDS` | 0.25 | `input/scroll.ts` | 줄이면 동적 범위가 20배→2배 |
| `DEFAULT_SCROLL_MAX_ACCELERATION` | 2 | `input/scroll.ts` | 접힘 안전선 |
| `BRUSH_MIN` | `2 / GRID_K` | `editor/brush.ts` | 하드코딩하면 정점을 0개 선택 |

### 왜 이 값인가 — 핵심 3가지

**① 격자는 짧은 변을 25칸으로.**
엔진의 모든 힘·거리 상수(`maximumDisplacement`, `maximumSpeed`, `MAXIMUM_FRAME_TRAVEL` …)가
**짧은 변으로 정규화된 mesh 단위**입니다. 그래서 불변량은 절대 픽셀 pitch도 tier도 아니고
`pitch / short` 하나뿐입니다.

```
tier 64 (벤더 기본)  종횡비 1:1~8:1 에서 진폭 2.85배 흔들림, 1:1에서 169틱 접힘
고정 pitch 16px      purupuru 36~242틱, shivery 212~508틱 접힘
short/25             진폭 편차 5.9%, 접힘 0                    ← 채택
```

K를 25→33으로 올려도 **최대 변위는 13px→14px로 거의 안 변하는데** 접힘만 늘어납니다.
"더 촘촘하게 하면 부드러워지지 않을까"는 이미 측정했고 답은 **아니오**입니다.

**② `tickRate: 60`.**
`advance()`는 `maxCatchUpSteps`회만 돌고 초과분을 **버립니다.** 절벽 = `mcs / tickRate`.
120Hz/4 = 33.3ms라 독자 기기가 30fps로 떨어지면 매 프레임 clamp되어 물리가 조용히
슬로모션이 되고 스크롤을 못 따라갑니다. 60Hz/4 = 66.7ms에 비용도 1.93배 쌉니다.

**③ 구동 세기 2가 접힘 안전선.**
웹툰 프리셋 4종 × 크롭 3종 × 600틱 실측:

| 세기 | 1 | **2** | 3 | 4 | 8 |
|---|---|---|---|---|---|
| 최악 접힘 틱 | 0 | **0~3** | 3~12 | 5~121 | 195~218 |

모든 입력 어댑터는 이 선 아래로 들어와야 합니다.

---

## 4. 구조

```
src/
  vendor/purupuru/  MIT 벤더링 (20파일) — 수정 금지
  core/             grid · crop · quality · buildCut · types(계약)
  input/            scroll · pointer · devicemotion · auto · combine
  project/          schema(프로젝트) · episode(에피소드) · io
  viewer/           scheduler · rendererPool · JiggleViewer
  editor/           MaskCanvas · CropPreview · ParameterPanel · SliceStrip
                    LivePreview · EpisodePreview · EditorApp · episode · brush
  demo/             ViewerDemo (demo.html)
  bench/            솔버 비용 측정
```

의존 방향: `editor`/`demo` → `viewer` → `core`/`input`/`project` → `vendor`

### 핵심 데이터 흐름

```
칠하기          region (원본 이미지 UV, 스트로크 벡터)
   ↓ cropForRegion + cropRectForMask
크롭 사각형      마스크 bbox + 마진 15.8%  (= 정확히 3셀)
   ↓ toProject
JiggleProject   region 이 크롭 UV 로 변환됨. 스트로크 size 도 함께 스케일
   ↓ buildCut
MeshData        gridForImage(crop) 로 격자, regionWeightAt 로 weight
   ↓ PhysicsSimulator
변형된 정점      JiggleViewer 가 풀에서 빌린 캔버스에 렌더
```

### 합성 (이거 틀리면 이음매가 보입니다)

```
[정적] 원본 슬라이스  <img>          — WebGL 안 씀
[동적] 크롭만        WebGL 캔버스    — 크롭 위치에 CSS 절대배치
```

크롭 가장자리는 안 칠했으니 핀 고정 → 원본 픽셀 그대로 → 아래와 정확히 겹칩니다.
**맞추는 게 아니라 어긋날 수 없는 구조**입니다. 단, 아래 4개가 전부 맞아야 합니다:

```ts
new SceneRenderer(canvas, {
  alpha: true, background: [0,0,0,0],
  padding: 0,             // 기본 0.04면 8% 작게 그려 어긋남
  blurredBackdrop: false, // true면 크롭 밖 121% 면적에 불투명 워시
})
renderer.render({ frameOffset: { x: 0, y: 0 } })   // 아니면 크롭이 통째로 미끄러짐
canvas.style.width = "100%"; canvas.style.height = "100%";  // 없으면 고유 픽셀 크기로 표시됨
```

---

## 5. 이미 기각된 접근 (재제안 금지)

스펙 §5에 측정치와 함께 있습니다. 요약:

| 접근 | 왜 안 되나 |
|---|---|
| **웨이트 페더링** (경계 부드럽게) | XPBD deep-compliance 영역이라 질량항이 평형에서 상쇄됨. 극한 실험에서 목표 지표가 **2.9배 반대로** 감. 게다가 벤더 마스크는 **이미 5셀 램프**를 만들고 있음 |
| **런타임 적응형 서브렉트** | 물리적으로는 완벽(전체 격자와 비트 동일)하지만 실제 웹툰 마스크에서 속도 이득 1.04배 — 없음. 핀 정점이 36.2ns, dynamic이 2400ns라 91배 차이 |
| **tier 상향 / 절대 픽셀 pitch** | 불변량은 `pitch/short` 뿐 (§3-①) |
| **진폭 보정 (k-rescale)** | 안정성 불변량이 깨짐. 스텝당 이동이 `2.19/k` 셀이 되어 k=0.5에서 접힘 영역 |
| **`RegionSnapshot.feather` 되살리기** | 벤더가 의도적으로 삭제한 기능의 묘비. `tests/app.test.tsx`가 UI 부재를 회귀 테스트로 지킴 |

---

## 6. 반복해서 나온 버그 패턴 — 같은 실수 조심

**고정 상수를 종횡비 무시하고 양축에 적용하기.** 이 프로젝트에서 **세 번** 나왔습니다.

| 사례 | 증상 |
|---|---|
| 벤더 `calculateGridDimensions` (tier를 긴 변에) | 컷 높이만으로 진폭 10.9배 |
| `OVERLAY_SAMPLES = 128` (양축 고정) | 1280×5120에서 셀 10×40px, 칠하기가 뭉툭 |
| 초기 설계의 `padding = 0.08 UV` | 가로 64px / 세로 240px 비대칭 |

새 상수를 도입할 때 **"이게 종횡비가 다른 이미지에서도 맞나?"** 를 항상 물으세요.

**그 외 실제로 났던 버그:**
- `setImage(전체 이미지)` — 메시 UV는 크롭 기준인데 원본을 올려 전체가 크롭 안에 찌그러짐
- 캔버스에 CSS 크기 미설정 — 고유 픽셀 크기로 표시되어 배경과 어긋남
- `image.decode()` 루프 — 디코드본을 고정시켜 브라우저가 회수 못 함

---

## 7. 메모리 규칙 (에피소드 다루는 코드)

디코드된 1280×5120 슬라이스는 **25MB RGBA**입니다(파일은 1.2~1.5MB). 회차 한 편이 60~70장.

브라우저는 뷰포트 근처만 디코드하고 나머지는 회수합니다 — **웹툰 뷰어가 그렇게 돌아갑니다.**
우리가 할 일은 그걸 방해하지 않는 것뿐입니다.

```
✅ <img loading="lazy" decoding="async"> + object URL + 명시적 aspect-ratio
✅ 크기는 onload 의 naturalWidth/Height 로
❌ createImageBitmap / 전체 슬라이스 캔버스 복사 / getImageData / decode() 루프
```

우리 자체 오버헤드는 칠한 활성 컷당 약 1.5MB(크롭 텍스처 + 메시)뿐입니다.

---

## 8. 알려진 리스크 / 미해결

### 사람이 해야 하는 검증 (에이전트가 브라우저를 못 엶)

- [ ] **4배 CPU 스로틀링 측정** — 활성 컷 2개 기준 프레임당 물리 4ms 이내인지
- [ ] **실기기 DeviceMotion** — iOS/Android 각 1대 (시뮬레이터 불가). iOS는 사용자 제스처 안에서만 권한 요청 가능
- [ ] **크롭 이음매 육안 확인** — `demo.html`에서 경계가 보이면 §4의 4개 설정부터 확인
- [ ] **프리셋 눈으로 튜닝** — 현재 값은 *테스트를 통과하는* 값이지 *예쁜* 값이 아님
- [ ] **에피소드 70장 메모리 실측** — §7 규칙이 실제로 통하는지

### 알려진 한계

| 항목 | 내용 |
|---|---|
| **성능 예산 초과 케이스** | 900×1800 큰 크롭 + 30% 칠하면 1.080 ms/frame (목표 0.8). 현실적 크롭은 통과 |
| **품질 하향의 대가** | `iterations` 4→3은 큰 마스크에서 삼각형을 뒤집음. 그래서 **활성 컷을 먼저** 줄임 (`QUALITY_TIERS` 순서) |
| **`QualityGovernor` 미배선** | 자기측정 거버너는 만들어져 있으나 `JiggleViewer.setQualityTier()` 를 아직 아무도 호출하지 않음 |
| **썸네일 "칠함" 배지가 낙관적** | `isPainted`가 `strokes.length > 0`만 봄. 지우개만 그은 슬라이스는 배지가 뜨지만 저장에선 빠짐 (파일은 항상 정확) |
| **마스크가 이미지 경계에 닿으면** | 마진이 클램프되어 그쪽 가드밴드가 얇아짐 → 경계가 보일 수 있음 |
| **벤더 프리셋 `shivery`** | `fluctuation 30`이라 우리 안전 범위 밖. K=25에서도 218~375틱 접힘. 우리 프리셋 4종은 전부 안전선 아래 |
| **내보내기 불가** | 원본 export 프로토콜이 크롭 원점을 못 나름. 하려면 벤더 `types.ts` 포크 필요 |

---

## 9. 명령어

```bash
npm install
npm run dev      # 저작툴 localhost:5173 · 뷰어 localhost:5173/demo.html
npm test         # 254개
npm run bench    # 솔버 비용 측정
npm run build
npx tsc -b --pretty false
```

**변경 후 반드시**: `npx tsc -b` + `npx vitest run` + `npx vite build` 셋 다 클린.
특히 **`tests/vendor/` 76개가 통과해야** 벤더를 안 건드렸다는 증거가 됩니다.

---

## 10. 작업 방식

이 프로젝트의 설계 결정은 **전부 실측으로 나왔습니다.** 3라운드에 걸쳐 에이전트 16개가
벤더 엔진을 실제로 돌려 측정했고, 그 과정에서 처음 세운 가설 다섯 개 중 넷이 반증됐습니다.

그래서 여기서는:

- **추측으로 상수를 정하지 마세요.** 하네스를 짜서 재고, 숫자를 `docs/superpowers/notes/`에 남기세요
- **"아마 이게 원인일 것"으로 고치지 마세요.** 실패 테스트로 먼저 재현하고 고치세요
- **성능·안정성 주장은 근거를 붙이세요.** 이 저장소의 표에는 전부 측정 조건이 적혀 있습니다
- 브라우저를 못 여는 상태라면 **"확인하지 못했다"고 말하세요.** 계산상 맞는 것과 눈으로 맞는 건 다릅니다
