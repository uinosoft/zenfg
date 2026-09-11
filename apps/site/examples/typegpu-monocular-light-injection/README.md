# TypeGPU Monocular Light Injection

This private showcase records DepthART inference and image-space relighting as
native ZenFG compute/render nodes. The algorithms derive from the pinned TypeGPU
example in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Ownership and recording

`createMonocularLightInjection({ device, outputFormat, initialSettings })` creates
an independent GPU workload asynchronously. It owns pipelines, model weights,
tensor allocations, disparity stabilization, history, and reconstructed surface.
It never requests a device, acquires a canvas, downloads models, or submits work.
`setModelBundle(bytes)` compiles before atomically installing a replacement;
failure preserves the previous model.

`recordFrame(recording, { color, source, uvTransform, swapAxes, updateDepth })`
records at most two passes and returns `{ commit(), discard() }` for that frame:

- `monocular-light-injection.depth`: one compute pass containing preprocessing,
  inference, range estimation/stabilization, depth preparation, and reconstruction.
- `monocular-light-injection.relight`: one render pass writing the supplied color
  target with a centered square viewport and cleared outer bars.

The caller records, compiles, and submits synchronously, then calls `commit()`
from ZenFG's successful submission callback. Abandoned frames call `discard()`.
Both are idempotent; recording errors release pending state internally. Settings,
history, and model changes cannot overlap a pending frame. Model compilation is
serialized and recording is paused during replacement.

Only history, stable range, and surface are imported during inference; with the
output target this is four graph resources. Stable image frames import only
surface, for two resources including the target. Weights, uniforms, auxiliary
storage, and inference scratch remain internally allocated, bound, updated,
validated against device limits, and released by the workload.

History and stable range start zero-initialized and use preserving writes.
Surface contents are undefined until a depth frame is submitted. History,
stabilized disparity range, and surface have explicit `markPersistentState()`
roots. No blanket side-effect node is needed. Static images reuse successfully submitted
depth; source/model changes and history reset force inference again.

The source `GPUExternalTexture` remains outside graph tracking and must remain
valid through synchronous submission. The host closes temporary `VideoFrame`
objects afterward. Workload `dispose()` leaves the caller-owned device alive.

## Browser host and Playground

`startMonocularLightInjection(canvas, options)` owns the browser device, canvas,
FrameGraph execution, sources, downloads, cache, light input, and Snapshot capture.
It returns a controller after GPU setup; model/image loading continues with state
notifications. Failures remain retryable. An optional abort signal releases
resources and invalidates late results. Playground owns Tweakpane and the file
picker; this package has no Playground or Tweakpane dependency.

Open `/playground/?example=typegpu-monocular-light-injection`.

WebGPU, VideoFrame, JavaScript Float16 DataView support, and network access for
uncached resources are required. The default small model is approximately 13 MB
with `shader-f16`, or 23 MB with f32. Base supports both; large requires f16.
Models use revision `913a7c13ddfbd48549279555d1db98172e8e5e0d`. No weights are bundled.
Cache Storage is best-effort. Disabling caching still permits existing cache hits;
**Clear model downloads** removes this example's cache.

Sources include the pinned demo photo, local images, and an optional front/back
camera. Images and frames are processed locally. Camera permission is requested
only when selected; replacing the source or disposing stops camera tracks.
Move/drag the light and scroll to change distance, or use touch dragging/pinching.
Views include relit, original image/camera, depth, and normals.

Inspector captures an actual frame without forcing inference: stable images have
only relight, while camera/depth-update frames have both nodes. Capture resolves
unavailable if rendering cannot continue or the host is disposed. Timestamp
queries provide optional GPU timing.

## Validation

```sh
npm test
npm run typecheck
npm test
npm run build:pages
npm run docs:check
```

Tests cover graph content/roots, frame settlement, replacement and disposal,
submission/capture, async source races, camera replacement, cache fallback, and
Playground retry/cleanup. See [VALIDATION.md](./VALIDATION.md) for browser observations.

See [Choosing resource declaration granularity](../../../../docs/core-concepts.md#choosing-resource-declaration-granularity) for this optional integration choice.
