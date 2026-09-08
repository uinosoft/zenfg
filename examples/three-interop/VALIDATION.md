# Three.js Co-rendering validation

Validated on 2026-09-08 using Node.js 24.19.0, Microsoft Edge 152.0.4191.66
on Windows, and an NVIDIA Turing hardware WebGPU adapter.

- Full repository typecheck passed.
- `npm run docs:check` passed.
- All 567 repository CPU tests passed, including 21 new example tests for
  graph declarations, output culling, native attachment validation, first-frame
  depth projections, scene data, asynchronous switching and host lifecycle.
- `npm run build:pages` passed. The production build retains large-chunk
  warnings, including the lazily loaded Three.js module and existing Inspector
  dependencies.
- All 11 real WebGPU test groups passed with no GPU validation, uncaptured,
  browser runtime or console errors. Instrumentation observed 50 external
  submissions, zero graph-external renders and 16 of 16 bridges disposed.
- Test fixtures prove both directions of cross-renderer occlusion, including
  swapped placement. Forward/reverse results, repeated first frames, resized
  frames and four host-switch images were byte-identical for these checks.
- The original scene was identical across depth conventions at 128 x 96 and
  96 x 144. At 192 x 112, one pixel at a cylinder/sphere intersection differed
  (105, 56): RGB `[19, 99, 116]` versus `[239, 173, 100]`. Both colors occur in
  the immediate neighboring pixels in the opposite image. This is a localized
  finite-depth precision difference at intersecting geometry, affecting 1 of
  21,504 pixels (0.00465%). The scene comparison permits only narrowly bounded
  intersection differences; fixtures and host switches retain strict checks.
- Real-device lifecycle checks cover abort before adapter resolution, abort
  after bridge initialization, active abort, disposal during replacement,
  pending captures and actual `GPUDevice.destroy()` loss notification. The
  borrowed device remains usable after a bridge is destroyed.
- The assembled production Playground was visually checked at 1440 x 960
  and 390 x 844. Reverse Z toggling, six actual source tabs and an Inspector
  capture with zero errors and warnings worked. Procedural geometry fits both
  viewports. The browser's unrelated default favicon request returns 404.

The optional [GPU runner](tests/gpu/README.md) saves quantitative results,
readback PNGs and actual snapshots under `.test-dist/three-interop-gpu/`.
These ignored artifacts can be regenerated; no production readback API or
browser automation dependency is added. Coverage is one hardware/browser
combination, not a portability or performance benchmark.
