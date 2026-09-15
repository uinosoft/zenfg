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

## Publication result

Status: published and verified on 2026-09-15.

- Release commit: `f644a73aad3c84de3b7b822acd8f1776366ea780` ([PR #5](https://github.com/uinosoft/zenfg/pull/5)).
- [Release commit CI](https://github.com/uinosoft/zenfg/actions/runs/34957413291): passed.
- [Five-package Publish dry-run](https://github.com/uinosoft/zenfg/actions/runs/34957420011): passed.
- [Production Publish run](https://github.com/uinosoft/zenfg/actions/runs/34958080272): passed, including publication, registry verification and Release creation.
- All five production candidate archive SHA-256 values matched the successful
  dry-run archives before the protected release Environment was approved.
- Registry downloads matched the approved archive checksums; exact-version
  consumers and cross-language checks passed. npm provenance and all three
  `latest` tags were verified. `next` remains at `0.1.0-beta.4`.
- The website and both versioned docs.rs documentation entrypoints returned
  HTTP 200 during the post-release check.

| Package | Version | Channel | Component Release |
| --- | --- | --- | --- |
| `@zenfg/snapshot` | `0.1.0` | npm `latest` | [npm/snapshot/v0.1.0](https://github.com/uinosoft/zenfg/releases/tag/npm%2Fsnapshot%2Fv0.1.0) |
| `@zenfg/webgpu` | `0.1.0` | npm `latest` | [npm/webgpu/v0.1.0](https://github.com/uinosoft/zenfg/releases/tag/npm%2Fwebgpu%2Fv0.1.0) |
| `@zenfg/inspector` | `0.1.0` | npm `latest` | [npm/inspector/v0.1.0](https://github.com/uinosoft/zenfg/releases/tag/npm%2Finspector%2Fv0.1.0) |
| `zenfg-snapshot` | `0.1.0` | crates.io | [cargo/zenfg-snapshot/v0.1.0](https://github.com/uinosoft/zenfg/releases/tag/cargo%2Fzenfg-snapshot%2Fv0.1.0) |
| `zenfg` | `0.1.0` | crates.io | [cargo/zenfg/v0.1.0](https://github.com/uinosoft/zenfg/releases/tag/cargo%2Fzenfg%2Fv0.1.0) |

Each component Release includes its archive, `manifest.json` and `verified.json`.
The production workflow also retains `release-candidate`, `publish-evidence-1`
and `registry-evidence-1` artifacts for 90 days. These contain the file lists,
checksums, command logs and consumer results.

Historical beta checklists remain unchanged. See [release process](release-process.md).
