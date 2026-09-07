# ZenFG 0.1.0-beta.3 release checklist

- Date: 2026-09-07
- Previous release commit: `cf4522965ba5dbb710d1dd7853c1790fba41b165`
- Status: local verification passed; registry publication pending

This coordinated release updates all five packages and their exact internal
dependencies. See [migration notes](migration-0.1.0-beta.3.md) for the breaking
Snapshot 1.1, root-report, and root-validation changes.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed, including all workspaces and WebGPU recipes |
| `npm test` | Passed: 363/363 tests |
| `npm run test:cross-language` | Passed: seven mirrored producers and Rust cross-validation |
| `npm run build` | Passed: all packages/apps; existing chunk-size advisories only |
| `npm run docs:check` | Passed: five entrypoints, 134 exports, 38 callable members, 72 deferred Rust types, 77 links |
| `npm run pack:check` | Passed after rebuilding deleted output: clean consumer imports, TypeScript 6.0.3 declarations/recipes, declaration maps and archive contents |
| npm publish dry-runs with `--tag next` | Passed for all three packages |
| `cargo fmt --all --check` | Passed |
| Clippy, all targets/features with warnings denied | Passed |
| `cargo test --workspace --all-features` | Passed: 114 tests plus three doctests, including seven trybuild cases |
| Explicit Rust doctests and rustdoc with warnings denied | Passed |
| All-feature Rust example checks | Passed |
| CPU examples: minimal-frame, snapshot-export, Snapshot basic | Passed |
| `npm run cargo:package-check` | Passed: both archives and public examples verified outside the workspace with cached dependencies and a temporary protocol patch |
| `cargo publish --dry-run -p zenfg-snapshot --locked --allow-dirty` | Passed online; expected excluded conformance-test warning |
| Diff, credential-pattern, license and notice review | Passed: no credential-pattern matches, six identical LICENSE files, attributed TypeGPU showcase |

Toolchains: Node 24.19.0, npm 11.17.0, Rust/Cargo 1.98.0.
The local network required the existing Windows proxy for npm login/downloads.
Cargo package verification used cached dependencies after online index refresh
stalled; actual registry publication and clean published consumers remain separate
required checks. No global proxy configuration was changed.

## Archive review

| Package | Files | Compressed size |
| --- | ---: | ---: |
| `@zenfg/snapshot` | 98 | 117,018 bytes |
| `@zenfg/webgpu` | 93 | 220,300 bytes |
| `@zenfg/inspector` | 123 | 219,212 bytes |
| `zenfg-snapshot` | 13 | 32.4 KiB |
| `zenfg` | 53 | 97.0 KiB |

Published artifacts must come from the final clean release commit. The runtime's
ordinary Cargo package verification follows publication of its exact protocol
dependency. Registry results and final CI will be recorded after publication.

## Publication order

1. Publish `@zenfg/snapshot@0.1.0-beta.3` under npm `next`.
2. Publish `zenfg-snapshot@0.1.0-beta.3` and wait for registry resolution.
3. Verify the ordinary Cargo runtime package and publish dry-run.
4. Publish `@zenfg/webgpu@0.1.0-beta.3` under npm `next`.
5. Publish `zenfg@0.1.0-beta.3`.
6. Publish `@zenfg/inspector@0.1.0-beta.3` under npm `next`.
7. Verify all five exact versions from clean consumers.
8. Create and push the five annotated component tags at the release commit.

After an uncertain registry response, query the exact version before retrying.
