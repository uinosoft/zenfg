# Repository examples

This directory contains private, application-like showcases, cross-package
workflows, and integrations with third-party libraries. They may be shared by
website surfaces, but they do not define a common example runtime contract or a
recommended package-level recipe structure.

Focused examples that teach one package's public API belong with that package
and may ship in its artifact. Larger applications and examples whose value
comes from a third-party integration remain here even when one ZenFG package is
their primary dependency.

Both repository examples and package recipes must remain independent of the
Examples. The Examples executes and displays their real source through
application-local catalog adapters.

## Reading entry convention

Each runnable showcase has a `src/main.ts` that participates in normal execution.
It contains the existing startup function, the per-frame recording/compilation/
submission flow, and GPU resource release. Keep browser events, controls,
asynchronous input preparation and snapshot delivery in example-local host
helpers; keep algorithms, shaders and detailed resource setup in focused modules.
This convention does not require a shared runtime abstraction or a common start
function signature. Importing an entry must not automatically launch the demo.

Begin `main.ts` with a short English comment containing `Source:` (original or
adapted, with pinned provenance and notices where available), `Demonstrates:`,
`Flow:` (including ownership), and `Read next:` (files and their roles).
Distinguish adapted integration code from third-party dependencies. Preserve
existing package exports and startup signatures; old source entry paths may
forward to `main.ts` for compatibility. The Reference Renderer showcase's main
belongs to `reference-renderer-demo`, while `reference-renderer` remains reusable.

Register that file as the Examples catalog's explicit `entrySourceId` and
display the implementation, helpers, shaders and host after it in reading order.
The displayed raw file and the executed file must be the same source.

`reference-renderer` is a private reusable GPU module. Its basic showcase lives
in `reference-renderer-demo`, which depends on the renderer's package entrypoint.
Future integrations can depend on that same module while owning their device,
shared attachments, host and presentation policy independently.

`three-interop` demonstrates that composition with Three.js: the external
renderer and Reference Renderer share color and depth on one device, with
forward-Z and reverse-Z modes. Its host and adapter remain local to the showcase.

`babylon-interop` demonstrates an engine-owned device and graph-visible resource
adaptation: Babylon.js writes native attachments, a native pass normalizes both
color and depth orientation, and the Reference Renderer continues drawing.
Its Reverse Z control changes convention on the same engine and shared device.

`babylon-lite-interop` uses Babylon Lite 1.28 with native reverse depth. A graph
pass decodes Lite color while Reference Renderer loads the original depth
attachment. It uses the same procedural composition without configurable effects.

The PlayCanvas GSplat showcases draw Reference geometry before an external splat
submission, sharing forward depth and compositing a transparent gamma-2.2 layer.
See [Toy Cat](playcanvas-gsplat-interop/README.md) and
[Roman Parish streaming](playcanvas-gsplat-streaming-interop/README.md). Both use
private playcanvas-gsplat-shared helpers and independently executable main.ts entries.

`glyph-interop` compares Glyph 0.1.0 Bitmap, MSDF and Slug on one 3D text
plane. Its official TypeGPU integration records directly into a native graph
render pass, reading Reference Renderer depth and blending into shared color.

The pixi-interop showcase turns a Reference Renderer city into a PixiJS texture.
One built-in DisplacementFilter bends the live 3D image and 2D star chart together;
the graph records Reference drawing followed by one Pixi external submission.
