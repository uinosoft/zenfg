# zenfg-snapshot

[![crates.io](https://img.shields.io/crates/v/zenfg-snapshot?include_prereleases)](https://crates.io/crates/zenfg-snapshot)
[![docs.rs](https://img.shields.io/docsrs/zenfg-snapshot)](https://docs.rs/zenfg-snapshot)
[![status: beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/uinosoft/zenfg/blob/main/CHANGELOG.md)
[![CI](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml/badge.svg)](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/main/LICENSE)

Portable, `wgpu`-independent wire types, JSON codec, validator, and legacy
migration support for ZenFG Snapshot 1.0.

This is a public beta crate. Public APIs may change before 1.0; integration
projects should pin the exact beta version. Snapshot wire format version 1.0 is
versioned independently from the crate API.

For package selection, Snapshot/runtime boundaries, TypeScript/Rust API mapping,
and common integration failures, see the
[ZenFG quick reference](https://github.com/uinosoft/zenfg/blob/main/docs/quick-reference.md).

The canonical format identifier is `zenfg.frame-graph-snapshot`; encoded files
use the `.fgsnapshot.json` extension.

## Installation

```sh
cargo add zenfg-snapshot@0.1.0-beta.1
```

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
let issues = validate_frame_graph_snapshot(&value);
assert!(issues.is_empty());
let decoded_from_value = decode_frame_graph_snapshot(value)?;
assert_eq!(decoded_from_value.snapshot, decoded.snapshot);
assert!(validate_typed_frame_graph_snapshot(&decoded.snapshot).is_ok());
let canonical_json = to_json_pretty(&decoded.snapshot)?;
assert!(canonical_json.contains("zenfg.frame-graph-snapshot"));
# Ok::<(), Box<dyn std::error::Error>>(())
```

The crate exports `FrameGraphSnapshotV1` and all wire types with both
`Serialize` and `Deserialize`. Decoding accepts canonical ZenFG V1, the
historical unversioned Legacy V0 shape, and Legacy Candidate V1.
Successful migrations always return ZenFG V1 with explicit migration
provenance; unknown formats and versions are rejected.

Validation returns structured `SnapshotIssue` values with stable issue codes,
JSON Pointer paths, and messages. The implementation has no `wgpu` dependency;
its runtime dependencies are Serde, `serde_json`, and `thiserror` only. The
normative specification, Schema, fixtures, and conformance manifest are
published by `@zenfg/snapshot`.

`validate_typed_frame_graph_snapshot()` applies the typed-to-JSON canonicalization
and full Snapshot validation checks without allocating JSON text. It is intended
for producers that need to validate an in-memory `FrameGraphSnapshotV1` before
returning it; `to_json()` and `to_json_pretty()` continue to perform the same
checks before writing wire output.

Extension values may contain at most 64 nested JSON object/array container
levels, exposed as `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH`. Primitive
extension values have depth zero and an object or array root has depth one.
Validation and encoding report `extension-depth-exceeded` at the extension's
root JSON Pointer when the limit is exceeded.
