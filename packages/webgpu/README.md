# @zenfg/webgpu

English | [简体中文](./README.zh-CN.md)

`@zenfg/webgpu` is a lightweight WebGPU FrameGraph for declaring and
executing per-frame GPU work. It orders graph nodes, validates resource access,
culls unused work, derives WebGPU usage, tracks lifetimes, and reuses transient
textures and buffers.

It is intentionally not a renderer abstraction. FrameGraph owns graph-visible
resources, dependencies, execution order, retention roots, transient allocation,
and optional diagnostics. Callers continue to own scene data, pipelines, bind
groups, samplers, long-lived GPU resources, setup and resize policy, and concrete
draw or dispatch behavior.

For a compact package/feature chooser, lifecycle and ownership summary,
TypeScript/Rust name map, troubleshooting table, and complete recipes, see the
[ZenFG quick reference](https://github.com/uinosoft/zenfg/blob/main/docs/quick-reference.md).

```txt
Caller-owned state -> graph node declarations -> FrameGraph -> ordered GPU commands
```

This is a public `0.1.x` package and all public APIs are beta. Import supported
APIs from the package root only:

```ts
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';
```

The package root is the runtime entrypoint. The one supported diagnostic
subpath is `@zenfg/webgpu/snapshot`; it converts an explicitly
requested compilation/timing/pool report into the independent
`@zenfg/snapshot` protocol. Other source modules and generated
files under `dist/` are not supported package subpaths.
The language-neutral wire semantics are defined by the Snapshot package's
`SPEC.md`; this package is the TypeScript producer, not the protocol owner.

## Installation

```sh
npm install @zenfg/webgpu
```

## Quick Start

### Minimal Frame

Keep one `FrameGraph` runtime for the lifetime of a `GPUDevice`. Create a fresh
recorder and import a fresh current swapchain texture for every presentation frame.
The following complete frame needs no render pipeline because the render pass only
clears its attachment:

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

// When the device-bound renderer stack is being released:
// graph.destroy();
```

`markPresent()` makes the final backbuffer value a retention root. Without a root
or a side-effect node, work that contributes to no observable result is culled.
Normal execution records and submits commands synchronously, so no `await` is
needed unless GPU timing is requested explicitly.

### Typical Transient-to-Present Flow

The next example shows the usual relationship between a transient scene target,
an access token, and a presentation pass. It assumes the caller has already
created:

- `scenePipeline`, which renders a fullscreen triangle into `rgba16float`;
- `presentPipeline`, which samples texture binding `1` with sampler binding `0`
  and renders into the configured canvas format;
- a caller-owned `sampler` compatible with the presentation pipeline.

```ts
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';

const graph = new FrameGraph(device);

function renderFrame(width: number, height: number, frameIndex: number): void {
	const recorder = graph.beginFrame();

	const sceneColor = recorder.createTexture({
		label: 'scene-color',
		format: 'rgba16float',
		size: [width, height],
	});
	const backbuffer = recorder.importSwapchainTexture(
		context.getCurrentTexture(),
		{ label: 'backbuffer' },
	);

	recorder.render({
		label: 'scene',
		colorAttachments: [{
			target: sceneColor,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
		encode({ pass }) {
			pass.setPipeline(scenePipeline);
			pass.draw(3);
		},
	});

	const sampledSceneColor = recorder.use(sceneColor, TextureAccess.Sampled);
	recorder.render({
		label: 'present',
		uses: [sampledSceneColor],
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
		encode({ device, pass, unwrap }) {
			const presentBindGroup = device.createBindGroup({
				layout: presentPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: sampler },
					{ binding: 1, resource: unwrap(sampledSceneColor) },
				],
			});
			pass.setPipeline(presentPipeline);
			pass.setBindGroup(0, presentBindGroup);
			pass.draw(3);
		},
	});

	recorder.markPresent(backbuffer);
	recorder.compile().execute({ frameIndex });
}
```

The scene target has no explicit WebGPU `usage`: compilation derives the retained
`RENDER_ATTACHMENT | TEXTURE_BINDING` requirements. The sampled token must appear
in the presentation node's `uses` list before that node may call `unwrap()`.

## Lifecycle And Core Model

FrameGraph uses three objects with distinct lifetimes:

```txt
FrameGraph runtime -> FrameGraphRecorder -> CompiledFrame
                       record + compile      execute / conditional re-execute
```

- `FrameGraph` is long-lived and permanently bound to one `GPUDevice`. It owns the
  transient resource pool and lazy GPU profiler resources.
- `beginFrame()` returns an independent, single-use recorder. Successful or failed
  `compile()` consumes it.
- `CompiledFrame` contains only retained execution data. Execution resolves
  logical resources, records and submits compiled segments, then returns transient
  resources to the runtime pool.

A compiled frame may be executed again only while every captured callback and
borrowed GPU resource remains valid. Captured declarative containers are detached
when recorded, but callbacks, imported GPU objects, handles, and use-token
identities remain fixed references. Re-execution does not refresh them or validate
their caller-owned lifetime.

In particular, a compiled frame containing a current swapchain texture is normally
frame-scoped. Acquire and import a fresh texture in the next frame instead of
re-executing an old presentation recording.

Execution is serialized per runtime. Recursive or overlapping `execute()` calls
on one runtime are rejected. Independent recorders may be recorded and compiled
while execution is in progress, but FrameGraph performs no cross-frame dependency
analysis; compiled frames rely on `GPUQueue` submission order.

## Core API At A Glance

| Area | Public API | Purpose |
| --- | --- | --- |
| Runtime | `new FrameGraph(device)` | Creates the device-bound runtime. |
| Recording | `beginFrame()` | Starts an independent single-use recording. |
| Transient resources | `createTexture()`, `createBuffer()` | Declares graph-owned resources for this compiled frame. |
| Imported resources | `importTexture()`, `importSwapchainTexture()`, `importBuffer()` | Registers caller-owned GPU resources in graph-visible data flow. |
| Resource metadata | `getTextureDesc()`, `getBufferDesc()` | Reads snapshotted registered descriptors. |
| Logical views | `createTextureView()`, `getTextureViewDesc()` | Selects texture subresources and reads the normalized view descriptor. |
| Access kinds | `TextureAccess`, `BufferAccess` | Names supported texture and buffer access roles. |
| Access declarations | `use()` | Creates a typed read or write token for a resource or view. |
| Diagnostic grouping | `withDebugGroup()`, `pushDebugGroup()`, `popDebugGroup()` | Associates recording-only hierarchy with resources and nodes. |
| Structured nodes | `render()`, `compute()`, `copy()`, `clearBuffer()` | Declares common WebGPU work with graph-visible accesses. |
| Escape hatches | `command()`, `externalSubmission()` | Records custom commands or an opaque caller-owned queue submission. |
| Retention roots | `markPresent()`, `markOutput()`, `markReadback()`, `markDebugCapture()`, `markPersistentState()` | Retains final visible producers for a specific intent. |
| Compilation | `compile()`, `compile({ report: true })` | Consumes the recorder and optionally attaches a diagnostic snapshot. |
| Execution | `compiled.execute()` | Encodes and submits retained execution segments. |
| Pool control | `getResourcePoolStats()`, `clearResourcePool()` | Observes or clears retained transient allocations. |
| Shutdown | `destroy()` | Releases runtime-owned resources and invalidates outstanding work. |

Exact fields, overloads, defaults, and callback types are documented by the TSDoc
preserved in `dist/index.d.ts`.

## Resources And Logical Values

### Choosing Ownership

Choose resource ownership from lifetime and graph-visible data flow:

- Use `createTexture()` or `createBuffer()` when the physical resource is needed
  only while this compiled frame executes. FrameGraph allocates, reuses, and
  releases it.
- Import a caller-owned resource when it outlives the graph and nodes must declare
  reads, writes, copies, retention, or presentation involving it.
- Keep caller-owned implementation state outside FrameGraph when it does not
  participate in graph-visible data flow.

Camera data, pipelines, bind groups, samplers, and local caches therefore normally
remain outside the graph. Import a camera buffer only when its produced or consumed
data must participate in graph ordering or retention.

`getTextureDesc()`, `getBufferDesc()`, and `getTextureViewDesc()` expose independent
read-only snapshots for recording-time decisions such as choosing compatible
pipeline variants or binding ranges. Mutating a returned snapshot does not change
the graph declaration, and the getters do not transfer ownership. A transient
descriptor with omitted `usage` continues to report `usage: undefined`; derived
usage is a compilation result.

Each native `GPUTexture` or `GPUBuffer` has one logical identity per recording and
may be imported only once. `importTexture()` and `importSwapchainTexture()` share
the native texture identity check. Import shared storage once at its ownership or
application-assembly boundary and pass the resulting handle to every consumer.

Import metadata is snapshotted from the native WebGPU object. `exposedSize` can
restrict a buffer to a logical prefix, and `exposedUsage` can restrict either
resource type to a usage subset. These options constrain graph validation and
dependency analysis, but they are not a security boundary: `unwrap()` still
returns the complete native buffer.

Transient descriptors may omit `usage`; compilation derives flags from retained
accesses only. If `usage` is provided, it is treated as the allocation contract and
must cover all retained requirements. Culled accesses remain visible in reports
but do not contribute physical usage.

The pool may reuse compatible transient resources whose compiled lifetimes do not
overlap. Imported resources are never owned, destroyed, or pooled by FrameGraph.

### Ordered Logical Resources

A handle is a stable, recording-local logical storage identity, not a physical GPU
object or immutable value version. The value visible to a node is determined by:

1. the logical texture or buffer;
2. the selected texture subresources or buffer byte range;
3. the node's position in recording order.

Retained nodes execute as a stable subsequence of recording order. Compilation
selects required producers and adds RAW, WAR, and WAW dependencies; it does not
reorder nodes. Within one node, `uses` list order has no meaning: reads consume the
pre-node value and writes produce or invalidate the post-node value.

| Declaration | Pre-node value | Post-node value |
| --- | --- | --- |
| read | consumed | unchanged |
| overwrite write | not consumed | produced |
| preserve write | consumed | produced |
| discard write | not consumed unless the operation also loads | not produced |
| resource root | selects the final visible producer at the end of recording | none |

Every explicit write created through `use()` declares
`contents: 'overwrite' | 'preserve'`:

- `overwrite` certifies that the declared range is fully defined on every
  execution path and does not need its previous value.
- `preserve` is the conservative choice for partial, conditional, sparse, or
  atomic writes. It retains prior producers covering the declared range without
  inventing a physical read access in diagnostics.

The first write to a transient range must overwrite it. Imported resources start
with a caller-owned external value by default. Pass `initialContents: 'undefined'`
when that assumption is false; such a resource requires an overwrite before any
read or preserving write. Surface resources always begin undefined. An attachment
using `storeOp: 'discard'` invalidates its selected range;
a later read or preserve is invalid until another overwrite restores it.

Attachments, copy operations, and buffer clears infer accesses and content
semantics. `loadOp: 'load'` preserves, `loadOp: 'clear'` overwrites,
`storeOp: 'store'` produces, and `storeOp: 'discard'` does not produce. Buffer
copies and clears track exact byte ranges. Texture histories track mip, array
layer, 3D depth slice, and aspect; partial XY texture copies conservatively
preserve at that subresource granularity.

Buffer accesses can declare `{ range: { offset, size } }`; omission means the
whole buffer. Use the smallest exact overwrite range that GPU work fully defines,
and use preserve when static ranges cannot express dynamic or sparse coverage.

### Use Tokens And Texture Views

`use(handle, access, options?)` creates an opaque typed access token. Creating the
token does not create a dependency; each node that consumes it must list it in
`uses`. A token can be reused by multiple nodes and is resolved independently at
each node position, but duplicate use in one node is rejected.

Inside a synchronous node callback, `unwrap(token)` returns:

- `GPUTextureView` for sampled, storage, color, or depth texture access;
- `GPUTexture` for texture copy access;
- `GPUBuffer` for buffer access.

Only tokens listed by the active node may be unwrapped. Resolved resources and
encoders are valid only during that callback and must not escape it. Handles and
tokens cannot cross recording boundaries.

A `TextureViewHandle` selects format, dimension, aspect, mip levels, and array
layers without creating a physical allocation or capturing a value. Passing a raw
texture handle uses a role-specific default view: sampled access selects the
normal full view, while storage and attachment access select the required
single-mip form.

```ts
const bloomMip = recorder.createTextureView(bloom, {
	baseMipLevel: mip,
	mipLevelCount: 1,
});
const bloomMipDesc = recorder.getTextureViewDesc(bloomMip);
const sampledBloomMip = recorder.use(bloomMip, TextureAccess.Sampled);

recorder.render({
	uses: [sampledBloomMip],
	colorAttachments: [{
		target: output,
		loadOp: 'clear',
		storeOp: 'store',
	}],
	encode({ pass, unwrap }) {
		void bloomMipDesc;
		pipeline.encode(pass, unwrap(sampledBloomMip));
	},
});
```

`TextureDesc.viewFormats` is the creation-time allowlist for compatible alternate
formats, commonly a linear/sRGB pair. For imports, the caller must ensure each
declared alternate format was allowed when the native texture was created because
WebGPU does not expose that original list.

## Nodes And Roots

### Structured Nodes

Use the most specific node type available:

- `render()` maps to `beginRenderPass()`. Attachments declare their own accesses;
  sampled, storage, and buffer dependencies belong in `uses`.
- `compute()` maps to `beginComputePass()` and declares accessed resources through
  `uses`.
- `copy()` records declarative buffer/texture copies and infers their accesses.
- `clearBuffer()` records declarative `clearBuffer()` operations and infers exact
  `CopyDst` overwrite ranges. Offsets and sizes must be 4-byte aligned.
- `command()` is the fallback for work that does not fit a structured node. It is
  a side effect by default, must declare every token it unwraps, and must not
  finish or submit its FrameGraph-owned encoder.

Depth clear and comparison conventions remain caller-owned. Cleared depth
attachments require `depthClearValue`; reverse-z scene depth normally clears to
`0`, while conventional depth such as an owned shadow map normally clears to `1`.
Stencil formats are outside the current contract and are rejected.

### Roots And Culling

FrameGraph culls nodes that contribute to no root. Side-effect nodes are roots,
and resource roots retain the final visible producer for their covered range:

```ts
recorder.markPresent(backbuffer);
recorder.markOutput(sceneColor);
recorder.markReadback(readbackBuffer);
recorder.markDebugCapture(debugTexture);
recorder.markPersistentState(importedHistory);
```

`markOutput()` retains a logical value; it does not unwrap, transfer ownership of,
or extend the lifetime of a transient physical allocation. A result needed after
execution must use caller-owned imported storage.

`markPersistentState()` is limited to imported resources and keeps the final
producer whose value is expected to survive into later application frames.

Readback buffers must be imported caller-owned buffers exposing exactly
`GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ`. Mapping, waiting for GPU
completion, consuming the bytes, and destroying staging storage remain
caller-owned post-submit work.

## Production And Interoperability Boundary

FrameGraph provides deterministic recording, compilation, synchronous command
encoding, and queue submission within these limits:

- One runtime is permanently bound to its constructor `GPUDevice`. Device loss,
  recreation, error scopes, and uncaptured errors remain caller-owned.
- Imported resources and callback-owned GPU state must belong to that device;
  WebGPU exposes no portable device-identity check.
- Node callbacks, external `submit`, `beforeSubmit`, and `afterSubmit` are
  synchronous. Their return type is `undefined`; async functions, Promise-like
  results, and other return values are rejected. Runtime checks also protect
  JavaScript callers and erased or cast TypeScript code.
- `execute({ frameIndex })` requires a non-negative safe integer. Invalid values
  are rejected before resource acquisition, GPU timing setup, or callback execution.
- Queue submission is not transactional. Successfully submitted segments cannot
  be rolled back if later encoding, callbacks, or submissions fail.
- The transient pool has no automatic memory budget or eviction policy. Resources
  remain retained until reuse, `clearResourcePool()`, or `destroy()`.
- CPU validation protects graph dependency, format, range, usage, and allocation
  calculations. It does not replace complete WebGPU validation, device limits, or
  memory-availability handling.

Production callers should acquire a fresh current texture every presentation
frame, catch synchronous `execute()` failures, discard a failed swapchain frame
when work may already have been submitted, monitor `device.lost`, and recreate the
entire caller-owned runtime stack on a replacement device.

Call `clearResourcePool()` after resize or highly dynamic descriptor phases when
old retained allocations are no longer useful. `destroy()` releases pool and
profiling resources and invalidates outstanding recorders and compiled frames; it
does not destroy the device or imported resources.

### External Submission

Use `externalSubmission()` when a third-party renderer owns its command encoders
and submits work through the same device queue. A retained external node forms a
hard opaque execution-segment boundary: FrameGraph submits the preceding graph
segment before invoking it and starts a new segment afterward. This orders queue
submissions; it is not a GPU-completion fence.

```ts
const sharedDepthRead = recorder.use(sharedDepth, TextureAccess.DepthRead);
const externalColorWrite = recorder.use(
	externalColor,
	TextureAccess.ColorAttachmentWrite,
	{ contents: 'overwrite' },
);

recorder.externalSubmission({
	label: 'third-party.render',
	uses: [sharedDepthRead, externalColorWrite],
	submit({ device, unwrap }) {
		thirdParty.renderAndSubmit({
			device,
			depth: unwrap(sharedDepthRead),
			color: unwrap(externalColorWrite),
		});
	},
});
```

The external contract is strict:

- `uses` must declare every access to a graph-tracked resource. Private resources
  that were never imported need no declaration.
- Imported resources may be accessed through the external owner's existing native
  reference, but the matching graph access must still be declared.
- Transient resources must be obtained through the current `unwrap()` and cannot
  escape the synchronous callback or be used by work enqueued later.
- All graph-visible work must be enqueued on the supplied `device.queue` before
  the callback returns.
- Returning a Promise-like value is a synchronous contract violation. FrameGraph
  rejects it and does not await it; work already performed before the callback
  returned cannot be rolled back.
- FrameGraph cannot inspect opaque commands or verify that actual accesses match
  declarations.

Opacity and retention are separate. External nodes are side effects by default;
an unreachable `sideEffect: false` external node is culled and creates no segment
boundary.

### Execution Hooks And Re-execution

`beforeSubmit` records caller commands into each FrameGraph-owned command segment
after graph nodes and before that segment is finished. It receives
`segmentIndex`/`segmentCount`; external segments do not trigger it.

`afterSubmit` runs once after every retained segment succeeds and before transient
resources return to the pool. Queue submission has occurred, but GPU completion is
not implied. It is suitable for post-submit bookkeeping or starting caller-owned
readback polling. It must return `undefined` synchronously.

Multiple executions reuse the exact recorded callbacks and imported objects.
FrameGraph does not verify their continued validity, so conditional re-execution
is a caller-owned decision and is normally inappropriate for swapchain recordings.

## Diagnostics And Resource Pool

Compilation diagnostics, GPU timing, and pool statistics are independent:

```ts
const recorder = graph.beginFrame();
// Record resources and nodes.
const compiled = recorder.compile({ report: true });
const compilation = compiled.compilationReport;
const timingPromise = compiled.execute({ frameIndex, gpuTiming: true });
const pool = graph.getResourcePoolStats();
const timing = await timingPromise;
```

Plain `compile()` returns a compact `CompiledFrame` without a report.
`compile({ report: true })` returns `CompiledFrameWithReport`, whose callback-free
snapshot contains:

- retained `nodes`, flat `culledNodes`, recording order, and diagnostic `debugGroups`;
- `resources`, lifetimes, effective usage, physical allocation ids, normalized texture
  or buffer descriptors, and graph-visible byte estimates;
- explicit logical `textureViews` referenced by retained or culled accesses;
- one normalized `accesses` table covering retained and culled nodes;
- `dependencies`, `roots`, `allocations`, and `executionSegments`. Allocation
  estimates use the texture estimator shared with ResourcePool or the actual buffer
  pool bucket size, so aliases contribute physical bytes only once.

Texture estimates account for format block dimensions, mip levels, sample count, and
three-dimensional extent. They intentionally exclude implementation-specific alignment,
compression behavior beyond the declared format blocks, residency, metadata, and driver
overhead. Buffer resource estimates are logical sizes while physical allocation estimates
use pool bucket sizes. These diagnostics are useful for comparison and alias analysis but
are not a measurement of actual driver video-memory usage. They remain available only
when the caller explicitly uses `compile({ report: true })`.

Reports do not change the execution plan. Reads and writes expose normalized
texture regions or buffer ranges; discarded writes remain visible without being
reported as value producers.

Diagnostic groups are recording metadata only. Prefer the exception-safe synchronous
wrapper for module code:

```ts
recorder.withDebugGroup('Bloom', () => {
    // Register Bloom resources and passes.
});
```

Each `pushDebugGroup()` or `withDebugGroup()` call creates a distinct recording scope.
Labels are trimmed display names and need not be unique, including among siblings;
reopening the same label creates another group rather than reentering or merging an
earlier one. Debug UIs may distinguish same-named siblings by their recording-order
occurrence, so expansion state is only best-effort when those siblings are added,
removed, or reordered across frames. Groups do not affect dependencies, ordering,
retention, resource lifetimes, allocation, or execution segments. Resource membership
records registration provenance; unused, unrooted resources remain outside compilation
reports as before.

`execute({ gpuDebugGroups: true })` additionally emits retained recording group paths
through `GPUCommandEncoder.pushDebugGroup()` and `popDebugGroup()`. This is disabled by
default, does not require a compilation report, and leaves render/compute node identity
to the existing pass descriptor labels. Each FrameGraph-owned execution segment starts
and ends with an empty debug-group stack. Groups spanning an opaque external submission
therefore appear as separate fragments, and the external renderer must emit markers on
its own encoder when needed. Whether and how these labels appear in GPU tooling is
WebGPU implementation dependent.

`execute({ gpuTiming: true })` still encodes and submits synchronously, then returns
a promise for timestamp readback. Synchronous errors throw before that promise can
represent them. Available reports include `frameIndex`, total frame duration, and
self-identifying render/compute node timings. Unavailable reports use
`unsupported`, `busy`, or `readback-failed`. Only one timing readback may be pending
per runtime.

`getResourcePoolStats()` synchronously reports acquisition, reuse, creation,
retained allocation count, and estimated retained bytes. It deliberately exposes
no allocator-private bucket keys.

For an explicit portable capture, use the diagnostic subpath only after all three
reports belong to the same executed frame:

```ts
import { createFrameGraphSnapshot } from '@zenfg/webgpu/snapshot';

const snapshot = createFrameGraphSnapshot({
    compilation,
    gpuTiming: timing,
    resourcePool: pool,
    capturedAt: new Date().toISOString(),
});
```

The builder normalizes numeric runtime IDs, WebGPU usage masks, surface origins,
timing availability, and physical allocations into a detached canonical Snapshot
V1. It rejects Snapshot-invalid values, including invalid numeric values and
dangling timing references; available timing kinds must also match their
compilation nodes. Unknown usage bits throw instead of being dropped. The builder
performs work only when called; ordinary compile and execute paths do not create
Snapshots.

The three independently supplied reports do not carry a shared compiled-frame
identity. Supplying compilation and timing from the same `CompiledFrame` remains
a caller requirement; pool counters are aggregate runtime statistics rather than
per-frame measurements.

## Validation And Current Limits

Registration and compilation reject invalid resource sizes, unsafe or fractional
range values, incompatible usage, invalid subresources, and unsupported format
roles before those values affect dependency or allocation calculations.

Texture extents are positive uint32 values, mip counts are bounded by the declared
extent, sample counts are currently `1` or `4`, and buffer sizes are non-negative
safe integers. Texture copy validation accounts for format block dimensions and
render attachments must agree on extent and sample count.

Format capability checks are conservative. Stencil formats are rejected.
Compressed BC/ETC/EAC/ASTC formats are recognized for copy block layout, but
device feature gates for compressed sampling, rendering, or storage are not yet
modeled. Feature-gated plain color capabilities such as tiered storage formats,
`bgra8unorm-storage`, and `rg11b10ufloat-renderable` are disabled until device
feature modeling exists.

These checks protect FrameGraph's model; they do not reproduce the complete
WebGPU descriptor validation matrix or guarantee allocation success.

## Development

The seven complete, public-entrypoint recipes under [`examples/`](./examples/)
are type-checked in CI and cover minimal presentation, transient resources,
imports, persistent state, external submissions, Snapshot export, and GPU timing.

Package-local build and checks:

```sh
npm run build --workspace @zenfg/webgpu
npm run typecheck --workspace @zenfg/webgpu
npm run test --workspace @zenfg/webgpu
npm run pack:dry-run --workspace @zenfg/webgpu
```

Local CPU-only compile benchmark:

```sh
npm run benchmark:compile --workspace @zenfg/webgpu
```

See the [benchmark guide](https://github.com/uinosoft/zenfg/blob/main/packages/webgpu/benchmarks/README.md)
for profiles, scenarios, and CLI filters. Benchmark results are diagnostic only
and are not a CI gate.

Workspace baseline:

```sh
npm run build
npm run test
```

Public TSDoc is preserved in generated declarations and is the precise API
reference. This README focuses on ownership, integration, common workflows, and
the contracts most likely to affect correct graph construction.
