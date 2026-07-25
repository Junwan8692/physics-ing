# Third Party Notices

This project bundles third-party code. Each entry below lists the source, the exact
revision used, the license, and every change we made.

---

## purupuru-maker (ぷるぷるメーカー)

- **Source:** https://github.com/grmchn/purupuru-maker
- **Revision:** `a1202d1003f3e83654a3940979540f980ec707c2` (shallow clone, 2026-07-25)
- **Copyright:** Copyright (c) 2026 Puru-Puru Maker contributors
- **License:** MIT — full text in [`licenses/PURUPURU_MAKER_MIT.txt`](licenses/PURUPURU_MAKER_MIT.txt)
- **Location in this repo:** `src/vendor/purupuru/**` (engine) and `tests/vendor/**` (its own tests,
  kept as our regression baseline)

### What we vendored

| Upstream path | Vendored path |
|---|---|
| `src/engine/core/*.ts` (10 files) | `src/vendor/purupuru/core/` |
| `src/engine/render/SceneRenderer.ts`, `index.ts` | `src/vendor/purupuru/render/` |
| `src/engine/coordinates/*.ts` (3 files) | `src/vendor/purupuru/coordinates/` |
| `src/features/region-editor/model.ts` | `src/vendor/purupuru/region/model.ts` |
| `src/features/region-editor/pointerGestures.ts` | `src/vendor/purupuru/region/pointerGestures.ts` |
| `src/features/play-controls/motion.ts` | `src/vendor/purupuru/motion/motion.ts` |
| `src/features/play-controls/useDeviceMotion.ts` | `src/vendor/purupuru/motion/useDeviceMotion.ts` |
| `src/features/play-controls/types.ts` | `src/vendor/purupuru/motion/types.ts` |
| `tests/{physics,region-model,region-weights,coordinates,motion}.test.ts` | `tests/vendor/` |
| `LICENSE` | `licenses/PURUPURU_MAKER_MIT.txt` |

Not vendored: `src/engine/export/**`, `src/features/recording/**`, `src/workers/**`,
`src/i18n/**`, `src/app/**`, `src/features/image-input/**`,
`src/features/play-controls/presets.ts`, and everything Playwright-related.
Upstream's `mediabunny` (MPL-2.0) and `gifenc` dependencies are export-only and are
therefore not present here.

### Changes we made

**Engine sources (`src/vendor/purupuru/**`) — no logic changes.**

1. An MIT attribution header was prepended to every `.ts` file.
2. `motion/types.ts`: removed the duplicate `MotionParameters`, `GravityDirection`,
   `PresetId` and `CurrentPresetId` declarations. Upstream declares `MotionParameters`
   twice with a differing field (`fluctuation` in `engine/core/types.ts` vs `variation`
   in `features/play-controls/types.ts`); we keep `engine/core/types.ts` as the single
   source of truth. Only `AutoMotionId`, `MotionVector` and `PointerDragOptions` remain.
3. No import path in any engine source needed rewriting — the vendored directory layout
   preserves every relative import as-is.

**Tests (`tests/vendor/**`).**

1. Import paths rewritten to point at `src/vendor/purupuru/…`.
   `../src/features/play-controls/regionWeights` was a pure re-export barrel upstream and
   now resolves directly to `src/vendor/purupuru/region/model`.
2. An explicit `import { describe, expect, it } from "vitest";` was added to each file.
   Upstream relies on `globals: true`; this project does not enable it.
3. `motion.test.ts`: three test cases were deleted because they only exercise
   `play-controls/presets.ts`, which is deliberately not vendored —
   "defines the four retained presets with fixed visible values",
   "falls back legacy preset IDs to current purupuru parameters", and
   "keeps the four UI and engine presets aligned". The reason is recorded in the file header.

---

## React / React DOM

- **Source:** https://github.com/facebook/react
- **Version:** 19.2.7 (npm dependency, not vendored)
- **License:** MIT — see `node_modules/react/LICENSE`

React is the only runtime dependency of this project besides the vendored engine, and it
is used by the authoring UI only.
