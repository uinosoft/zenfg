# Changelog

All notable changes to ZenFG are documented in this file. The five publishable
packages use independent versions; component tags identify each release.

## [Unreleased]

No changes yet.

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

[Unreleased]: https://github.com/uinosoft/zenfg/compare/cargo/zenfg/v0.1.0-beta.1...HEAD
[0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.1
[npm-snapshot-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Fsnapshot%2Fv0.1.0-beta.1
[npm-webgpu-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Fwebgpu%2Fv0.1.0-beta.1
[npm-inspector-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/npm%2Finspector%2Fv0.1.0-beta.1
[cargo-snapshot-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg-snapshot%2Fv0.1.0-beta.1
[cargo-zenfg-0.1.0-beta.1]: https://github.com/uinosoft/zenfg/tree/cargo%2Fzenfg%2Fv0.1.0-beta.1
