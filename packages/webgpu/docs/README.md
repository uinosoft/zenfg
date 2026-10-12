# @zenfg/webgpu usage



`@zenfg/webgpu` is a lightweight WebGPU FrameGraph for declaring and executing
per-frame GPU work. It orders graph nodes, validates resource access, culls
unused work, derives WebGPU usage, tracks lifetimes, and reuses transient
textures and buffers.

Build rendering features directly with WebGPU or compatible libraries, and combine
them with existing renderers through explicit graph integration. See the
[composition model](./CONCEPTS.md#integration-levels).

It is not a renderer abstraction. ZenFG owns graph-visible dependencies,
execution order, retention, transient allocation, and optional diagnostics.
The caller owns scenes, pipelines, bind groups, samplers, long-lived resources,
surface presentation, device-loss policy, and concrete draw or dispatch work.

Public APIs may change before 1.0. Pin the exact package version and review
migration notes before upgrading.
Import runtime APIs from the package root; the only supported
diagnostic subpath is `@zenfg/webgpu/snapshot`.

<!-- skill:description:start -->
Use @zenfg/webgpu to integrate WebGPU rendering or compute, declare resource access, organize diagnostic groups, retain outputs, manage transient pools, or export frame diagnostics.
<!-- skill:description:end -->

<!-- skill:quick-start:start -->
## Quick start

Run this in a browser module served from HTTPS or localhost, with native WebGPU enabled.
The host supplies a `GPUDevice` and a configured canvas `GPUCanvasContext`. Call
`renderFrame()` from the host animation loop; the canvas clears to dark blue.
For a ready-to-run canvas host, open the [minimal-frame recipe in the Examples](https://uinosoft.github.io/zenfg/playground/?example=minimal-frame).

Keep one `FrameGraph` for the lifetime of a `GPUDevice`. Create a fresh
recording and import a fresh current surface texture for every presentation
frame. This complete example needs no render pipeline because it only clears
the surface attachment:

```ts
import { FrameGraph } from '@zenfg/webgpu';

// `device` and the configured `context` are caller-owned.
const graph = new FrameGraph(device);
let frameIndex = 0;

function renderFrame(): void {
	const recorder = graph.beginFrame();
	const backbuffer = recorder.importSwapchainTexture(
		context.getCurrentTexture(),
		{ label: 'backbuffer' },
	);

	recorder.render({
		label: 'clear-backbuffer',
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0.04, g: 0.06, b: 0.1, a: 1 },
		}],
	});

	recorder.markPresent(backbuffer);
	recorder.compile().execute({ frameIndex: frameIndex++ });
}

// When the device-bound renderer stack is released:
// graph.destroy();
```

Imported GPU objects must belong to the `GPUDevice` passed to `FrameGraph`.
ZenFG checks graph dependencies, logical ranges, content flow, access
declarations, usage contracts, bounded resource planning, and format
categories. Native resource-descriptor, render-pass, texture-view,
copy-command, device-limit, and command validation remains a WebGPU
responsibility, including native copy alignment, format, aspect, and
same-resource overlap rules. Non-empty buffer-texture copies additionally
require a known format footprint so ZenFG can track the buffer byte range used
by the copy. A zero-sized copy is a native no-op and does not define or consume
graph contents; if retained, it is still encoded for native parameter
validation.
Native WebGPU validation errors may be reported
asynchronously through error scopes or `uncapturederror`; ordinary execution
does not wait for those results and does not convert them to ZenFG error codes.
ZenFG also checks device-independent texture shape rules and structural usage
requirements for retained transient allocations before creating native
resources. Format capabilities and device limits remain native validation.
WebGPU `TRANSIENT_ATTACHMENT` is currently rejected because Snapshot 1.2 does
not encode it; it is distinct from a ZenFG transient resource.

`markPresent()` makes the final surface value observable. Without a resource
root or a side-effect node, work that contributes to no result is culled.
Normal execution records and submits synchronously; only optional GPU timing
returns an asynchronous readback result.
<!-- skill:quick-start:end -->

<!-- skill:lifecycle:start -->
## Lifecycle

```text
FrameGraph runtime -> FrameGraphRecorder -> CompiledFrame
device lifetime       one recording        retained executable plan
```

- `FrameGraph` is permanently bound to one caller-owned `GPUDevice` and owns
  the transient pool and lazy profiler resources.
- `beginFrame()` creates an independent, single-use recording. A successful or
  failed `compile()` consumes it.
- Handles, views, and access tokens are local to one recording.
- A compiled frame can be re-executed only while all captured callbacks and
  imported GPU objects remain valid. Presentation recordings normally should
  not be re-executed.
- `destroy()` releases runtime-owned resources; it never destroys the device or
  imported resources.
<!-- skill:lifecycle:end -->

<!-- skill:grouping:start -->
## Diagnostic grouping

Debug groups annotate recorded resources and passes in reports and Inspector.
Recorded pass paths can emit optional native GPU markers. Groups do not create
dependencies, retain work, own resources, or partition allocation. Choose `ResourcePoolScope` independently for
pool reuse and eviction.

- Organize coherent features and useful phases with shallow, meaningful names.
  Atmosphere can include sky, clouds, haze and lens flare; unrelated Water work
  keeps its own attribution.
- Put feature-local, graph-visible declarations and their processing passes in
  the appropriate group at their original recording points. Shared imports stay
  at the composition boundary of each recording; reuse their handles across groups.
- Preserve correct recording and submission order. When a feature is interleaved,
  use semantic segments such as `atmosphere.environment`, `atmosphere.sky`,
  `atmosphere.air-haze` and `atmosphere.lens-flare` instead of moving unrelated work.
  These are example labels, not a mandatory taxonomy.
- Bloom's repeated downsample/upsample passes are a useful grouping case: use an
  outer `bloom` and, when helpful, `downsample`/`upsample` phases. Give passes their
  actual mip or iteration numbers; avoid a new group for every mip or deep nesting.
  Real iteration numbers are useful; arbitrary segment numbers are not.
- Prefer synchronous `withDebugGroup()`. Balance manual push/pop calls and close
  groups before compilation. Every push/with creates a distinct recording-local
  group; repeated labels do not reopen an ID, and dots do not create hierarchy.
- A resource keeps the group captured at declaration/import, even when other
  groups use it. Group attribution does not transfer native ownership or make
  transient objects safe to retain.

See the [Bloom grouping adapter](#bloom-grouping-adapter) for supported API usage.
<!-- skill:grouping:end -->

### Bloom grouping adapter

This adapter records caller-prepared, valid pass descriptors without changing
their order, labels, attachments or accesses. Use it only when the existing
plan has contiguous downsample then upsample work. Keep each descriptor's label
specific, for example `bloom.downsample.mip-2` or `bloom.upsample.mip-1`.
The caller supplies pipelines, shaders and resource declarations; this is a
grouping adapter, not a Bloom filter implementation. Already-declared resources
keep their declaration groups.

~~~ts
import type { FrameGraphRecording, RenderPassNodeDesc } from '@zenfg/webgpu';

export function recordBloomGroups(
  recorder: FrameGraphRecording,
  downsample: readonly RenderPassNodeDesc[],
  upsample: readonly RenderPassNodeDesc[],
): void {
  recorder.withDebugGroup('bloom', () => {
    recorder.withDebugGroup('downsample', () => {
      for (const pass of downsample) recorder.render(pass);
    });
    recorder.withDebugGroup('upsample', () => {
      for (const pass of upsample) recorder.render(pass);
    });
  });
}
~~~

For interleaved work, record separate phase groups at the original call sites.
The recorder does not offer entry into an existing group ID. Snapshot can express
non-contiguous group references, and native GPU markers may reopen the recorded
path around submission segments; neither adds a recorder re-entry API.
Enable `gpuDebugGroups` at execution only when native markers are wanted.

## Common tasks

| Task | Public API |
| --- | --- |
| Create the device-bound runtime | `new FrameGraph(device)` |
| Annotate diagnostic groups | `pushDebugGroup()`, `popDebugGroup()`, `withDebugGroup()` |
| Start a recording | `beginFrame()` |
| Create transient storage | `createTexture()`, `createBuffer()` |
| Import caller-owned storage | `importTexture()`, `importBuffer()` |
| Import the current presentation target | `importSwapchainTexture()` |
| Select texture subresources | `createTextureView()` |
| Declare typed resource access | `use()` with `TextureAccess` or `BufferAccess` |
| Record structured work | `render()`, `compute()`, `copy()`, `clearBuffer()` |
| Add native render-pass fields | `render({ webgpuDescriptor })` with `WebGpuRenderPassDescriptorExtras` |
| Encode custom graph-owned commands | `command()` |
| Call a renderer that submits itself | `externalSubmission()` |
| Retain observable values | `markPresent()`, `markOutput()`, `markReadback()`, `markDebugCapture()`, `markPersistentState()` |
| Compile a compact executable plan | `compile()` |
| Request full compilation diagnostics | `compile({ report: true })` |
| Execute and optionally request timing/debug groups | `compiled.execute()` |
| Inspect or manage retained allocations | `getResourcePoolStats()`, `createResourcePoolScope()`, `clearResourcePool(scope?)`, `evictResourcePool(predicate)` |
| Export portable diagnostics | `createFrameGraphSnapshot()` from `@zenfg/webgpu/snapshot` |
| Release runtime-owned resources | `destroy()` |

Exact fields, overloads, defaults, return types, and failure conditions are
documented by the TSDoc preserved in the packaged source and declarations.

## Key pattern: declare, list, and unwrap access

`use()` creates an opaque typed token. A node must list that exact token in
`uses` before its synchronous callback can resolve it with `unwrap()`:

```ts
const sampledSceneColor = recorder.use(
	sceneColor,
	TextureAccess.Sampled,
);

recorder.render({
	label: 'present',
	uses: [sampledSceneColor],
	colorAttachments: [{
		target: backbuffer,
		loadOp: 'clear',
		storeOp: 'store',
	}],
	encode({ pass, unwrap }) {
		const sceneColorView = unwrap(sampledSceneColor);
		pass.setPipeline(presentPipeline);
		pass.setBindGroup(0, createPresentBindGroup(sceneColorView));
		pass.draw(3);
	},
});
```

Resolved transient objects are callback-scoped. Do not cache them across
callbacks or frames. The complete
[`transient-to-present.ts`](../examples/transient-to-present.ts) recipe shows the
pipeline and bind-group setup without placeholder helpers.

## Native render-pass descriptor extras

`render({ webgpuDescriptor })` forwards additional native WebGPU descriptor
fields while retaining normal attachment validation, load/store/resolve content
tracking, explicit `uses`, and optional GPU timing. Omitting it preserves the
existing descriptor. ZenFG owns `label`, `colorAttachments`,
`depthStencilAttachment`, and `timestampWrites`; these fields are forbidden in
extras by the public type and rejected at recording with `FG2013`.

Use `WebGpuRenderPassDescriptorExtras` for standard fields such as
`occlusionQuerySet` and `maxDrawCount`, or add application-local types for
experimental fields. For example, the
[GPUWeb bindless draft](https://github.com/gpuweb/gpuweb/blob/main/proposals/bindless.md#encoder-state-and-pipeline-compatibility)
adds `resourceTable` to the native render-pass descriptor. The application
supplies its actual native table; ZenFG does not define an experimental table API:

```ts
import type {
	FrameGraphRecording,
	RenderPassNodeDesc,
	WebGpuRenderPassDescriptorExtras,
} from '@zenfg/webgpu';

type ResourceTableDescriptorExtras = WebGpuRenderPassDescriptorExtras & {
	readonly resourceTable: object;
};

function recordWithResourceTable(
	recorder: FrameGraphRecording,
	draw: Omit<RenderPassNodeDesc, 'webgpuDescriptor'>,
	resourceTable: object,
): void {
	const webgpuDescriptor: ResourceTableDescriptorExtras = { resourceTable };
	recorder.render({ ...draw, webgpuDescriptor });
}
```

Only own enumerable string data properties are accepted. Symbols, accessors,
non-enumerable own properties, and `__proto__`, `constructor`, or `prototype`
fields are rejected with `FG2013`. Recording takes a shallow snapshot of the
fields: later changes to the descriptor object do not change the compiled
frame, and referenced GPU objects retain their identity. Keep those objects
valid for every execution of a retained compiled frame; ZenFG does not create,
update, import, or destroy a resource table supplied this way.

The application owns native feature detection, enabled device features, pipeline
layout compatibility (including draft `usesResourceTable`), and native
validation. Extras do not infer graph dependencies: graph textures or buffers
accessed through a table still need their access tokens explicitly listed in
the node's `uses`, even when the shader does not use a bind group for them.
Resolved transient objects remain callback-scoped. Native extras are specific
to the TypeScript WebGPU runtime and are not included in portable Snapshots.

The compiled [`imported-resource.ts`](../examples/imported-resource.ts) recipe
accepts optional `webgpuDescriptor` and a caller-owned MSAA target. Its normal
attachment resolves to the presentation texture and discards only the
multisample source that it never reads again. Keep `storeOp: 'store'` for any
MSAA attachment whose contents a later node needs.

<!-- skill:resource-decisions:start -->
## Resource and integration choices

Allocation ownership and graph visibility are separate choices. Importing
caller-owned storage enables graph tracking without transferring native ownership.

| Need | Typical choice |
| --- | --- |
| Frame-local allocation and pooling | Declare transient Bloom intermediates, G-buffer attachments or graph-managed compute scratch. |
| Data flow between graph nodes, persistent state, output or readback | Declare the relevant resources, ranges and accesses. Import caller-owned history, scene storage or staging buffers; retain observable results with the appropriate roots. |
| Private storage with no useful graph dependency or management role | Cached read-only mesh vertex/index buffers, material textures, weights or workload-internal scratch may stay module-owned and internally bound. The caller owns initialization, lifetime and safe internal execution. |
| CPU or native binding state | Scene/camera objects, pipelines, bind groups and samplers remain application-owned. A native resource table is not itself a graph texture or buffer. Assess its underlying resources separately. |

Longevity alone does not decide visibility. If a graph node writes a persistent
vertex/index buffer or material texture and another consumes it, expose the
needed data flow rather than hiding it as a cached asset. For graph-visible
resources, import once per recording and declare all accesses through structured attachments
or `use()` tokens listed in the node's `uses`. Private native bindings are not
automatically scanned. Use `command()` or `externalSubmission()` with declared
boundary accesses for custom/opaque work; an external node orders shared-queue
submissions, not GPU completion.

The native `resourceTable` descriptor extra only passes through caller-owned
state. Its entries are not automatically imported, dependency-tracked or
synchronized. Graph-visible textures/buffers accessed through it still need
declarations and `uses`; the application owns features, pipeline compatibility
and native lifetimes. See [native extras](#native-render-pass-descriptor-extras)
and [resource declaration granularity](CONCEPTS.md#choosing-resource-declaration-granularity).
<!-- skill:resource-decisions:end -->

Declaration granularity is optional: complex workloads can keep private weights,
parameters, and scratch internally bound, while teaching or diagnostic use can
expose more resources. Graph-visible dependencies and access correctness still
apply. See [Choosing resource declaration granularity](CONCEPTS.md#choosing-resource-declaration-granularity).

For resources exposed to the graph:

- Create a transient resource when native storage is needed only for the
  compiled frame. Import a resource when the caller owns its native storage or
  it must survive execution.
- Transient and surface contents begin undefined. The first write to a
  transient range must fully overwrite it. Use preserve for partial,
  conditional, sparse, or atomic writes.
- `clearBuffer()` with omitted `size` clears from `offset` (default zero) to
  the logical buffer boundary, including when an import narrows the native size.
  Texture-to-buffer copies with row or layer padding preserve previous contents
  in their tracked byte range. Initialize that range before copying if its
  contents are undefined; contiguous copies can initialize their own range.
- Use structured render, compute, copy, and clear nodes whenever possible. Use
  `command()` for custom work on a FrameGraph-owned encoder.
- Use `externalSubmission()` when a third-party renderer owns and submits its
  encoders. The node orders queue submissions but is not a GPU-completion fence.
- Acquire, import, compile, execute, and present a fresh surface texture on each
  presentation frame.

See [Core concepts](CONCEPTS.md)
for the complete ownership, content, dependency, lifetime, and integration
model.

## Error handling

ZenFG-detected failures in recording, compilation, and execution, including
invalid descriptors, access declarations, copy operations, ranges, roots, and
execution options, throw `FrameGraphError`. Branch on its stable `code` and
`phase`; `nodeId` and `resourceId` are present only when the failing node or
resource can be identified. Messages are for people and may change.

Exceptions thrown by application callbacks or the WebGPU implementation pass
through unchanged. Snapshot projection and serialization use a separate
`FrameGraphSnapshotValidationError` with structured `issues`; import it from
`@zenfg/webgpu/snapshot` alongside the Snapshot functions. Validation failures
that previously threw plain `Error` or `TypeError` now throw
`FrameGraphError` (which still extends `Error`).

## Diagnostics and Snapshot

Compilation reports, CPU/GPU timing, and pool statistics are opt-in and independent.
Requesting them does not change the execution plan. Convert matching reports to
the portable protocol through `@zenfg/webgpu/snapshot`; ordinary compile and
execute paths do not create Snapshot data.

Snapshot export produces an in-memory value only. Capture naming, filesystem
storage, transport, and retention policy remain caller-owned. The language-
neutral wire contract is defined by the
[`@zenfg/snapshot` specification](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/packages/snapshot/SPEC.md).

Use `compiled.executeWithTiming({ frameIndex, timing: 'cpu' })`, choosing
`'cpu'`, `'gpu'` or `'both'`. The returned `cpu` report is immediately
available; consume `gpu` as a Promise only when requested. Ordinary `execute()`
remains synchronous and does not collect timing. CPU duration is elapsed time,
not thread CPU usage, and covers every executed node kind. Keep compilation,
frame identity and pool counters from the same execution when exporting.

GPU timing uses two queries per retained render/compute node. More than 2048
timed nodes returns `unavailable` with reason `too-many-timed-nodes` before
creating timing resources. Execution still proceeds, and `both` retains CPU
results. Treat timing availability as optional when displaying or exporting it.

### Download a Snapshot for Inspector

`@zenfg/webgpu/snapshot` provides both the WebGPU projection and canonical
serializer. An application that already depends on `@zenfg/webgpu` does not
need `@zenfg/inspector` to export a file:

```ts
import type { FrameGraph, FrameGraphRecording } from '@zenfg/webgpu';
import {
  createFrameGraphSnapshot,
  stringifyFrameGraphSnapshot,
} from '@zenfg/webgpu/snapshot';

async function downloadRecordedFrame(
  recorder: FrameGraphRecording,
  graph: FrameGraph,
  frameIndex: number,
): Promise<void> {
  const compiled = recorder.compile({ report: true });
  const timing = compiled.executeWithTiming({ frameIndex, timing: 'both' });
  const resourcePool = graph.getResourcePoolStats();
  const gpuTiming = await timing.gpu;
  const snapshot = createFrameGraphSnapshot({
    frameIndex: timing.frameIndex,
    compilation: compiled.compilationReport,
    cpuTiming: timing.cpu,
    gpuTiming,
    resourcePool,
  });
  const json = stringifyFrameGraphSnapshot(snapshot, { pretty: true });
  const url = URL.createObjectURL(new Blob([json], {
    type: 'application/json;charset=utf-8',
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `frame-graph-${snapshot.capture.frameIndex}.fgsnapshot.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

Call this path for the next normally recorded application frame after a user
requests a capture; use ordinary `compile().execute()` for other frames. Save
pool statistics immediately after execution, before waiting for GPU timestamp
readback. GPU timing unavailability is recorded in the Snapshot and does not
prevent export. Drop the downloaded `.fgsnapshot.json` file into the
[hosted Inspector](https://uinosoft.github.io/zenfg/inspector/); imported files
are processed locally in the browser and are not uploaded.

## Common mistakes

| Symptom | Fix |
| --- | --- |
| A node disappears from execution | Retain its final value with the correct root, or mark only genuine side effects as such. |
| A read or preserving write reports undefined contents | Clear or fully overwrite the selected range first, or declare imported initial contents correctly. |
| The first transient write is rejected | Use `overwrite` only when the complete declared range is written. |
| `unwrap()` rejects a token | List the same token in the active node's `uses`; never cross a recording boundary. |
| The same native object is imported twice | Import it once at the composition boundary and share the logical handle. |
| A later presentation frame fails | Do not reuse an old current texture or compiled presentation frame. |
| Work after an external node starts too early | Queue all declared external work on the shared device queue before the callback returns. |
| Timing is unavailable | Treat `unsupported`, `busy`, `readback-failed`, and `no-timed-nodes` as non-fatal results. |

## Complete recipes

The following files are published with the package and type-checked as consumers
of supported public entrypoints:

| Workflow | Recipe |
| --- | --- |
| Minimal presentation lifecycle | [`minimal-frame.ts`](../examples/minimal-frame.ts) |
| Transient render target to presentation | [`transient-to-present.ts`](../examples/transient-to-present.ts) |
| Caller-owned imported resource | [`imported-resource.ts`](../examples/imported-resource.ts) |
| Cross-frame persistent state | [`persistent-state.ts`](../examples/persistent-state.ts) |
| Opaque third-party submission | [`external-submission.ts`](../examples/external-submission.ts) |
| Portable Snapshot JSON for browser download or other caller-owned storage | [`snapshot-export.ts`](../examples/snapshot-export.ts) |
| Asynchronous GPU timing | [`gpu-timing.ts`](../examples/gpu-timing.ts) |
| Compute storage output | [`compute-output.ts`](../examples/compute-output.ts) |
| Scoped resize cleanup and idle eviction | [`resource-pool-control.ts`](../examples/resource-pool-control.ts) |

GPU-dependent recipes are compile-checked. CPU-only workflows also execute in
CI. See the [examples index](../examples/README.md) for their input contracts.

<!-- skill:pool:start -->
## Resource pool maintenance

Create a scope once and pass it through transient declaration options:
`recorder.createTexture(desc, { scope })` or
`recorder.createBuffer(desc, { scope })`. Scope clearing affects only retained
cache entries, preserves historical counters, and leaves the scope usable.
Clear between executions after stopping old-size plans; a re-executed old plan
can recreate its allocations. `clearResourcePool()` and
`clearResourcePool(undefined)` clear every domain.

Use `evictResourcePool(info => info.unusedExecutions > 60)` for application
idle policy, or `info.scope === undefined` to select only the default domain.
The predicate receives frozen physical specifications, including rounded buffer
capacity, and no GPU handle or persistent instance ID. It must synchronously
return boolean. Selection throws leave the pool unchanged; traversal order is
unspecified and provides no strict LRU guarantee. Runtime execution and pool
mutation during selection are rejected. These APIs do not wait for GPU completion.

See [Resource pool control](../examples/resource-pool-control.ts) for a complete
resize and eviction recipe; [Core Concepts](CONCEPTS.md#lifetime-and-allocation)
defines ownership, idle counts and failure boundaries.
<!-- skill:pool:end -->

## Further reading

- [ZenFG documentation index](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/docs/README.md)
- [Core concepts](CONCEPTS.md)
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/packages/snapshot/README.md)
- [`@zenfg/inspector`](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/packages/inspector/README.md)
- [Compatibility](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/docs/compatibility.md)


<!-- skill:reading:start -->
## Usage references

- [Runtime concepts](./CONCEPTS.md)
- [Upgrade notes](./MIGRATION.md)
- [Complete examples](../examples/)
<!-- skill:reading:end -->
