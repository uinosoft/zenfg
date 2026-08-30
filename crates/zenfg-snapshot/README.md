# zenfg-snapshot

Portable, `wgpu`-independent wire types, JSON codec, validator, and legacy
migration support for ZenFG Snapshot 1.0.

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

let decoded = parse_frame_graph_snapshot(json_text)?;
let value = serde_json::to_value(&decoded.snapshot)?;
let issues = validate_frame_graph_snapshot(&value);
let canonical_json = to_json_pretty(&decoded.snapshot)?;
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
