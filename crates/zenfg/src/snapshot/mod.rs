//! Snapshot 1.0 export plus the portable [`zenfg_snapshot`] wire API.
//!
//! Enable the `snapshot` Cargo feature, compile with a full report, then call
//! [`create_frame_graph_snapshot`]. Encoding, arbitrary JSON validation, and
//! legacy migration are re-exported from the wgpu-independent snapshot crate.

mod error;
mod export;

pub use error::SnapshotExportError;
pub use export::{CreateFrameGraphSnapshotOptions, create_frame_graph_snapshot};
pub use zenfg_snapshot::*;

#[cfg(test)]
mod tests;
