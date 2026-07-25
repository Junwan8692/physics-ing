# Webtoon Jiggle

칠한 부분만 실시간으로 출렁이는 이미지 물리 시스템. 세로 스크롤 웹툰 뷰어에서 독자가
스크롤·터치·기기 기울임에 반응하는 런타임을 목표로 한 프로토타입입니다.

> 1단계 결과물은 **저작툴 + 뷰어 데모**로 이루어진 독립 웹앱입니다.
> 실제 서비스 뷰어 통합, 동영상 내보내기, 자동 세그멘테이션은 범위 밖입니다.

## 무엇을 하나

```
1. 컷 이미지 열기
2. 흔들 부분 칠하기
3. 칠한 영역 + 여백이 자동으로 크롭됨   ← 이게 물리가 도는 단위
4. 프리셋 고르기 (머리카락 / 옷자락 / 가슴 / 볼)
5. 저장 → 뷰어에서 스크롤하면 반응
```

렌더링은 레이어 두 장입니다. 아래는 원본 컷 그대로(`<img>`), 위는 크롭 영역만 WebGL로 덮습니다.
크롭 가장자리는 칠하지 않은 영역이라 핀으로 고정되고, 그 픽셀은 원본과 동일하므로
**이음매가 어긋날 수 없습니다.**

## 실행

```bash
npm install
npm run dev      # 저작툴  → http://localhost:5173/
                 # 뷰어    → http://localhost:5173/demo.html
npm test         # 223 tests
npm run bench    # 솔버 비용 측정
npm run build
```

Node 22 이상, WebGL2를 지원하는 브라우저가 필요합니다.
기기 모션 센서는 HTTPS 또는 루프백 오리진에서만 동작합니다.

## 구조

```
src/
  vendor/purupuru/   MIT 벤더링. 수정하지 않음 (아래 참조)
  core/              격자 · 크롭 · 품질 티어 · 컷 빌드
  input/             스크롤 관성 / 포인터 / 기기모션 / 자동 루프 어댑터
  project/           프로젝트 파일 포맷 + 검증 파서
  viewer/            활성 컷 스케줄러 · 렌더러 풀 · 런타임
  editor/            저작 UI
  demo/              스크롤 뷰어 데모
```

`core` · `input`(단 `devicemotion.ts` 제외) · `project`는 DOM과 React에 의존하지 않습니다.
나중에 서비스 뷰어에 그대로 이식하기 위해서입니다.

## 설계 문서

- [설계 스펙](docs/superpowers/specs/2026-07-25-webtoon-jiggle-physics-design.md) — 확정된 결정과 그 근거
- [구현 계획](docs/superpowers/plans/2026-07-25-webtoon-jiggle-physics.md)
- [측정 기록](docs/superpowers/notes/2026-07-25-measurements.md)

**스펙의 숫자는 전부 실측입니다.** 엔진을 실제로 돌려 측정했고, 근거 없이 바꾸지 않기로 했습니다.
특히 §5 "하지 않기로 한 것"은 시도했다가 측정으로 기각된 접근들의 기록입니다 — 다시 제안되기 전에
읽어 주세요.

핵심 결정 셋:

| | 결정 | 근거 |
|---|---|---|
| 격자 | 짧은 변을 25칸 | 엔진 상수가 전부 짧은변 정규화라 `pitch/short`만 불변량. 종횡비 1:1~8:1에서 진폭 편차 5.9%, 뒤집힌 삼각형 0 |
| 솔버 | `tickRate: 60` | 120Hz는 30fps 기기에서 매 프레임 catch-up 절벽에 걸려 물리가 슬로모션이 됨 |
| 크롭 | 저작 시점에 확정 | 런타임 계산은 다른 곳에 칠하면 손대지 않은 영역의 진폭을 -51% 바꿈 |

## 서드파티

물리 엔진은 [grmchn/purupuru-maker](https://github.com/grmchn/purupuru-maker) (MIT)를
`src/vendor/purupuru/`에 수정 없이 벤더링했습니다. 원저작자와 라이선스 전문은
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 [licenses/](licenses/)에 있습니다.

```
Copyright (c) 2026 Puru-Puru Maker contributors — MIT License
```

벤더링 파일에 허용되는 수정은 import 경로 조정, 저작권 고지 주석 추가,
스펙 §2.3에 명시된 중복 타입 삭제뿐입니다. 로직을 바꿔야 하면 벤더 파일을 고치지 말고
우리 코드에서 감싸 주세요.

## 아직 남은 것

에이전트가 할 수 없어 사람 손이 필요한 검증입니다:

- [ ] 4배 CPU 스로틀링 브라우저 측정 (활성 컷 2개 기준 프레임당 물리 4ms 이내)
- [ ] 실기기 DeviceMotion 확인 (iOS / Android 각 1대, 시뮬레이터 불가)
- [ ] `demo.html`에서 크롭 이음매가 보이지 않는지 육안 확인
- [ ] 프리셋 4종 실제 웹툰 컷으로 눈으로 튜닝 (현재 값은 테스트를 통과하는 값일 뿐)
