# Hardware validation

Run run.mjs from any directory with an installed Chromium browser supporting
WebGPU (Windows defaults to Edge; GPU_TEST_BROWSER can select an executable).
It bundles the actual source and local image, reads GPU pixels, and tests:

- current-frame Pixi submissions and sRGB/BGRA roundtrip;
- front/back sphere depth against the screen;
- DPR 1 / 1.25 / 2, narrow framing and persistent target ownership;
- trusted pointer orbit, wheel, pause/reset, blur and pointer cancellation;
- snapshots, visibility, startup abort, device loss and repeated disposal.

production.mjs serves the built site under /zenfg/ and checks Examples, Inspector,
source reading, controls, exact paused pixels, navigation/remount and DPR 2.

Artifacts are written to .test-dist/pixi-surface-gpu/. Run after npm test, which
cleans .test-dist. Tests retain Pixi's known teardown BindGroup warnings rather
than suppressing them; validation, uncaptured errors and page/console errors fail.
