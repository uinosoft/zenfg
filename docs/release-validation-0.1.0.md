# ZenFG 0.1.0 release validation

Date: 2026-09-15

## Scope

All five public packages advance from 0.1.0-beta.4 to 0.1.0. The three npm
packages target latest; the two Rust crates target crates.io. Runtime APIs and
Snapshot 1.2 semantics are unchanged. Internal dependencies use exact 0.1.0.

## Local candidate checks

- Release static preflight and documentation checks passed.
- TypeScript typecheck passed; 719 unit tests passed with no skips.
- Package and site build passed; 188 built HTML pages and deep links verified.
  The existing large-chunk advisory remains.
- Reference renderer hardware suite: 13 checks passed on NVIDIA Turing via Edge.
  Includes actual shader execution, pixel/indirect-buffer readback, resizing,
  capture, shared attachments and device loss; no uncaptured GPU errors.
- Three.js hardware integration suite passed without page or console errors.
- Inspector timing browser acceptance passed on the production build: CPU/GPU
  capture, Snapshot 1.2 same-frame export, keyboard controls and narrow layout.

## Publication gates

The release commit must pass the complete CI workflow and a Publish dry-run
before a new publishing run is dispatched. That run builds its own candidate;
review its names, versions, channels, checksums and clean consumers before the
protected release Environment is approved. Publication results and archive
verification are recorded by the workflow artifacts and component Releases.

Historical beta checklists remain unchanged. See [release process](release-process.md).
