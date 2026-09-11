# Babylon Lite Co-rendering

A procedural showcase of Babylon Lite and the Reference Renderer sharing one
GPU device and scene. Cyan rings and columns belong to Lite; orange cubes and
spheres, and the neutral platform, belong to the Reference Renderer. They
occlude one another in both directions.

Run `npm run dev` and select **Babylon Lite Co-rendering**, or use
`?example=babylon-lite-interop`. Drag to orbit and scroll to zoom. Reverse Z is
always enabled: Lite 1.28 has no public forward-depth switch. Color and depth
sharing are always enabled. There are no remote assets or configurable effects.

## Follow the graph

```text
Lite external submission → Linearize color → Reference Draw → Present
             └──────── native depth ──────────────┘
                                                ↑
                                      Reference Reset → Cull
```

`src/graph.ts` imports each native attachment once. Lite clears and writes them
inside a synchronous external submission callback. A graph render pass decodes
Lite's gamma-2.2 color into a transient linear color target. Reference Draw loads
this target and Lite's original depth texture. Present applies the sRGB transfer
curve once and roots the chain through `markPresent`. Without an output root,
the entire composition can be culled. Lite's internal graph and timings remain
opaque; the ZenFG Inspector shows one external submission, not invented passes.

The external boundary orders queue submissions, not GPU completion. Exactly one
Lite `renderFrame(engine, 0)` occurs per actual graph execution; initialization,
resize, recording and compilation do not render. Resource uploads during scene
preparation are distinct from rendering a scene.

## Version and adaptation contracts

`@babylonjs/lite` is pinned to **1.28.0**, released September 7, 2026. Registry
metadata and the official release were checked on September 8. The release has
no notable changes from 1.27.0, and identifies source revision
`64710b56f9dfe175d919c635812f84c8872d467c`.

Relevant improvements since the original t3d-next example's 1.10.0 include:

- [1.15.0](https://github.com/BabylonJS/Babylon-Lite/releases/tag/npm-lite-v1.15.0):
  projection changes have their own cache revision.
- [1.16.0](https://github.com/BabylonJS/Babylon-Lite/releases/tag/npm-lite-v1.16.0):
  native orbit controls honor sensitivity changes after attachment.
- [1.20.0](https://github.com/BabylonJS/Babylon-Lite/releases/tag/npm-lite-v1.20.0):
  optional PBR features are opt-in for tree shaking. This scene uses base PBR only.
- [1.27.0](https://github.com/BabylonJS/Babylon-Lite/releases/tag/npm-lite-v1.27.0):
  inline WGSL is minified in published builds; new Inspector Lite introspection
  APIs are available but not needed by this ZenFG showcase.
- [1.28.0](https://github.com/BabylonJS/Babylon-Lite/releases/tag/npm-lite-v1.28.0):
  the stable version used here, without additional notable changes.

Lite owns a separate canvas and single-sampled `rgba16float` / `depth32float`
offscreen target. `registerScene()` prepares the scene and allocates targets;
`setEngineSize()` rebuilds the target on resize. Private `_device`,
`_colorTexture` and `_depthTexture` access is isolated in `src/bridge.ts`, with
format, extent, dimension, sample-count and usage validation. These fields are
version-coupled and are not a new public ZenFG API.

Basic Lite PBR still emits gamma-2.2 color and clamps highlights, even with tone
mapping disabled. Exposure and contrast are 1. Clear color is encoded with the
same gamma convention so the graph's `pow(2.2)` decode preserves the intended
linear background. Decoding cannot recover highlights already clipped by Lite.
No Y flip or depth conversion is needed on this path; hardware fixtures validate
both orientation and color/depth alignment.

Lite uses left-handed coordinates and reverse zero-to-one clip depth. Its scene,
lights and initial camera mirror the canonical showcase along Z. Reference
instances retain their canonical right-handed transforms and use `VP_Lite *
diag(1,1,-1,1)`. Reference Draw uses `depthConvention: 'reverse-z'` and loads the
native depth cleared by Lite to zero.

## Camera and ownership

Native `attachControl` collects orbit and zoom input without a scene inertia
hook. Before recording, a small helper consumes and clears only alpha, beta and
radius offsets, using native setters to enforce limits. Both renderers therefore
see the same pose without manually advancing a scene or rendering a warmup frame.
Panning and inertia are disabled. Moving one CSS canvas height rotates by 2π,
independent of DPR; sensitivity updates on resize. Cancelled/lost pointer capture
resets the native gesture listeners, preserving motion already queued for the
next frame. Pointer focus suppresses outlines while keyboard input restores the
original focus style.

Import `startBabylonLiteInterop` from `./src/index.ts`, passing
a canvas and optional `signal`, `onReady` and `onError` callbacks. Startup returns
a controller or `undefined` on cancellation/failure. Failures are reported once;
cancellation is silent. The controller has no settings API:

- `captureSnapshot()` schedules a real frame, including while idle. Concurrent
  requests share a promise; suspension, failure and disposal settle pending work.
- `dispose()` idempotently stops input and scheduling, removes listeners and
  observers, restores canvas styles, and releases resources.

Rendering follows `requestAnimationFrame` continuously and pauses while hidden.
Preparation has cancellation, device-loss handling and a 30-second timeout;
late async scene resources use
Lite's disposal tracking. A late engine result after cancellation is disposed.
Device loss terminates the whole composition; Lite's opt-in automatic recovery
is not enabled. Timestamp support comes from the actual shared device.

FrameGraph, Reference Renderer and the visible canvas borrow Lite's device.
Teardown releases borrowers and unconfigures the visible canvas before disposing
Lite's scene and engine. Only Lite destroys the device. Playground owns the
legend, depth description, source panel and Inspector.

## Validation

```sh
npm test
npm run typecheck
npm run build:pages
npm run docs:check
```

See [hardware test instructions](tests/gpu/README.md),
[validation results](VALIDATION.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
