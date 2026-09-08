# Validation record

Validated on 2026-09-08 with Babylon.js 9.4.0.

## Automated checks

- `npm test`: 583 tests passed, including 16 Babylon attachment, graph, host
  lifecycle and failed-engine-initialization cases and the Playground routing
  and source-catalog regression checks.
- `npm run typecheck`: all workspace type checks passed.
- `npm run build:pages`: passed. Vite reports large lazy-loaded chunks, including
  the Babylon bundle; the example does not load until selected.
- `npm run docs:check`: passed (89 local Markdown links checked).

## Hardware WebGPU

Command: `node examples/babylon-interop/tests/gpu/run.mjs`, with
`PLAYWRIGHT_MODULE` pointing to the existing bundled Playwright installation.

- Edge **152.0.4191.66**, NVIDIA **Turing** hardware; no software fallback.
- **11/11** cases passed; **31** pixel comparisons were byte-exact. The
  documented geometric-intersection allowance was not needed.
- **50** external submissions, **zero** scene renders outside graph execution,
  **11/11** successfully created bridges disposed.
- No GPU validation errors, uncaptured GPU errors, browser errors or console
  errors. Forward/reverse first frames and landscape/portrait resize passed.
- Asymmetric upper marker and swapped front/back overlap patches confirmed
  color/depth orientation and both occlusion directions. Known unlit linear
  colors verified a single sRGB encoding.
- Actual host canvas pixels were captured synchronously after graph execution,
  before WebGPU expires the presentation texture. Four depth switches preserved
  the same engine/device, orbit state, viewport and first presented image.
- Cancellation before startup, during startup, after real initialization and
  during active use passed, as did pending-capture disposal and real device loss
  induced by `GPUDevice.destroy()`. Physical adapter removal was not simulated.

Artifacts are in `.test-dist/babylon-interop-gpu`: `result.json`,
`browser-log.json`, PNG readbacks and actual host snapshots. The normal CPU
test runner clears `.test-dist`, so run hardware/browser checks afterwards.

## Built Playground

`node examples/babylon-interop/tests/gpu/playground.mjs` passed against the
assembled Pages preview on the same Edge version. Desktop (1280x800) and narrow
(390x844) screenshots were visually inspected. The Reverse Z checkbox worked,
all seven source files were present, and the resolver source displayed its
actual depth-writing shader. The Inspector captured without diagnostics and
its exported JSON contained `babylon-interop.resolve`.

Four navigations between Babylon, Three.js and Reference Renderer completed
without runtime errors or remote asset requests. The test supplies an empty
root favicon response for the preview; no example resource requests are mocked.
Screenshots, exported Inspector JSON and `playground-result.json` are saved
alongside the hardware artifacts.

## Pointer interaction follow-up

The default Babylon sensitivity (1000 pixels/radian) was too slow with inertia
disabled. It now matches OrbitControls' 2π radians per CSS canvas height on both
axes, recalculated when the viewport changes. Babylon's programmatic pointer
focus could match `:focus-visible`; pointer input now hides only the canvas's
outline, restoring its original style for keyboard input, blur and disposal.

After these changes, the 16 example CPU tests, example typecheck, Pages build
and built Playground acceptance passed. The expanded hardware suite passed
**12/12** cases at both **DPR 1 and DPR 2**, without validation or uncaptured GPU
errors. At 200 CSS pixels high, a 20-pixel drag rotated 0.62831853 radians; at
400 pixels high it rotated 0.31415927 radians. One-event and twenty-event drags
agreed within floating-point precision, each event appeared in the next frame,
batched vertical events accumulated once and release left no inertia or idle
render loop. Real Playwright mouse dragging produced no canvas outline, while
keyboard input restored its focus indicator. See `pointer-dpr1.json`, the latest
`result.json` (DPR 2), and `playground-pointer-focus.png` in the artifact directory.

## Pre-commit review

The complete migration and pointer fixes were reviewed together. The final
`npm test` run passed all 583 tests, the full workspace `npm run typecheck`
passed, and `npm run docs:check` passed. Hardware checks were rerun after the
CPU runner: 12/12 cases passed at both DPR 1 and DPR 2, with 101 external
submissions, zero scene renders outside graph execution and all 12 bridges
disposed per run. The built Playground checks also passed again without
browser errors or remote asset requests.
