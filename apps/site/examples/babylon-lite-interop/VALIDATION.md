# Validation record

Validated September 8, 2026 on Windows, Edge **152.0.4191.66**, NVIDIA Turing
hardware WebGPU (`isFallbackAdapter: false`). Dependency: `@babylonjs/lite@1.28.0`.

## Repository checks

- `npm test`: **15 passed** (including the rotation regression below).
- `npm test`: **598 passed**, no failures or skipped tests.
- `npm run typecheck`: passed for the workspace and examples.
- `npm run build:pages`: passed. Existing large-chunk guidance from Vite remains;
  this is not a build failure.
- `npm run docs:check`: passed.
- `git diff --check`: passed.

CPU tests cover native attachment rejection, shared logical resources, retained
depth writes, dependency pruning, synchronous external execution, borrowed-device
ownership, demand rendering, coalesced snapshots, hidden state, cancellation,
device loss, submission failure, camera limits, projection reflection and resize.

### Rotation follow-up

All three examples use radians. Lite's XYZ Euler composition applied the torus's
0.3 radian yaw before its initial plane correction, leaving the ring normal without
the intended yaw. Explicit `qY * qX` composition now matches Babylon's yaw-pitch-roll
and Three's XY torus after reflecting Lite's Z axis. The actual Lite world-matrix
regression failed before the fix and passes afterward; cylinder axes and positions
also match the canonical scene. The 15 Lite CPU tests, Lite typecheck, pages build,
13 hardware cases at each of DPR 1 and DPR 2, and Playground browser checks were
rerun successfully. Final review also reran all 598 workspace tests, workspace
typechecking and documentation checks successfully.

## Hardware rendering

Lite's hardware runner passed **13/13 cases at DPR 1** and **13/13 at DPR 2**:

- First/repeated frame equivalence for the procedural showcase and two exchanged
  front/back occlusion fixtures, at 128×96, 192×112 and 96×144.
- Both renderers win depth tests in the same frame. An upper-only marker verifies
  orientation. Known unlit colors and the background validate gamma decoding and
  final sRGB encoding within one byte.
- All nine first/repeated comparisons have **zero changed channels** at both DPRs.
- Native color and depth are replaced on resize; the graph does not own either.
- Borrowed devices continue to execute after Reference Renderer and graph cleanup;
  Lite engine disposal destroys the device.
- Native orbit/zoom input, per-frame camera response, CSS-height-scaled drag at
  200/400 px with 1/20 events, batched vertical input, no inertial drift, disabled
  right-button panning, cancelled/lost pointer capture and canvas style cleanup.
- Snapshots from actual host frames, idle scheduling and resize; pre-abort,
  startup-abort, abort during real scene preparation, abort after initialization,
  active abort, pending-capture disposal and actual device loss.

Native frame encoder counts equal external submission counts: **81/81 at DPR 1**
and **83/83 at DPR 2**, with **zero outside-graph renders**. Host frame counts can
vary with ResizeObserver scheduling. Each run returns nine ready bridges and
disposes all of them, plus one partially prepared bridge cancelled before return.
No GPU validation errors, uncaptured errors, browser console errors or page errors
were observed.

Artifacts under `.test-dist/babylon-lite-interop-gpu/`:

- `dpr1-result.json`, `dpr2-result.json`: results, comparisons and instrumentation.
- `occlusion-*.png`, `swapped-*.png`, `demo-*.png`: real GPU readbacks.
- `host-*.snapshot.json`, `lifecycle-*.snapshot.json`: actual ZenFG snapshots.
- `browser-log.json`: native browser log from the latest hardware run.

These are generated local artifacts, not tracked fixtures. The workspace test
runner may clean `.test-dist`; run hardware acceptance after workspace tests.

## Playground and regressions

Built Playground acceptance passed: real mouse drag changes pixels, pointer
outline suppression and keyboard style restoration, fixed Reverse Z description
without settings inputs, seven real source tabs, Inspector JSON export, 390×844
mobile layout and switching through Three.js, Babylon.js, Reference Renderer and
Babylon Lite. There were **zero remote requests and zero browser errors**.

Desktop, pointer-drag, mobile and Inspector screenshots were inspected visually.
The initial composition and renderer legend are visible at both viewport sizes;
the Inspector shows the actual external submission and color linearization node.

Artifacts: `playground-result.json`, `playground-inspector.snapshot.json`,
`playground-desktop.png`, `playground-pointer-focus.png`, `playground-mobile.png`,
and `playground-inspector.png` in the same output directory.

The unchanged Three.js hardware suite passed **11/11** and Babylon.js passed
**12/12**, both at DPR 1, including their forward/reverse depth modes. Their results
remain in `.test-dist/three-interop-gpu/` and `.test-dist/babylon-interop-gpu/`.

## Supported boundary

This example demonstrates static opaque geometry with Lite's native reverse
depth. It does not promise HDR preservation past Lite PBR's internal clamp,
forward-depth support, cross-device sharing, automatic device recovery, or
compatibility of private attachment fields with another Lite version. Re-run
the hardware suite when upgrading the dependency.
