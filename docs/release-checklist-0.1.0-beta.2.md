# ZenFG 0.1.0-beta.2 release checklist

- Date: 2026-09-02
- Previous release commit: `1c59e5f5a22f4bd6b55335f1ddc54c95543e702a`
- Release commit: the commit containing this candidate checklist
- Status: candidate validated; publication pending

This checklist records the coordinated `0.1.0-beta.2` release of all five
packages. Published artifacts must come from the final clean release commit.

## Candidate changes

- `@zenfg/webgpu`: accept iterable texture extents and origins consistently in
  public types and at runtime.
- `zenfg`: preserve sparse recording debug-group IDs during execution and GPU
  timing ancestry reconstruction.
- `@zenfg/inspector`: align the export menu and improve graph zoom and framing.
- All five packages: ship the reorganized package-local documentation and align
  exact internal dependencies at `0.1.0-beta.2`.

## Candidate verification

| # | Check | Result |
| ---: | --- | --- |
| 1 | `npm run typecheck` | Passed: all package workspaces, Inspector app, and seven WebGPU recipes |
| 2 | `npm test` | Passed: 318/318 tests |
| 3 | `npm run test:cross-language` | Passed: seven mirrored producer cases and the Rust integration test |
| 4 | `npm run build` | Passed: all packages and apps; only the existing Vite chunk-size advisory was emitted |
| 5 | `npm run docs:check` | Passed: five entrypoints, 129 exports, 38 callable members, 68 deferred Rust types, and 72 links |
| 6 | Remove generated package output, then `npm run pack:check` | Passed: tarball contents, clean consumer imports, TypeScript 6 declarations/recipes, and source-backed maps |
| 7 | `npm publish --dry-run --access public --tag next` for all three npm packages | Passed: Snapshot 88 files/108.5 kB; WebGPU 92/214.7 kB; Inspector 123/208.0 kB |
| 8 | `cargo fmt --all --check` | Passed |
| 9 | `cargo clippy --workspace --all-targets --all-features -- -D warnings` | Passed |
| 10 | `cargo test --workspace --all-features` | Passed, including the sparse debug-group regression and all seven trybuild cases |
| 11 | `cargo test --workspace --all-features --doc` | Passed: three README doctests |
| 12 | `RUSTDOCFLAGS="-D warnings" cargo doc --workspace --all-features --no-deps` | Passed for both crates |
| 13 | `cargo check --workspace --all-features --examples` | Passed for all examples |
| 14 | Run the three CPU-only examples from the release validation guide | Passed: `minimal-frame`, `snapshot-export`, and Snapshot `basic` |
| 15 | `npm run cargo:package-check` | Passed: Snapshot 13 files/155.5 KiB (30.1 KiB compressed); runtime 52/532.8 KiB (95.4 KiB compressed) |
| 16 | `cargo publish --dry-run -p zenfg-snapshot --locked --allow-dirty` | Passed with the accepted excluded conformance-test warning |
| 17 | Review diffs, credentials, licenses, package boundaries, and archive contents | Passed: no credential-pattern hits, all six LICENSE hashes match, expected remote, and no beta.2 tags |

## Release boundary

- Release commit and push: pending
- Required GitHub Actions checks: pending
- Registry publication and clean-consumer verification: pending

## Publication order

1. Publish `@zenfg/snapshot@0.1.0-beta.2` with npm tag `next`.
2. Publish `zenfg-snapshot@0.1.0-beta.2`, then wait until Cargo can resolve it.
3. Run the ordinary `zenfg` Cargo publish dry-run.
4. Publish `@zenfg/webgpu@0.1.0-beta.2` with npm tag `next`.
5. Publish `zenfg@0.1.0-beta.2`.
6. Publish `@zenfg/inspector@0.1.0-beta.2` with npm tag `next`.
7. Verify all five exact versions from clean consumers.
8. Create and push the five annotated component tags.

## Publication result

| Registry | Package | Version | Result |
| --- | --- | --- | --- |
| npm | `@zenfg/snapshot` | `0.1.0-beta.2` | Pending |
| npm | `@zenfg/webgpu` | `0.1.0-beta.2` | Pending |
| npm | `@zenfg/inspector` | `0.1.0-beta.2` | Pending |
| crates.io | `zenfg-snapshot` | `0.1.0-beta.2` | Pending |
| crates.io | `zenfg` | `0.1.0-beta.2` | Pending |

## Component tags

- `npm/snapshot/v0.1.0-beta.2`
- `npm/webgpu/v0.1.0-beta.2`
- `npm/inspector/v0.1.0-beta.2`
- `cargo/zenfg-snapshot/v0.1.0-beta.2`
- `cargo/zenfg/v0.1.0-beta.2`

## Failure recovery

- After a registry timeout, query the registry before retrying; registry
  versions are immutable.
- Deprecate a faulty npm version and publish a new beta.
- Yank a faulty Cargo crate version and publish a new beta.
