# Migration baseline

ZenFG was extracted from two clean source revisions:

- TypeScript/WebGPU: `t3d-next` at `287ff8c26e018d0905fddf1389181424934d8a3c`
- Rust/wgpu: `zen-proto` at `5b8bc75809085195eb386259edd61aacb420e9d0`

Only tracked FrameGraph, Snapshot, Inspector, test, documentation, and benchmark
files were migrated. Renderer features, applications, interop adapters, build
artifacts, and local logs were deliberately excluded.

The source baseline passed 282 TypeScript tests and 98 Rust test functions plus
seven trybuild compile-fail cases before extraction.

The extracted acceptance results, including the completed one-time browser
check, are recorded in [`validation.md`](validation.md).

The closure pass aligned the TypeScript and Rust Snapshot validators and
historical migrations, added the seven independent mirrored producer cases,
and completed Inspector import regression coverage. It did not rewrite the
compiler, scheduler, resource pool, or execution algorithms.

## Directory mapping

| Source | ZenFG destination |
| --- | --- |
| `t3d-next/packages/frame-graph` | `packages/webgpu` |
| `t3d-next/packages/frame-graph-snapshot` | `packages/snapshot` |
| `t3d-next/packages/frame-graph-debug-panel` | `packages/inspector` |
| `zen-proto/crates/zen-frame-graph` | `crates/zenfg` |
| Snapshot wire model extracted from both runtimes | `crates/zenfg-snapshot` |

`docs/migration-manifest.json` records every migrated source, fixture, test,
benchmark, and application file together with a SHA-256 digest. Regenerate it
with `npm run migration:manifest` once after the migration closure changes are
accepted. It is then frozen as the final extraction inventory rather than
rewritten during ordinary post-migration development. Build output, dependency
trees, benchmarks output, and logs are excluded.
