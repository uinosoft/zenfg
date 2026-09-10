# Three.js Co-rendering

A procedural showcase of Three.js and the Reference Renderer drawing into the
same color and depth attachments, coordinated by ZenFG. Cyan rings and columns
belong to Three.js; orange cubes and spheres, and the neutral platform, belong
to the Reference Renderer. They occlude one another in a single shared scene.

Run `npm run dev:playground` and select **Three.js Co-rendering**, or use
`?example=three-interop`. Drag to orbit and scroll to zoom. **Reverse Z** starts
enabled; switching it preserves the camera pose and should preserve the image.
Color and depth sharing are always enabled. There are no remote assets.

## Follow the graph

```text
Three.js external submission ── shared color + depth ── Reference Draw ── Present
                                                       ↑
                                             Reference Reset → Cull
```

`src/graph.ts` contains the composition. The host imports each native texture
once per recording and gives both renderers the same logical handles. Three.js
clears and writes the attachments; the Reference Renderer loads and continues
them. A final Present node reads linear color, encodes sRGB exactly once, and
roots the graph through `markPresent`. No extra side-effect roots are needed.

The host owns one GPUDevice, its canvas, FrameGraph and Reference Renderer.
Three.js borrows that device and owns a single-sampled `rgba16float` color target
and `depth32float` depth texture. `initRenderTarget()` allocates these textures
at startup and resize without rendering outside the graph. The Reference
Renderer neither submits nor destroys borrowed attachments.

The external callback calls initialized Three.js `render()` synchronously.
All external work must be enqueued on the same queue before that callback
returns. The boundary orders submissions; it is not a GPU-completion fence.
Three.js internal passes remain opaque in the Inspector, including their timing.

## Version and depth contracts

`three` and `@types/three` are pinned to **0.184.0**. The only native texture
lookup is isolated in `src/bridge.ts`, using `renderer.backend.get(texture)`.
It verifies the WebGPU backend and shared device, and validates the exposed
texture formats, dimensions, sampling and required usage. This is a
version-coupled example adapter, not a stable Three.js extension API. Re-run
the real GPU suite when upgrading Three.js. WebGL fallback cannot participate.

Both renderers use the same view and zero-to-one projection. The first frame's
reverse projection is generated explicitly with public matrix APIs before
Three.js initializes its camera convention. No private camera state is written.
Three's public clear depth remains 1: its reverse backend converts that to 0.
The Reference Renderer uses the corresponding `depthConvention` and loads the
existing depth. Three tone mapping is disabled and its target stays linear.

In r184, depth comparison depends on renderer construction parameters and the
camera's reverse state is not reset automatically by changing an option.
Switching therefore rebuilds Three.js renderer, scene, camera and attachments
on the existing device. The host pauses rendering, retains the orbit pose,
settles pending captures and reconnects controls to the new camera. The
Reference Renderer and FrameGraph remain alive. Switching failures stop and
clean up the demo; no half-switched frame is rendered.

## Host interface and ownership

Import `startThreeInterop` from `@zenfg-example/three-interop`, passing a canvas
and optional `signal`, `onReady` and `onError` callbacks. Startup resolves a
controller, or `undefined` on cancellation/failure (reported through `onError`
unless cancelled). The controller provides:

- `getSettings()` returns `{ reverseZ }` for the active renderer.
- `await setSettings({ reverseZ })` rebuilds when the convention changes.
  Await completion before another change; concurrent changes are rejected.
- `captureSnapshot()` requests the next actual frame, even when idle. Duplicate
  pending requests share a promise. Hidden, switching or disposed hosts resolve
  `undefined`; suspension and disposal also settle pending requests.
- `dispose()` idempotently removes controls/listeners and releases owned GPU
  resources, including the host device. A late initialization result is cleaned
  up when it arrives after cancellation.

Rendering follows `requestAnimationFrame` continuously while visible, including
when the camera is idle. Page visibility and device loss are handled by the
host. Playground owns controls, source tabs and Inspector presentation; the
example does not import Playground or the basic Reference Renderer demo.

## Validation

```sh
npm test --workspace @zenfg-example/three-interop
npm run typecheck
npm run build:pages
npm run docs:check
```

CPU tests exercise graph declarations, depth projections, attachment contracts
and host lifecycle. The optional [hardware WebGPU suite](tests/gpu/README.md)
checks real pixels, first frames, resize, depth switching and ownership. See
[validation results](VALIDATION.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
