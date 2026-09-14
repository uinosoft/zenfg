# Release process

Releases are manual and auditable during the `0.1.x` phase.

The current coordinated release is tracked in the
[`0.1.0-beta.3` release checklist](release-checklist-0.1.0-beta.3.md). The
completed first release remains recorded in the
[`0.1.0-beta.1` release checklist](release-checklist-0.1.0.md).

1. Run TypeScript build, typecheck, tests, cross-language conformance, and
   package checks.
2. Run Rust formatting, Clippy, all-feature tests, rustdoc with warnings denied,
   and package verification.
3. Review packed file lists and third-party notices.
4. Verify the compatibility matrix and changelogs.
5. Publish protocol packages first, runtimes second, and Inspector last.
6. Test each published artifact from a clean temporary consumer before
   promoting it to the stable release channel.

Use the commands in [release validation](release-validation.md), with `--locked`
for workspace dependency checks and ordinary Cargo package/publish commands.
Intentional dependency changes must include an explicitly updated `Cargo.lock`.

When a coordinated release bumps `zenfg-snapshot`, a normal `cargo package -p
zenfg --locked` cannot resolve the runtime's new exact optional registry dependency until
the protocol crate is published. `npm run cargo:package-check` covers this
interval accurately: it packages and verifies `zenfg-snapshot`, assembles the
exact `zenfg` archive, then compiles the unpacked archive outside the workspace
with the packaged protocol crate supplied through a temporary crates.io patch.
The bootstrap runtime package deliberately uses `--no-verify --exclude-lockfile`
without `--locked`: generating its registry lockfile would require the unpublished
Snapshot version. The unpacked-crate checks are temporary consumer checks, not
workspace lockfile gates; they resolve their own dependencies, including the local
patch for the runtime. Snapshot workspace packaging still uses `--locked`.
After the exact required Snapshot version is published and available from the
crates.io index, run `npm run cargo:release-check` from the clean release checkout,
before publishing the runtime. This manual release-only gate runs
`cargo publish --dry-run --locked -p zenfg --all-features --registry crates-io`
with a unique target directory. Cargo builds the final registry-resolved archive,
including the Snapshot feature, without the bootstrap flags or a local patch.
No upload occurs and no publish token is required. Do not use registry source
replacements or local Cargo patches for this check.

Each invocation preserves its archive, `commands.log`, and `result.json` under
`target/release-validation/zenfg-*/`. The report records the commit, tracked
worktree status, Cargo version, Snapshot requirement, command arguments, and, on
success, archive file list, size, and SHA-256. Attach these results to the release
checklist or release evidence storage; ignored local target files alone are not
a durable audit record. Keep the checkout unchanged through runtime publication;
rerun the gate after any source, manifest, lockfile, or toolchain change.

A nonzero exit or failed report blocks runtime publication. An unavailable
Snapshot version, registry/network failure, lockfile drift, dirty crate contents,
or archive verification failure is not a successful bootstrap substitute. Fix
the cause and rerun; do not bypass it with `--no-verify`, `--exclude-lockfile`,
`--allow-dirty`, or a patch. Ordinary PR CI continues to use only the existing
bootstrap package check.

No dual-registry automatic release tool is required for the initial series.
