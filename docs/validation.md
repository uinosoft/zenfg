# Migration validation

This document records the extraction acceptance run on 2026-08-30. It is not a
performance baseline or a substitute for release-time checks.

## Source baseline

- Both source repositories matched the commits in `migration-baseline.md` and
  had clean worktrees before copying tracked files.
- The source TypeScript baseline passed 282 tests.
- The source Rust baseline passed 98 tests plus seven trybuild cases.

## Extracted workspace

- `npm run typecheck`: passed for all three packages and the Inspector app.
- `npm test`: 294 passed, including Snapshot compatibility/conformance,
  imported undefined contents, persistent state, Inspector complexity guards,
  stale async operations, standalone file-picker/drop routing, t3d V1
  migration feedback, and atomic rejection of semantic-invalid imports.
- `npm run test:cross-language`: seven mirrored producer cases passed. Both
  validators and decoders accepted the other runtime's raw Snapshot, repeated
  production was deterministic, and both semantic projections matched the
  reviewed goldens.
- `npm run build`: passed; the Inspector app produced backend-free static
  output and `THIRD_PARTY_NOTICES.txt`.
- `npm run pack:check`: all three npm tarballs were installed and imported from
  a temporary empty project; exports, declarations, Schema, fixtures, LICENSE,
  and workspace leakage were checked.
- `cargo fmt --all --check`: passed.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`:
  passed.
- `cargo test --workspace --all-features`: 100 `zenfg` test functions passed,
  including the cross-language producer integration and the UI harness; that
  harness ran seven trybuild cases. Five `zenfg-snapshot`
  integration/conformance tests passed.
- `npm run cargo:package-check`: both crate archives contained their expected
  metadata and LICENSE; `zenfg-snapshot` passed Cargo's package verifier and
  unpacked `zenfg` compiled outside the workspace with all features.
- The CPU-only TypeScript compile benchmark completed a small smoke run.

The TypeScript and Rust validators consume the same 39-case conformance
manifest and compare the complete sorted issue multiset. The independent
cross-language harness mirrors linear dependency, overwrite/culling,
preserve/discard, buffer range, texture subresource, external-submission, and
aliasing semantics. Its projection preserves descriptors, group membership,
exact access regions, dependencies, roots, segments, lifetimes, and allocation
equivalence classes while excluding producer, capture, timing, pool history,
estimated bytes, and graph-local IDs.

## One-time browser check

No browser automation framework or browser dependency is retained in the
repository. The one-time real-browser acceptance was completed successfully on
2026-08-30. It covered file selection, drag/drop, Legacy migration feedback,
invalid input feedback, the Graph, Passes, Resources, Memory, Diagnostics, and
Inspector views, layout, scrolling, selection, and window resizing.

No Playwright configuration, browser automation script, screenshot baseline,
or browser package was added after the check.
