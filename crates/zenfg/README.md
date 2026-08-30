# zenfg

`zenfg` is a renderer-agnostic, wgpu-specific FrameGraph compiler.
It records per-frame logical resources and accesses, validates content flow,
builds dependencies, removes dead work, derives wgpu usage, tracks lifetimes,
and produces a transient allocation plan and optional diagnostics. Device-backed
graphs materialize that plan through a cross-frame resource pool and can encode
and submit retained render, compute, copy, clear, command, and
external-submission nodes over transient and caller-owned imported resources.

## Installation

```sh
cargo add zenfg
```

## Features

| Feature | Enabled by default | Description |
| --- | --- | --- |
| `default` | Yes | Core FrameGraph compiler and executor without optional serialization or Snapshot support. |
| `serde` | No | Enables Serde serialization for internal report types. |
| `snapshot` | No | Adds `zenfg-snapshot`, re-exports the Snapshot 1.0 wire API, and enables runtime report export. |

`FrameGraph::new()` remains completely CPU-only. `FrameGraph::with_device()`
stores a cloned `wgpu::Device` handle, owns its transient resource pool, and
enables one-shot execution. The queue, surface, scene data, pipelines, bind
groups, samplers, and imported resources remain caller-owned.

## Lifecycle

```text
FrameGraph -> Frame<'frame> -> CompiledFrame<'frame> -> execute(queue)
              record          CPU plan + report        optional, one-shot
```

`Frame::compile` consumes the recording. Logical handles are bound to the
exclusive frame borrow and also carry runtime owner and recording identities.
Recording-time `texture_desc`, `buffer_desc`, and `texture_view_desc` queries
return snapshotted metadata; the view query resolves all descriptor defaults.
After compilation, callbacks and native bindings referenced only by culled work
are released immediately, while a Full report still describes the complete
recording.

## GPU execution

Imported resources are declared logically and bound to caller-owned native wgpu
objects. Transient resources need no binding: retained resources are allocated
from the FrameGraph-owned pool immediately before execution. Both kinds resolve
through the same typed access tokens in synchronous structured callbacks:

```rust,no_run
use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, ImportBufferOptions,
    InitialContents,
};

# fn record(device: &wgpu::Device, queue: &wgpu::Queue, native: &wgpu::Buffer)
# -> Result<(), zenfg::FrameGraphError> {
let mut graph = FrameGraph::with_device(device);
let mut frame = graph.begin_frame();
let buffer = frame.import_buffer(
    BufferDesc::new("input", native.size()),
    ImportBufferOptions::new(InitialContents::Defined),
)?;
frame.bind_imported_buffer(buffer, native)?;

let mut pass = frame.compute_pass("consume");
let input = pass.storage_buffer_read(buffer, BufferRange::whole())?;
pass.finish_compute(move |ctx| {
    let _native = ctx.resources.buffer(input)?;
    // Set a compute pipeline/bind groups and dispatch through ctx.pass.
    Ok(())
})?;

frame.compile(CompileOptions::default())?.execute(queue)?;
# Ok(())
# }
```

`finish_render` and `finish_compute` expose only an active wgpu pass plus typed
resource resolution. Copy nodes own validated buffer-buffer, buffer-texture,
texture-buffer, or texture-texture operations. `clear_buffer` records one
aligned, non-empty range, while `clear_buffers` records several ordered clears
in one node. `command_pass` remains an escape hatch, while external submission
nodes split FrameGraph-owned command encoders into ordered segments.

Retained texture accesses are compiled into a per-execution materialization
plan. Repeated accesses to one logical `TextureView` share a single native
`wgpu::TextureView`; compatible implicit storage views are shared as well. The
cache is scoped to one execution and never enters the cross-frame resource pool.

Render nodes support multisample color resolve targets and read-only depth
attachments. Attachment declarations, sampled/storage roles, copy roles, sample
counts, and resolve compatibility are checked against texture-format
capabilities before dead-node elimination. Root declarations are also strict:
`Present` accepts only surface textures, `Readback` accepts only imported buffers
exposed exactly as `MAP_READ | COPY_DST`, and `PersistentState` accepts only
imported resources.

Execution performs a full preflight before acquiring transient resources or
creating the first callback, encoder, or submission. A missing imported native
binding, callback or copy operation, descriptor/usage mismatch, or token
resolved from the wrong pass produces a structured error. Surface acquisition
and presentation remain caller-owned.

## GPU timing

GPU timing is opt-in and leaves the normal execution path allocation-free with
respect to profiler resources. `execute_with_gpu_timing` uses timestamp writes
only for retained render and compute passes and returns a one-shot,
`#[must_use]` readback handle:

```rust,no_run
# use zenfg::{CompileOptions, ExecutionOptions, FrameGraph};
# fn sample(device: &wgpu::Device, queue: &wgpu::Queue)
# -> Result<(), zenfg::FrameGraphError> {
let mut graph = FrameGraph::with_device(device);
let mut frame = graph.begin_frame();
frame.command_pass("untimed setup").finish_command(|_| Ok(()))?;
let compiled = frame.compile(CompileOptions::default())?;
let mut readback = compiled.execute_with_gpu_timing(
    queue,
    ExecutionOptions::default().with_frame_index(42),
)?;

// Call from later frames; this never blocks.
if let Some(report) = readback.try_take() {
    println!("{report:?}");
}
# Ok(())
# }
```

`GpuTimingReadback::try_take` polls the correct cloned Device on native wgpu
backends and relies on the browser event loop on WebGPU. Reports use
`std::time::Duration`, carry the caller's frame index, and include only the
debug groups needed to interpret timed retained nodes. Unsupported devices,
an overlapping pending readback, readback failure, and query-count overflow are
reported as non-fatal `Unavailable` results; graph execution still proceeds.
The profiler lazily creates and grows one query set plus resolve/readback
buffers. Only one timing readback may be pending per FrameGraph.

## Transient resource pool

The compiler assigns non-overlapping, compatible logical resources to one
physical allocation. Execution acquires one native resource per physical
allocation, so aliases resolve to the same `wgpu` object. After execution the
resources return to a per-`FrameGraph` pool and can be reused by later frames on
the same queue.

`FrameGraph::resource_pool_stats()` reports cumulative acquire, reuse, and
creation counts plus the currently retained resource count and estimated bytes.
`FrameGraph::clear_resource_pool()` destroys retained resources without
resetting the cumulative counters. Dropping the graph also destroys retained
resources.

References resolved from transient access tokens are valid only for the current
execution callback. They must not be cloned or retained after that callback;
`wgpu` handle cloning cannot be completely prohibited by Rust lifetimes.

Imported resources remain caller-owned and may be referenced by long-lived bind
groups or native handles, but every node that uses them must declare the matching
FrameGraph access. A transient resource must instead be resolved from the
current callback's typed token and must never be cached across callbacks or
frames. When several renderer domains share one native resource, the frame
composer should import it once and pass the same logical handle to each domain.

## Minimal example

```rust
use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, RootReason,
    UsagePolicy, WriteContents,
};

let mut graph = FrameGraph::new();
let mut frame = graph.begin_frame();
let output = frame.create_buffer(BufferDesc {
    label: "output".into(),
    size: 1024,
    usage: UsagePolicy::Infer,
})?;

let mut pass = frame.compute_pass("produce");
let _output = pass.storage_buffer_write(
    output,
    BufferRange::whole(),
    WriteContents::Overwrite,
)?;
pass.finish()?;

frame.mark_buffer_root(output, BufferRange::whole(), RootReason::Output)?;
let compiled = frame.compile(CompileOptions::full_report())?;
assert_eq!(compiled.report().unwrap().summary.retained_node_count, 1);
# Ok::<(), zenfg::FrameGraphError>(())
```

## Content model

- Transient and surface resources begin undefined.
- Imported resources explicitly select `InitialContents::Defined` or
  `InitialContents::Undefined`.
- Reads and preserving writes require defined contents.
- Overwrites create a new logical value without consuming the previous value.
- Discarding an attachment invalidates its selected subresources.
- Value dependencies retain producers; ordering-only WAR/WAW hazards do not.

Retained passes always remain a stable subsequence of recording order. The
compiler does not reorder or merge passes.

## Diagnostics and Snapshot

`ReportLevel::Summary` records counts and compile timings. `ReportLevel::Full`
also records resources, views, accesses, values, dependencies, roots, lifetimes,
allocation plans, execution segments, original recording order, explicit
culling reasons, and recording debug-group hierarchy.
`Frame::push_debug_group`, `pop_debug_group`, and `with_debug_group` assign nodes
and resources to stable per-recording groups. `ExecutionOptions` can optionally
emit those retained group paths as GPU debug markers; marker emission is off by
default and is reset across external-submission segment boundaries.

The optional `serde` feature remains the internal report serialization switch.
The separate `snapshot` feature depends on the `wgpu`-free `zenfg-snapshot`
crate, re-exports its Snapshot 1.0 wire types and codec, and adds
`create_frame_graph_snapshot` for runtime reports.
The adapter requires a Full report and preserves groups, original recording
order, retained/culled state, normalized texture views, split texture regions,
dependencies, roots, execution segments, allocation facts, optional pool facts,
GPU timings, and diagnostics. `CompiledFrame::take_report()` moves that report
into an asynchronous capture path without cloning it.

Snapshot export creates an in-memory object or JSON text only. Filesystem and
capture naming policy remain caller-owned. Arbitrary JSON validation and both
historical migrations are provided by `zenfg-snapshot`; the normative Schema,
specification, fixtures, and conformance corpus live in `@zenfg/snapshot`.

Errors are structured `FrameGraphError` values with stable `FGxxxx` diagnostic
codes and graph context.

## Current limits

The GPU runtime does not accept a host-owned encoder, time copy, command, or
external nodes, apply a pool memory budget or eviction policy, merge or reorder
passes, schedule async compute or multiple queues, analyze cross-frame
dependencies, or expose a public SSA resource API. Structured render passes
currently omit stencil, occlusion queries, and caller-defined timestamp writes.
The crate is prepared for packaging as MIT-licensed `0.1.x` software; actual
registry publication remains a separate manual step.
