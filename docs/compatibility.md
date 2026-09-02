# Compatibility matrix

| ZenFG package | Version | Runtime/toolchain | Snapshot |
| --- | --- | --- | --- |
| `@zenfg/webgpu` | `0.1.0-beta.1` | Node 24 for tooling; native WebGPU at runtime | produces 1.0 |
| `@zenfg/snapshot` | `0.1.0-beta.1` | ESM, ES2022 | reads Legacy V0, Legacy Candidate V1, ZenFG 1.0 |
| `@zenfg/inspector` | `0.1.0-beta.1` | modern DOM; no WebGPU dependency | reads through `@zenfg/snapshot` |
| `zenfg` | `0.1.0-beta.1` | Rust 1.98; wgpu 30 | optional producer through `snapshot` |
| `zenfg-snapshot` | `0.1.0-beta.1` | Rust 1.98; no wgpu | reads Legacy V0, Legacy Candidate V1, ZenFG 1.0 |

Package versions do not lockstep. A Snapshot major/minor change requires an
explicit reader migration; unknown formats and versions are rejected.

All public APIs are beta and may change before 1.0. Integration projects should
pin exact beta versions rather than using a floating compatible range.

## Repository toolchains

The repository currently targets Node.js 24, npm 11, TypeScript 6, Rust 1.98,
and wgpu 30. Node.js is required for development and packaging, not for browser
runtime use. Browser execution depends on native WebGPU and modern DOM support.

TypeScript consumers should import documented package entrypoints rather than
source files or undeclared `dist` paths. Rust consumers should use the feature
flags documented by each crate. Toolchain changes are validated by the release
checks before package publication.
