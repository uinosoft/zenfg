# Changelog

<!-- generated:language:start -->
**English** | [简体中文][documentation-zh]

[documentation-en]: ./CHANGELOG.md
[documentation-zh]: ./CHANGELOG.zh-CN.md
<!-- generated:language:end -->

All notable changes to ZenFG are documented in this file. The five publishable
packages use independent versions; component tags identify each release.

## Unreleased

- Document diagnostic grouping, repeated Bloom stages and the distinction between
  native resource ownership and graph-visible access in runtime guides; derive
  concise grouping/resource rules and Inspector display guidance into npm Skills.

- Keep runtime, Snapshot and Inspector usage/upgrade guidance beside their owning
  packages. Ship deterministic, tracked Agent Skills in the three npm artifacts,
  with package-contained references and pnpm discovery/approval checks. Rust guides
  remain crate-owned; Rust Skill distribution is deferred. Preserve documentation
  routes and historical release records without changing published versions.

- Add explicit runtime-owned resource-pool scopes and synchronous predicate
  eviction to `@zenfg/webgpu` and `zenfg`. Scopes isolate transient aliasing
  and reuse; predicates receive readonly physical specifications and idle
  execution counts. Imported resources remain caller-owned. Clear-all defaults,
  cumulative counters and the Snapshot 1.2 wire schema remain unchanged.

## Runtime and Inspector 0.2.0, Snapshot packages 0.1.1 - 2026-10-10

| Package | Version |
| --- | --- |
| `@zenfg/webgpu` | 0.2.0 |
| `@zenfg/inspector` | 0.2.0 |
| `zenfg` | 0.2.0 |
| `@zenfg/snapshot` | 0.1.1 |
| `zenfg-snapshot` | 0.1.1 |

Versions remain independent. Runtime and Inspector packages select exact
Snapshot dependency 0.1.1; the portable Snapshot wire format remains 1.2.
See [the migration guide](docs/migration-0.2.0.md).

### Compatibility

- Extend the existing WebGPU `FrameGraphError` coverage and replace public
  `__brand` handle fields with a private unique-symbol type brand. Update
  exact built-in error checks and integrations that construct or inspect brands.
- Preserve previously skipped Rust compilation-report Serde fields. Persisted
  report JSON missing newly required producer facts may need regeneration or an
  application adapter; this does not change portable Snapshot compatibility.
- Keep native capability, descriptor and command validation with browser WebGPU
  or wgpu. Some native failures now occur at allocation or encoding instead of
  graph recording; host error handling remains required.
- Hide Inspector resource declaration nodes initially. Set
  `showResourceDeclarations: true` to restore the previous initial graph display.

### Added and fixed

- Add optional WebGPU `render({ webgpuDescriptor })` passthrough for caller-owned
  native descriptor fields while keeping attachments, labels and timing writes
  graph-owned. Explicit `uses`, feature detection, pipeline compatibility and
  native object lifetimes remain application responsibilities. This is not a
  complete bindless integration; real GPU acceptance of extras is unverified.
- Re-export portable Snapshot types, the canonical serializer and the validation
  error from `@zenfg/webgpu/snapshot`; allow Snapshot export without pool counters.
- Add typed CPU/GPU/both WebGPU timing results and report `no-timed-nodes` in
  both runtimes instead of an available zero-duration GPU measurement.
- Make Rust pass completion and compound access recording atomic, and resolve
  texture-view layers consistently.
- Roll back failed WebGPU resource-pool acquisitions.
- Add Inspector Overview metrics, relation focus, graph search and zoom controls;
  improve panel readability, responsive details, keyboard interactions and async
  state preservation.
- Normalize omitted WebGPU clear ranges to the logical buffer boundary so
  dependency reports and native commands clear the same bytes.
- Preserve initialized buffer contents across texture readback footprints with
  row or layer padding. Unused single-row or single-layer strides do not turn
  a contiguous copy into a preserving write; both runtimes share these rules.
- Return WebGPU GPU timing unavailability with `too-many-timed-nodes` when
  more than 2048 retained render/compute nodes would exceed 4096 queries.
  Execution still submits normally, and `both` mode retains CPU timing.
- Reject Rust access tokens from another graph or recording with `ForeignHandle`
  before resolving colliding local resource IDs.
- Validate Snapshot group ancestry with a linear iterative traversal while
  preserving issue messages, ordering, and first-match duplicate-ID references.
  Traverse WebGPU node retention iteratively to support long dependency chains.
- Validate device-independent texture descriptor structure and retained
  transient allocation usage before native allocation. Browser WebGPU keeps
  sample counts 1 and 4; Rust preserves native wgpu sample-count capabilities.
  `TRANSIENT_ATTACHMENT` is explicitly unsupported until the Snapshot contract
  can represent it.
- Preserve zero-sized buffer and texture copies as native no-op commands while
  excluding them from FrameGraph content dependencies, output production, and
  access reports.
- Reject non-empty buffer-texture copies during recording when the texture
  format has no known copy footprint for FrameGraph dependency tracking.
  Texture memory-size estimates remain separate from buffer-copy layout
  metadata.
- Give ZenFG-detected `@zenfg/webgpu` validation failures structured
  `FrameGraphError` codes and phase/location metadata. Code that checked for
  exact `TypeError` or plain `Error` types should check `FrameGraphError.code`.
- Re-export `FrameGraphSnapshotValidationError` from
  `@zenfg/webgpu/snapshot` and report unknown usage bits as a Snapshot issue.
- Reject runtime CPU and available GPU timing reports whose node IDs, order, or
  kinds do not match the retained compilation sequence during Snapshot export,
  while preserving the Snapshot 1.2 partial-coverage contract.

### Per-package notes

- [@zenfg/webgpu 0.2.0](docs/releases/npm-webgpu-0.2.0.md)
- [@zenfg/inspector 0.2.0](docs/releases/npm-inspector-0.2.0.md)
- [@zenfg/snapshot 0.1.1](docs/releases/npm-snapshot-0.1.1.md)
- [zenfg 0.2.0](docs/releases/cargo-zenfg-0.2.0.md)
- [zenfg-snapshot 0.1.1](docs/releases/cargo-zenfg-snapshot-0.1.1.md)

## [0.1.0] - 2026-09-15

- Publish all five packages as the first non-prerelease version, preserving
  beta.4 public APIs, runtime behavior and Snapshot 1.2 compatibility.
- Update exact internal dependencies and public installation documentation to
  0.1.0. npm packages use the `latest` channel. No migration from beta.4 is required.


- Improve release tooling with a read-only package assessment, registry progress,
  Node 24 artifact Actions, deduplicated PR CI and version-independent golden checks.
  These tooling changes do not alter runtime APIs.

## [0.1.0-beta.4] - 2026-09-15

All five public packages release as 0.1.0-beta.4 in this coordinated update.
Package versions remain independent for future releases.

### Breaking changes

- Replace GPU-only execution entrypoints with unified CPU/GPU/both timing APIs
  in TypeScript and Rust. Plain execution collects no timing.
- Emit Snapshot 1.2 with CPU and GPU availability records. Readers explicitly
  migrate validated 1.1 inputs; canonical 1.0 remains rejected.
- Require explicit TypeScript Snapshot frame indices and forward Inspector
  provider timing requests through host adapters.
- See the [migration guide](docs/migration-timing-snapshot-1.2.md).

### Added and fixed

- Add CPU timing for all executed node kinds and synchronous execution total;
  capture CPU/pool facts before GPU readback to preserve same-frame data.
- Harden Snapshot validation against inherited fields and align Rust/TypeScript
  identifier, numeric and migration behavior.
- Improve Inspector CPU measurements, themes, search, navigation, responsive
  details and capture replacement invalidation; defer inactive views.
- Refresh packaged documentation and examples. Add a generated documentation
  site, PlayCanvas GSplat demos and shareable canvas fullscreen mode.
- Add approved per-package OIDC publishing with verified archives and isolated
  registry consumers.

### Per-package notes

- [@zenfg/snapshot](docs/releases/npm-snapshot-0.1.0-beta.4.md)
- [zenfg-snapshot](docs/releases/cargo-zenfg-snapshot-0.1.0-beta.4.md)
- [@zenfg/webgpu](docs/releases/npm-webgpu-0.1.0-beta.4.md)
- [zenfg](docs/releases/cargo-zenfg-0.1.0-beta.4.md)
- [@zenfg/inspector](docs/releases/npm-inspector-0.1.0-beta.4.md)

## [0.1.0-beta.3] - 2026-09-07

### Breaking changes

- Upgrade the canonical Snapshot wire format from 1.0 to 1.1. Both decoders
  reject canonical 1.0; Legacy V0 and Legacy Candidate V1 remain supported.
- Require normalized resource-root ranges and final-content resolution in native
  Snapshot 1.1. Roots now distinguish resource selections from side effects.
- Replace Rust `RootReport.producers` with
  `RootReport.resolution.producer_node_ids` and change `SnapshotRoot` from a
  struct to a reason-tagged enum.
- Reject undefined or discarded selected root contents during WebGPU compilation
  with FG1004, and reject empty resource-root ranges.

### Added and changed

- Add WebGPU buffer-range and texture-view root selections, final-writer and
  initial-content reporting, and matching cross-language conformance coverage.
- Unify Inspector visualization into Frame Flow with output endpoints, range
  identity, final-content sources, and refined labels, colors, and legend.
- Add the public Examples, runnable package recipes, interactive background,
  and attributed TypeGPU slime-mold showcase.

Coordinate all five packages at `0.1.0-beta.3` with exact internal dependencies.
See the [beta.3 migration guide](docs/migration-0.1.0-beta.3.md).

## [0.1.0-beta.2] - 2026-09-02

- Aligned WebGPU texture-size and copy-operation input types with the runtime's
  existing iterable support, including typed-array extents and origins, while
  materializing those inputs before compilation and execution.
- Fixed Rust/wgpu GPU debug-group execution and timing ancestry when compilation
  retains non-contiguous recording group IDs.
- Aligned the Inspector export menu, refined graph zoom behavior, and improved
  viewport framing for large or newly loaded graphs.
- Reorganized public documentation around bilingual project entrypoints,
  package-local quick references, a single Core Concepts guide, and an explicit
  source-of-truth policy for API docs, examples, and future interactive stories.

This release coordinates all five packages at `0.1.0-beta.2` so package-local
documentation and exact internal dependencies remain aligned.

## [0.1.0-beta.1] - 2026-09-01

The Inspector is now a host-sized, always-visible workbench with integrated
branding, file selection, and drag-and-drop. The pre-release collapsible shell
and its `expanded`/`setExpanded()` API have been removed.

The WebGPU runtime now enforces synchronous execution callbacks in both its
TypeScript types and runtime checks. Render, compute, command, external
submission, `beforeSubmit`, and `afterSubmit` callbacks must return `undefined`;
Promise-like results are rejected without being awaited. `execute()` also rejects
invalid `frameIndex` values before allocating resources or starting GPU work.

Initial public beta release of:

- [`@zenfg/snapshot@0.1.0-beta.1`][npm-snapshot-0.1.0-beta.1]
- [`@zenfg/webgpu@0.1.0-beta.1`][npm-webgpu-0.1.0-beta.1]
- [`@zenfg/inspector@0.1.0-beta.1`][npm-inspector-0.1.0-beta.1]
- [`zenfg-snapshot@0.1.0-beta.1`][cargo-snapshot-0.1.0-beta.1]
- [`zenfg@0.1.0-beta.1`][cargo-zenfg-0.1.0-beta.1]

This candidate establishes the standalone TypeScript/WebGPU and Rust/wgpu
FrameGraph runtimes, the renderer-independent Inspector, cross-language
conformance fixtures, and manual package-verification workflows.

Developer and coding-agent usability is part of the candidate contract:

- one compact Quick Reference maps package choice, lifecycle, ownership,
  content semantics, common tasks, TypeScript/Rust names, and failure fixes;
- public TSDoc/rustdoc, self-contained package READMEs, and complete compiled
  recipes document the supported workflows without requiring repository search;
- npm declaration maps point to packaged sources, while Rust crate READMEs serve
  as tested crate-level documentation;
- documentation, recipes, package contents, and link integrity are guarded by
  release checks without changing runtime APIs or Snapshot 1.0 semantics.

The final candidate also hardens Snapshot decoding before the first public
release:

- TypeScript programmatic decode, validation, and encoding reject non-JSON
  runtime values without invoking getters or `toJSON` hooks or leaking native
  serialization errors; Legacy Candidate V1 migration is copy-on-write and
  never mutates the caller's input or silently discards invalid data;
- Snapshot 1.0 defines a shared maximum of 64 object/array container levels for
  each extension value, enforced by the Schema and both TypeScript and Rust
  validators with the stable `extension-depth-exceeded` issue code.

The package versions are independent of the ZenFG FrameGraph Snapshot wire
format, which is version `1.0` in this candidate.

[Unreleased]: https://github.com/uinosoft/zenfg/compare/cargo/zenfg/v0.2.0...HEAD
[0.1.0]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0
[0.1.0-beta.4]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.1
[npm-snapshot-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Fsnapshot%2Fv0.1.0-beta.1
[npm-webgpu-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Fwebgpu%2Fv0.1.0-beta.1
[npm-inspector-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Finspector%2Fv0.1.0-beta.1
[cargo-snapshot-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg-snapshot%2Fv0.1.0-beta.1
[cargo-zenfg-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.1
