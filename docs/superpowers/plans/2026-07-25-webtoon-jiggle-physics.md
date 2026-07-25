# 웹툰 런타임 지글 피직스 구현 계획 (2차 개정)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정지 이미지의 칠한 영역만 실시간으로 출렁이는 시스템. 저작툴에서 칠하면 bbox+마진이 자동 크롭되고, 뷰어에서 스크롤·터치·기기모션·자동루프에 반응한다.

**Architecture:** MIT [grmchn/purupuru-maker](https://github.com/grmchn/purupuru-maker)의 XPBD 엔진을 `src/vendor/purupuru/`에 **수정 없이** 벤더링. 그 위에 웹툰 레이어만 신규 작성 — 짧은변 25칸 격자, 저작시점 bbox 크롭, 입력 어댑터 4종, 레이어 합성 뷰어, 프로젝트 포맷.

**Tech Stack:** TypeScript 5.9.3 / Vite 8.1.4 / React 19.2.7 / Vitest 4.1.10 / WebGL2

**Spec:** `docs/superpowers/specs/2026-07-25-webtoon-jiggle-physics-design.md` — **읽고 시작할 것.** 특히 §4(확정 결정)와 §5(하지 않기로 한 것).

---

## Global Constraints

- Node.js 22+. 버전 고정: TypeScript 5.9.3, Vite 8.1.4, Vitest 4.1.10, React 19.2.7
- 런타임 의존성은 `react`, `react-dom` 둘뿐. **새 런타임 의존성 추가 금지.** 필요해 보이면 멈추고 보고
- `src/vendor/purupuru/**` 는 벤더링 코드. 허용 수정은 **import 경로, 저작권 주석, 스펙 §2.3의 중복 타입 삭제**뿐. 로직 수정 금지
- `src/core/**`, `src/input/**`(`devicemotion.ts` 제외), `src/project/**` 는 **DOM·React 미참조.** `window`/`document`/`HTMLElement` 등장 시 설계 위반
- `MotionParameters`의 요동 필드는 **`fluctuation`**. `variation`은 쓰지 않는다
- **확정 상수 (스펙 §4, 실측 근거 있음. 임의 변경 금지):**
  - `GRID_K = 25` — 짧은 변 셀 수. **ABI다.** 바꾸면 프리셋 전부 무효
  - `GUARD_CELLS = 3`, `MARGIN_RATIO = 3/19`
  - `SOLVER_QUALITY = { tickRate: 60, iterations: 4, maxCatchUpSteps: 4 }`
  - `BRUSH_MIN = 2 / GRID_K = 0.08`, 기본 0.12, 최대 0.5
  - `LOCAL_ACCELERATION_CLAMP = 8`, `AUTOMATIC_ACCELERATION_CLAMP = 1`
  - SceneRenderer: `{ alpha: true, background: [0,0,0,0], padding: 0, blurredBackdrop: false }`, `render({ frameOffset: { x: 0, y: 0 } })`
- **`calculateGridDimensions`를 호출하지 않는다.** `createGridMesh`에 columns/rows를 직접 넘긴다
- `src/core/types.ts`는 **Task 1에서 확정되는 계약 파일. Task 2 이후 수정 금지.** 필요하면 멈추고 보고
- 커밋 메시지는 Conventional Commits
- 테스트: `npx vitest run [경로]`

---

## 병렬 실행 구조

Wave 안의 작업은 파일이 겹치지 않아 동시 진행 가능. Wave 경계는 배리어.

```
Wave 0  Task 1   부트스트랩 + 벤더링 + 계약 타입              (단독, 선행 필수)

Wave 1  Task 2   격자 + 크롭        src/core/{grid,crop}.ts
        Task 3   입력 계약 + 스크롤  src/input/{types,scroll,combine}.ts
        Task 4   프로젝트 포맷      src/project/{schema,io}.ts
        Task 5   품질 + 벤치        src/core/quality.ts, src/bench/
        Task 6   활성 컷 선택기      src/viewer/scheduler.ts

Wave 2  Task 7   나머지 어댑터      src/input/{pointer,devicemotion,auto}.ts   (T3)
        Task 8   컷 빌드 + 뷰어     src/core/buildCut.ts, src/viewer/*         (T2,T3,T5,T6)
        Task 9   저작 UI 부품       src/editor/{brush,MaskCanvas,CropPreview,ParameterPanel}  (T2,T4)

Wave 3  Task 10  저작툴 셸          src/editor/EditorApp.tsx, src/main.tsx     (T8,T9)
        Task 11  뷰어 데모          src/demo/, demo.html                       (T8)

Wave 4  Task 12  프리셋 + 실측 확정                                            (전부)
```

**병렬 에이전트 규칙:**
1. 자기 Task의 `**Files:**` 에 적힌 파일만 만들고 고친다. 다른 파일이 필요하면 멈추고 보고
2. `src/core/types.ts`, `src/vendor/**`, `package.json` 은 읽기 전용
3. 각 Task는 자기 테스트를 자기가 쓴다. 다른 Task 테스트를 고치지 않는다
4. Wave 안에서는 rebase 없이 각자 커밋한다 (파일이 안 겹침)
5. 스펙 §5에 "하지 않기로 한 것"으로 적힌 걸 되살리지 않는다

---

## Task 1: 부트스트랩 + 벤더링 + 계약 타입

**단독. 완료 전 다른 Task 시작 금지.**

**Files:** `package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `src/vendor/purupuru/**`, `licenses/`, `THIRD_PARTY_NOTICES.md`, `src/core/types.ts`, `src/main.tsx`, `tests/vendor/**`, `tests/contracts.test.ts`

**Produces:** `src/core/types.ts` 전체 계약. 벤더 재수출 API — `PhysicsSimulator`, `createGridMesh`, `MeshData`, `MotionParameters`, `PhysicsInput`, `SolverQuality`, `MOTION_PRESETS`, `resolveParameters`, `clampMagnitude`, `RegionSnapshot`, `RegionStroke`, `RegionHistory`, `regionWeightAt`, `EMPTY_REGION`, `SceneRenderer`, `sampleAutoMotion`, `samplePointerDrag`, `processSensorSample`

- [ ] **Step 1: 저장소 초기화 + 업스트림 클론**

```bash
cd <프로젝트 루트>
git init
git clone --depth 1 https://github.com/grmchn/purupuru-maker.git /tmp/purupuru-upstream
git -C /tmp/purupuru-upstream rev-parse HEAD    # SHA 기록
```

- [ ] **Step 2: `package.json`**

```json
{
  "name": "webtoon-jiggle", "version": "0.1.0", "private": true, "type": "module",
  "scripts": {
    "dev": "vite", "build": "tsc -b && vite build",
    "typecheck": "tsc -b --pretty false", "test": "vitest run",
    "bench": "vitest run src/bench --reporter=verbose"
  },
  "dependencies": { "react": "19.2.7", "react-dom": "19.2.7" },
  "devDependencies": {
    "@types/node": "25.0.3", "@types/react": "19.2.14", "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.3", "jsdom": "28.0.0", "typescript": "5.9.3",
    "vite": "8.1.4", "vitest": "4.1.10"
  },
  "engines": { "node": ">=22.0.0" }
}
```

`npm install`.

- [ ] **Step 3: 설정 파일**

`tsconfig.json`: `{ "files": [], "references": [{"path":"./tsconfig.app.json"},{"path":"./tsconfig.node.json"}] }`

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022","DOM","DOM.Iterable"], "module": "ESNext",
    "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true,
    "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true, "noEmit": true, "composite": true, "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

`noUncheckedIndexedAccess`는 벤더가 `?? 0` 방어를 두른 이유이므로 반드시 켠다.

`tsconfig.node.json`: 위와 같되 `lib: ["ES2022"]`, `jsx` 없음, `include: ["vite.config.ts","vitest.config.ts"]`.

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.dom.test.{ts,tsx}", "jsdom"]],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
  },
});
```

`.gitignore`: `node_modules`, `dist`, `.DS_Store`, `*.local`

- [ ] **Step 4: 벤더링 (스펙 §2.3 매니페스트대로)**

```bash
U=/tmp/purupuru-upstream
mkdir -p src/vendor/purupuru/{core,render,region,motion,coordinates} tests/vendor licenses
cp $U/src/engine/core/*.ts               src/vendor/purupuru/core/
cp $U/src/engine/render/SceneRenderer.ts src/vendor/purupuru/render/
cp $U/src/engine/render/index.ts         src/vendor/purupuru/render/
cp $U/src/engine/coordinates/*.ts        src/vendor/purupuru/coordinates/
cp $U/src/features/region-editor/model.ts           src/vendor/purupuru/region/
cp $U/src/features/region-editor/pointerGestures.ts src/vendor/purupuru/region/
cp $U/src/features/play-controls/motion.ts          src/vendor/purupuru/motion/
cp $U/src/features/play-controls/useDeviceMotion.ts src/vendor/purupuru/motion/
cp $U/src/features/play-controls/types.ts           src/vendor/purupuru/motion/
cp $U/tests/{physics,region-model,region-weights,coordinates,motion}.test.ts tests/vendor/
cp $U/LICENSE licenses/PURUPURU_MAKER_MIT.txt
```

`src/engine/export/**`, `src/features/recording/**`, `src/workers/**`, `src/i18n/**`, `src/app/**`, `src/features/image-input/**`, `play-controls/presets.ts` 는 **가져오지 않는다.**

- [ ] **Step 5: 중복 타입 제거 + import 경로 조정**

`src/vendor/purupuru/motion/types.ts` 를 이 셋만 남기고 삭제:
```ts
export type AutoMotionId = "sway" | "hop" | "orbit";
export interface MotionVector { x: number; y: number; }
export interface PointerDragOptions { gain?: number; maximumTravel?: number; }
```

`tests/vendor/*.test.ts` import 경로 변환:
```
../src/engine/core/...            → ../../src/vendor/purupuru/core/...
../src/engine/coordinates/...     → ../../src/vendor/purupuru/coordinates/...
../src/features/region-editor/... → ../../src/vendor/purupuru/region/...
../src/features/play-controls/... → ../../src/vendor/purupuru/motion/...
```

`tests/vendor/motion.test.ts` 가 `presets.ts` 나 삭제된 타입을 참조하면 그 케이스만 삭제하고 상단에 이유를 주석으로 남긴다.

- [ ] **Step 6: 저작권 고지 + THIRD_PARTY_NOTICES**

`src/vendor/purupuru/**/*.ts` 전 파일 최상단:
```ts
/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
```

`THIRD_PARTY_NOTICES.md`에 출처 URL, Step 1의 SHA, 라이선스, 변경 요약, React 항목을 기재.

- [ ] **Step 7: 회귀 기준선 확인**

```bash
npx tsc -b --pretty false && npx vitest run tests/vendor
```
Expected: 타입 에러 0, 벤더 테스트 전부 PASS. 이 통과가 이후 "벤더를 안 건드렸다"의 증거다.

- [ ] **Step 8: 계약 파일 `src/core/types.ts`**

```ts
import type { MeshData, MotionParameters, PhysicsInput } from "../vendor/purupuru/core/types";
import type { RegionSnapshot } from "../vendor/purupuru/region/model";

/** 픽셀 사각형. 원본 이미지 좌표계. */
export interface Rect { x: number; y: number; width: number; height: number; }

export interface GridSize { columns: number; rows: number; pitch: number; }

export type InputAdapterId = "scroll" | "pointer" | "devicemotion" | "auto";

export interface InputAdapter {
  readonly id: InputAdapterId;
  enabled: boolean;
  sample(dtSeconds: number): PhysicsInput;
  attach(): void;
  detach(): void;
}

export interface TaggedInput { id: InputAdapterId; input: PhysicsInput; }

export type QualityTierId = "high" | "medium" | "low";

export interface JiggleProject {
  format: "jiggle-project";
  version: 1;
  /** 원본 슬라이스. 뷰어가 정적 배경으로 깐다. */
  source: { src: string; width: number; height: number };
  /** 원본 안에서 물리가 적용되는 픽셀 사각형. */
  crop: Rect;
  /** 스트로크 좌표는 crop 기준 UV [0,1]. */
  region: RegionSnapshot;
  motion: MotionParameters;
  seed: number;
}

/** buildCut의 산출물. 시뮬레이터에 넘길 준비가 된 메시. */
export interface BuiltCut { mesh: MeshData; grid: GridSize; crop: Rect; }
```

- [ ] **Step 9: 계약 테스트 `tests/contracts.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { MOTION_PRESETS, createGridMesh, PhysicsSimulator } from "../src/vendor/purupuru/core";
import { EMPTY_REGION } from "../src/vendor/purupuru/region/model";
import type { JiggleProject } from "../src/core/types";

describe("contracts", () => {
  it("MOTION_PRESETS uses fluctuation, never variation", () => {
    expect(MOTION_PRESETS.purupuru).toHaveProperty("fluctuation");
    expect(MOTION_PRESETS.purupuru).not.toHaveProperty("variation");
  });

  it("a JiggleProject literal type-checks against vendor types", () => {
    const project: JiggleProject = {
      format: "jiggle-project", version: 1,
      source: { src: "cut.png", width: 1280, height: 5120 },
      crop: { x: 340, y: 1820, width: 494, height: 394 },
      region: EMPTY_REGION, motion: MOTION_PRESETS.purupuru, seed: 1,
    };
    expect(project.motion.fluctuation).toBe(5);
  });

  it("the simulator runs and stays sane on a contract-path mesh", () => {
    const mesh = createGridMesh({
      columns: 25, rows: 25, imageWidth: 400, imageHeight: 400,
      weights: (u, v) => (u > 0.35 && u < 0.65 && v > 0.35 && v < 0.65 ? 1 : 0),
    });
    const sim = new PhysicsSimulator({
      mesh, parameters: MOTION_PRESETS.purupuru, seed: 1,
      quality: { tickRate: 60, iterations: 4, maxCatchUpSteps: 4 },
    });
    for (let i = 0; i < 300; i += 1) sim.step({ localAcceleration: { x: 2, y: 3 } });
    expect(sim.isFinite()).toBe(true);
    expect(sim.hasInvertedTriangles()).toBe(false);
  });
});
```

- [ ] **Step 10: 진입점 + 전체 검증 + 커밋**

`index.html` (root div + `/src/main.tsx`), `src/main.tsx` 는 자리표시 렌더.

```bash
npx tsc -b --pretty false && npx vitest run && npx vite build
git add -A && git commit -m "chore: bootstrap and vendor purupuru-maker engine (MIT)"
```

---

## Task 2: 격자 + 크롭

**Wave 1 — T3·T4·T5·T6과 병렬.**

**Files:** Create `src/core/grid.ts`, `src/core/crop.ts`; Test `tests/grid.test.ts`, `tests/crop.test.ts`

**Consumes:** `src/core/types.ts`의 `Rect`, `GridSize`. `vendor/purupuru/region/model.ts`의 `regionWeightAt`, `RegionSnapshot`

**Produces:**
- `grid.ts`: `GRID_K = 25`, `gridForImage(width, height): GridSize`
- `crop.ts`: `GUARD_CELLS = 3`, `MARGIN_RATIO = 3/19`, `maskBoundsPx(region, imageWidth, imageHeight, samples?): Rect | null`, `cropRectForMask(maskRect, imageWidth, imageHeight): Rect`

- [ ] **Step 1: 실패 테스트 — grid**

`tests/grid.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { gridForImage, GRID_K } from "../src/core/grid";

describe("gridForImage", () => {
  it("gives the short side exactly GRID_K cells", () => {
    for (const [w, h] of [[400,400],[600,900],[800,3000],[800,6400],[3200,800]]) {
      const { columns, rows } = gridForImage(w, h);
      expect(w <= h ? columns : rows).toBe(GRID_K);
    }
  });

  it("keeps cells square within rounding", () => {
    for (const [w, h] of [[400,400],[600,900],[800,3000],[1280,5120]]) {
      const { columns, rows } = gridForImage(w, h);
      const cw = w / columns, ch = h / rows;
      expect(Math.max(cw, ch) / Math.min(cw, ch)).toBeLessThan(1.1);
    }
  });

  it("reports pitch as short side over GRID_K", () => {
    expect(gridForImage(800, 3000).pitch).toBeCloseTo(800 / 25);
    expect(gridForImage(3200, 800).pitch).toBeCloseTo(800 / 25);
  });

  it("never goes below 4 cells on either axis", () => {
    const { columns, rows } = gridForImage(100, 100000);
    expect(columns).toBeGreaterThanOrEqual(4);
    expect(rows).toBeGreaterThanOrEqual(4);
  });

  it("rejects non-positive dimensions", () => {
    expect(() => gridForImage(0, 100)).toThrow(RangeError);
    expect(() => gridForImage(100, Number.NaN)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: 실패 테스트 — crop**

`tests/crop.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { maskBoundsPx, cropRectForMask, GUARD_CELLS } from "../src/core/crop";
import { gridForImage } from "../src/core/grid";
import type { RegionSnapshot } from "../src/vendor/purupuru/region/model";

const blob: RegionSnapshot = {
  baseFill: 0, inverted: false,
  strokes: [{ id: 1, mode: "paint", size: 0.2, strength: 1, operation: "add", points: [{ x: 0.5, y: 0.5 }] }],
};
const empty: RegionSnapshot = { baseFill: 0, inverted: false, strokes: [] };

describe("maskBoundsPx", () => {
  it("returns null for an empty mask", () => {
    expect(maskBoundsPx(empty, 800, 800)).toBeNull();
  });

  it("brackets a central blob inside the image", () => {
    const b = maskBoundsPx(blob, 800, 800)!;
    expect(b.x).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThan(0);
    expect(b.x + b.width).toBeLessThan(800);
    expect(b.y + b.height).toBeLessThan(800);
  });
});

describe("cropRectForMask", () => {
  it("puts exactly GUARD_CELLS of margin around the mask", () => {
    const mask = { x: 300, y: 300, width: 400, height: 300 };
    const crop = cropRectForMask(mask, 2000, 2000);
    const { pitch } = gridForImage(crop.width, crop.height);
    expect((mask.x - crop.x) / pitch).toBeCloseTo(GUARD_CELLS, 0);
    expect((mask.y - crop.y) / pitch).toBeCloseTo(GUARD_CELLS, 0);
  });

  it("uses the same pixel margin on all four sides", () => {
    const mask = { x: 300, y: 300, width: 400, height: 300 };
    const crop = cropRectForMask(mask, 2000, 2000);
    expect(mask.x - crop.x).toBe(crop.x + crop.width - (mask.x + mask.width));
    expect(mask.y - crop.y).toBe(crop.y + crop.height - (mask.y + mask.height));
  });

  it("clamps to the image", () => {
    const crop = cropRectForMask({ x: 0, y: 0, width: 300, height: 300 }, 400, 400);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(400);
    expect(crop.y + crop.height).toBeLessThanOrEqual(400);
  });

  it("stays integral so the crop can be a pixel blit", () => {
    const crop = cropRectForMask({ x: 301, y: 307, width: 401, height: 303 }, 2000, 2000);
    for (const value of [crop.x, crop.y, crop.width, crop.height]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/grid.test.ts tests/crop.test.ts` → resolve 실패

- [ ] **Step 4: `src/core/grid.ts`**

```ts
import type { GridSize } from "./types";

/**
 * 짧은 변을 몇 칸으로 나눌지. 이 값이 ABI다 — 스펙 §4.9.
 * 엔진의 모든 힘·거리 상수가 짧은 변 정규화 단위이므로 pitch/short 만이 불변량이다.
 * 실측: 종횡비 1:1~8:1 에서 진폭 편차 5.9%, 뒤집힌 삼각형 0.
 * short/33 보다 곱게 가면 접힌다.
 */
export const GRID_K = 25;

export function gridForImage(width: number, height: number): GridSize {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError("Image dimensions must be finite positive numbers.");
  }
  const short = Math.min(width, height);
  return {
    columns: Math.max(4, Math.round(GRID_K * width / short)),
    rows: Math.max(4, Math.round(GRID_K * height / short)),
    pitch: short / GRID_K,
  };
}
```

- [ ] **Step 5: `src/core/crop.ts`**

```ts
import { regionWeightAt, type RegionSnapshot } from "../vendor/purupuru/region/model";
import { GRID_K } from "./grid";
import type { Rect } from "./types";

/** 실측: 3셀이면 전체격자 대비 진폭 오차 0.5%, 1셀이면 찢어진다. */
export const GUARD_CELLS = 3;

/**
 * margin = GUARD_CELLS * pitch, pitch = cropShort / GRID_K, cropShort = maskShort + 2*margin
 * 를 풀면 margin = maskShort * GUARD_CELLS / (GRID_K - 2*GUARD_CELLS).
 */
export const MARGIN_RATIO = GUARD_CELLS / (GRID_K - 2 * GUARD_CELLS);

export function maskBoundsPx(
  region: RegionSnapshot,
  imageWidth: number,
  imageHeight: number,
  samples = 128,
): Rect | null {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let row = 0; row < samples; row += 1) {
    const v = (row + 0.5) / samples;
    for (let column = 0; column < samples; column += 1) {
      const u = (column + 0.5) / samples;
      if (regionWeightAt(region, u, v, imageWidth, imageHeight) <= 0) continue;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  if (!Number.isFinite(minU)) return null;
  // 셀 중심만 표본하므로 반 셀 넓혀 실제 경계를 놓치지 않는다.
  const halfU = 0.5 / samples;
  const x = Math.max(0, Math.floor((minU - halfU) * imageWidth));
  const y = Math.max(0, Math.floor((minV - halfU) * imageHeight));
  return {
    x, y,
    width: Math.min(imageWidth, Math.ceil((maxU + halfU) * imageWidth)) - x,
    height: Math.min(imageHeight, Math.ceil((maxV + halfU) * imageHeight)) - y,
  };
}

export function cropRectForMask(mask: Rect, imageWidth: number, imageHeight: number): Rect {
  const margin = Math.ceil(MARGIN_RATIO * Math.min(mask.width, mask.height));
  const x = Math.max(0, mask.x - margin);
  const y = Math.max(0, mask.y - margin);
  return {
    x, y,
    width: Math.min(imageWidth, mask.x + mask.width + margin) - x,
    height: Math.min(imageHeight, mask.y + mask.height + margin) - y,
  };
}
```

- [ ] **Step 6: 통과 확인 + 커밋**

```bash
npx vitest run tests/grid.test.ts tests/crop.test.ts   # 11개 PASS
npx tsc -b --pretty false
git add src/core/grid.ts src/core/crop.ts tests/grid.test.ts tests/crop.test.ts
git commit -m "feat: short-side-pinned grid sizing and authoring-time crop rect"
```

**주의**: `uses the same pixel margin on all four sides` 는 이미지 경계에 안 닿는 마스크에서만 성립한다. 테스트가 2000×2000 안의 작은 마스크를 쓰는 이유다. 경계 클램프 시 비대칭은 의도된 동작이다.

---

## Task 3: 입력 계약 + 스크롤 관성

**Wave 1 — T2·T4·T5·T6과 병렬.**

**Files:** Create `src/input/{types,scroll,combine}.ts`; Test `tests/input-scroll.test.ts`, `tests/input-combine.test.ts`

**Consumes:** `src/core/types.ts`의 `InputAdapter`, `InputAdapterId`, `TaggedInput`. `vendor/purupuru/core/math.ts`의 `clampMagnitude`

**Produces:**
- `types.ts`: `FRAME_TARGET_PRIORITY`, `LOCAL_ACCELERATION_CLAMP = 8`, `AUTOMATIC_ACCELERATION_CLAMP = 1`
- `scroll.ts`: `createScrollAdapter(options?): ScrollAdapter`, `type ScrollAdapter = InputAdapter & { gain: number; smoothingSeconds: number }` (**두 값은 런타임 가변** — 디버그 슬라이더로 튜닝), `interface ScrollAdapterOptions { readScrollY?: () => number; gain?: number; smoothingSeconds?: number; maxAcceleration?: number }`
- `combine.ts`: `combineInputs(samples: readonly TaggedInput[]): PhysicsInput`

- [ ] **Step 1: 실패 테스트 — combine**

`tests/input-combine.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { combineInputs } from "../src/input/combine";
import type { TaggedInput } from "../src/core/types";

describe("combineInputs", () => {
  it("returns an empty input for no samples", () => expect(combineInputs([])).toEqual({}));

  it("sums localAcceleration", () => {
    expect(combineInputs([
      { id: "scroll", input: { localAcceleration: { x: 1, y: 2 } } },
      { id: "devicemotion", input: { localAcceleration: { x: 3, y: 1 } } },
    ]).localAcceleration).toEqual({ x: 4, y: 3 });
  });

  it("clamps summed localAcceleration to magnitude 8", () => {
    const samples: TaggedInput[] = Array.from({ length: 5 }, () =>
      ({ id: "scroll" as const, input: { localAcceleration: { x: 10, y: 0 } } }));
    const c = combineInputs(samples).localAcceleration!;
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(8);
  });

  it("clamps summed automaticAcceleration to magnitude 1", () => {
    const c = combineInputs([
      { id: "auto", input: { automaticAcceleration: { x: 5, y: 0 } } },
      { id: "auto", input: { automaticAcceleration: { x: 5, y: 0 } } },
    ]).automaticAcceleration!;
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(1);
  });

  it("prefers the pointer frameTarget over everything", () => {
    expect(combineInputs([
      { id: "auto", input: { frameDragging: true, frameTarget: { x: 0.9, y: 0.9 } } },
      { id: "scroll", input: { frameDragging: true, frameTarget: { x: 0.5, y: 0.5 } } },
      { id: "pointer", input: { frameDragging: true, frameTarget: { x: 0.1, y: 0.1 } } },
    ]).frameTarget).toEqual({ x: 0.1, y: 0.1 });
  });

  it("falls through the priority order", () => {
    expect(combineInputs([
      { id: "auto", input: { frameDragging: true, frameTarget: { x: 0.9, y: 0.9 } } },
      { id: "scroll", input: { frameDragging: true, frameTarget: { x: 0.5, y: 0.5 } } },
    ]).frameTarget).toEqual({ x: 0.5, y: 0.5 });
  });

  it("ignores a frameTarget whose adapter is not dragging", () => {
    expect(combineInputs([
      { id: "pointer", input: { frameDragging: false, frameTarget: { x: 0.1, y: 0.1 } } },
      { id: "scroll", input: { frameDragging: true, frameTarget: { x: 0.5, y: 0.5 } } },
    ]).frameTarget).toEqual({ x: 0.5, y: 0.5 });
  });

  it("drops non-finite contributions instead of poisoning the sum", () => {
    expect(combineInputs([
      { id: "scroll", input: { localAcceleration: { x: Number.NaN, y: 1 } } },
      { id: "auto", input: { localAcceleration: { x: 2, y: 1 } } },
    ]).localAcceleration).toEqual({ x: 2, y: 2 });
  });
});
```

- [ ] **Step 2: 실패 테스트 — scroll**

`tests/input-scroll.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createScrollAdapter } from "../src/input/scroll";

const scripted = (positions: number[]) => {
  let i = 0;
  return () => positions[Math.min(i++, positions.length - 1)] ?? 0;
};

describe("createScrollAdapter", () => {
  it("has the scroll id", () => expect(createScrollAdapter().id).toBe("scroll"));

  it("reports zero acceleration while the page is still", () => {
    const a = createScrollAdapter({ readScrollY: () => 100 });
    a.attach();
    for (let i = 0; i < 10; i += 1) a.sample(1 / 60);
    expect(Math.abs(a.sample(1 / 60).localAcceleration!.y)).toBeLessThan(1e-6);
  });

  it("produces non-zero acceleration when scrolling starts", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 0, 40, 90, 150]) });
    a.attach();
    let peak = 0;
    for (let i = 0; i < 5; i += 1) peak = Math.max(peak, Math.abs(a.sample(1 / 60).localAcceleration!.y));
    expect(peak).toBeGreaterThan(0);
  });

  it("never exceeds maxAcceleration", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 1e5, 0, 1e5, 0]), maxAcceleration: 8 });
    a.attach();
    for (let i = 0; i < 5; i += 1) {
      expect(Math.abs(a.sample(1 / 60).localAcceleration!.y)).toBeLessThanOrEqual(8 + 1e-9);
    }
  });

  it("decays back toward zero after scrolling stops", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 50, 100, 150]) });
    a.attach();
    let last = 0;
    for (let i = 0; i < 40; i += 1) last = a.sample(1 / 60).localAcceleration!.y;
    expect(Math.abs(last)).toBeLessThan(0.05);
  });

  it("never emits NaN even for a zero dt", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 10, 20]) });
    a.attach();
    a.sample(0);
    expect(Number.isFinite(a.sample(0).localAcceleration!.y)).toBe(true);
  });

  it("emits no input while disabled", () => {
    const a = createScrollAdapter({ readScrollY: scripted([0, 500, 1000]) });
    a.attach();
    a.enabled = false;
    expect(a.sample(1 / 60)).toEqual({});
  });

  it("exposes gain and smoothing as live knobs", () => {
    const a = createScrollAdapter();
    a.gain = 0.005;
    a.smoothingSeconds = 0.1;
    expect(a.gain).toBe(0.005);
    expect(a.smoothingSeconds).toBe(0.1);
  });
});
```

- [ ] **Step 3: 실패 확인**

- [ ] **Step 4: `src/input/types.ts`**

```ts
import type { InputAdapterId } from "../core/types";

/** frameTarget은 하나만 채택된다. 명시적 조작이 암묵적 움직임을 이긴다. */
export const FRAME_TARGET_PRIORITY: readonly InputAdapterId[] =
  ["pointer", "devicemotion", "scroll", "auto"];

/** PhysicsSimulator.step()이 거는 값과 동일. */
export const LOCAL_ACCELERATION_CLAMP = 8;
export const AUTOMATIC_ACCELERATION_CLAMP = 1;
```

- [ ] **Step 5: `src/input/combine.ts`**

```ts
import { clampMagnitude } from "../vendor/purupuru/core/math";
import type { PhysicsInput, Point } from "../vendor/purupuru/core/types";
import type { TaggedInput } from "../core/types";
import { AUTOMATIC_ACCELERATION_CLAMP, FRAME_TARGET_PRIORITY, LOCAL_ACCELERATION_CLAMP } from "./types";

const addFinite = (total: Point, value: Point | undefined): Point =>
  !value || !Number.isFinite(value.x) || !Number.isFinite(value.y)
    ? total : { x: total.x + value.x, y: total.y + value.y };

export function combineInputs(samples: readonly TaggedInput[]): PhysicsInput {
  if (samples.length === 0) return {};
  let local: Point = { x: 0, y: 0 }, automatic: Point = { x: 0, y: 0 };
  let sawLocal = false, sawAutomatic = false;

  for (const { input } of samples) {
    if (input.localAcceleration) { local = addFinite(local, input.localAcceleration); sawLocal = true; }
    if (input.automaticAcceleration) { automatic = addFinite(automatic, input.automaticAcceleration); sawAutomatic = true; }
  }

  const combined: PhysicsInput = {};
  if (sawLocal) combined.localAcceleration = clampMagnitude(local, LOCAL_ACCELERATION_CLAMP);
  if (sawAutomatic) combined.automaticAcceleration = clampMagnitude(automatic, AUTOMATIC_ACCELERATION_CLAMP);

  for (const id of FRAME_TARGET_PRIORITY) {
    const winner = samples.find((s) => s.id === id && s.input.frameDragging === true && s.input.frameTarget !== undefined);
    if (!winner) continue;
    combined.frameDragging = true;
    combined.frameTarget = winner.input.frameTarget;
    if (winner.input.frameTravelLimit !== undefined) combined.frameTravelLimit = winner.input.frameTravelLimit;
    break;
  }
  return combined;
}
```

- [ ] **Step 6: `src/input/scroll.ts`**

```ts
import type { InputAdapter } from "../core/types";
import type { PhysicsInput } from "../vendor/purupuru/core/types";

export interface ScrollAdapterOptions {
  readScrollY?: () => number;
  gain?: number;
  smoothingSeconds?: number;
  maxAcceleration?: number;
}

/** gain과 smoothingSeconds는 눈으로 맞추는 값이라 런타임 가변이어야 한다. */
export type ScrollAdapter = InputAdapter & { gain: number; smoothingSeconds: number };

export function createScrollAdapter(options: ScrollAdapterOptions = {}): ScrollAdapter {
  const readScrollY = options.readScrollY ?? (() => window.scrollY);
  const maxAcceleration = options.maxAcceleration ?? 8;
  let previousY: number | null = null, velocity = 0, acceleration = 0;

  const reset = (): void => { previousY = null; velocity = 0; acceleration = 0; };
  const clamp = (v: number): number =>
    Number.isFinite(v) ? Math.max(-maxAcceleration, Math.min(maxAcceleration, v)) : 0;

  const adapter: ScrollAdapter = {
    id: "scroll",
    enabled: true,
    gain: options.gain ?? 0.0015,
    smoothingSeconds: options.smoothingSeconds ?? 0.04,
    attach: reset,
    detach: reset,
    sample(dtSeconds: number): PhysicsInput {
      if (!adapter.enabled) return {};
      // dt가 비정상이면 상태를 굴리지 않고 직전 값을 낸다.
      if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
        return { localAcceleration: { x: 0, y: clamp(acceleration * adapter.gain) } };
      }
      const y = readScrollY();
      if (previousY === null || !Number.isFinite(y)) {
        previousY = Number.isFinite(y) ? y : 0;
        return { localAcceleration: { x: 0, y: 0 } };
      }
      const rawVelocity = (y - previousY) / dtSeconds;
      previousY = y;
      const smoothing = 1 - Math.exp(-dtSeconds / Math.max(1e-4, adapter.smoothingSeconds));
      const nextVelocity = velocity + (rawVelocity - velocity) * smoothing;
      const rawAcceleration = (nextVelocity - velocity) / dtSeconds;
      velocity = nextVelocity;
      acceleration += (rawAcceleration - acceleration) * smoothing;
      return { localAcceleration: { x: 0, y: clamp(acceleration * adapter.gain) } };
    },
  };
  return adapter;
}
```

- [ ] **Step 7: 통과 확인 + 커밋** (15개 PASS)

```bash
npx vitest run tests/input-scroll.test.ts tests/input-combine.test.ts
npx tsc -b --pretty false
git add src/input tests/input-*.test.ts
git commit -m "feat: input adapter contract, scroll inertia adapter, combiner"
```

---

## Task 4: 프로젝트 파일 포맷

**Wave 1 — T2·T3·T5·T6과 병렬.**

**Files:** Create `src/project/{schema,io}.ts`; Test `tests/project.test.ts`

**Produces:**
- `schema.ts`: `parseProject(value: unknown): JiggleProject`, `class ProjectParseError extends Error { readonly path: string }`, `MAX_STROKES = 2000`, `MAX_POINTS_PER_STROKE = 5000`
- `io.ts`: `serializeProject`, `deserializeProject`, `createProject(source, crop): JiggleProject`

- [ ] **Step 1: 실패 테스트**

`tests/project.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseProject, ProjectParseError, MAX_STROKES } from "../src/project/schema";
import { serializeProject, deserializeProject, createProject } from "../src/project/io";

const valid = createProject(
  { src: "cut-003.png", width: 1280, height: 5120 },
  { x: 340, y: 1820, width: 494, height: 394 },
);

describe("parseProject", () => {
  const rejects = (patch: object, path: string) => {
    try { parseProject({ ...valid, ...patch }); expect.unreachable("should throw"); }
    catch (e) { expect(e).toBeInstanceOf(ProjectParseError); expect((e as ProjectParseError).path).toBe(path); }
  };

  it("accepts a round-tripped project", () => {
    expect(() => parseProject(JSON.parse(JSON.stringify(valid)))).not.toThrow();
  });
  it("rejects a wrong format tag", () => rejects({ format: "nope" }, "format"));
  it("rejects an unknown version", () => rejects({ version: 99 }, "version"));
  it("rejects non-positive source dimensions", () => rejects({ source: { ...valid.source, width: 0 } }, "source.width"));
  it("rejects a crop outside the source", () => rejects({ crop: { x: 1200, y: 0, width: 500, height: 100 } }, "crop"));
  it("rejects a non-integral crop", () => rejects({ crop: { ...valid.crop, x: 3.5 } }, "crop.x"));
  it("rejects a motion value outside 0..100", () => rejects({ motion: { ...valid.motion, stretch: 140 } }, "motion.stretch"));
  it("rejects NaN in a motion value", () => rejects({ motion: { ...valid.motion, bounce: Number.NaN } }, "motion.bounce"));
  it("rejects an unknown gravity direction", () => rejects({ motion: { ...valid.motion, gravityDirection: "sideways" } }, "motion.gravityDirection"));
  it("rejects a stroke count above the cap", () => {
    const strokes = Array.from({ length: MAX_STROKES + 1 }, (_u, i) =>
      ({ id: i, mode: "paint", size: 0.1, points: [{ x: 0.5, y: 0.5 }] }));
    rejects({ region: { ...valid.region, strokes } }, "region.strokes");
  });
  it("rejects a stroke with no points", () =>
    rejects({ region: { ...valid.region, strokes: [{ id: 1, mode: "paint", size: 0.1, points: [] }] } }, "region.strokes[0].points"));
  it("rejects a stroke point outside the unit square", () =>
    rejects({ region: { ...valid.region, strokes: [{ id: 1, mode: "paint", size: 0.1, points: [{ x: 3, y: 0.5 }] }] } }, "region.strokes[0].points[0].x"));
  it("rejects a non-object", () => {
    expect(() => parseProject(null)).toThrow(ProjectParseError);
    expect(() => parseProject("nope")).toThrow(ProjectParseError);
  });
});

describe("round trip", () => {
  it("survives serialize then deserialize unchanged", () => {
    const p = createProject({ src: "a.png", width: 800, height: 1200 }, { x: 10, y: 20, width: 300, height: 240 });
    p.region.strokes.push({ id: 1, mode: "paint", size: 0.2, strength: 0.7, operation: "add", points: [{ x: 0.4, y: 0.4 }, { x: 0.45, y: 0.5 }] });
    expect(deserializeProject(serializeProject(p))).toEqual(p);
  });
  it("throws ProjectParseError on malformed JSON", () =>
    expect(() => deserializeProject("{ not json")).toThrow(ProjectParseError));
});

describe("createProject", () => {
  it("uses the purupuru preset with fluctuation", () => {
    expect(valid.motion.fluctuation).toBe(5);
    expect(valid.motion).not.toHaveProperty("variation");
  });
  it("starts with an empty region", () => expect(valid.region.strokes).toEqual([]));
});
```

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: `src/project/schema.ts`**

`Rect`(정수, source 안), `RegionSnapshot`(스트로크 상한, 점 상한, UV [0,1]), `MotionParameters`(7개 퍼센트 필드 0~100, `gravityDirection` 열거, `gravityStrength` 0~2), `seed`(0..0xffffffff)를 검증한다. 실패 시 `ProjectParseError(path, message)`. 모든 검증 실패 경로에 정확한 `path`를 붙일 것 — 테스트가 `path`를 직접 비교한다.

구조:
```ts
export const MAX_STROKES = 2000;
export const MAX_POINTS_PER_STROKE = 5000;

export class ProjectParseError extends Error {
  public constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ProjectParseError";
  }
}

const PERCENT_FIELDS = ["inputStrength","stretch","bounce","damping","cohesion","fluctuation","maxStretch"] as const;
const GRAVITY_DIRECTIONS = ["none","down","up","left","right"] as const;

function requireObject(value: unknown, path: string): Record<string, unknown> { /* ... */ }
function requireNumber(value: unknown, path: string, min: number, max: number): number { /* ... */ }
function requireInteger(value: unknown, path: string, min: number, max: number): number { /* ... */ }
function parseRect(value: unknown, path: string, bounds: { width: number; height: number }): Rect { /* 정수 + bounds 안 */ }
function parseMotion(value: unknown): MotionParameters { /* ... */ }
function parseRegion(value: unknown): RegionSnapshot { /* ... */ }
export function parseProject(value: unknown): JiggleProject { /* ... */ }
```

`crop`이 `source` 밖으로 나가면 `path = "crop"`, 비정수면 `path = "crop.x"` 등.

- [ ] **Step 4: `src/project/io.ts`**

```ts
import type { JiggleProject, Rect } from "../core/types";
import { MOTION_PRESETS } from "../vendor/purupuru/core/parameters";
import { parseProject, ProjectParseError } from "./schema";

export function createProject(
  source: { src: string; width: number; height: number },
  crop: Rect,
): JiggleProject {
  return {
    format: "jiggle-project", version: 1,
    source: { ...source }, crop: { ...crop },
    region: { baseFill: 0, inverted: false, strokes: [] },
    motion: { ...MOTION_PRESETS.purupuru },
    seed: 1,
  };
}

export const serializeProject = (project: JiggleProject): string => JSON.stringify(project, null, 2);

export function deserializeProject(json: string): JiggleProject {
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch (error) { throw new ProjectParseError("$", `malformed JSON: ${(error as Error).message}`); }
  return parseProject(raw);
}
```

**마이그레이션 메모**: `version`은 지금 1만 허용. 2가 생기면 `parseProject` 진입부에서 `migrateV1ToV2`를 태우고 이어서 검증한다. 미리 만들지 않는다.

- [ ] **Step 5: 통과 확인 + 커밋** (17개 PASS)

---

## Task 5: 솔버 품질 + 벤치

**Wave 1 — T2·T3·T4·T6과 병렬.**

**Files:** Create `src/core/quality.ts`, `src/bench/solver.bench.test.ts`, `src/bench/README.md`; Test `tests/quality.test.ts`

**Produces:** `SOLVER_QUALITY`, `QUALITY_TIERS: Record<QualityTierId, SolverQuality>`, `qualityForTier`, `degradeTier`, `DEFAULT_QUALITY_TIER`, `class QualityGovernor`

- [ ] **Step 1: 실패 테스트**

`tests/quality.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { QUALITY_TIERS, qualityForTier, degradeTier, DEFAULT_QUALITY_TIER, QualityGovernor } from "../src/core/quality";

describe("quality tiers", () => {
  it("defaults to 60 Hz, not the vendor's 120", () => {
    expect(qualityForTier(DEFAULT_QUALITY_TIER).tickRate).toBe(60);
  });
  it("keeps the catch-up cliff at or above 66 ms in every tier", () => {
    for (const q of Object.values(QUALITY_TIERS)) {
      expect(q.maxCatchUpSteps / q.tickRate).toBeGreaterThanOrEqual(0.066);
    }
  });
  it("only uses values the vendor SolverQuality type allows", () => {
    for (const q of Object.values(QUALITY_TIERS)) {
      expect([60, 120]).toContain(q.tickRate);
      expect([3, 4, 6]).toContain(q.iterations);
    }
  });
  it("orders tiers by descending cost", () => {
    const cost = (id: "high"|"medium"|"low") => QUALITY_TIERS[id].tickRate * QUALITY_TIERS[id].iterations;
    expect(cost("high")).toBeGreaterThan(cost("medium"));
    expect(cost("medium")).toBeGreaterThanOrEqual(cost("low"));
  });
  it("degrades downward and stops at low", () => {
    expect(degradeTier("high")).toBe("medium");
    expect(degradeTier("medium")).toBe("low");
    expect(degradeTier("low")).toBe("low");
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
```

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: `src/core/quality.ts`**

```ts
import type { QualityTierId } from "./types";
import type { SolverQuality } from "../vendor/purupuru/core/types";

/**
 * tickRate 60은 어떤 격자 변경보다 가치가 크다 — 스펙 §4.3.
 * advance()는 maxCatchUpSteps회만 돌고 초과분을 버린다. 절벽 = mcs / tickRate.
 * 120Hz/4 = 33.3ms 이므로 독자 기기가 30fps로 떨어지면 매 프레임 clamp되어
 * 물리가 조용히 슬로모션이 된다. 60Hz/4 = 66.7ms 이고 비용도 1.93배 싸다.
 */
export const QUALITY_TIERS: Record<QualityTierId, SolverQuality> = {
  high:   { tickRate: 60, iterations: 4, maxCatchUpSteps: 4 },
  medium: { tickRate: 60, iterations: 3, maxCatchUpSteps: 4 },
  low:    { tickRate: 60, iterations: 3, maxCatchUpSteps: 8 },
};

export const DEFAULT_QUALITY_TIER: QualityTierId = "high";
export const SOLVER_QUALITY: SolverQuality = QUALITY_TIERS.high;

export const qualityForTier = (id: QualityTierId): SolverQuality => ({ ...QUALITY_TIERS[id] });

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
```

- [ ] **Step 4: 벤치 하네스 `src/bench/solver.bench.test.ts`**

`gridForImage`로 실제 크롭 크기(400×400, 640×800, 900×1800)의 메시를 만들고, 칠한 면적 2% / 10% / 30%에 대해 `step()` 소요를 600회 평균으로 측정. 티어 3종 전부. 출력은 `console.log` 표. `tickRate`가 60이므로 60fps 프레임당 1스텝, 활성 2개면 2스텝임을 표에 명시.

`src/bench/README.md`에 목표(활성 2개 합계 ≤ 0.8 ms/frame on Apple Silicon, 중급폰 5배 가정)와 "이 숫자를 그대로 결론으로 쓰지 말 것"을 적는다.

- [ ] **Step 5: 실행 + 커밋**

```bash
npx vitest run tests/quality.test.ts    # 8개 PASS
npm run bench                            # 표 출력
npx tsc -b --pretty false
git add src/core/quality.ts src/bench tests/quality.test.ts
git commit -m "feat: solver quality tiers at 60 Hz with a self-measuring governor"
```

---

## Task 6: 활성 컷 선택기

**Wave 1 — T2·T3·T4·T5와 병렬.** 완전히 순수한 모듈, 의존성 없음.

**Files:** Create `src/viewer/scheduler.ts`; Test `tests/viewer-scheduler.test.ts`

**Produces:** `interface SchedulerEntry { id: string; centerY: number; intersecting: boolean }`, `selectActive(entries, viewportCenterY, limit): string[]`

- [ ] **Step 1: 실패 테스트**

`tests/viewer-scheduler.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { selectActive, type SchedulerEntry } from "../src/viewer/scheduler";

const e = (id: string, centerY: number, intersecting = true): SchedulerEntry => ({ id, centerY, intersecting });

describe("selectActive", () => {
  it("returns nothing when the limit is zero", () => expect(selectActive([e("a", 0)], 0, 0)).toEqual([]));
  it("returns nothing when nothing intersects", () => expect(selectActive([e("a",0,false),e("b",10,false)], 0, 2)).toEqual([]));
  it("ignores non-intersecting entries even when closest", () => expect(selectActive([e("far",500),e("near",0,false)], 0, 2)).toEqual(["far"]));
  it("picks the entries closest to the viewport center", () => expect(selectActive([e("a",1000),e("b",100),e("c",-50),e("d",600)], 0, 2)).toEqual(["c","b"]));
  it("respects the limit", () => expect(selectActive([e("a",0),e("b",1),e("c",2),e("d",3)], 0, 2)).toHaveLength(2));
  it("returns everything when the limit exceeds the count", () => expect(selectActive([e("a",0),e("b",1)], 0, 10)).toEqual(["a","b"]));
  it("breaks ties by id so the result is stable", () => expect(selectActive([e("z",100),e("a",-100)], 0, 1)).toEqual(["a"]));
  it("does not mutate the input", () => {
    const entries = [e("a",1000), e("b",0)];
    const before = entries.map((i) => i.id);
    selectActive(entries, 0, 1);
    expect(entries.map((i) => i.id)).toEqual(before);
  });
  it("treats a non-finite centerY as infinitely far", () => expect(selectActive([e("bad",Number.NaN),e("good",900)], 0, 1)).toEqual(["good"]));
});
```

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: `src/viewer/scheduler.ts`**

```ts
export interface SchedulerEntry {
  id: string;
  /** 뷰포트 좌표계에서의 컷 중심 y. */
  centerY: number;
  intersecting: boolean;
}

/**
 * 뷰포트 중심에 가까운 순으로 최대 limit개.
 * 거리 동점은 id 사전순으로 갈라 결과를 안정화한다 —
 * 매 프레임 결과가 흔들리면 컷이 깜빡이며 켜졌다 꺼진다.
 */
export function selectActive(
  entries: readonly SchedulerEntry[],
  viewportCenterY: number,
  limit: number,
): string[] {
  if (limit <= 0) return [];
  const distance = (entry: SchedulerEntry): number => {
    const value = Math.abs(entry.centerY - viewportCenterY);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };
  return entries
    .filter((entry) => entry.intersecting)
    .slice()
    .sort((l, r) => {
      const delta = distance(l) - distance(r);
      if (delta !== 0) return delta;
      return l.id < r.id ? -1 : l.id > r.id ? 1 : 0;
    })
    .slice(0, limit)
    .map((entry) => entry.id);
}
```

- [ ] **Step 4: 통과 확인 + 커밋** (9개 PASS)

---

## Task 7: 나머지 입력 어댑터

**Wave 2 — T8·T9와 병렬. T3 필요.**

**Files:** Create `src/input/{pointer,devicemotion,auto}.ts`; Test `tests/input-pointer.test.ts`, `tests/input-auto.test.ts`

**벤더 API 확인 먼저**: 구현 전에 `src/vendor/purupuru/motion/motion.ts`에서 `samplePointerDrag`, `sampleAutoMotion`, `processSensorSample`의 **실제 시그니처를 읽고** 맞춘다. 이 계획서의 호출 형태와 다르면 **벤더가 정본이다.** 벤더를 고치지 말고 래퍼를 맞춘다. 벤더에 export를 추가하지 않는다 — 필요한 상수가 없으면 우리 파일에 지역 상수로 복제하고 출처를 주석에 남긴다.

**Produces:**
- `pointer.ts`: `createPointerAdapter(options?): PointerAdapter = InputAdapter & { setPointer(position: MotionVector | null): void }`
- `auto.ts`: `createAutoAdapter(options?): AutoAdapter = InputAdapter & { motion: AutoMotionId; strength: number; periodMs: number }`
- `devicemotion.ts`: `createDeviceMotionAdapter(): DeviceMotionAdapter = InputAdapter & { readonly status: "off"|"active"|"denied"|"unsupported"; requestPermission(): Promise<"granted"|"denied"|"unsupported"> }`

- [ ] **Step 1: 실패 테스트 — pointer**

`tests/input-pointer.test.ts`: id가 `"pointer"`; 위치 설정 전에는 `frameDragging` falsy; `setPointer` 후 `frameDragging === true` 이고 `frameTarget`이 유한; `setPointer(null)` 후 다시 falsy; `enabled = false`면 `{}`; `detach()` 후 재부착하면 상태 초기화. (6개)

- [ ] **Step 2: 실패 테스트 — auto**

`tests/input-auto.test.ts`: id가 `"auto"`; 240프레임 동안 `automaticAcceleration`이 항상 유한; 한 주기 동안 크기 최댓값 > 0; `sway`/`hop`/`orbit` 전부 throw 없음; `strength: 0`이면 크기 ~0; `enabled = false`면 `{}`. (6개)

- [ ] **Step 3: 실패 확인**

- [ ] **Step 4: `src/input/pointer.ts`**

벤더 `samplePointerDrag(origin, current, scale, options?)`를 감싼다. `origin`은 첫 `setPointer`에서 고정, 이후 `current`만 갱신. `frameTravelLimit`은 `POINTER_MAXIMUM_TRAVEL`.

- [ ] **Step 5: `src/input/auto.ts`**

벤더 `sampleAutoMotion`을 감싼다. `elapsedMs`를 자체 누적. `automaticAcceleration`과 함께 `frameTarget`/`frameTravelLimit: AUTO_FRAME_TRAVEL`을 낸다.

- [ ] **Step 6: `src/input/devicemotion.ts`**

**이 파일만 DOM에 의존한다.** 벤더 `processSensorSample`을 감싼다.
- `requestPermission()`은 iOS의 `DeviceMotionEvent.requestPermission`이 있으면 호출, 없으면 바로 리스닝 시작
- 권한 전에는 `attach()`가 아무것도 하지 않는다 (권한 획득이 리스너를 붙인다)
- `screen.orientation?.angle ?? 0`을 `screenAngle`로 넘긴다
- `status !== "active"`면 `sample()`은 `{}`

실기기 없이 의미 있는 단위 테스트를 쓸 수 없다. Task 12의 실기기 확인으로 미룬다.

- [ ] **Step 7: 통과 확인 + 커밋** (12개 PASS)

---

## Task 8: 컷 빌드 + 뷰어 런타임

**Wave 2 — T7·T9와 병렬. T2·T3·T5·T6 필요.**

**Files:** Create `src/core/buildCut.ts`, `src/viewer/rendererPool.ts`, `src/viewer/JiggleViewer.ts`; Test `tests/build-cut.test.ts`, `tests/renderer-pool.test.ts`, `tests/jiggle-viewer.dom.test.ts`

**Produces:**
- `buildCut.ts`: `buildCut(project: JiggleProject): BuiltCut`, `createSimulator(built: BuiltCut, project: JiggleProject, quality: SolverQuality): PhysicsSimulator`
- `rendererPool.ts`: `class ResourcePool<T>` — `constructor(size, factory, disposer)`, `acquire(id): T`, `release(id): void`, `has(id): boolean`, `get activeIds(): string[]`, `dispose(): void`
- `JiggleViewer.ts`: `class JiggleViewer`, `interface ViewerRenderer { setMesh(mesh: MeshData): void; setImage(source: TexImageSource): void; render(options?: { frameOffset?: { x: number; y: number } }): void; dispose(): void }`, `interface JiggleViewerOptions { adapters: InputAdapter[]; activeLimit?: number; reducedMotion?: boolean; createRenderer?: (canvas: HTMLCanvasElement) => ViewerRenderer }`

**캔버스 소유권 (반드시 이대로)**: `SceneRenderer`는 생성자에 넘긴 캔버스에 컨텍스트를 만들고 뗄 수 없다. **캔버스는 컷이 아니라 렌더러가 소유한다.** 풀은 `{ renderer, canvas }` 쌍을 들고, 컷이 활성화되면 그 캔버스를 컷 엘리먼트에 붙이고 비활성화되면 뗀다. 컷 엘리먼트는 자기 캔버스를 갖지 않는다.

- [ ] **Step 1: 실패 테스트 — buildCut**

`tests/build-cut.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildCut, createSimulator } from "../src/core/buildCut";
import { createProject } from "../src/project/io";
import { GRID_K } from "../src/core/grid";
import { SOLVER_QUALITY } from "../src/core/quality";
import type { JiggleProject } from "../src/core/types";

function painted(cropWidth = 494, cropHeight = 394): JiggleProject {
  const project = createProject(
    { src: "a.png", width: 1280, height: 5120 },
    { x: 340, y: 1820, width: cropWidth, height: cropHeight },
  );
  project.region.strokes.push({ id: 1, mode: "paint", size: 0.4, strength: 1, operation: "add", points: [{ x: 0.5, y: 0.5 }] });
  return project;
}

describe("buildCut", () => {
  it("sizes the grid from the crop, short side at GRID_K", () => {
    const { grid, crop } = buildCut(painted());
    expect(crop.width <= crop.height ? grid.columns : grid.rows).toBe(GRID_K);
  });
  it("pins every unpainted vertex", () => {
    const { mesh } = buildCut(painted());
    expect(mesh.inverseMasses[0]).toBe(0);
  });
  it("makes at least one vertex dynamic", () => {
    const { mesh } = buildCut(painted());
    expect(Array.from(mesh.weights).some((w) => w > 0)).toBe(true);
  });
  it("keeps every weight inside 0..1", () => {
    const { mesh } = buildCut(painted());
    for (const w of mesh.weights) expect(w).toBeGreaterThanOrEqual(0), expect(w).toBeLessThanOrEqual(1);
  });
});

describe("createSimulator", () => {
  it("stays finite and un-inverted under hard driving", () => {
    const project = painted();
    const sim = createSimulator(buildCut(project), project, SOLVER_QUALITY);
    for (let i = 0; i < 900; i += 1) sim.step({ localAcceleration: { x: 4, y: 6 } });
    expect(sim.isFinite()).toBe(true);
    expect(sim.hasInvertedTriangles()).toBe(false);
  });
  it("never moves a pinned vertex", () => {
    const project = painted();
    const built = buildCut(project);
    const pinned: number[] = [];
    for (let v = 0; v < built.mesh.weights.length; v += 1) if ((built.mesh.inverseMasses[v] ?? 0) === 0) pinned.push(v);
    expect(pinned.length).toBeGreaterThan(0);
    const sim = createSimulator(built, project, SOLVER_QUALITY);
    for (let i = 0; i < 300; i += 1) sim.step({ localAcceleration: { x: 5, y: 5 } });
    for (const v of pinned) {
      expect(built.mesh.positions[v * 2]).toBe(built.mesh.restPositions[v * 2]);
      expect(built.mesh.positions[v * 2 + 1]).toBe(built.mesh.restPositions[v * 2 + 1]);
    }
  });
  it("is deterministic for the same seed and inputs", () => {
    const run = (): string => {
      const project = painted();
      const sim = createSimulator(buildCut(project), project, SOLVER_QUALITY);
      for (let i = 0; i < 200; i += 1) sim.step({ localAcceleration: { x: Math.sin(i / 7) * 3, y: Math.cos(i / 11) * 3 } });
      return JSON.stringify(sim.createSnapshot());
    };
    expect(run()).toBe(run());
  });
  it("settles back to rest when the input stops and gravity is off", () => {
    const project = painted();
    project.motion = { ...project.motion, gravityDirection: "none", gravityStrength: 0 };
    const built = buildCut(project);
    const sim = createSimulator(built, project, SOLVER_QUALITY);
    for (let i = 0; i < 120; i += 1) sim.step({ localAcceleration: { x: 4, y: 4 } });
    for (let i = 0; i < 1200; i += 1) sim.step({});
    let maximum = 0;
    for (let i = 0; i < built.mesh.positions.length; i += 1) {
      maximum = Math.max(maximum, Math.abs((built.mesh.positions[i] ?? 0) - (built.mesh.restPositions[i] ?? 0)));
    }
    expect(maximum).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 2: `src/core/buildCut.ts`**

```ts
import { createGridMesh } from "../vendor/purupuru/core/mesh";
import { PhysicsSimulator } from "../vendor/purupuru/core/simulator";
import { regionWeightAt } from "../vendor/purupuru/region/model";
import type { SolverQuality } from "../vendor/purupuru/core/types";
import { gridForImage } from "./grid";
import type { BuiltCut, JiggleProject } from "./types";

/**
 * 크롭 이미지 하나가 곧 물리 이미지다.
 * region의 스트로크 좌표는 이미 크롭 기준 UV라 그대로 넘긴다.
 * calculateGridDimensions를 쓰지 않는다 — 스펙 §4.1.
 */
export function buildCut(project: JiggleProject): BuiltCut {
  const { width, height } = project.crop;
  const grid = gridForImage(width, height);
  const mesh = createGridMesh({
    columns: grid.columns,
    rows: grid.rows,
    imageWidth: width,
    imageHeight: height,
    weights: (u, v) => regionWeightAt(project.region, u, v, width, height),
  });
  return { mesh, grid, crop: { ...project.crop } };
}

export function createSimulator(
  built: BuiltCut,
  project: JiggleProject,
  quality: SolverQuality,
): PhysicsSimulator {
  return new PhysicsSimulator({
    mesh: built.mesh,
    parameters: project.motion,
    seed: project.seed,
    quality,
  });
}
```

- [ ] **Step 3: 실패 테스트 — 풀**

`tests/renderer-pool.test.ts`: 최대 `size`개만 생성; 같은 id는 같은 리소스; 고갈 시 **가장 오래 전에 acquire된 보유자를 축출**; 최근 재-acquire된 보유자는 축출 안 됨; release 후 재사용(새로 안 만듦); `activeIds`; `dispose()`가 생성된 것마다 정확히 1회; size ≤ 0이면 `RangeError`; 모르는 id `release`는 무시. (9개)

- [ ] **Step 4: `src/viewer/rendererPool.ts`**

LRU 축출 풀. `free: T[]`, `held: Map<string,T>`, `created: T[]`, `order: string[]`(앞이 오래된 것). `acquire`는 보유 중이면 touch 후 반환, 아니면 여유가 있을 때 factory로 생성, 없으면 `order[0]`을 release 후 재사용.

- [ ] **Step 5: 실패 테스트 — 뷰어**

`tests/jiggle-viewer.dom.test.ts` (파일명의 `.dom.`이 jsdom을 고른다). `IntersectionObserver`와 `matchMedia`를 stub하고 `createRenderer`로 가짜를 주입한다:
- 활성 상한만큼만 활성화 (5개 등록, limit 2 → `activeIds.length === 2`)
- `reducedMotion: true`면 `activeIds === []`
- 틱마다 활성 컷당 정확히 1회 `render`
- 600틱 후 모든 시뮬레이터가 `isFinite()`
- `destroy()`가 모든 렌더러를 `dispose`
- `unregister` 후 추적 중단
- **`render`가 항상 `frameOffset: {x:0, y:0}`으로 호출된다** (크롭 슬래브가 미끄러지면 안 됨)
- **메시 지연 생성**: `register`만 하고 활성화되지 않은 컷은 `buildCut`이 호출되지 않는다

- [ ] **Step 6: `src/viewer/JiggleViewer.ts`**

핵심 요구사항:
- `register(id, element, project, image)`는 **메시를 만들지 않는다.** 프로젝트와 엘리먼트만 등록하고 `IntersectionObserver`에 붙인다
- `tick(elapsed)`에서 활성으로 선택된 컷만 `buildCut` + `createSimulator` (lazy). 비활성화 시 시뮬레이터·메시를 버린다 (639 KB/cut × 150 = 96MB)
- 풀은 `ResourcePool<{ renderer, canvas }>`, 크기 `activeLimit + 1`
- 활성화: 풀에서 빌려 `canvas.width/height = crop.width/height` 설정 → `setImage` → `setMesh` → `element.append(canvas)`
- 비활성화: `element.querySelector("canvas")?.remove()` → 풀 반납 → 시뮬레이터/메시 폐기
- 입력은 활성 어댑터를 `sample()` 해서 `combineInputs`로 합치고 모든 활성 컷에 같은 값을 준다
- `render({ frameOffset: { x: 0, y: 0 } })` — 하드코딩. `simulator.frame.position`을 절대 쓰지 않는다
- `reducedMotion` 기본값은 `matchMedia("(prefers-reduced-motion: reduce)").matches`
- `isFinite()` 헬퍼 (테스트용)

- [ ] **Step 7: 통과 확인 + 커밋**

```bash
npx vitest run tests/build-cut.test.ts tests/renderer-pool.test.ts tests/jiggle-viewer.dom.test.ts
npx tsc -b --pretty false
git add src/core/buildCut.ts src/viewer tests/build-cut.test.ts tests/renderer-pool.test.ts tests/jiggle-viewer.dom.test.ts
git commit -m "feat: cut builder, renderer pool, and lazy viewer runtime"
```

---

## Task 9: 저작 UI 부품

**Wave 2 — T7·T8과 병렬. T2·T4 필요.**

**Files:** Create `src/editor/{brush.ts,MaskCanvas.tsx,CropPreview.tsx,ParameterPanel.tsx}`; Test `tests/editor-brush.test.ts`

**Produces:**
- `brush.ts`: `BRUSH_MIN = 2 / GRID_K`, `BRUSH_MAX = 0.5`, `DEFAULT_BRUSH: BrushSettings`, `interface BrushSettings { size: number; strength: number; mode: "paint"|"erase" }`, `beginStroke(settings, id, point): RegionStroke`, `extendStroke(stroke, point, minimumSpacing?): RegionStroke`, `nextStrokeId(region): number`
- `MaskCanvas.tsx`: `MaskCanvas(props: { image, region, brush, onRegionChange })`
- `CropPreview.tsx`: `CropPreview(props: { image, region })` — bbox와 마진을 오버레이로 표시
- `ParameterPanel.tsx`: `ParameterPanel(props: { motion, onMotionChange })`

- [ ] **Step 1: 실패 테스트**

`tests/editor-brush.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { beginStroke, extendStroke, nextStrokeId, DEFAULT_BRUSH, BRUSH_MIN } from "../src/editor/brush";
import { GRID_K } from "../src/core/grid";
import { regionWeightAt, EMPTY_REGION } from "../src/vendor/purupuru/region/model";
import { createGridMesh } from "../src/vendor/purupuru/core/mesh";
import { gridForImage } from "../src/core/grid";

describe("brush limits", () => {
  it("derives the minimum from GRID_K", () => expect(BRUSH_MIN).toBeCloseTo(2 / GRID_K));

  it("selects at least one vertex at the minimum size", () => {
    // 실측: 하드코딩한 0.02는 정점을 0개 고른다. 최소값은 격자에서 유도해야 한다.
    const stroke = beginStroke({ size: BRUSH_MIN, strength: 1, mode: "paint" }, 1, { x: 0.5, y: 0.5 });
    const region = { ...EMPTY_REGION, strokes: [stroke] };
    const { columns, rows } = gridForImage(600, 800);
    const mesh = createGridMesh({
      columns, rows, imageWidth: 600, imageHeight: 800,
      weights: (u, v) => regionWeightAt(region, u, v, 600, 800),
    });
    expect(Array.from(mesh.weights).filter((w) => w > 0).length).toBeGreaterThan(0);
  });
});

describe("nextStrokeId", () => {
  it("starts at 1", () => expect(nextStrokeId(EMPTY_REGION)).toBe(1));
  it("is one past the highest id", () => {
    expect(nextStrokeId({ ...EMPTY_REGION, strokes: [
      { id: 3, mode: "paint", size: 0.1, points: [{ x: 0, y: 0 }] },
      { id: 7, mode: "paint", size: 0.1, points: [{ x: 0, y: 0 }] },
    ]})).toBe(8);
  });
});

describe("beginStroke", () => {
  it("carries the brush settings", () => {
    const s = beginStroke({ size: 0.2, strength: 0.6, mode: "paint" }, 1, { x: 0.5, y: 0.5 });
    expect(s.points).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(s.size).toBe(0.2);
    expect(s.strength).toBe(0.6);
    expect(s.operation).toBe("add");
  });
  it("uses subtract for erase", () =>
    expect(beginStroke({ size: 0.2, strength: 1, mode: "erase" }, 1, { x: 0.5, y: 0.5 }).operation).toBe("subtract"));
  it("raises the weight under the brush and nowhere else", () => {
    const region = { ...EMPTY_REGION, strokes: [beginStroke({ size: 0.2, strength: 1, mode: "paint" }, 1, { x: 0.5, y: 0.5 })] };
    expect(regionWeightAt(region, 0.5, 0.5, 800, 800)).toBeGreaterThan(0);
    expect(regionWeightAt(region, 0.05, 0.05, 800, 800)).toBe(0);
  });
});

describe("extendStroke", () => {
  it("appends a far-enough point", () =>
    expect(extendStroke(beginStroke(DEFAULT_BRUSH, 1, { x: 0.5, y: 0.5 }), { x: 0.6, y: 0.6 }).points).toHaveLength(2));
  it("drops a too-close point", () =>
    expect(extendStroke(beginStroke(DEFAULT_BRUSH, 1, { x: 0.5, y: 0.5 }), { x: 0.5001, y: 0.5 }).points).toHaveLength(1));
  it("does not mutate the input", () => {
    const s = beginStroke(DEFAULT_BRUSH, 1, { x: 0.5, y: 0.5 });
    extendStroke(s, { x: 0.9, y: 0.9 });
    expect(s.points).toHaveLength(1);
  });
});
```

- [ ] **Step 2: `src/editor/brush.ts`**

```ts
import { GRID_K } from "../core/grid";
import type { RegionSnapshot, RegionStroke } from "../vendor/purupuru/region/model";

export interface BrushSettings { size: number; strength: number; mode: "paint" | "erase"; }

/**
 * regionWeightAt은 격자 정점 위치만 검사한다. 정점을 못 덮는 브러시는 아무것도 안 움직인다.
 * 정점 간격이 짧은 변의 1/K 이므로 지름이 2/K 이면 최악의 정렬에서도 정점을 문다.
 * 실측: 하드코딩한 0.02는 정점을 0개 고른다.
 */
export const BRUSH_MIN = 2 / GRID_K;
export const BRUSH_MAX = 0.5;
export const DEFAULT_BRUSH: BrushSettings = { size: 0.12, strength: 1, mode: "paint" };

/** 점을 촘촘히 쌓으면 regionWeightAt이 느려진다. */
const DEFAULT_MINIMUM_SPACING = 0.004;

export const nextStrokeId = (region: RegionSnapshot): number =>
  region.strokes.reduce((highest, stroke) => Math.max(highest, stroke.id), 0) + 1;

export function beginStroke(settings: BrushSettings, id: number, point: { x: number; y: number }): RegionStroke {
  return {
    id, mode: settings.mode,
    size: Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, settings.size)),
    strength: settings.strength,
    operation: settings.mode === "paint" ? "add" : "subtract",
    points: [{ ...point }],
  };
}

export function extendStroke(
  stroke: RegionStroke,
  point: { x: number; y: number },
  minimumSpacing = DEFAULT_MINIMUM_SPACING,
): RegionStroke {
  const last = stroke.points[stroke.points.length - 1];
  const points = stroke.points.map((item) => ({ ...item }));
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minimumSpacing) return { ...stroke, points };
  return { ...stroke, points: [...points, { ...point }] };
}
```

- [ ] **Step 3: `src/editor/MaskCanvas.tsx`**

Canvas 2D. 이미지를 그리고 그 위에 128×128 저해상도 표본으로 칠한 영역을 반투명 오버레이(분홍). 포인터 이벤트를 크롭 기준 UV로 변환해 `beginStroke`/`extendStroke`. `touchAction: "none"`, `setPointerCapture`. `aria-label` 필수.

- [ ] **Step 4: `src/editor/CropPreview.tsx`**

`maskBoundsPx` → `cropRectForMask` 결과를 이미지 위에 두 개의 테두리로 표시 (마스크 bbox 실선, 크롭 점선). 크롭 크기·pitch·정점 수를 텍스트로 표시해 저작자가 비용을 볼 수 있게 한다.

- [ ] **Step 5: `src/editor/ParameterPanel.tsx`**

`MOTION_PRESETS` 4종 버튼 + 슬라이더 7개(`inputStrength`, `stretch`, `bounce`, `damping`, `cohesion`, `fluctuation`, `maxStretch`, 전부 0~100) + `gravityDirection` select + `gravityStrength` 0~2. 라벨은 한국어(반응 세기 / 늘어남 / 탄성 / 가라앉음 / 뭉침 / 요동 / 최대 늘어남).

- [ ] **Step 6: 통과 확인 + 커밋** (9개 PASS)

---

## Task 10: 저작툴 셸

**Wave 3 — T11과 병렬. T8·T9 필요.**

**Files:** Create `src/editor/{EditorApp.tsx,useImageFile.ts}`; Modify `src/main.tsx`; Test `tests/editor-project.dom.test.tsx`

**핵심 흐름**: 이미지 로드 → 칠하기 → **크롭 자동 계산** → 미리보기에서 물리 실시간 확인 → 파라미터 조절 → 저장.

주의: 저작 중 `region`의 좌표계는 **원본 이미지 UV**지만, 저장 시 **크롭 기준 UV로 변환**해야 한다 (스펙 §4.7). 변환 함수를 `EditorApp` 안에 두고 저장/불러오기 양쪽에서 쓴다.

```ts
// 원본 UV → 크롭 UV
const toCropUv = (p: Point, crop: Rect, imageW: number, imageH: number) => ({
  x: (p.x * imageW - crop.x) / crop.width,
  y: (p.y * imageH - crop.y) / crop.height,
});
```
스트로크 `size`도 같은 비율로 스케일해야 한다: `size * min(imageW, imageH) / min(crop.width, crop.height)`.

- [ ] **Step 1: 실패 테스트** — 저장/불러오기 왕복에서 스트로크·모션·크롭이 보존되고, 좌표 변환이 가역인지 (오차 1e-6). 손상 파일은 `ProjectParseError`.
- [ ] **Step 2: `useImageFile.ts`** — PNG/JPEG/WebP만, 한 변 8000px 이하, 실패 시 한국어 에러 메시지.
- [ ] **Step 3: `EditorApp.tsx`** — 좌: `MaskCanvas` + `CropPreview` 토글, 우: 브러시 / 파라미터 / 프로젝트(저장·불러오기). 칠할 때마다 크롭 재계산.
- [ ] **Step 4: `src/main.tsx`**를 `EditorApp` 렌더로 교체.
- [ ] **Step 5: 빌드 + 수동 확인** — 이미지 로드 → 칠하면 오버레이 → 크롭 사각형이 마스크를 3셀 여유로 감싸는지 눈으로 → 저장 후 재로드 시 복원.
- [ ] **Step 6: 커밋**

---

## Task 11: 뷰어 데모

**Wave 3 — T10과 병렬. T8 필요.**

**Files:** Create `src/demo/{ViewerDemo.tsx,TriggerToggles.tsx,main.tsx}`, `demo.html`; Modify `vite.config.ts` (다중 진입점)

**핵심**: 세로 스크롤 페이지에 원본 슬라이스를 `<img>`로 깔고, 프로젝트가 있는 슬라이스에는 크롭 위치에 절대배치 컨테이너를 둔다. `JiggleViewer`가 그 컨테이너에 풀 캔버스를 붙였다 뗀다.

```tsx
<div style={{ position: "relative" }}>
  <img src={slice.src} style={{ width: "100%", display: "block" }} />
  <div ref={cutRef} style={{
    position: "absolute",
    left:   `${crop.x / source.width * 100}%`,
    top:    `${crop.y / source.height * 100}%`,
    width:  `${crop.width / source.width * 100}%`,
    height: `${crop.height / source.height * 100}%`,
  }} />
</div>
```

`TriggerToggles`: 어댑터 4개 체크박스 + **스크롤 게인/평활 슬라이더** + 센서 권한 버튼 + 상태 표시. 자동 루프는 기본 꺼짐.

`vite.config.ts`에 `rollupOptions.input = { main: index.html, demo: demo.html }`.

- [ ] **Step 1: 진입점 3종 + `vite.config.ts` 수정**
- [ ] **Step 2: `TriggerToggles.tsx`**
- [ ] **Step 3: `ViewerDemo.tsx`** — 프로젝트 JSON + 이미지 파일을 함께 로드. rAF 루프 하나에서 `viewer.tick()`. 포인터 이벤트를 `pointerAdapter.setPointer`로.
- [ ] **Step 4: 빌드 + 수동 확인** — `http://localhost:5173/demo.html`. 스크롤하면 칠한 부분만 출렁이고 **크롭 경계가 안 보이는지** 확인. 토글로 트리거를 끄면 멈춤. 컷 3개 이상에서 화면 중앙 2개만 활성.
  - **크롭 경계가 보이면** `padding: 0`과 `blurredBackdrop: false`가 실제로 들어갔는지 먼저 확인한다 (스펙 §4.5)
  - **크롭이 통째로 미끄러지면** `frameOffset`이 `{0,0}`이 아닌 것이다
- [ ] **Step 5: 커밋**

---

## Task 12: 웹툰 프리셋 + 실측 확정

**Wave 4 — 전부 완료 후 단독.**

**Files:** Create `src/editor/webtoonPresets.ts`, `docs/superpowers/notes/2026-07-25-measurements.md`; Modify `src/editor/ParameterPanel.tsx`; Test `tests/webtoon-presets.test.ts`

- [ ] **Step 1: 벤치 실행 + 기록** — `npm run bench`. 출력과 기계 사양을 노트에 기록.
- [ ] **Step 2: 4배 스로틀링 데모 측정** — Chrome DevTools Performance, CPU 4x. 컷 4개 등록 후 스크롤 녹화. 활성 2개 기준 프레임당 물리 시간, 드롭 프레임, `JiggleViewer.tick` self time.
  **판정**: 4배 스로틀링에서 활성 2개 프레임당 4ms 초과 시 미달.
- [ ] **Step 3: 미달이면 티어 조정** — `QualityGovernor`의 임계값 또는 `QUALITY_TIERS`. **`GRID_K`는 건드리지 않는다** (ABI, 스펙 §4.9).
- [ ] **Step 4: 실기기 DeviceMotion 확인** — iOS 1대, Android 1대. 권한 팝업, 흔들기 반응, 실패 시 상태 표시.
- [ ] **Step 5: 프리셋 테스트 작성**

`tests/webtoon-presets.test.ts`: 4종(`hair`/`cloth`/`chest`/`cheek`) 존재; `fluctuation` 사용(`variation` 아님); 퍼센트 필드 0~100; **900틱 후 `isFinite()` true, `hasInvertedTriangles()` false** (실제 크롭 크기 3종 전부에서); 중력 끈 상태에서 1200틱 후 rest 수렴; **`resolveParameters(preset).tremorStrength <= 0.223`** (실측 상한, 스펙 §9).

- [ ] **Step 6: `src/editor/webtoonPresets.ts`**

원본 프리셋에서 출발한 초기값. 실제 크롭에서 눈으로 맞춘다.

```ts
import type { MotionParameters } from "../vendor/purupuru/core/types";

/**
 * X에서 관찰된 실사용 패턴(머리카락·옷자락·가슴·볼)에서 고름 — 스펙 §2.5.
 * demo.html에서 실제 크롭으로 눈으로 맞춘다. 물리 상수를 재유도하지 않는다.
 * fluctuation은 tremorStrength <= 0.223 을 넘지 않게 유지할 것 (스펙 §9).
 */
export const WEBTOON_PRESETS: Record<"hair"|"cloth"|"chest"|"cheek", MotionParameters> = {
  hair:  { inputStrength: 70, stretch: 85, bounce: 22, damping: 12, cohesion: 20, gravityDirection: "down", gravityStrength: 0.9, fluctuation: 12, maxStretch: 95 },
  cloth: { inputStrength: 62, stretch: 65, bounce: 30, damping: 18, cohesion: 45, gravityDirection: "down", gravityStrength: 1,   fluctuation: 8,  maxStretch: 70 },
  chest: { inputStrength: 82, stretch: 72, bounce: 55, damping: 22, cohesion: 40, gravityDirection: "down", gravityStrength: 1,   fluctuation: 5,  maxStretch: 60 },
  cheek: { inputStrength: 45, stretch: 40, bounce: 70, damping: 35, cohesion: 65, gravityDirection: "down", gravityStrength: 0.6, fluctuation: 15, maxStretch: 30 },
};
```

- [ ] **Step 7: 통과 확인 후 눈으로 튜닝** — 실패하면 `damping`을 올리거나 `stretch`/`fluctuation`을 내린다. 통과 후 `demo.html`에서 실제 크롭으로 확인하고 조정. 조정할 때마다 테스트 재실행.
- [ ] **Step 8: `ParameterPanel`에 웹툰 프리셋 줄 추가** (기존 원본 프리셋 줄은 유지)
- [ ] **Step 9: 전체 검증**

```bash
npx tsc -b --pretty false && npx vitest run && npx vite build
```
**`tests/vendor/` 5개가 여전히 통과해야 한다** — 벤더를 안 건드렸다는 증거.

- [ ] **Step 10: 측정 노트 마무리 + 커밋**

---

## 완료 기준

- `npx vitest run` 전부 통과 (`tests/vendor/` 포함)
- `npx tsc -b` 에러 0, `npx vite build` 성공
- `index.html`: 이미지 로드 → 칠하기 → 크롭 자동 계산 → 파라미터 조절 → 저장 → 재로드 복원
- `demo.html`: 세로 스크롤에 반응, 트리거 4종 개별 토글, **크롭 경계가 보이지 않음**, 활성 컷 상한 동작
- 4배 CPU 스로틀링에서 활성 2개 기준 프레임당 물리 4ms 이내, 또는 미달 사유와 조정 내역이 측정 노트에 기록
- `THIRD_PARTY_NOTICES.md` + `licenses/PURUPURU_MAKER_MIT.txt` 존재, 벤더 파일 전부에 저작권 주석
