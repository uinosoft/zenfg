# TypeGPU Slime Mold

This private repository showcase adapts the official TypeGPU Slime Mold example
to run as native ZenFG compute and render nodes. It demonstrates how a subsystem
can use TypeGPU to define shaders, pipelines, bind groups, and persistent GPU
resources while giving ZenFG declarations for graph-visible data flow and
submission ownership.

The reusable `TypeGpuSlimeMold` module receives a caller-owned `GPUDevice`. It
does not acquire a canvas, create a device, or submit command buffers. Its agent
buffer and trail textures remain TypeGPU-owned and are imported into each frame
recording as persistent state. TypeGPU pipelines encode into the pass encoders
provided by ZenFG.

The browser host owns WebGPU setup, the canvas lifecycle, presentation, resize,
snapshot capture, and device-loss policy. The Playground adapter owns the
optional controls UI; the showcase package has no dependency on Playground or
Tweakpane.

The simulation rules, 200,000-agent default, frame-time behavior, parameters,
and visual direction intentionally follow the pinned upstream example. See
`THIRD_PARTY_NOTICES.md` for source and license details.

The graph contains agents, two trail textures, and the output target (four
resources). Params, delta-time, and resolution uniforms remain internally bound,
CPU-updated, and destroyed by the workload. Reset, ping-pong dependencies, and
persistent-state roots retain their existing semantics.

See [Choosing resource declaration granularity](../../../../docs/core-concepts.md#choosing-resource-declaration-granularity)
for why this showcase chooses a smaller graph while teaching examples may expose more.
