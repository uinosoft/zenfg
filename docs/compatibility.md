# Compatibility matrix

| ZenFG package | Version | Runtime/toolchain | Snapshot |
| --- | --- | --- | --- |
| `@zenfg/webgpu` | `0.1.x` | Node 24 for tooling; native WebGPU at runtime | produces 1.0 |
| `@zenfg/snapshot` | `0.1.x` | ESM, ES2022 | reads Legacy V0, Legacy Candidate V1, ZenFG 1.0 |
| `@zenfg/inspector` | `0.1.x` | modern DOM; no WebGPU dependency | reads through `@zenfg/snapshot` |
| `zenfg` | `0.1.x` | Rust 1.98; wgpu 30 | optional producer through `snapshot` |
| `zenfg-snapshot` | `0.1.x` | Rust 1.98; no wgpu | reads Legacy V0, Legacy Candidate V1, ZenFG 1.0 |

Package versions do not lockstep. A Snapshot major/minor change requires an
explicit reader migration; unknown formats and versions are rejected.
