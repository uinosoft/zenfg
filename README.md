# ZenFG

English | [简体中文](README.zh-CN.md)

ZenFG is a standalone, composable FrameGraph toolchain for WebGPU and wgpu.
It provides idiomatic TypeScript and Rust runtimes, a portable Snapshot format,
validation and conformance tools, and an embeddable Inspector.

ZenFG coordinates graph-visible GPU work without owning scenes, materials,
pipelines, bind groups, cameras, surface presentation, or application policy.
Independent renderers can participate through native render/compute/copy
nodes, command encoding, or opaque external-submission boundaries.

Website: <https://uinosoft.github.io/zenfg/>

Inspector: <https://uinosoft.github.io/zenfg/inspector/>

Start with the [developer and AI quick reference](docs/quick-reference.md) for
package selection, lifecycle and ownership rules, API name mapping, common
failure fixes, and complete TypeScript/Rust recipes.

## Packages

| Package | Purpose |
| --- | --- |
| `@zenfg/webgpu` | WebGPU FrameGraph runtime |
| `@zenfg/snapshot` | Snapshot V1 types, codec, validator, schema, and conformance corpus |
| `@zenfg/inspector` | Renderer-independent DOM Inspector |
| `zenfg` | wgpu FrameGraph runtime |
| `zenfg-snapshot` | Rust Snapshot V1 codec and validator |

All packages are in their initial-development (`0.1.x`) series. When
published, `0.1.x` versions are ordinary registry releases, while public APIs
may still evolve under the SemVer rules for `0.x`. The implementations share
semantics and portable diagnostics, not source-level API parity.

The private `apps/inspector` workspace builds a backend-free static viewer with
file selection, drag-and-drop, validation feedback, and historical-format
migration. The [hosted Inspector](https://uinosoft.github.io/zenfg/inspector/)
runs entirely in the browser; imported snapshots are not uploaded.

For local development, install dependencies and start the standalone Inspector
from a clean checkout with `npm run dev:inspector`. Run the independent
TypeScript/Rust producer corpus with `npm run test:cross-language`.

See the [quick reference](docs/quick-reference.md),
[architecture guide](docs/architecture.md),
[semantic model](docs/semantic-model.md),
[integration guide](docs/integration.md),
[compatibility matrix](docs/compatibility.md), and
[release validation](docs/release-validation.md). Release changes are
tracked in the [changelog](CHANGELOG.md); the first candidate has a dedicated
[0.1.0 release checklist](docs/release-checklist-0.1.0.md).
