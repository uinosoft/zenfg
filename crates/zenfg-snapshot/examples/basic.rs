use zenfg_snapshot::{FRAME_GRAPH_SNAPSHOT_FORMAT, decode_frame_graph_snapshot, to_json_pretty};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let value = serde_json::json!({
        "format": "zenfg.frame-graph-snapshot",
        "version": { "major": 1, "minor": 0 },
        "producer": { "name": "snapshot-basic-example" },
        "capture": { "frameIndex": 0 },
        "graph": {
            "groups": [],
            "nodes": [],
            "resources": [],
            "textureViews": [],
            "accesses": [],
            "dependencies": [],
            "roots": [],
            "segments": []
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
    });

    let decoded = decode_frame_graph_snapshot(value)?;
    assert_eq!(decoded.snapshot.format, FRAME_GRAPH_SNAPSHOT_FORMAT);
    println!("{}", to_json_pretty(&decoded.snapshot)?);
    Ok(())
}
