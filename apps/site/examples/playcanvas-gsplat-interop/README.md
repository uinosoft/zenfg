# PlayCanvas GSplat Co-rendering

Run `npm run dev` and select **PlayCanvas GSplat Co-rendering**, or open `?example=playcanvas-gsplat-interop`.
Requires WebGPU and a network connection. Toy Cat is loaded at runtime.
Drag to orbit; scroll to zoom. There are no settings.

## Follow the graph

Reference Reset → Cull → Draw → PlayCanvas external submission → Composite → Present.

PlayCanvas 2.21.4 owns the GPU device, rgba8unorm splat color and depth32float
attachments. Reference Renderer borrows the device and draws into a graph transient
rgba16float color texture, clearing shared forward-Z depth to one. Each native
attachment is imported once per frame. PlayCanvas reads depth without clearing it
and writes a transparent splat layer inside the synchronous external callback.
Initialization, resize, recording and compilation do not render the scene.

Composite encodes Reference color with gamma 2.2, combines PlayCanvas premultiplied
color, decodes gamma 2.2 and applies the final sRGB transfer. Exposure is fixed and
tone mapping is linear. Present roots the dependency chain; without it the graph
can cull the whole composition. Inspector reports three execution segments
(native / external / native), not a guarantee of three queue submissions. Internal
PlayCanvas passes remain opaque.

## Implementation and lifecycle

Start reading `src/main.ts`: it contains startup, the actual per-frame graph and
teardown. `src/scene.ts` defines assets and procedural geometry. Private shared
helpers live in `../playcanvas-gsplat-shared/src`; they are not a public ZenFG API
and have no dependency on Playground. The catalog adapter owns Tweakpane and page
status integration.

The visible canvas, Reference Renderer and FrameGraph borrow PlayCanvas's device.
Dispose borrowers before the bridge. Cancellation releases late preparation
results; startup has bounded timeouts. Hidden pages stop frame scheduling and
settle pending captures. Switching examples or device loss disposes the composition.
Initial failure offers an explicit retry; later asset failures retain rendered
content and display a warning. No dataset is included in repository or build output;
browser requests use the original host and normal browser caching.

See [third-party notices](THIRD_PARTY_NOTICES.md) and
[shared validation](../playcanvas-gsplat-shared/VALIDATION.md).
