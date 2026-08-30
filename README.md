# ZenFG

ZenFG is a standalone, composable FrameGraph toolchain for WebGPU and wgpu.
It provides idiomatic TypeScript and Rust runtimes, a portable Snapshot format,
validation and conformance tools, and an embeddable Inspector.

ZenFG coordinates graph-visible GPU work without owning scenes, materials,
pipelines, bind groups, cameras, surface presentation, or application policy.
Independent renderers can participate through native render/compute/copy
nodes, command encoding, or opaque external-submission boundaries.

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
migration. It is built in CI but is not deployed by this repository.

For local development, install dependencies and start the standalone Inspector
from a clean checkout with `npm run dev:inspector`. Run the independent
TypeScript/Rust producer corpus with `npm run test:cross-language`.

See [the architecture guide](docs/architecture.md),
[semantic model](docs/semantic-model.md), and
[integration guide](docs/integration.md),
[compatibility matrix](docs/compatibility.md), and
[migration baseline](docs/migration-baseline.md). The extraction acceptance run
is recorded in [migration validation](docs/validation.md). Release changes are
tracked in the [changelog](CHANGELOG.md); the first candidate has a dedicated
[0.1.0 release checklist](docs/release-checklist-0.1.0.md).
