# Release process

Releases are manual and auditable during the `0.1.x` phase.

The current coordinated release is tracked in the
[`0.1.0-beta.2` release checklist](release-checklist-0.1.0-beta.2.md). The
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

When a coordinated release bumps `zenfg-snapshot`, a normal `cargo package -p
zenfg` cannot resolve the runtime's new exact optional registry dependency until
the protocol crate is published. `npm run cargo:package-check` covers this
interval accurately: it packages and verifies `zenfg-snapshot`, assembles the
exact `zenfg` archive, then compiles the unpacked archive outside the workspace
with the packaged protocol crate supplied through a temporary crates.io patch.
After the protocol crate is published, the release operator must also run
ordinary `cargo package -p zenfg --locked --allow-dirty` before publishing the
runtime.

No dual-registry automatic release tool is required for the initial series.
