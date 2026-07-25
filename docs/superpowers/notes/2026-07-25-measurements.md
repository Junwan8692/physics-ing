# 실측 노트 — 2026-07-25 (Task 12)

계획 `docs/superpowers/plans/2026-07-25-webtoon-jiggle-physics.md` Task 12의 산출물.
여기 적힌 숫자는 전부 이 기계에서 실제로 돌려 얻은 것이다. 추정치는 "추정"이라고 명시한다.

---

## 1. 측정 기계

| 항목 | 값 |
|---|---|
| CPU | Apple M5 (10 코어) |
| 메모리 | 32 GB |
| OS | macOS 26.5.2 (25F84) |
| Node | v22.22.3 |
| npm | 10.9.8 |
| Vitest | 4.1.10 |
| 전원 | AC 연결, 다른 부하 없음 |

**이 숫자는 기계 하나의 숫자다.** 스펙 §8의 목표 0.8 ms/frame은 "중급 폰이 단일스레드
JS에서 5배 느리다"는 가정에서 역산한 값이며, 실기기 측정 전까지는 가정이다.

---

## 2. `npm run bench` 출력 (2026-07-25)

```
solver bench — purupuru preset, 600 steps averaged (warmup 60)
tickRate 60 => 60fps 에서 컷당 프레임당 1 스텝. 활성 2개 = 프레임당 2 스텝.
budget: <= 0.8 ms/frame on this machine (spec §8). 숫자 읽는 법은 src/bench/README.md.
crop     fill% tier   verts dyn   us/step  ms/frame x2   vs budget inverted
----------------------------------------------------------------------------
400x400  2     high   676   12    39.1     0.078         ok        -
400x400  2     medium 676   12    32.0     0.064         ok        -
400x400  2     low    676   12    29.7     0.059         ok        -
400x400  10    high   676   60    106.1    0.212         ok        -
400x400  10    medium 676   60    87.9     0.176         ok        -
400x400  10    low    676   60    87.1     0.174         ok        -
400x400  30    high   676   188   286.8    0.574         ok        -
400x400  30    medium 676   188   232.5    0.465         ok        -
400x400  30    low    676   188   232.7    0.465         ok        -
640x800  2     high   832   16    46.2     0.092         ok        -
640x800  2     medium 832   16    37.5     0.075         ok        -
640x800  2     low    832   16    37.4     0.075         ok        -
640x800  10    high   832   80    139.8    0.280         ok        -
640x800  10    medium 832   80    113.7    0.227         ok        -
640x800  10    low    832   80    114.4    0.229         ok        -
640x800  30    high   832   236   357.3    0.715         ok        -
640x800  30    medium 832   236   292.2    0.584         ok        -
640x800  30    low    832   236   291.9    0.584         ok        -
900x1800 2     high   1326  26    72.3     0.145         ok        -
900x1800 2     medium 1326  26    58.8     0.118         ok        -
900x1800 2     low    1326  26    58.8     0.118         ok        -
900x1800 10    high   1326  128   211.7    0.423         ok        -
900x1800 10    medium 1326  128   176.3    0.353         ok        -
900x1800 10    low    1326  128   175.8    0.352         ok        -
900x1800 30    high   1326  370   535.5    1.071         over      -
900x1800 30    medium 1326  370   438.0    0.876         over      YES
900x1800 30    low    1326  370   443.9    0.888         over      YES
```

실행 시간 3.26s. 유일한 단언은 `isFinite()` — 시간에 대한 단언은 없다 (`src/bench/README.md`).

### 읽은 것

- **27개 조합 중 24개가 예산 안.** 넘는 셋은 전부 `900x1800` + `fill 30%` (dyn 370)다.
  30%는 크롭 **면적** 대비이므로 이미 상당히 큰 마스크다. 저작 시점에 이 정도로 칠하면
  크롭도 같이 커지므로, 예산 초과는 저작 단계에서 보이는 신호다.
- **품질 하향이 공짜가 아니다.** 같은 조합에서 `iterations` 4 → 3 (medium/low)은
  비용을 18% 줄이는 대신 측정 끝 시점에 **뒤집힌 삼각형을 남겼다** (`high`에서는 0).
  큰 마스크에서 `QualityGovernor`가 내려가면 시각 확인이 필요하다.
- `medium`과 `low`는 스텝 비용이 같다 (차이는 `maxCatchUpSteps` 4 → 8뿐).
  표에서 둘의 `us/step` 차이는 측정 잡음이다.
- 티어 간 절감폭은 스펙 §4.3이 적은 19~20%대와 일치한다 (관측 17~19%).

### 판정

- 활성 컷 2개 기준 **현실적인 크롭·마스크 조합에서는 예산 안**이다.
  `src/bench/README.md`의 2026-07-25 관측 메모와 같은 결론이 재현되었다.
- **티어를 조정하지 않았다.** 계획 Step 3(미달 시 티어 조정)은 발동 조건이 아니었다.
  `GRID_K`는 물론 건드리지 않았다 (ABI, 스펙 §4.9).

---

## 3. 웹툰 프리셋 확정

`src/editor/webtoonPresets.ts`. 검증은 `tests/webtoon-presets.test.ts` (20 케이스).

### 검증 조건

- 크롭 3종 **전부**에서 900틱 후 `isFinite()` true, `hasInvertedTriangles()` false
  — 400×400 / 640×800 / 900×1800
- 구동: 스크롤 플릭 흉내. `localAcceleration = { x: 3·sin(0.11t), y: 6·sin(0.07t) }`
  (엔진 상한 8 안쪽의 센 구동)
- 마스크: 크롭 중앙, 짧은 변 기준 지름 0.4의 세로 획 하나
- 중력 끄고 입력 제거 후 1200틱 → 모든 정점이 rest 대비 **0.02 이내**
- `resolveParameters(preset).tremorStrength <= 0.223` (스펙 §9 실측 상한)

### 확정값과 측정치

| id | inputStrength | stretch | bounce | damping | cohesion | gravity | fluctuation | maxStretch | tremorStrength | rest 잔차 |
|---|---|---|---|---|---|---|---|---|---|---|
| hair (머리카락) | 70 | 85 | 22 | 12 | 20 | down 0.9 | 12 | 95 | 0.0230 | 0.00709 |
| cloth (옷자락) | 62 | 65 | 30 | 18 | 45 | down 1.0 | 8 | 70 | 0.0260 | 0.00591 |
| chest (가슴) | 82 | 72 | 55 | 22 | 40 | down 1.0 | 5 | 60 | 0.0102 | 0.00415 |
| cheek (볼) | 45 | 40 | 70 | 35 | 65 | down 0.6 | **10** | 30 | 0.0984 | 0.01221 |

`tremorStrength` 상한 0.223 대비 최대 사용률은 cheek의 **44%**. 넉넉하다.
`rest 잔차`는 640×800 크롭 기준 1200틱 후 최대 |position − rest| (한계 0.02).

### 초기값에서 바꾼 것 — 딱 하나

**`cheek.fluctuation` 15 → 10.**

계획 Step 6의 초기값(15)은 뒤집힘·발산 검사는 3개 크롭 전부 통과했지만
**rest 수렴에서 떨어졌다: 잔차 0.02568 (한계 0.02).**

원인은 진폭이 아니라 항의 성격이다. `simulator.ts`의 `tremorTargetForVertex`는
`tetherTargetOffsets`에 상시 오프셋을 싣는다 — 즉 tremor는 감쇠하는 과도 상태가 아니라
**입력을 끊어도 계속 살아 있는 목표 변위**다. 그래서 `damping`을 올려도 잔차가
줄지 않는다 (감쇠는 속도에 걸리지 목표에 걸리지 않는다). 유효한 레버는 `fluctuation` 하나다.
`tremorStrength ∝ fluctuation²` 이라 효과도 가파르다.

`fluctuation` 스윕 (cheek, 640×800, 1200틱):

| fluctuation | tremorStrength | rest 잔차 | 판정 |
|---|---|---|---|
| 15 | 0.2214 | 0.02568 | **초과** |
| 12 | 0.1417 | 0.01797 | 통과, 여유 10% |
| **10** | **0.0984** | **0.01221** | 통과, 여유 39% |

여유 10%는 마스크 모양이 바뀌면 넘어갈 수 있는 폭이라 **10을 택했다.**
cheek은 `stretch`가 낮고 `bounce`가 높아 tremor가 다른 프리셋보다 그대로 드러난다
— 같은 `fluctuation` 값이라도 시각적으로 더 세다. 값이 작아도 "볼 떨림"은 유지된다.

**나머지 3종은 계획 초기값 그대로 통과했다.** 뒤집힘 0, 발산 0, 잔차 전부 한계의 35% 이하.

---

## 4. 전체 검증 (2026-07-25)

| 명령 | 결과 |
|---|---|
| `npx tsc -b --pretty false` | 에러 0 |
| `npx vitest run` | **Test Files 22 passed (22) / Tests 220 passed (220)** |
| `npx vitest run tests/vendor` | **Test Files 5 passed (5) / Tests 76 passed (76)** |
| `npx vite build` | 성공 (52 modules, 45ms) |

### 벤더 무결성 — 실제로 확인한 방법

`git diff --stat -- src/vendor`는 **이 저장소에서 아무것도 증명하지 못한다.**
저장소에 커밋이 하나도 없어서(`main` 브랜치에 커밋 없음, 전 파일이 `??` 상태)
diff의 기준점이 없기 때문이다. 그래서 업스트림과 직접 비교했다:

```bash
git -C /tmp/purupuru-upstream rev-parse HEAD   # a1202d1003f3e83654a3940979540f980ec707c2
# 각 벤더 파일에서 MIT 고지 헤더(7줄)만 제거하고 업스트림 원본과 diff
```

결과: **엔진 소스 19개 전부 바이트 동일.**

`core/{constraints,index,math,mesh,parameters,prng,rigidFrame,shapeMatching,simulator,types}.ts`,
`render/{SceneRenderer,index}.ts`, `coordinates/{affine,index,spaces}.ts`,
`region/{model,pointerGestures}.ts`, `motion/{motion,useDeviceMotion}.ts`

유일하게 다른 파일은 `motion/types.ts` 하나이고, 차이는 스펙 §2.3이 지시한
중복 타입 삭제(`GravityDirection`, `MotionParameters`(`variation` 판), `PresetId`,
`CurrentPresetId`)뿐이다. 로직은 없다.

`tests/vendor/` 5개 76 케이스가 통과하는 것이 같은 사실의 런타임 쪽 증거다.

---

## 5. 아직 하지 않은 측정 — 사람이 해야 한다

에이전트가 할 수 없는 항목이다. **완료 기준(계획 마지막 절)이 이 셋을 요구한다.**

### 5.1 4배 CPU 스로틀링 브라우저 측정 (계획 Step 2)

- Chrome DevTools → Performance → CPU **4x slowdown**
- `demo.html`에 컷 4개 이상 등록, 세로 스크롤하며 녹화
- 재는 것: 활성 2개 기준 **프레임당 물리 시간**, 드롭 프레임 수, `JiggleViewer.tick` self time
- **판정: 프레임당 4ms 초과면 미달.** 미달 시 계획 Step 3 — `QualityGovernor` 임계값
  또는 `QUALITY_TIERS` 조정. **`GRID_K`는 건드리지 않는다** (ABI, 스펙 §4.9)
- 참고: 이 노트 §2의 Node 벤치는 렌더를 포함하지 않는다. 브라우저 수치는 이보다 크다

### 5.2 실기기 DeviceMotion (계획 Step 4)

- **iOS 1대 + Android 1대.** 시뮬레이터/에뮬레이터로는 대체 불가
- iOS: 권한 팝업이 **사용자 제스처 안에서만** 뜬다. 거부했을 때 상태 표시가 나오는지 확인
- Android: 권한 팝업 없이 바로 이벤트가 오는지, 축 부호가 iOS와 같은지
- 흔들었을 때 반응 세기가 스크롤·포인터와 비슷한 스케일인지

### 5.3 크롭 이음매 육안 확인 (계획 Task 11 Step 4)

- `npm run dev` → `http://localhost:5173/demo.html`
- 스크롤 중 **크롭 경계선이 보이지 않아야 한다.** 구조상 보일 수 없지만(스펙 §4.5) 눈으로 확인
- 보이면 순서대로: `padding: 0` 실제 적용 여부 → `blurredBackdrop: false` → 그 다음 다른 원인
- 크롭이 통째로 미끄러지면 `frameOffset`이 `{0,0}`이 아닌 것이다
- 같은 화면에서 확인: 컷 3개 이상일 때 화면 중앙 **2개만** 활성, 트리거 4종 개별 토글 동작

### 5.4 프리셋 육안 튜닝 (계획 Step 7 후반)

이 노트의 프리셋은 **테스트가 통과하는 값**이지 눈으로 맞춘 값이 아니다.
실제 웹툰 컷(머리카락·옷자락·가슴·볼)에 칠해서 보고 조정할 것.
조정할 때마다 `npx vitest run tests/webtoon-presets.test.ts`를 다시 돌린다.
특히 `fluctuation`은 올리면 §3의 rest 수렴이 먼저 깨진다.
