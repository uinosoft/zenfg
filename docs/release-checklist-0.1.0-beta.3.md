# ZenFG 0.1.0-beta.3 release checklist

- Date: 2026-09-07
- Previous release commit: `cf4522965ba5dbb710d1dd7853c1790fba41b165`
- Release commit: `1140d275b66cd1a28383e653a4577bff05ac2fb3`
- Status: published, tagged, and verified from clean npm and Cargo consumers

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
stalled; subsequent online publication checks and clean registry consumers also
passed. No global proxy configuration was changed.

## Archive review

| Package | Files | Compressed size |
| --- | ---: | ---: |
| `@zenfg/snapshot` | 98 | 117,018 bytes |
| `@zenfg/webgpu` | 93 | 220,300 bytes |
| `@zenfg/inspector` | 123 | 219,212 bytes |
| `zenfg-snapshot` | 13 | 33,146 bytes |
| `zenfg` | 54 | 110,674 bytes |

All published artifacts came from the clean release commit. Both downloaded
registry crates record that commit without a dirty marker. All three npm registry
integrity hashes match the reviewed publish dry-runs. The final runtime crate
includes its registry-resolved Cargo.lock; the earlier bootstrap archive had
53 files and was 97.0 KiB compressed.

## Release boundary

- Release commit pushed to `origin/main`.
- [CI run 34101857773](https://github.com/uinosoft/zenfg/actions/runs/34101857773)
  passed TypeScript, Rust, cross-language, and Pages before publication.
- npm Snapshot publication required browser confirmation and asynchronous
  registry processing. All three packages are now available under `next`.
- The previous Cargo environment token overrode the user's refreshed login.
  Removing that stale variable only in the publishing process allowed both crate
  publications to succeed with the refreshed credentials.
- After the protocol crate became available, ordinary `cargo package -p zenfg
  --locked` and `cargo publish --dry-run -p zenfg --locked` both passed against
  the actual registry dependency before the runtime was published.

## Publication result

| Registry | Package | Version | Result |
| --- | --- | --- | --- |
| npm | `@zenfg/snapshot` | `0.1.0-beta.3` | Published under `next`; clean consumer passed |
| npm | `@zenfg/webgpu` | `0.1.0-beta.3` | Published under `next`; clean consumer passed |
| npm | `@zenfg/inspector` | `0.1.0-beta.3` | Published under `next`; clean consumer passed |
| crates.io | `zenfg-snapshot` | `0.1.0-beta.3` | Published, not yanked; clean Rust consumer passed |
| crates.io | `zenfg` | `0.1.0-beta.3` | Published, not yanked; clean Rust consumer passed |

The empty npm consumer installed all three exact registry versions, checked their
public imports, accepted Snapshot 1.1, and rejected canonical 1.0. The empty Cargo
consumer installed both exact crate versions without patches, enabled `zenfg`'s
`snapshot` feature, and compiled and ran checks of the 1.1 constant and new root
resolution API. npm `latest` remains `0.1.0-beta.1`.

## Component tags

- `npm/snapshot/v0.1.0-beta.3`
- `npm/webgpu/v0.1.0-beta.3`
- `npm/inspector/v0.1.0-beta.3`
- `cargo/zenfg-snapshot/v0.1.0-beta.3`
- `cargo/zenfg/v0.1.0-beta.3`

All five annotated tags were atomically pushed and verified on `origin`, pointing
to the release commit, after exact-version registry consumer verification.

## Failure recovery

After an uncertain registry response, query the exact version before retrying.
