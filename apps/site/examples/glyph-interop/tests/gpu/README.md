# Hardware and production validation

Run from the repository root:

    node apps/site/examples/glyph-interop/tests/gpu/run.mjs
    npm run build:pages
    node apps/site/examples/glyph-interop/tests/gpu/production.mjs --local-only

The first command starts a temporary Vite server and uses installed Edge on
Windows through Playwright. GPU_TEST_BROWSER can select another installed
browser. It checks actual pixel readbacks for Bitmap/MSDF/Slug, front mesh
occlusion, rear mesh visibility through an O counter, borrowed-device lifetime,
retained shaping, effects, missing/empty text, portrait resize, captures, startup
abort, remount and disposal. The actual catalog and Inspector also render. The suite then navigates between Glyph
and Slime Mold to check development dependency optimization and live FPS.

The production command uses the /zenfg/ build, verifies font/WASM URL loading,
the shipped font license, all three raster choices, source display, mobile
layout, DPR 2 and existing Three.js / Slime Mold first frames. --local-only
explicitly skips the network-dependent Monocular browser regression; omit it
to include that regression.

For environments where browser downloads are restricted, GPU_TEST_MONOCULAR_ASSETS
may name a directory containing model.depthart and demo.jpg downloaded from the
exact pinned URLs listed in production.mjs. The test substitutes only HTTP
transport and records SHA-256 and byte size; parsing, inference and rendering
still run through the production implementation. Never supply partial downloads.

Reports and screenshots are saved under .test-dist/glyph-interop-gpu.
The temporary Vite server has its own cache under the test output directory so it
cannot replace dependency chunks used by an open Site development session.
Duplicate TypeGPU runtime warnings fail the GPU suite.
Do not run the repository unit runner concurrently: it clears .test-dist.

## Observations, 2026-09-19

- Edge 153.0.4234.32, NVIDIA Turing hardware: eight GPU case groups passed,
  zero WebGPU validation errors or browser errors.
- Production local checks passed, including the actual Inspector graph and DPR 2.
- Three.js 0.185.0's existing hardware integration suite passed.
- All 723 repository tests, full typecheck, docs:check, Pages build and the
  font bake --check passed.
- The Monocular production regression reached its external download phase but
  did not reach a first frame within 120 seconds. A separate download of the
  same pinned model also stalled and was cancelled. Its TypeGPU unit/host tests
  passed; real inference after the dependency upgrade remains unverified here.
