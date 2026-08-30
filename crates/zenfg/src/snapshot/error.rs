#[derive(Debug, thiserror::Error)]
pub enum SnapshotExportError {
    #[error("a full compilation report is required to create a FrameGraph Snapshot")]
    FullReportRequired,

    #[error("{field} value {value} exceeds the JavaScript safe-integer range")]
    UnsafeInteger { field: &'static str, value: u64 },

    #[error("texture usage contains unsupported Snapshot V1 bits {bits:#x}")]
    UnsupportedTextureUsage { bits: u32 },

    #[error("buffer usage contains unsupported Snapshot V1 bits {bits:#x}")]
    UnsupportedBufferUsage { bits: u32 },

    #[error("cannot map {field} value {value} to Snapshot V1")]
    UnsupportedValue { field: &'static str, value: String },

    #[error("GPU timing frame {timing_frame} does not match capture frame {capture_frame}")]
    TimingFrameMismatch {
        capture_frame: u64,
        timing_frame: u64,
    },

    #[error("invalid compilation report for Snapshot export: {message}")]
    InvalidReport { message: String },
}
