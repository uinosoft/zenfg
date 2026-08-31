#![doc = include_str!("../README.md")]
#![warn(missing_docs)]

mod codec;
mod error;
mod json;
// Public wire types are documented; item-level allows in `types.rs` defer only
// exhaustive field and variant documentation for the schema-shaped data model.
mod types;
mod validator;

pub use codec::{decode_frame_graph_snapshot, parse_frame_graph_snapshot};
pub use error::{SnapshotDecodeError, SnapshotIssue, SnapshotIssueSeverity, SnapshotJsonError};
pub use json::{to_json, to_json_pretty};
pub use types::*;
pub use validator::validate_frame_graph_snapshot;

/// Canonical `format` discriminator for ZenFG Snapshot 1.0 documents.
pub const FRAME_GRAPH_SNAPSHOT_FORMAT: &str = "zenfg.frame-graph-snapshot";
/// Historical pre-release `format` discriminator accepted for migration.
pub const LEGACY_CANDIDATE_FRAME_GRAPH_SNAPSHOT_FORMAT: &str =
    "zenfg.frame-graph-snapshot-candidate";
/// Snapshot wire version emitted by this crate.
pub const FRAME_GRAPH_SNAPSHOT_VERSION: SnapshotVersion = SnapshotVersion { major: 1, minor: 0 };
/// Maximum number of nested JSON container levels allowed in one extension value.
///
/// Primitive extension values have depth zero. An extension value whose root is
/// an object or array has depth one, and each nested object or array adds one.
pub const FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH: usize = 64;
