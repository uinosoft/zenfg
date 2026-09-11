# Validation observations

Validated on Windows on 2026-09-07 using the Codex in-app browser, a real WebGPU
device, and the static Pages build at `/playground/`. The browser exposed
`shader-f16`; small and base balanced models both compiled and rendered.

## Browser checks

- Default pinned photo loaded and rendered. Relit, original image, depth, and
  normals views were inspected. Pointer placement and wheel distance controls
  changed the visible light.
- A synthetic PNG selected through the native file chooser became the active
  Upload source and rendered through the GPU path.
- Switched from small to base; download/compilation state was visible and the
  controller returned to `Live · base`. Reloads used cached models. Clearing
  downloads changed the cache indicator to `not cached` without stopping rendering.
- Inspector captured a stable image frame with only
  `monocular-light-injection.relight`, one read, one write, and no side effect
  after the declaration-granularity cleanup.
  Code displayed the real workload, host, shader, model-store, and adapter files.
- After the capture-wait fix, reloaded with Inspector already open using both
  cached models and a cleared model cache. Initial capture automatically showed
  depth + relight; a subsequent capture showed relight alone. Switching to Slime
  Mold and back with Inspector open also captured each example automatically.
  No manual Capture retry or browser console error was needed/observed.
- Resized to 800 × 900: the backing canvas followed the viewport and the image
  remained a centered square with outer bars. Reset the viewport override afterward.
- Camera selection reported `Requested device not found`, retained the previous
  source, and left controls usable. The test machine exposed no usable webcam.
- A transient remote photo fetch failure was visible during development; the
  retry action remained available. Automated tests cover repeatable network failure
  and successful retry without relying on external services.
- No WebGPU validation or shader compilation error was observed. Opening Inspector
  emitted its existing Cytoscape custom-wheel-sensitivity warning.

## Automated coverage and limits

The suite covers first-frame content validity, explicit persistent roots, discarded
frame retries, repeated/stale settlement, atomic model replacement, asynchronous
disposal, download cancellation, image races, camera replacement/failure,
cache fallback, BFCache frame resumption, Snapshot cleanup, and Tweakpane refresh
events not recursively selecting sources.
Delayed host and adapter/Inspector tests cover capture requests spanning model
download/compilation, photo download/decoding, source replacement, and camera
permission/playback. They also cover preparation/submission failure and retry,
obsolete upload/camera failures, and suspension/disposal while waiting. Upload
decoding also excludes concurrent model replacement and releases the old bitmap.
All 397 repository tests passed after the capture-wait fix.

Camera permission denial and successful/front-back camera streams are covered with
test doubles; actual webcam capture and mobile orientation/touch gestures were not
hardware-validated. The no-f16 model selection path is automated, but real f32-only
GPU hardware and the large model were not exercised in the browser.

Repository validation uses `npm run typecheck`, `npm test`, `npm run build:pages`,
and `npm run docs:check`. The Pages build retains the existing large Inspector
dependency chunk warning; the new workload is lazy-loaded.

## Declaration-granularity regression (2026-09-07)

The rebuilt Pages app was checked on the same real WebGPU device:

- Monocular automatically captured depth + relight with exactly four resources:
  backbuffer, surface, stable range, and history. A subsequent stable capture
  contained only backbuffer and surface. Relit and normals rendered correctly;
  moving the light and resizing to 800 × 900 preserved the centered square.
- Slime Mold captured exactly four resources (agents, both trails, backbuffer).
  Changing Move Speed to 80 and resizing to 1100 × 720 continued rendering.
- Interactive Background captured five textures and five passes; pointer
  disturbance and resizing to 800 × 900 continued rendering.
- Inspector remained open across showcase switches. No browser console errors
  were observed. Temporary viewport overrides were reset afterward.

These checks cover the available shader-f16 desktop path. No additional camera,
large-model, mobile hardware, or real f32-only device validation was performed
for this declaration-only change; lifecycle and fallback tests remain in place.
