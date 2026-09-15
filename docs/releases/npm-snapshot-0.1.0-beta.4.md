# @zenfg/snapshot 0.1.0-beta.4

Date: 2026-09-15

### Changes

- Add Snapshot 1.2 CPU timing types, schema, validation and conformance cases.
- Validate Snapshot 1.1 before migrating it to 1.2 with explicit unavailable historical CPU timing. Keep Legacy V0 and Candidate V1 migration support.
- Reject inherited object fields and align identifier, numeric and extension validation with the Rust reader.

### Compatibility

- Writers must provide both CPU and GPU availability records in canonical 1.2 snapshots. Canonical 1.0 and unknown versions remain rejected.
- Upgrade readers before consuming new runtime captures.

[Migration guide](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.0-beta.4/docs/migration-timing-snapshot-1.2.md).
