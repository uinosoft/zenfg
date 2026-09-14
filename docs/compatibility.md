# Compatibility matrix

<!-- generated:compatibility:start -->
| ZenFG package | Version | Runtime/toolchain | Snapshot |
| --- | --- | --- | --- |
| `@zenfg/webgpu` | `0.1.0-beta.3` | Native WebGPU; tooling Node >=24.0.0 <25 | produces 1.1 |
| `@zenfg/snapshot` | `0.1.0-beta.3` | ESM, ES2022 | reads Legacy V0, Legacy Candidate V1, 1.1 |
| `@zenfg/inspector` | `0.1.0-beta.3` | Modern DOM; no WebGPU dependency | reads through @zenfg/snapshot |
| `zenfg` | `0.1.0-beta.3` | Rust 1.98; wgpu 30.0.1 | produces 1.1 |
| `zenfg-snapshot` | `0.1.0-beta.3` | Rust 1.98; no wgpu | reads Legacy V0, Legacy Candidate V1, 1.1 |
<!-- generated:compatibility:end -->

Package versions do not lockstep. A Snapshot major/minor change requires an
explicit reader migration; unknown formats and versions are rejected.

Beta.2 used Snapshot 1.0; beta.3 uses Snapshot 1.1 and rejects canonical 1.0.
Upgrade producers and consumers together. See the
[beta.3 migration guide](migration-0.1.0-beta.3.md) for archived captures and
source-level API changes.

All public APIs are beta and may change before 1.0. Integration projects should
pin exact beta versions rather than using a floating compatible range.

## Repository toolchains

<!-- generated:toolchains:start -->
Repository tooling: Node `>=24.0.0 <25`, npm `>=11.11.0 <12`, TypeScript `^6.0.3`, Rust `1.98`, wgpu `30.0.1`.
<!-- generated:toolchains:end --> Node.js is required for development and packaging, not for browser
runtime use. Browser execution depends on native WebGPU and modern DOM support.

TypeScript consumers should import documented package entrypoints rather than
source files or undeclared `dist` paths. Rust consumers should use the feature
flags documented by each crate. Toolchain changes are validated by the release
checks before package publication.
