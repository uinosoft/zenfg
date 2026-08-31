/// Failure to adapt a native compilation report to Snapshot 1.0.
#[derive(Debug, thiserror::Error)]
pub enum SnapshotExportError {
    /// Snapshot export requires the graph tables in a full compilation report.
    #[error("a full compilation report is required to create a FrameGraph Snapshot")]
    FullReportRequired,

    /// A numeric field cannot be represented safely by JavaScript consumers.
    #[error("{field} value {value} exceeds the JavaScript safe-integer range")]
    UnsafeInteger {
        /// Snapshot field being converted.
        field: &'static str,
        /// Out-of-range value.
        value: u64,
    },

    /// Native texture usage contains no Snapshot 1.0 representation.
    #[error("texture usage contains unsupported Snapshot V1 bits {bits:#x}")]
    UnsupportedTextureUsage {
        /// Unsupported native usage bits.
        bits: u32,
    },

    /// Native buffer usage contains no Snapshot 1.0 representation.
    #[error("buffer usage contains unsupported Snapshot V1 bits {bits:#x}")]
    UnsupportedBufferUsage {
        /// Unsupported native usage bits.
        bits: u32,
    },

    /// A native enum or descriptor value cannot be expressed by Snapshot 1.0.
    #[error("cannot map {field} value {value} to Snapshot V1")]
    UnsupportedValue {
        /// Snapshot field being converted.
        field: &'static str,
        /// Unsupported native value.
        value: String,
    },

    /// Optional GPU timing data belongs to a different caller frame.
    #[error("GPU timing frame {timing_frame} does not match capture frame {capture_frame}")]
    TimingFrameMismatch {
        /// Frame identity requested for the capture.
        capture_frame: u64,
        /// Frame identity carried by the timing report.
        timing_frame: u64,
    },

    /// The projected value does not satisfy Snapshot 1.0 invariants.
    #[error("invalid FrameGraph Snapshot: {source}")]
    InvalidSnapshot {
        /// Validation or serialization failure from the Snapshot codec.
        #[source]
        source: zenfg_snapshot::SnapshotJsonError,
    },

    /// The supplied report violates an invariant needed for wire conversion.
    #[error("invalid compilation report for Snapshot export: {message}")]
    InvalidReport {
        /// Human-readable invariant failure.
        message: String,
    },
}
