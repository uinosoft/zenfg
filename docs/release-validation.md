# Release validation

Run the release checks from a clean checkout with the supported Node.js, pnpm, npm,
and Rust toolchains. The authoritative observed counts and archive sizes for a
specific candidate belong in its release checklist.

## TypeScript and npm

1. Run `pnpm run typecheck` and `pnpm test`.
2. Run `pnpm run test:cross-language` to compare the TypeScript and Rust
   producers and decoders against the shared conformance corpus.
3. Run `pnpm run build` and `pnpm run docs:check`.
4. Remove generated package output, then run `pnpm run pack:check`. This rebuilds
   all three npm packages, inspects their tarballs, installs them in clean
   temporary npm and pnpm consumers, verifies their public exports and declaration
   maps, and compiles the documented examples in both dependency layouts.
5. Run `pnpm run release:smoke:npm` to retain validated archives in `target/release/`.
   Inspect each archive with the pinned CLI:
   `node node_modules/npm/bin/npm-cli.js publish target/release/ARCHIVE.tgz --dry-run --ignore-scripts --access public --tag CHANNEL`.
   Replace `CHANNEL` with `next` for prereleases or `latest` for versions without
   a prerelease suffix. The selected-package Publish dry-run chooses the channel
   from each package version.

Publishing dry-runs require unoccupied versions. Ordinary static checks and
artifact smoke tests also work with versions that are already published.

The Snapshot checks cover canonical V1, Legacy V0, Legacy Candidate V1,
structural and semantic failures, cross-language producer parity, deterministic
serialization, JSON-safety, and the extension-depth boundary.

## Rust and Cargo

1. Run `cargo fmt --all --check`.
2. Run `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`.
3. Run `cargo test --locked --workspace --all-features` and
   `cargo test --locked --workspace --all-features --doc`.
4. Run `cargo check --locked --workspace --all-features --examples`, then execute the
   CPU-only examples with the same locked commands as CI:
   `cargo run --locked -p zenfg --example minimal-frame --all-features`,
   `cargo run --locked -p zenfg --example snapshot-export --features snapshot`, and
   `cargo run --locked -p zenfg-snapshot --example basic`.
   Run `cargo doc --locked --workspace --all-features --no-deps` with
   `RUSTDOCFLAGS="-D warnings"`.
5. Run `pnpm run cargo:package-check` and inspect both crate archives.
6. Run the native selected-package Cargo dry-run and clean artifact consumers
   through `pnpm run release:smoke`. This never uploads. See the
   [release process](release-process.md) for candidate selection, independent
   dependencies, approval, evidence and failure recovery.

Workspace checks use the committed `Cargo.lock`; temporary consumers resolve
their own lockfiles. Registry consumers use exact versions without patches.

## Repository and artifact review

- Run `git diff --check` and review the complete staged diff.
- Scan tracked source, documentation, fixtures, and package archives for
  credentials, private paths, unpublished identifiers, and unexpected files.
- Confirm LICENSE and third-party notice files are present and consistent.
- Verify the npm and Cargo archive file counts and sizes, then record the
  observed values in the release checklist.
- Confirm the worktree is clean and the intended commit is at `HEAD` before any
  tag or publication action.

## Browser acceptance

Before the first release, verify the standalone Inspector in a real browser:
file selection, drag-and-drop, legacy migration feedback, invalid input
feedback, all workbench views, layout, scrolling, selection, and resizing.
Browser automation and screenshot baselines are optional and are not part of
the published packages.
