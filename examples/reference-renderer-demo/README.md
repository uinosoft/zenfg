# Reference Renderer demo

The basic showcase for [Reference Renderer](../reference-renderer/README.md).
This private workspace owns the application code; the reusable renderer remains
an independent dependency with no browser host or Playground imports.

```text
Playground adapter -> reference-renderer-demo -> reference-renderer -> @zenfg/webgpu
```

## Run

Run `npm run dev:playground` and select **Reference Renderer**. The existing
`?example=reference-renderer` URL remains unchanged. The demo starts with 1,000
primitives. Drag to orbit, scroll to zoom, and adjust instance count, frustum
culling or depth convention in the controls. Camera dragging follows the pointer
in both directions.

The demo renders on demand, including the next real frame requested by the
Inspector. It creates an `rgba16float` scene target and uses a separate Present
pass to encode sRGB exactly once for the canvas.

## Responsibilities

- `src/start.ts`: device, canvas, graph, frame loop, resize, Snapshot and disposal.
- `src/scene.ts`: deterministic primitive placement and colors.
- `src/camera.ts`: view/projection matrices and pointer controls.
- `src/present.ts`: linear scene color to canvas encoding.
- `src/index.ts`: the demo's `startReferenceRenderer()` entrypoint and controller types.

The demo imports `createReferenceRenderer` and `ReferenceInstance` from
`@zenfg-example/reference-renderer`, without reaching into its implementation.
Playground controls and source/Inspector presentation stay in the catalog adapter.

Future examples should create their own host and consume the renderer package.
They can choose a device and attachments supplied by another engine rather than
reuse this demo's device creation. Camera, Present and host utilities stay local
until another example establishes a concrete shared need.

## Validation

```sh
npm test --workspace @zenfg-example/reference-renderer-demo
npm run typecheck
npm run build:pages
npm run docs:check
```

Host and camera/scene tests live here; renderer and geometry tests stay with the
renderer. The host tests reuse the renderer's test-only fake GPU, never a runtime
helper. The [optional real WebGPU suite](tests/gpu/README.md) checks both packages
through their package entrypoints, including real frames, shared resources and
device-loss handling. See [validation results](VALIDATION.md).
