# TypeScript recipes

These complete recipes import only supported ZenFG package entrypoints and are
type-checked in CI. GPU devices, canvas contexts, pipelines, native resources,
and external renderer adapters are explicit function parameters so the files
can be copied into an application without test-only mocks. Each file keeps its
FrameGraph declarations in a `record*` function and provides a small execution
wrapper, allowing hosts such as the ZenFG Examples to compile the exact same
recording with diagnostics enabled.

The topic-named file is each recipe's reading entry; recipes do not introduce
`main.ts` or a browser runtime. Begin each file with a short English block comment
containing `Source:`, `Demonstrates:`, `Flow:`, and `Read next:`. Explain caller-owned
inputs and graph execution, and point to related code without duplicating it.
Examples adapters explicitly register this same file with `entrySourceId` and
place browser setup, capture helpers and shaders after the recipe.

| Recipe | Demonstrates |
| --- | --- |
| [`resource-pool-control.ts`](./resource-pool-control.ts) | Scoped resize cleanup and application predicate eviction |
| [`minimal-frame.ts`](./minimal-frame.ts) | Runtime/recording lifecycle, surface import, presentation root |
| [`transient-to-present.ts`](./transient-to-present.ts) | Derived transient usage, typed access token, native pass callbacks |
| [`imported-resource.ts`](./imported-resource.ts) | Caller-owned buffer import, graph-visible uniform access, and optional native render-pass extras with MSAA resolve/discard |
| [`persistent-state.ts`](./persistent-state.ts) | Defined/undefined imported contents and a cross-frame state root |
| [`external-submission.ts`](./external-submission.ts) | Opaque caller-owned submission boundary followed by native work |
| [`snapshot-export.ts`](./snapshot-export.ts) | Matching compilation, timing, and pool reports encoded as canonical Snapshot 1.2 JSON for caller-owned download or storage |
| [`gpu-timing.ts`](./gpu-timing.ts) | Opt-in asynchronous timestamp readback and unavailable results |
| [`compute-output.ts`](./compute-output.ts) | Compute storage output retained through an output root |

Imported Resource intentionally exposes its single-pass uniform for teaching
imports, access tokens, and input validation. Complex workloads can choose to
bind private parameters internally instead; see
[Choosing resource declaration granularity](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.2.0/docs/core-concepts.md#choosing-resource-declaration-granularity).

Imported Resource also accepts optional `webgpuDescriptor` fields and a
caller-owned `multisampleTexture`. Supply a 4x MSAA texture with
`RENDER_ATTACHMENT` usage, the backbuffer format and size, and a matching
pipeline. The recipe clears and resolves it into the current backbuffer, then
discards that MSAA source because no later node reads it. Omitting both inputs
keeps the direct single-sampled draw. Descriptor extras retain native object
identity and never transfer ownership; native feature and pipeline compatibility
remain application responsibilities. See
[Native render-pass descriptor extras](../README.md#native-render-pass-descriptor-extras)
for experimental resource tables and explicit graph access requirements.

Create one `FrameGraph` for each `GPUDevice`, invoke a recipe after acquiring
the inputs shown by its exported function, and call `graph.destroy()` when that
device-bound renderer stack is released.
