# Changelog

All notable changes to ZenFG are documented in this file. The five publishable
packages use independent versions; component tags identify each release.

## [Unreleased]

No user-facing changes have been recorded after the `0.1.0` release candidate.

## 0.1.0 release candidate - 2026-08-31

Initial release candidate for the coordinated first publication of:

- [`@zenfg/snapshot@0.1.0`][npm-snapshot-0.1.0]
- [`@zenfg/webgpu@0.1.0`][npm-webgpu-0.1.0]
- [`@zenfg/inspector@0.1.0`][npm-inspector-0.1.0]
- [`zenfg-snapshot@0.1.0`][cargo-snapshot-0.1.0]
- [`zenfg@0.1.0`][cargo-zenfg-0.1.0]

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

The package versions are independent of the ZenFG FrameGraph Snapshot wire
format, which is version `1.0` in this candidate.

[Unreleased]: https://github.com/uinosoft/zenfg/compare/cargo/zenfg/v0.1.0...HEAD
[npm-snapshot-0.1.0]: https://github.com/uinosoft/zenfg/releases/tag/npm%2Fsnapshot%2Fv0.1.0
[npm-webgpu-0.1.0]: https://github.com/uinosoft/zenfg/releases/tag/npm%2Fwebgpu%2Fv0.1.0
[npm-inspector-0.1.0]: https://github.com/uinosoft/zenfg/releases/tag/npm%2Finspector%2Fv0.1.0
[cargo-snapshot-0.1.0]: https://github.com/uinosoft/zenfg/releases/tag/cargo%2Fzenfg-snapshot%2Fv0.1.0
[cargo-zenfg-0.1.0]: https://github.com/uinosoft/zenfg/releases/tag/cargo%2Fzenfg%2Fv0.1.0
