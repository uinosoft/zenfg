# Interactive Background

The browser host owns the device, canvas, frame parameters, pipelines, and
FrameGraph execution. Five passes produce the flow field, HDR scene, bloom
seed, softened bloom, and final presentation. These five textures are visible
to the graph, which manages transient allocations and their dependencies.

The CPU-updated frame uniform is bound directly in the compute, lattice, and
composite pipelines. The host initializes and updates it before rendering and
releases it on disposal; it does not appear in graph resource statistics.
Snapshot captures the real executed frame, including these five passes.

This is an optional choice for a showcase with several passes. Explicitly
importing frame parameters can also be useful for teaching or inspecting their
usage. See [Choosing resource declaration granularity](../../../../docs/core-concepts.md#choosing-resource-declaration-granularity).
