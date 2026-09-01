# ZenFG quick reference

This is the compact, language-neutral entrypoint for humans and coding agents
integrating ZenFG. It summarizes the supported public packages and the shared
FrameGraph semantics. Follow the linked package README and generated API docs
for exact signatures, defaults, and errors.

## Choose a package

| Need | TypeScript / WebGPU | Rust / wgpu |
| --- | --- | --- |
| Record, compile, and execute GPU work | `@zenfg/webgpu` | `zenfg` |
| Read, write, migrate, or validate Snapshot 1.0 | `@zenfg/snapshot` | `zenfg-snapshot` |
| Embed a renderer-independent DOM viewer | `@zenfg/inspector` | Use a Snapshot producer and the TypeScript Inspector |
| Convert a runtime report to Snapshot 1.0 | `@zenfg/webgpu/snapshot` | `zenfg` with the `snapshot` feature |

Install only the layer your application owns:

```sh
npm install @zenfg/webgpu@0.1.0-beta.1
npm install @zenfg/snapshot@0.1.0-beta.1
npm install @zenfg/inspector@0.1.0-beta.1
```

```sh
cargo add zenfg@0.1.0-beta.1
cargo add zenfg-snapshot@0.1.0-beta.1
cargo add zenfg@0.1.0-beta.1 --features snapshot
```

The Rust runtime features are:

| `zenfg` feature | Default | Adds |
| --- | --- | --- |
| `default` | Yes | Empty feature set; the core compiler and device-backed executor are always available |
| `serde` | No | Serde support for internal compilation report types |
| `snapshot` | No | `zenfg-snapshot`, wire-type re-exports, and report export |

The core runtime is available even with `--no-default-features`. `snapshot` is
the portable interchange feature. Enable `serde` only when an application must
serialize ZenFG's internal report model directly.

## Lifecycle

Keep one runtime per device and create a new recording for each logical frame.

```text
TypeScript: FrameGraph(device) -> beginFrame() -> recorder -> compile() -> execute()
Rust:       FrameGraph          -> begin_frame() -> Frame    -> compile() -> execute(queue)
```

- The runtime owns transient pooling and optional timing resources, not the
  device, queue, surface, pipelines, bind groups, scene, or application policy.
- Compilation consumes the recording. Handles and access tokens cannot cross
  recording boundaries.
- Acquire and import a fresh current surface texture for every presentation
  frame. Presentation itself remains application-owned.
- TypeScript compiled frames may be re-executed only while every captured
  callback and imported GPU object remains valid. Rust execution is one-shot.
- Retained work executes as a stable subsequence of recording order. ZenFG
  culls unreachable work but does not reorder or merge nodes.
- External submissions split FrameGraph-owned command segments. They guarantee
  queue submission order, not GPU completion.
- Release TypeScript runtime-owned resources with `FrameGraph.destroy()`.
  Rust releases them when `FrameGraph` is dropped; either runtime can clear its
  retained transient pool explicitly.

## Choose resource ownership

| Resource | Use it when | TypeScript | Rust |
| --- | --- | --- | --- |
| Transient texture or buffer | Storage exists only for this compiled frame | `createTexture()`, `createBuffer()` | `create_texture()`, `create_buffer()` |
| Imported texture or buffer | Caller owns native storage and lifetime | `importTexture()`, `importBuffer()` | `import_texture()` / `import_buffer()`, then `bind_imported_*()` for execution |
| Current surface texture | Value is the current presentation target | `importSwapchainTexture()` | `import_surface_texture()`, then `bind_imported_texture()` |
| Logical texture view | Dependencies need a subresource selection | `createTextureView()` | `create_texture_view()` |
| Non-resource state | It has no graph-visible data flow | Keep it outside ZenFG | Keep it outside ZenFG |

Transient resources are allocated, aliased, pooled, and destroyed by the
runtime. Imported resources are borrowed: ZenFG never destroys or pools them.
Import one native resource once per recording and share its logical handle.

TypeScript reads native import metadata directly and may narrow it with
`exposedUsage` or `exposedSize`. Rust registers a logical descriptor and exposed
usage first, then validates the separately bound native object before execution.

## Content and dependency rules

A handle names recording-local storage. The value visible to a node is selected
by resource range and node recording position, not by handle or token creation
order.

- Transient and surface contents begin undefined.
- Imported contents begin defined in TypeScript unless `initialContents` says
  otherwise; Rust requires an explicit `InitialContents` choice.
- A read requires a defined value over its complete declared range.
- `overwrite` means the write fully defines the range and does not consume its
  previous value. The first write to transient storage must overwrite.
- `preserve` is required for partial, conditional, sparse, or atomic writes and
  retains the previous value without inventing a physical read access.
- An attachment clear overwrites; an attachment load preserves. A stored result
  is defined, while `storeOp: 'discard'` / `AttachmentStoreOp::Discard` leaves
  the affected contents undefined.
- Texture dependencies use normalized mip/layer/depth-slice regions. Buffer
  dependencies use byte ranges; an omitted range covers the whole buffer.
- RAW edges carry values and can retain producers. WAR and WAW edges preserve
  order but do not make otherwise unreachable work observable.

In TypeScript, `recorder.use()` creates an opaque typed token. List that exact
token in a node's `uses`, then call `unwrap(token)` only inside the node's
synchronous callback. In Rust, declare an access on its `PassBuilder` and resolve
the returned typed token only through that pass's execution context. Never cache
resolved transient GPU objects outside the callback.

## Common tasks to public API

| Task | TypeScript | Rust |
| --- | --- | --- |
| Start a recording | `graph.beginFrame()` | `graph.begin_frame()` |
| Add render work | `recorder.render()` | `frame.render_pass()` + `finish_render()` |
| Add compute work | `recorder.compute()` | `frame.compute_pass()` + `finish_compute()` |
| Add copies | `recorder.copy()` | `frame.copy_pass()` + copy methods |
| Clear a buffer | `recorder.clearBuffer()` | `frame.clear_buffer()` / `clear_buffers()` |
| Encode custom commands | `recorder.command()` | `frame.command_pass()` + `finish_command()` |
| Call a renderer that submits itself | `recorder.externalSubmission()` | `frame.external_submission()` + `finish_external()` |
| Retain a surface result | `markPresent()` | `mark_present()` |
| Retain an application output | `markOutput()` | `mark_buffer_root()` / `mark_texture_root()` with `RootReason::Output` |
| Retain imported cross-frame state | `markPersistentState()` | `mark_buffer_root()` / `mark_texture_root()` with `RootReason::PersistentState` |
| Retain an imported readback buffer | `markReadback()` | `mark_readback()` |
| Retain a debug capture | `markDebugCapture()` | `mark_buffer_root()` / `mark_texture_root()` with `RootReason::DebugCapture` |
| Get a compact compilation | `compile()` | `compile(CompileOptions::default())` |
| Get full diagnostics | `compile({ report: true })` | `compile(CompileOptions::full_report())` |
| Execute with GPU debug groups | `execute({ gpuDebugGroups: true })` | `execute_with_options(queue, ExecutionOptions::default().with_gpu_debug_groups(true))` |
| Request GPU timing | `execute({ gpuTiming: true })` | `execute_with_gpu_timing()` |
| Inspect pool counters | `getResourcePoolStats()` | `resource_pool_stats()` |
| Export Snapshot 1.0 | `createFrameGraphSnapshot()` from the supported diagnostic subpath | `snapshot::create_frame_graph_snapshot()` with feature `snapshot` |
| Decode or migrate a Snapshot | `decodeFrameGraphSnapshot()` | `decode_frame_graph_snapshot()` |
| Parse Snapshot JSON text | `parseFrameGraphSnapshot()` | `parse_frame_graph_snapshot()` |
| Validate canonical Snapshot data | `validateFrameGraphSnapshot()` | `validate_frame_graph_snapshot()` |
| Read the Snapshot extension depth limit | `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` | `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` |

## TypeScript and Rust name map

The implementations share semantics and diagnostics, not source-level API
parity. Translate intent rather than mechanically translating syntax.

| Concept | TypeScript | Rust |
| --- | --- | --- |
| Recording | `FrameGraphRecorder` | `Frame<'frame>` |
| Executable plan | `CompiledFrame` | `CompiledFrame<'frame>` |
| Texture / buffer handle | `TextureHandle`, `BufferHandle` | `Texture<'frame>`, `Buffer<'frame>` |
| Texture view handle | `TextureViewHandle` | `TextureView<'frame>` |
| Write semantics | `'overwrite'`, `'preserve'` | `WriteContents::{Overwrite, Preserve}` |
| Initial contents | `'defined'`, `'undefined'` | `InitialContents::{Defined, Undefined}` |
| Maximum extension JSON depth | `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` | `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` |
| Sampled texture | `TextureAccess.Sampled` | `PassBuilder::sampled_texture()` |
| Storage texture read/write | `TextureAccess.StorageRead/StorageWrite` | `storage_texture_read()` / `storage_texture_write()` |
| Color attachment | `colorAttachments` | `color_attachment()` and `ColorAttachmentOps` |
| Depth attachment | `depthStencilAttachment` | `depth_attachment()` / `depth_attachment_read_only()` |
| Uniform buffer | `BufferAccess.Uniform` | `uniform_buffer()` |
| Storage buffer read/write | `BufferAccess.StorageRead/StorageWrite` | `storage_buffer_read()` / `storage_buffer_write()` |
| Vertex/index/indirect buffer | matching `BufferAccess` value | matching `PassBuilder` method |
| Copy source/destination | matching `TextureAccess` / `BufferAccess` value | matching typed copy method |
| Presentation root | `markPresent()` | `mark_present()` |
| Structured runtime error | JavaScript `Error` with stable message contract where documented | `FrameGraphError` with stable `FGxxxx` code and graph context |

## Frequent failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| A recorded node is absent from execution | It reaches no resource root and is not a side effect | Mark the intended final value or explicitly declare a genuine side effect |
| Read-before-produce / undefined-content error | The selected range has no defined producer | Clear or overwrite it first, or correctly declare defined imported contents |
| First transient write is rejected | It was declared `preserve` | Use `overwrite` only if the whole declared range is written |
| `unwrap()` or typed-token resolution fails | Token is missing from the active node or belongs to another pass/recording | Declare and resolve the same token in the same node callback |
| Duplicate native import error | One GPU object was registered more than once | Import once at the composition boundary and pass the logical handle onward |
| Usage or descriptor mismatch | Explicit/transient usage or exposed/imported metadata omits an actual access | Omit transient usage for inference, or include every retained role and bind matching native storage |
| Presentation work fails on a later frame | An old current surface texture or compiled presentation frame was reused | Acquire, import, compile, and execute a fresh surface recording each frame |
| Recording rejects further calls | `compile()` already consumed it, successfully or unsuccessfully | Start a new recording with `beginFrame()` / `begin_frame()` |
| Work after an external node starts too early | The external callback queued work after returning or used another queue | Enqueue all graph-visible work on the supplied device queue before returning |
| Code waits for an external boundary as a fence | A segment boundary orders submissions only | Use the graphics API's completion mechanism when CPU/GPU completion is required |
| GPU timing reports unavailable | Timestamp queries are unsupported, busy, or readback failed | Treat unavailable timing as non-fatal and continue normal execution |
| Readback root is rejected | Buffer is transient or exposes the wrong usage | Import caller-owned storage exposed exactly as `COPY_DST | MAP_READ` |
| Snapshot input is rejected | JSON, format/version, structure, or cross-reference semantics are invalid | Use the decoder, inspect structured issues, and add an explicit migration for new versions |

## Complete recipes

The TypeScript recipes are complete, type-checked functions with runtime-owned
inputs supplied explicitly. Rust covers the same workflows with idiomatic Cargo
examples:

| Workflow | TypeScript | Rust |
| --- | --- | --- |
| Minimal frame | [`minimal-frame.ts`](../packages/webgpu/examples/minimal-frame.ts) | [`minimal_frame.rs`](../crates/zenfg/examples/minimal_frame.rs) |
| Transient to present | [`transient-to-present.ts`](../packages/webgpu/examples/transient-to-present.ts) | [`transient_to_present.rs`](../crates/zenfg/examples/transient_to_present.rs) |
| Imported resource | [`imported-resource.ts`](../packages/webgpu/examples/imported-resource.ts) | [`imported_resource.rs`](../crates/zenfg/examples/imported_resource.rs) |
| Persistent state | [`persistent-state.ts`](../packages/webgpu/examples/persistent-state.ts) | [`persistent_state.rs`](../crates/zenfg/examples/persistent_state.rs) |
| External submission | [`external-submission.ts`](../packages/webgpu/examples/external-submission.ts) | [`external_submission.rs`](../crates/zenfg/examples/external_submission.rs) |
| Snapshot export | [`snapshot-export.ts`](../packages/webgpu/examples/snapshot-export.ts) | [`snapshot_export.rs`](../crates/zenfg/examples/snapshot_export.rs) |
| GPU timing | [`gpu-timing.ts`](../packages/webgpu/examples/gpu-timing.ts) | [`gpu_timing.rs`](../crates/zenfg/examples/gpu_timing.rs) |

GPU-dependent examples are compile-checked. CI also executes the CPU-only
`minimal-frame` and `snapshot-export` workflows; Snapshot export enables the
Rust `snapshot` feature.

For deeper context, continue with the [architecture guide](architecture.md),
[semantic model](semantic-model.md), [integration levels](integration.md), and
the Snapshot [`SPEC.md`](../packages/snapshot/SPEC.md).

## Versions and support boundary

- All five public packages are currently `0.1.0-beta.1`; public APIs may change
  before 1.0, so integration projects should pin the exact beta version.
- Snapshot wire format version `1.0` is independent from package versions.
  Unknown wire versions are rejected until a reader implements migration.
- Current repository tooling targets Node.js 24, npm 11, TypeScript 6, Rust
  1.98, and wgpu 30. Browser runtime support depends on native WebGPU and modern
  DOM capabilities rather than Node.js.
- Import TypeScript runtime APIs from documented package entrypoints only.
  Source files and undeclared `dist` paths are not supported subpaths.
- The normative Snapshot specification, Schema, fixtures, and conformance
  corpus live in `@zenfg/snapshot`; runtime producers do not own wire semantics.
- ZenFG owns graph-visible ordering, retention, validation, transient planning,
  and diagnostics. Rendering architecture, device loss, surface policy, resource
  contents, filesystem storage, and capture naming remain caller-owned.
