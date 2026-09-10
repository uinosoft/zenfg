# Babylon.js Co-rendering

A procedural showcase of Babylon.js and the Reference Renderer sharing a GPU
device and a scene. Cyan rings and columns belong to Babylon.js; orange cubes
and spheres, and the neutral platform, belong to the Reference Renderer.

Run `npm run dev:playground` and select **Babylon.js Co-rendering**, or use
`?example=babylon-interop`. Drag to orbit and scroll to zoom. **Reverse Z** starts
enabled; switching preserves the camera pose and should preserve the image.
Color and depth sharing are always enabled. There are no remote assets.

## Follow the graph

```text
Babylon external submission → Normalize color + depth → Reference Draw → Present
                                                          ↑
                                                Reference Reset → Cull
```

`src/graph.ts` imports each native attachment once. The external submission
overwrites them, then `src/resolve.ts` samples both textures with the same Y
flip and writes transient attachments. The Reference Renderer loads those
attachments and continues the scene. Present reads linear color, encodes sRGB
exactly once and roots the chain through `markPresent`. No side-effect roots
are needed. The Inspector represents Babylon as one opaque external submission;
it does not expose Babylon's internal passes or invent GPU timing for them.

Babylon 9.4's offscreen render path flips Y in its internal uniform buffer.
The normalization pass writes both color and `frag_depth`; changing texture
`invertY` metadata alone does not correct that render path. Output remains
single-sampled `rgba16float` color and `depth32float` depth throughout.

## Bridge, camera and version contracts

`@babylonjs/core` is pinned to **9.4.0**. The example uses built-in WGSL PBR
materials with image processing deferred, no GLSL compiler downloads, loaders,
models, textures or IBL. Scene readiness is awaited with cancellation and a
30-second timeout before rendering. Creating or resizing a render target
allocates its GPU textures without a scene render. GPU resource uploads during
initialization are distinct from rendering a scene.

`src/bridge.ts` isolates version-coupled native access through `engine._device`
and texture `_hardwareTexture.underlyingResource`. It validates native texture
format, extent, dimension, sampling and attachment/sampling usage. The bridge
also contains a narrowly scoped failed-initialization cleanup: Babylon 9.4's
normal disposer assumes GPU helpers exist; if they do not, its common DOM and
base-engine cleanup remove constructor listeners and the engine registry entry,
and any partially allocated device is destroyed. This is an example adapter,
not a public ZenFG extension API. Re-run the hardware suite when upgrading.

The native `ArcRotateCamera` receives input from the visible canvas through
`engine.inputElement`, with inertia and panning disabled. Each frame consumes
input once via `camera.update()`, then shares its view/projection with the
Reference Renderer. Babylon renders with camera updating disabled. Both use
right-handed coordinates and WebGPU zero-to-one clip depth. The Reverse Z
setting updates the public engine property, forces projection refresh and
selects the corresponding native depth comparison and clear value without
replacing the engine, device, camera or targets.

Drag sensitivity matches Three.js OrbitControls: moving one CSS canvas height
rotates by 2π radians on either axis, subject to the camera's elevation limits.
The sensitivity follows viewport resize and is independent of device pixel
ratio. Pointer-down focus hides the canvas outline; keyboard input or blur
restores the original focus style. New canvas focus uses the natural tab order,
and disposal restores the original outline and tabindex.

The synchronous external callback calls `wipeCaches(true)`, `beginFrame()`,
`scene.render(false, false)` and `endFrame()`. It must enqueue all external
work on the shared device queue before returning. The boundary orders
submissions; it is not a GPU-completion fence.

## Host interface and ownership

Import `startBabylonInterop` from `@zenfg-example/babylon-interop`, passing a
canvas and optional `signal`, `onReady` and `onError` callbacks. Startup resolves
a controller, or `undefined` on cancellation/failure. Non-cancellation failures
are reported through `onError`. The controller provides:

- `getSettings()` returns `{ reverseZ }`.
- `await setSettings({ reverseZ })` changes convention on the same engine.
- `captureSnapshot()` schedules a real frame even when idle; concurrent
  requests coalesce. Hidden, disposed or switching hosts return `undefined`.
  Suspension, switching and disposal settle pending captures.
- `dispose()` idempotently removes input, listeners and observers, releases
  native graph resources and ends pending work.

Rendering follows `requestAnimationFrame` continuously while visible, including
when the camera is idle. Hidden pages suspend the frame loop. The
Playground owns controls, legend, source tabs and Inspector presentation.

Babylon owns the device and RTT on a separate canvas. The visible canvas,
FrameGraph and Reference Renderer borrow that device. Teardown stops the host,
releases Reference Renderer and FrameGraph resources, unconfigures the visible
canvas, and only then disposes Babylon and its device. The host never separately
destroys the device. Late startup results are released after cancellation.
Babylon automatic device recovery is disabled: device loss reports an error
and disposes the whole composition instead of silently replacing one renderer's
device. Timestamp queries are optional and checked on the actual shared device.

## Validation

```sh
npm test --workspace @zenfg-example/babylon-interop
npm run typecheck
npm run build:pages
npm run docs:check
```

See the [hardware test instructions](tests/gpu/README.md),
[validation record](VALIDATION.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
