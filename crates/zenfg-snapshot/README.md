# zenfg-snapshot

Portable, `wgpu`-independent wire types, JSON codec, validator, and legacy
migration support for ZenFG Snapshot 1.0.

For package selection, Snapshot/runtime boundaries, TypeScript/Rust API mapping,
and common integration failures, see the
[ZenFG quick reference](https://github.com/uinosoft/zenfg/blob/main/docs/quick-reference.md).

The canonical format identifier is `zenfg.frame-graph-snapshot`; encoded files
use the `.fgsnapshot.json` extension.

## Installation

```sh
cargo add zenfg-snapshot
```

```rust
use zenfg_snapshot::{
    decode_frame_graph_snapshot, parse_frame_graph_snapshot, to_json_pretty,
    validate_frame_graph_snapshot,
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
let canonical_json = to_json_pretty(&decoded.snapshot)?;
assert!(canonical_json.contains("zenfg.frame-graph-snapshot"));
# Ok::<(), Box<dyn std::error::Error>>(())
```

The crate exports `FrameGraphSnapshotV1` and all wire types with both
`Serialize` and `Deserialize`. Decoding accepts canonical ZenFG V1, the
historical unversioned Legacy V0 shape, and the pre-release t3d V1 candidate.
Successful migrations always return ZenFG V1 with explicit migration
provenance; unknown formats and versions are rejected.

Validation returns structured `SnapshotIssue` values with stable issue codes,
JSON Pointer paths, and messages. The implementation has no `wgpu` dependency;
its runtime dependencies are Serde, `serde_json`, and `thiserror` only. The
normative specification, Schema, fixtures, and conformance manifest are
published by `@zenfg/snapshot`.

Extension values may contain at most 64 nested JSON object/array container
levels, exposed as `FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH`. Primitive
extension values have depth zero and an object or array root has depth one.
Validation and encoding report `extension-depth-exceeded` at the extension's
root JSON Pointer when the limit is exceeded.
