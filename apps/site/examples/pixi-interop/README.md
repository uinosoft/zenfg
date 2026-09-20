# Portal Lens · PixiJS

A small 3D city becomes a texture in a PixiJS star chart. Move the golden lens
across the portal edge: Pixi's built-in DisplacementFilter bends the live city,
grid and lettering together. A circular Graphics mask and front/back orbit
decorations provide the rest of the scene.

Run `npm run dev` and select **Portal Lens · PixiJS**, or use
`?example=pixi-interop`. Drag the lens to move it; drag elsewhere inside the
portal to orbit; scroll over the portal to zoom. Canvas buttons control
automatic orbit, the lens and reset. Blur and pointer cancellation release a
drag. There is no object picking or shared depth.

## Read the frame first

Start at `src/main.ts`, then `src/graph.ts`:

```text
Reference Reset → Cull → Draw
                           │ writes an sRGB attachment view
                   persistent 3D image
                           │ sampled as unorm
                 Pixi external submission
                           │ mask + built-in filter + controls
                     Canvas / markPresent
```

The host owns one GPUDevice and a persistent `bgra8unorm` viewport texture.
Reference Renderer writes through a `bgra8unorm-srgb` view; Pixi ExternalSource
samples the default unorm view. Display-encoded values pass through Pixi's
normal 2D composition: no second sRGB encoding, custom presentation shader or
CPU transfer of the rendered city. Depth is a transient graph texture.

Each physical image is imported once per frame. Pixi's node explicitly reads
the viewport and overwrites the swapchain. `markPresent` retains the full chain,
with no extra side-effect root. Without it, the whole graph is culled.
The callback calls synchronous `renderer.render()` once, enqueuing all work
before returning. Pixi uses its own encoders and internal filter targets;
those passes remain opaque in Inspector. The boundary orders submissions,
not GPU completion.

Pixi initializes/configures the visible canvas. The bridge primes its target
without drawing. After acquiring the current image, the host records and
executes synchronously without resizing or reconfiguring the canvas.
There is one 3D render per frame, regardless of the lens.

## Scene and lifecycle

`src/pixi.ts` owns Pixi setup, ExternalSource and interaction.
`src/artwork.ts` uses Container, Sprite, Graphics, Text and DisplacementFilter.
The filtered container includes the city and 2D artwork; controls and the lens
rim sit outside it. City geometry, camera/layout and host scheduling live in
focused helpers. There is no custom filter WGSL or extra effects dependency.

The local 128×128 `assets/displacement.png` is a data texture: red controls
horizontal offset, green vertical offset. A radial falloff approaches neutral
gray at its edge. The 8-bit neutral value is approximate; this is a visual lens,
not calibrated optics. Rebuild it with
`node apps/site/examples/pixi-interop/scripts/build-displacement.mjs`.
It is generated once, decoded as ImageBitmap and uploaded as a static asset.
It contains no captured 3D pixels. Geometry is procedural, fonts are system
fonts, and there are no remote assets.

`startPixiInterop(canvas, options)` accepts `signal`, `onReady`, `onFrame`,
`onPaused` and `onError`, resolving a controller or `undefined` on failure
or cancellation. The controller offers `captureSnapshot(request?)` and
idempotent `dispose()`. Pending captures share a promise and settle to
`undefined` when hidden or disposed. Device loss stops and cleans up the host.

Resize replaces the viewport, updates ExternalSource, then destroys the old
image. Pixi never owns that image or the shared device. DPR is capped at 2 and
device texture limits. One host rAF drives rendering while visible; there is
no Pixi Application or application ticker.

## Image quality

The canvas uses the effective DPR, capped at 2. The 3D viewport renders at
twice its displayed pixel diameter, while the displacement filter's input
renders at 1.5 times the effective DPR. Raising both preserves detail before
the lens samples the composite. Resize recalculates these sizes and caps
them to device limits, including the filter pool's power-of-two rounding.

Pixi's renderer enables antialiasing and the filter inherits it (4x MSAA in
Pixi 8.21's WebGPU backend). This smooths the artwork both inside and outside
the filtered container. The shared 3D texture stays single-sampled; Pixi owns
all MSAA/resolve attachments, so the four-node FrameGraph is unchanged.
The higher resolutions trade extra attachment memory and fill work for clarity.

## Validation

```sh
npm test
npm run typecheck
npm run build:pages
npm run docs:check
node apps/site/examples/pixi-interop/tests/gpu/run.mjs
node apps/site/examples/pixi-interop/tests/gpu/production.mjs
```

Pixi is pinned to **8.21.0**. Public advanced APIs used here include shared
GPU initialization, ExternalSource/updateGPUTexture and render-target
initialization. Re-run hardware tests on upgrade. See
[validation notes](VALIDATION.md) and [third-party notices](THIRD_PARTY_NOTICES.md).