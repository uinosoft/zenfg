# Reference Renderer

A small GPU-driven primitive renderer for teaching and repository showcases.
This private workspace is not a production renderer or a published ZenFG package.
It uses native WebGPU and WGSL, without a scene graph, material system or engine
dependency. Its package entrypoint exports only `createReferenceRenderer` and
renderer types. The reusable renderer depends only on `@zenfg/webgpu` and does not
import a demo, browser host or the Playground. Other examples should depend on
internal `src/index.ts` entrypoint.

## Start with the graph

```text
CPU instance update                 Per-frame view/projection
        |                                    |
        +--------------+---------------------+
                       v
Reset -------------> Cull -----------------> Draw
initialize lists     GPU frustum test         3 indexed indirect draws
and draw arguments   compact visible IDs      shared color + depth
                     count each shape
```

There is one batch each for the unit cube, radius-0.5 sphere and unit XZ plane.
The CPU uploads transforms and colors only when the instance list changes. GPU
compute chooses visibility and writes each batch's `instanceCount`; draw count
stays at three even with 10,000 objects. `firstInstance` is always zero, so no
optional GPU feature is required. The sphere has fixed 16-by-8 tessellation.

Geometry, instance and camera buffers belong to the renderer. Visible IDs and
indirect arguments are transient graph buffers. Reset initializes their complete
contents; Cull's sparse writes preserve those contents. The output attachment
keeps this chain alive; without an output root, ZenFG can cull it entirely.

## Use an existing device and attachments

```ts
import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from './src/index.ts';

// The application or another engine owns these same-device resources.
export function createPrimitiveLayer(device: GPUDevice) {
    const graph = new FrameGraph(device);
    const renderer = createReferenceRenderer(device, { maxInstances: 10_000 });
    renderer.setInstances([{
        shape: 'cube',
        transform: new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ]),
        color: [0.3, 0.6, 0.9],
    }]);

    return {
        // Continue rendering into initialized, caller-owned attachments.
        render(colorTexture: GPUTexture, depthTexture: GPUTexture,
            viewProjection: Float32Array) {
            const frame = graph.beginFrame();
            const color = frame.importTexture(colorTexture);
            const depth = frame.importTexture(depthTexture);
            renderer.record(frame, {
                viewProjection,
                depthConvention: 'reverse-z',
                color: { target: color, loadOp: 'load', storeOp: 'store' },
                depth: { target: depth, depthLoadOp: 'load', depthStoreOp: 'store' },
            });
            frame.markOutput(color);
            frame.compile().execute();
        },
        destroy() {
            renderer.destroy();
            graph.destroy();
        },
    };
}
```

For several participants in one graph, the host imports each physical texture
**once** and passes that same handle to every participant. A logical
`TextureViewHandle` is also accepted, including a single mip/layer or an sRGB
view. The renderer uses the actual view format when selecting its pipeline.
The first producer can clear the attachments; later producers load them. The
example above assumes both attachments already contain a defined value.

The renderer does not request a device, create output textures, submit command
buffers, present, or destroy borrowed resources. It checks the executing graph's
device identity. An engine with its own submissions can later participate through
the host's `externalSubmission` nodes; that adapter is outside this module.

## Small API, explicit contracts

- `createReferenceRenderer(device, { maxInstances? })`: fixed capacity, default
  10,000; exceeding device limits throws. No capacity growth or format lock-in.
- `setInstances(instances)`: replaces and copies the whole array. Each instance
  has a shape, 16-value column-major invertible affine transform, and linear RGB
  in `[0, 1]`. Rotation, non-uniform scale and shear are handled by normal matrices
  and conservative world AABBs. An empty list is valid; overflow throws.
- `record(frame, options)`: adds Reset, Cull and Draw, once per renderer per
  recording. Supply a WebGPU view/projection matrix (`0 <= z <= w`), color and
  depth descriptors. `culling` defaults to `true`; `depthConvention` defaults to
  `reverse-z`. Depth can be read-only. The method returns no lifecycle token.
- `destroy()`: idempotently releases only the renderer's own resources.

Always **update -> record -> compile/execute -> update the next frame**. Input
uploads are queue operations, not graph commands. Recording copies camera data,
and later updates invalidate older recordings; executing an overwritten frame
throws instead of using new input accidentally. Do not keep compiled frames for
replay across input changes. Use distinct renderer instances for distinct layers
recorded in the same graph. If recording fails, discard that recording. Resizing
borrowed attachments needs no renderer call.

| Target policy | Supported values |
| --- | --- |
| Color | `rgba8unorm`, `bgra8unorm`, their `-srgb` variants, `rgba16float` |
| Depth | `depth16unorm`, `depth24plus`, `depth32float` |
| Reverse-Z | `greater`, clear `0`, matching zero-to-one projection |
| Forward-Z | `less`, clear `1`, matching zero-to-one projection |
| Attachment shape | One color and one depth, single-sampled 2D, matching view dimensions |

The fixed directional light and ambient term operate in linear space. sRGB views
encode automatically. Unorm and float attachments retain linear output; the host
owns display conversion. Geometry is opaque and double-sided.

Textures on materials, transparency, arbitrary geometry, models, lights, shadows,
LOD, occlusion culling, multisampling, stencil and GPU instance-buffer inputs are
deliberately outside v1.

## Demo and validation

The [standalone demo workspace](../reference-renderer-demo/README.md) owns scene
layout, camera controls, browser setup, presentation and Snapshot capture. It
consumes this renderer through the same public entrypoint as any future engine
integration. The Playground mounts that demo without becoming a renderer dependency.

```sh
npm test
npm run typecheck
npm run build:pages
npm run docs:check
```

CPU tests in this package cover data layout, graph declarations, resource sharing
and lifecycle. The demo's cross-package [real WebGPU suite](../reference-renderer-demo/tests/gpu/README.md)
checks GPU-generated counts, pixels and shared attachments through the public
package entrypoints. No readback or browser-host API is added to the renderer.
