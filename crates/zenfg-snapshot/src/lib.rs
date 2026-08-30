//! Portable ZenFG Snapshot 1.0 wire model, validation, and migration.

mod codec;
mod error;
mod json;
mod types;
mod validator;

pub use codec::{decode_frame_graph_snapshot, parse_frame_graph_snapshot};
pub use error::{SnapshotDecodeError, SnapshotIssue, SnapshotIssueSeverity, SnapshotJsonError};
pub use json::{to_json, to_json_pretty};
pub use types::*;
pub use validator::validate_frame_graph_snapshot;

pub const FRAME_GRAPH_SNAPSHOT_FORMAT: &str = "zenfg.frame-graph-snapshot";
pub const T3D_FRAME_GRAPH_SNAPSHOT_FORMAT: &str = "t3d.frame-graph-snapshot";
pub const FRAME_GRAPH_SNAPSHOT_VERSION: SnapshotVersion = SnapshotVersion { major: 1, minor: 0 };
