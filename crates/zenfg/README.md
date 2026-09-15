# zenfg

<!-- generated:badges:start -->
[![zenfg published version](https://img.shields.io/crates/v/zenfg?include_prereleases)](https://crates.io/crates/zenfg)
[![docs.rs](https://img.shields.io/docsrs/zenfg/0.1.0)](https://docs.rs/zenfg/0.1.0/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/LICENSE)
<!-- generated:badges:end -->

`zenfg` is a renderer-agnostic FrameGraph compiler and transient-resource
executor for wgpu. It records logical resources and accesses, validates content
flow, builds dependencies, culls dead work, derives usage, plans transient
aliasing, and optionally materializes retained work on a caller-owned device and
queue.

ZenFG does not own scenes, pipelines, bind groups, samplers, surfaces,
presentation, or device-loss policy. This is a public beta crate; pin the exact
prerelease version while integrating.

## Installation

<!-- generated:installation:start -->
```sh
cargo add zenfg@=0.1.0
```
<!-- generated:installation:end -->

## Features

| Feature | Default | Adds |
| --- | --- | --- |
| `default` | Yes | Empty feature set; the core compiler and device-backed executor are always available |
| `serde` | No | Serde support for internal compilation report types |
| `snapshot` | No | `zenfg-snapshot`, wire-type re-exports, and portable report export |

`FrameGraph::new()` is CPU-only. `FrameGraph::with_device()` stores a cloned
`wgpu::Device`, owns a transient pool, and enables execution. The queue and all
imported resources remain caller-owned.

## Quick start

Use a Cargo application with the toolchain in [Compatibility](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/docs/compatibility.md).
Place this code inside `fn main() -> Result<(), zenfg::FrameGraphError>` and finish
with `Ok(())`. Run `cargo run`; the assertion succeeds without requiring a GPU.
Lines prefixed with `#` in this Markdown are rustdoc test scaffolding, not lines to paste.

This complete CPU-only example records one transient output, retains it, and
compiles a diagnostic plan:

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

## Lifecycle

```text
FrameGraph -> Frame<'frame> -> CompiledFrame<'frame> -> execute(queue)
runtime       recording         retained CPU plan        optional, one-shot
```

- `begin_frame()` exclusively borrows the runtime and creates one recording.
- `Frame::compile()` consumes the recording. Handles and access tokens carry
  runtime and recording identities enforced by the API and validation.
- `CompiledFrame::execute()` is one-shot. Native bindings and callbacks needed
  only by culled work are released after compilation.
- Surface acquisition and presentation remain caller-owned; import and bind a
  fresh current surface texture for each presentation frame.
- Dropping `FrameGraph` releases retained pool and profiler resources, but not
  caller-owned imported resources.

## Common tasks

| Task | Public API |
| --- | --- |
| Create a CPU-only compiler | `FrameGraph::new()` |
| Create a device-backed runtime | `FrameGraph::with_device()` |
| Start a recording | `begin_frame()` |
| Create transient storage | `create_texture()`, `create_buffer()` |
| Register imported storage | `import_texture()`, `import_surface_texture()`, `import_buffer()` |
| Bind imported native objects | `bind_imported_texture()`, `bind_imported_buffer()` |
| Select texture subresources | `create_texture_view()` |
| Record render or compute work | `render_pass()` / `finish_render()`, `compute_pass()` / `finish_compute()` |
| Record copies or clears | `copy_pass()` with typed copy methods, `clear_buffer()`, `clear_buffers()` |
| Encode custom graph-owned commands | `command_pass()` / `finish_command()` |
| Call a renderer that submits itself | `external_submission()` / `finish_external()` |
| Retain observable values | `mark_present()`, `mark_buffer_root()`, `mark_texture_root()`, `mark_readback()` |
| Compile compact or full diagnostics | `compile(CompileOptions::default())`, `compile(CompileOptions::full_report())` |
| Execute retained work | `execute()`, `execute_with_options()` |
| Request CPU/GPU timing | `execute_with_timing()` |
| Inspect or clear retained allocations | `resource_pool_stats()`, `clear_resource_pool()` |
| Export Snapshot 1.2 | `snapshot::create_frame_graph_snapshot()` with feature `snapshot` |

Exact signatures, fields, defaults, and structured `FGxxxx` errors are
documented on [docs.rs](https://docs.rs/zenfg).

## Key pattern: bind and resolve typed access

Imported storage is declared logically, then bound to a caller-owned native
object. Transient and imported storage resolve through the same typed pass
tokens:

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
    // Set a compute pipeline and dispatch through ctx.pass.
    Ok(())
})?;

frame.compile(CompileOptions::default())?.execute(queue)?;
# Ok(())
# }
```

Resolved transient objects are valid only inside their execution callback.
Imported objects remain caller-owned, but every graph-visible access still
needs a matching declaration.

## Resource and integration choices

Declaration granularity is optional: complex workloads can keep private weights,
parameters, and scratch internally bound, while teaching or diagnostic use can
expose more resources. Graph-visible dependencies and access correctness still
apply. See [Choosing resource declaration granularity](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/docs/core-concepts.md#choosing-resource-declaration-granularity).

For resources exposed to the graph:

- Use transient resources for storage needed only by one compiled execution;
  import storage that the caller owns or that must survive execution.
- Imported resources explicitly choose `InitialContents::Defined` or
  `InitialContents::Undefined`. The first write to a transient range must fully
  overwrite it.
- Prefer structured render, compute, copy, and clear nodes. Use command passes
  for custom work on a graph-owned encoder.
- Use external submissions for renderers that own and submit their encoders.
  The boundary orders queue submissions but is not a GPU-completion fence.
- ZenFG performs no cross-frame dependency analysis and never acquires or
  presents a surface for the application.

See [Core concepts](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/docs/core-concepts.md)
for the shared ownership, content, dependency, lifetime, and integration model.

## Common mistakes

| Symptom | Fix |
| --- | --- |
| A pass is absent from the compiled plan | Retain its final value with the appropriate root, or declare only genuine side effects. |
| A read or preserving write reports undefined contents | Overwrite the complete range first or choose the correct imported initial contents. |
| An imported resource cannot execute | Bind the matching native object and ensure descriptor and usage metadata agree. |
| A typed token fails to resolve | Resolve it only through the pass that declared it and only inside that pass's callback. |
| A transient object is used later | Never clone or retain resolved transient wgpu handles across callbacks or frames. |
| External work is incorrectly ordered | Submit all declared work on the shared queue before the external callback returns. |
| Timing is unavailable | Treat unsupported, busy, readback failure, and overflow as non-fatal timing results. |

## Complete examples

The following Cargo examples are published with the crate and compile-checked
outside the workspace:

| Workflow | Example |
| --- | --- |
| Minimal presentation lifecycle | [`minimal_frame.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg/examples/minimal_frame.rs) |
| Transient render target to presentation | [`transient_to_present.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg/examples/transient_to_present.rs) |
| Caller-owned imported resource | [`imported_resource.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg/examples/imported_resource.rs) |
| Cross-frame persistent state | [`persistent_state.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg/examples/persistent_state.rs) |
| Opaque third-party submission | [`external_submission.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg/examples/external_submission.rs) |
| Portable Snapshot export | [`snapshot_export.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg/examples/snapshot_export.rs) |
| Asynchronous GPU timing | [`gpu_timing.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg/examples/gpu_timing.rs) |
| Compute storage output | [`compute_output.rs`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg/examples/compute_output.rs) |

The repository also contains CPU-only compile and pool benchmarks. Snapshot
export requires the `snapshot` feature.

## Further reading

- [ZenFG documentation index](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/docs/README.md)
- [Core concepts](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/docs/core-concepts.md)
- [`zenfg-snapshot`](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/crates/zenfg-snapshot/README.md)
- [Compatibility](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/docs/compatibility.md)

## Documentation and versions

<!-- generated:documentation:start -->
This README describes **zenfg 0.1.0**. Registry badges show the current published channel, not your installed version.

- Exact installed APIs: read the included `src/`, or run `cargo doc --open` in your consuming project.
- [Online guide (development branch)](https://uinosoft.github.io/zenfg/docs/packages/zenfg.html). The site may describe changes newer than this package.
- [Rust API for this version](https://docs.rs/zenfg/0.1.0/).
- [Source and documentation for this release](https://github.com/uinosoft/zenfg/tree/cargo/zenfg/v0.1.0/crates/zenfg).
- [Shared concepts for this release](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/docs/core-concepts.md) and [compatibility](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.1.0/docs/compatibility.md).
- [Plain Markdown documentation index (development branch)](https://uinosoft.github.io/zenfg/docs/llms.txt).
- Complete Cargo recipes are included in `examples/`.
<!-- generated:documentation:end -->

## Execution timing

Use `execute_with_timing(&queue, options, TimingMode::Cpu)`,
`TimingMode::Gpu`, or `TimingMode::Both`. The result owns an optional synchronous
CPU report and optional GPU readback. Poll the latter with `try_take()`; CPU-only
execution never waits for a GPU result. Ordinary execution collects no timing.
CPU is synchronous elapsed time for all executed node kinds, not thread CPU
usage. Execution total includes preparation, submission and transient release.
