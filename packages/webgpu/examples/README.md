# TypeScript recipes

These complete recipes import only supported ZenFG package entrypoints and are
type-checked in CI. GPU devices, canvas contexts, pipelines, native resources,
and external renderer adapters are explicit function parameters so the files
can be copied into an application without test-only mocks. Each file keeps its
FrameGraph declarations in a `record*` function and provides a small execution
wrapper, allowing hosts such as the ZenFG Playground to compile the exact same
recording with diagnostics enabled.

| Recipe | Demonstrates |
| --- | --- |
| [`minimal-frame.ts`](./minimal-frame.ts) | Runtime/recording lifecycle, surface import, presentation root |
| [`transient-to-present.ts`](./transient-to-present.ts) | Derived transient usage, typed access token, native pass callbacks |
| [`imported-resource.ts`](./imported-resource.ts) | Caller-owned buffer import and graph-visible uniform access |
| [`persistent-state.ts`](./persistent-state.ts) | Defined/undefined imported contents and a cross-frame state root |
| [`external-submission.ts`](./external-submission.ts) | Opaque caller-owned submission boundary followed by native work |
| [`snapshot-export.ts`](./snapshot-export.ts) | Matching compilation, timing, and pool reports encoded as Snapshot 1.1 |
| [`gpu-timing.ts`](./gpu-timing.ts) | Opt-in asynchronous timestamp readback and unavailable results |
| [`compute-output.ts`](./compute-output.ts) | Compute storage output retained through an output root |

Imported Resource intentionally exposes its single-pass uniform for teaching
imports, access tokens, and input validation. Complex workloads can choose to
bind private parameters internally instead; see
[Choosing resource declaration granularity](../../../docs/core-concepts.md#choosing-resource-declaration-granularity).

Create one `FrameGraph` for each `GPUDevice`, invoke a recipe after acquiring
the inputs shown by its exported function, and call `graph.destroy()` when that
device-bound renderer stack is released.
