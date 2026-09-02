# zenfg-snapshot

[![crates.io](https://img.shields.io/crates/v/zenfg-snapshot?include_prereleases)](https://crates.io/crates/zenfg-snapshot)
[![docs.rs](https://img.shields.io/docsrs/zenfg-snapshot)](https://docs.rs/zenfg-snapshot)
[![status: beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/uinosoft/zenfg/blob/main/CHANGELOG.md)
[![CI](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml/badge.svg)](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/main/LICENSE)

`zenfg-snapshot` provides portable, wgpu-independent Snapshot 1.0 wire types,
JSON codec, validation, and legacy migration. It is the Rust counterpart of the
normative `@zenfg/snapshot` package and depends only on Serde, `serde_json`, and
`thiserror`.

Snapshot documents contain graph structure and diagnostics, not GPU commands or
resource contents, and cannot replay a frame. Wire-format versioning is
independent from this crate's beta API version.

## Installation

```sh
cargo add zenfg-snapshot@0.1.0-beta.1
```

## Quick start

Parse untrusted JSON text to validate and normalize a canonical Snapshot:

```rust
use zenfg_snapshot::{
    decode_frame_graph_snapshot, parse_frame_graph_snapshot, to_json_pretty,
    validate_frame_graph_snapshot, validate_typed_frame_graph_snapshot,
};

let json_text = r#"{
  "format": "zenfg.frame-graph-snapshot",
  "version": { "major": 1, "minor": 0 },
  "producer": { "name": "example" },
  "capture": { "frameIndex": 0 },
  "graph": {
    "groups": [], "nodes": [], "resources": [], "textureViews": [],
    "accesses": [], "dependencies": [], "roots": [], "segments": []
  },
  "memory": {
    "allocationReport": { "status": "available", "allocations": [] },
    "poolReport": { "status": "unavailable", "reason": "not captured" }
  },
  "timings": {
    "gpu": { "status": "unavailable", "reason": "not captured" }
  },
  "diagnostics": [],
  "extensions": {}
}"#;

let decoded = parse_frame_graph_snapshot(json_text)?;
let value = serde_json::to_value(&decoded.snapshot)?;
assert!(validate_frame_graph_snapshot(&value).is_empty());

let decoded_from_value = decode_frame_graph_snapshot(value)?;
assert_eq!(decoded_from_value.snapshot, decoded.snapshot);
assert!(validate_typed_frame_graph_snapshot(&decoded.snapshot).is_ok());

let canonical_json = to_json_pretty(&decoded.snapshot)?;
assert!(canonical_json.contains("zenfg.frame-graph-snapshot"));
# Ok::<(), Box<dyn std::error::Error>>(())
```

Successful decoding returns a canonical Snapshot 1.0 value and explicit
migration provenance when historical input was upgraded. Unknown formats and
versions are rejected.

## Common tasks

| Task | Public API |
| --- | --- |
| Parse untrusted JSON text | `parse_frame_graph_snapshot()` |
| Decode an already-parsed `serde_json::Value` | `decode_frame_graph_snapshot()` |
| Validate canonical JSON-shaped data | `validate_frame_graph_snapshot()` |
| Validate a typed in-memory Snapshot | `validate_typed_frame_graph_snapshot()` |
| Serialize validated typed data | `to_json()`, `to_json_pretty()` |
| Handle decode failures | `SnapshotDecodeError` |
| Inspect structured issues | `SnapshotIssue`, `SnapshotIssueSeverity` |
| Read format, version, and depth limits | `FRAME_GRAPH_SNAPSHOT_FORMAT`, `FRAME_GRAPH_SNAPSHOT_VERSION`, `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH` |

The crate exports `FrameGraphSnapshotV1` and all wire types with `Serialize` and
`Deserialize`. Exact fields and error variants are documented on
[docs.rs](https://docs.rs/zenfg-snapshot).

## Consumer and producer boundaries

- Use parse or decode for untrusted input. Canonical Snapshot 1.0, Legacy V0,
  and Legacy Candidate V1 are accepted; supported historical data is migrated
  explicitly.
- Use `validate_typed_frame_graph_snapshot()` before returning a typed producer
  value. `to_json()` and `to_json_pretty()` perform the same checks before
  writing wire output.
- Validation returns structured issues with stable codes, JSON Pointer paths,
  and messages.
- Unknown versions are rejected until an explicit migration is implemented and
  tested. Missing legacy facts remain absent rather than being invented.
- The crate has no wgpu dependency. Runtime-to-Snapshot projection belongs to
  `zenfg` behind its `snapshot` feature.

The normative Schema, specification, fixtures, and conformance manifest are
published by `@zenfg/snapshot`. See the
[Snapshot 1.0 specification](https://github.com/uinosoft/zenfg/blob/main/packages/snapshot/SPEC.md)
for the complete structural and cross-field contract.

## Common mistakes

| Symptom | Fix |
| --- | --- |
| Legacy input fails typed or canonical validation | Decode it first so the explicit migration runs. |
| Serialization rejects a typed value | Validate it and inspect the structured issue before writing JSON. |
| An unknown version looks structurally similar | Reject it until a reader implements a tested migration. |
| A producer expects validation to add missing facts | Populate required facts explicitly; validators do not invent diagnostics. |
| A Snapshot is expected to replay GPU work | Use an application-owned command/resource capture mechanism instead. |

## Complete example

The crate ships a compile-checked
[`examples/basic.rs`](https://github.com/uinosoft/zenfg/blob/main/crates/zenfg-snapshot/examples/basic.rs)
workflow. Cross-language fixtures and producer projections live in the
normative `@zenfg/snapshot` conformance corpus.

## Further reading

- [Snapshot 1.0 specification](https://github.com/uinosoft/zenfg/blob/main/packages/snapshot/SPEC.md)
- [ZenFG Core concepts](https://github.com/uinosoft/zenfg/blob/main/docs/core-concepts.md)
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/main/packages/snapshot/README.md)
- [`zenfg`](https://github.com/uinosoft/zenfg/blob/main/crates/zenfg/README.md)
- [Compatibility](https://github.com/uinosoft/zenfg/blob/main/docs/compatibility.md)
