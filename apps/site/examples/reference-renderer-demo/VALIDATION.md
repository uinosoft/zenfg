# Reference Renderer v1 validation

Validated on 2026-09-08 with Node.js 24.19.0 and Microsoft Edge
152.0.4191.66 on Windows. Hardware WebGPU reported an NVIDIA Turing adapter.

- Repository typecheck passed; the affected workspaces were checked again after
  the final changes.
- All 424 repository tests passed after separating the workspaces, including
  16 renderer/geometry tests and eight demo host/camera tests. The corrected
  vertical orbit direction is preserved in the demo's camera module.
- `npm run build:pages` and `npm run docs:check` passed after the separation.
  Renderer, demo and Playground workspace typechecks also passed.
- The explicit real WebGPU suite passed all 13 groups with no captured or
  uncaptured WebGPU validation errors. It checks actual indirect counts, image
  equivalence with culling disabled, reflection lighting, empty/capacity frames,
  depth conventions and formats, shared attachments in either recording order,
  read-only depth, linear/sRGB output, color and depth mip/layer views, resize,
  device mismatch, real host snapshots and device-loss cleanup. The suite lives
  in the demo workspace and uses both packages' public entrypoints.
- The Playground was visually checked at 1440 x 960 and 390 x 844, DPR 1.
  Source tabs and the Inspector display the real implementation and captures.
- Final review repeated the full typecheck, 424 tests, Pages build, docs check,
  and 13 hardware GPU groups in the main checkout. The assembled production
  page at `/playground/?example=reference-renderer` loaded all nine source tabs,
  rendered the Inspector graph, and handled orbit, depth/culling controls and
  a mobile viewport without browser runtime errors.

The optional hardware runner is documented in [tests/gpu/README.md](tests/gpu/README.md).
It uses an existing Playwright installation; Playwright is not a renderer or
production dependency. Results are written to the ignored
`.test-dist/reference-renderer-gpu/result.json` file.

These are correctness checks on one browser/GPU combination, not a portability
or performance benchmark. Build output retains the existing large-chunk warnings
from the Inspector dependencies.
