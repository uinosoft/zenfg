# Changelog

All notable changes to ZenFG are documented in this file. The five publishable
packages use independent versions; component tags identify each release.

## [Unreleased]

No changes yet.

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
- Add the public Playground, runnable package recipes, interactive background,
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

[Unreleased]: https://github.com/uinosoft/zenfg/compare/cargo/zenfg/v0.1.0-beta.3...HEAD
[0.1.0-beta.3]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.1
[npm-snapshot-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Fsnapshot%2Fv0.1.0-beta.1
[npm-webgpu-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Fwebgpu%2Fv0.1.0-beta.1
[npm-inspector-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Finspector%2Fv0.1.0-beta.1
[cargo-snapshot-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg-snapshot%2Fv0.1.0-beta.1
[cargo-zenfg-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.1
