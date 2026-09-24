# @zenfg/webgpu

<!-- generated:badges:start -->
[![@zenfg/webgpu published latest version](https://img.shields.io/npm/v/%40zenfg%2Fwebgpu/latest?label=npm)](https://www.npmjs.com/package/@zenfg/webgpu)
[![API Docs (development)](https://img.shields.io/badge/API_docs-development-blue)](https://uinosoft.github.io/zenfg/docs/api/webgpu/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/LICENSE)
<!-- generated:badges:end -->

`@zenfg/webgpu` is a lightweight WebGPU FrameGraph for declaring and executing
per-frame GPU work. It orders graph nodes, validates resource access, culls
unused work, derives WebGPU usage, tracks lifetimes, and reuses transient
textures and buffers.

Build rendering features directly with WebGPU or compatible libraries, and combine
them with existing renderers through explicit graph integration. See the
[composition model](https://uinosoft.github.io/zenfg/docs/concepts.html#integration-levels).

It is not a renderer abstraction. ZenFG owns graph-visible dependencies,
execution order, retention, transient allocation, and optional diagnostics.
The caller owns scenes, pipelines, bind groups, samplers, long-lived resources,
surface presentation, device-loss policy, and concrete draw or dispatch work.

This is a public beta package. Pin the exact prerelease version while
integrating. Import runtime APIs from the package root; the only supported
diagnostic subpath is `@zenfg/webgpu/snapshot`.

## Installation

<!-- generated:installation:start -->
```sh
npm install @zenfg/webgpu@0.1.0
```
<!-- generated:installation:end -->

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
declarations, usage contracts, and resource planning. Native render-pass,
texture-view, device-limit, and command validation remains a WebGPU
responsibility. Native WebGPU validation errors may be reported asynchronously
through error scopes or `uncapturederror`; ordinary execution does not wait for
those results and does not convert them to ZenFG error codes.

`markPresent()` makes the final surface value observable. Without a resource
root or a side-effect node, work that contributes to no result is culled.
Normal execution records and submits synchronously; only optional GPU timing
returns an asynchronous readback result.

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

## Common tasks

| Task | Public API |
| --- | --- |
| Create the device-bound runtime | `new FrameGraph(device)` |
| Start a recording | `beginFrame()` |
| Create transient storage | `createTexture()`, `createBuffer()` |
| Import caller-owned storage | `importTexture()`, `importBuffer()` |
| Import the current presentation target | `importSwapchainTexture()` |
| Select texture subresources | `createTextureView()` |
| Declare typed resource access | `use()` with `TextureAccess` or `BufferAccess` |
| Record structured work | `render()`, `compute()`, `copy()`, `clearBuffer()` |
| Encode custom graph-owned commands | `command()` |
| Call a renderer that submits itself | `externalSubmission()` |
| Retain observable values | `markPresent()`, `markOutput()`, `markReadback()`, `markDebugCapture()`, `markPersistentState()` |
| Compile a compact executable plan | `compile()` |
| Request full compilation diagnostics | `compile({ report: true })` |
| Execute and optionally request timing/debug groups | `compiled.execute()` |
| Inspect or clear retained allocations | `getResourcePoolStats()`, `clearResourcePool()` |
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
[`transient-to-present.ts`](./examples/transient-to-present.ts) recipe shows the
pipeline and bind-group setup without placeholder helpers.

## Resource and integration choices

Declaration granularity is optional: complex workloads can keep private weights,
parameters, and scratch internally bound, while teaching or diagnostic use can
expose more resources. Graph-visible dependencies and access correctness still
apply. See [Choosing resource declaration granularity](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/docs/core-concepts.md#choosing-resource-declaration-granularity).

For resources exposed to the graph:

- Create a transient resource when native storage is needed only for the
  compiled frame. Import a resource when the caller owns its native storage or
  it must survive execution.
- Transient and surface contents begin undefined. The first write to a
  transient range must fully overwrite it. Use preserve for partial,
  conditional, sparse, or atomic writes.
- Use structured render, compute, copy, and clear nodes whenever possible. Use
  `command()` for custom work on a FrameGraph-owned encoder.
- Use `externalSubmission()` when a third-party renderer owns and submits its
  encoders. The node orders queue submissions but is not a GPU-completion fence.
- Acquire, import, compile, execute, and present a fresh surface texture on each
  presentation frame.

See [Core concepts](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/docs/core-concepts.md)
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
[`@zenfg/snapshot` specification](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/packages/snapshot/SPEC.md).

Use `compiled.executeWithTiming({ frameIndex, timing: 'cpu' })`, choosing
`'cpu'`, `'gpu'` or `'both'`. The returned `cpu` report is immediately
available; consume `gpu` as a Promise only when requested. Ordinary `execute()`
remains synchronous and does not collect timing. CPU duration is elapsed time,
not thread CPU usage, and covers every executed node kind. Keep compilation,
frame identity and pool counters from the same execution when exporting.

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
| Timing is unavailable | Treat `unsupported`, `busy`, and `readback-failed` as non-fatal results. |

## Complete recipes

The following files are published with the package and type-checked as consumers
of supported public entrypoints:

| Workflow | Recipe |
| --- | --- |
| Minimal presentation lifecycle | [`minimal-frame.ts`](./examples/minimal-frame.ts) |
| Transient render target to presentation | [`transient-to-present.ts`](./examples/transient-to-present.ts) |
| Caller-owned imported resource | [`imported-resource.ts`](./examples/imported-resource.ts) |
| Cross-frame persistent state | [`persistent-state.ts`](./examples/persistent-state.ts) |
| Opaque third-party submission | [`external-submission.ts`](./examples/external-submission.ts) |
| Portable Snapshot JSON for browser download or other caller-owned storage | [`snapshot-export.ts`](./examples/snapshot-export.ts) |
| Asynchronous GPU timing | [`gpu-timing.ts`](./examples/gpu-timing.ts) |
| Compute storage output | [`compute-output.ts`](./examples/compute-output.ts) |

GPU-dependent recipes are compile-checked. CPU-only workflows also execute in
CI. See the [examples index](./examples/README.md) for their input contracts.

## Further reading

- [ZenFG documentation index](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/docs/README.md)
- [Core concepts](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/docs/core-concepts.md)
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/packages/snapshot/README.md)
- [`@zenfg/inspector`](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/packages/inspector/README.md)
- [Compatibility](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/docs/compatibility.md)

## Documentation and versions

<!-- generated:documentation:start -->
This README describes **@zenfg/webgpu 0.1.0**. Registry badges show the current published channel, not your installed version.

- Exact installed APIs: follow `package.json` → `exports` → `dist/*.d.ts`; declaration maps point to the included `src/`. Only declared export paths are public.
- [Online guide (development branch)](https://uinosoft.github.io/zenfg/docs/packages/webgpu.html). The site may describe changes newer than this package.
- [TypeScript API (development branch)](https://uinosoft.github.io/zenfg/docs/api/webgpu/).
- [Source and documentation for this release](https://github.com/uinosoft/zenfg/tree/npm/webgpu/v0.1.0/packages/webgpu).
- [Shared concepts for this release](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/docs/core-concepts.md) and [compatibility](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/docs/compatibility.md).
- [Plain Markdown documentation index (development branch)](https://uinosoft.github.io/zenfg/docs/llms.txt).
- Local complete recipes: [examples](./examples/README.md).
<!-- generated:documentation:end -->
