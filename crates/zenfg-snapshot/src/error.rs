#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotIssueSeverity {
    Warning,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotIssue {
    pub severity: SnapshotIssueSeverity,
    pub code: String,
    pub path: String,
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

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("FrameGraph Snapshot could not be decoded")]
pub struct SnapshotDecodeError {
    pub issues: Vec<SnapshotIssue>,
}

impl SnapshotDecodeError {
    pub(crate) fn new(issues: Vec<SnapshotIssue>) -> Self {
        Self { issues }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SnapshotJsonError {
    #[error("FrameGraph Snapshot failed validation")]
    Validation { issues: Vec<SnapshotIssue> },

    #[error("failed to encode FrameGraph Snapshot JSON: {source}")]
    Serialization {
        #[source]
        source: serde_json::Error,
    },
}

impl SnapshotJsonError {
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
