/// Severity assigned to a validation or migration issue.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotIssueSeverity {
    /// The document is usable, but decoding performed a noteworthy migration.
    Warning,
    /// The document is invalid and cannot be decoded or encoded.
    Error,
}

/// One structured Snapshot validation or migration diagnostic.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotIssue {
    /// Whether the issue prevents a successful operation.
    pub severity: SnapshotIssueSeverity,
    /// Stable machine-readable issue code.
    pub code: String,
    /// RFC 6901 JSON Pointer to the affected value, or the empty root pointer.
    pub path: String,
    /// Human-readable explanation intended for diagnostics.
    pub message: String,
}

impl SnapshotIssue {
    pub(crate) fn error(
        code: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            severity: SnapshotIssueSeverity::Error,
            code: code.into(),
            path: path.into(),
            message: message.into(),
        }
    }

    pub(crate) fn warning(
        code: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            severity: SnapshotIssueSeverity::Warning,
            code: code.into(),
            path: path.into(),
            message: message.into(),
        }
    }
}

/// Failure to parse, recognize, migrate, validate, or deserialize a Snapshot.
///
/// All available structured diagnostics are retained in [`Self::issues`].
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("FrameGraph Snapshot could not be decoded")]
pub struct SnapshotDecodeError {
    /// Structured reasons the document could not be decoded.
    pub issues: Vec<SnapshotIssue>,
}

impl SnapshotDecodeError {
    pub(crate) fn new(issues: Vec<SnapshotIssue>) -> Self {
        Self { issues }
    }
}

/// Failure to validate or serialize an in-memory Snapshot.
#[derive(Debug, thiserror::Error)]
pub enum SnapshotJsonError {
    /// The in-memory value does not satisfy Snapshot 1.0 invariants.
    #[error("FrameGraph Snapshot failed validation")]
    Validation {
        /// Structured validation diagnostics.
        issues: Vec<SnapshotIssue>,
    },

    /// Serde failed while converting a valid model to JSON.
    #[error("failed to encode FrameGraph Snapshot JSON: {source}")]
    Serialization {
        /// Underlying JSON serialization error.
        #[source]
        source: serde_json::Error,
    },
}

impl SnapshotJsonError {
    /// Returns validation issues, or `None` for serialization failures.
    pub fn issues(&self) -> Option<&[SnapshotIssue]> {
        match self {
            Self::Validation { issues } => Some(issues),
            Self::Serialization { .. } => None,
        }
    }
}

impl From<serde_json::Error> for SnapshotJsonError {
    fn from(source: serde_json::Error) -> Self {
        Self::Serialization { source }
    }
}
