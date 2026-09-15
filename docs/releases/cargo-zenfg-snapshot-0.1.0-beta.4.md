# zenfg-snapshot 0.1.0-beta.4

Date: 2026-09-15

### Changes

- Add Snapshot 1.2 CPU timing structures, validation and serde support.
- Validate and migrate Snapshot 1.1 inputs while preserving migration provenance and extensions.
- Align identifier and numeric validation with TypeScript and update the public basic example.

### Compatibility

- Canonical 1.2 snapshots require CPU and GPU availability records. Legacy V0 and Candidate V1 remain supported; canonical 1.0 and unknown versions remain rejected.
- Upgrade readers before consuming new runtime captures.

[Migration guide](https://github.com/uinosoft/zenfg/blob/cargo/zenfg-snapshot/v0.1.0-beta.4/docs/migration-timing-snapshot-1.2.md).
