use crate::{AccessRole, DebugGroupId, NodeKind, PassId, ResourceId, RootReason};

/// All recording, compilation, and execution errors emitted by the FrameGraph.
#[derive(Clone, Debug, thiserror::Error, PartialEq, Eq)]
pub enum FrameGraphError {
    #[error("invalid resource descriptor: {message}")]
    InvalidResourceDescriptor { message: String },

    #[error(
        "buffer range {offset}..{end} is outside resource {resource} with size {resource_size}"
    )]
    InvalidBufferRange {
        resource: ResourceId,
        offset: u64,
        end: u64,
        resource_size: u64,
    },

    #[error("invalid texture view for resource {resource}: {message}")]
    InvalidTextureView {
        resource: ResourceId,
        message: String,
    },

    #[error(
        "handle belongs to owner {actual_owner}, recording {actual_recording}; expected owner {expected_owner}, recording {expected_recording}"
    )]
    ForeignHandle {
        expected_owner: u64,
        expected_recording: u64,
        actual_owner: u64,
        actual_recording: u64,
    },

    #[error("pass {pass} ({label}) was dropped without finish()")]
    UnclosedPass { pass: PassId, label: String },

    #[error("debug group label is invalid: {message}")]
    InvalidDebugGroupLabel { message: String },

    #[error("cannot pop a debug group because the stack is empty")]
    DebugGroupStackUnderflow,

    #[error("debug group {group} ({label}) was not closed before compile")]
    UnclosedDebugGroup { group: DebugGroupId, label: String },

    #[error("pass {pass} declares conflicting accesses to resource {resource}: {message}")]
    ConflictingAccesses {
        pass: PassId,
        resource: ResourceId,
        message: String,
    },

    #[error("invalid operation declared by pass {pass}: {message}")]
    InvalidNodeOperation {
        pass: PassId,
        resource: Option<ResourceId>,
        message: String,
    },

    #[error("invalid {reason:?} root for resource {resource}: {message}")]
    InvalidRoot {
        resource: ResourceId,
        reason: RootReason,
        message: String,
    },

    #[error(
        "texture resource {resource} with format {format:?} cannot be used as {role:?}: {message}"
    )]
    UnsupportedTextureFormatUsage {
        resource: ResourceId,
        role: AccessRole,
        format: wgpu::TextureFormat,
        message: String,
    },

    #[error("pass {pass} reads undefined contents of resource {resource} at {range}")]
    ReadBeforeWrite {
        pass: PassId,
        resource: ResourceId,
        range: String,
    },

    #[error("pass {pass} preserves undefined contents of resource {resource} at {range}")]
    PreserveBeforeWrite {
        pass: PassId,
        resource: ResourceId,
        range: String,
    },

    #[error("pass {pass} accesses discarded contents of resource {resource} at {range}")]
    ReadAfterDiscard {
        pass: PassId,
        resource: ResourceId,
        range: String,
    },

    #[error("root references undefined contents of resource {resource} at {range}")]
    RootReferencesUndefinedContents { resource: ResourceId, range: String },

    #[error(
        "resource {resource} exposes usage bits {available:#x}, but retained work requires {required:#x}"
    )]
    UsageMismatch {
        resource: ResourceId,
        required: u64,
        available: u64,
    },

    #[error("GPU execution requires FrameGraph::with_device()")]
    MissingGpuDevice,

    #[error("resource {resource} has no native wgpu binding")]
    MissingNativeBinding { resource: ResourceId },

    #[error(
        "native binding for resource {resource} does not match its logical descriptor: {message}"
    )]
    NativeDescriptorMismatch {
        resource: ResourceId,
        message: String,
    },

    #[error("pass {pass} has no {expected} executor")]
    MissingNodeExecutor {
        pass: PassId,
        expected: &'static str,
    },

    #[error("pass {pass} cannot use a {expected} executor for node kind {actual:?}")]
    InvalidNodeExecutor {
        pass: PassId,
        expected: &'static str,
        actual: NodeKind,
    },

    #[error(
        "access token for pass {token_pass} was resolved while executing pass {executing_pass}"
    )]
    WrongPassToken {
        executing_pass: PassId,
        token_pass: PassId,
    },

    #[error(
        "transient resource {resource} cannot be executed before the GPU allocator is implemented"
    )]
    UnsupportedTransientExecution { resource: ResourceId },

    #[error("node {pass} of kind {kind:?} has no executable runtime implementation")]
    UnsupportedExecutableNode { pass: PassId, kind: NodeKind },

    #[error("callback for pass {pass} failed: {message}")]
    CallbackFailed { pass: PassId, message: String },

    #[error("FrameGraph internal invariant failed: {message}")]
    Internal { message: String },
}

impl FrameGraphError {
    /// Stable diagnostic code suitable for tests, captures, and tooling.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::ReadBeforeWrite { .. } => "FG1001",
            Self::PreserveBeforeWrite { .. } => "FG1002",
            Self::ReadAfterDiscard { .. } => "FG1003",
            Self::RootReferencesUndefinedContents { .. } => "FG1004",
            Self::UsageMismatch { .. } => "FG1101",
            Self::InvalidResourceDescriptor { .. } => "FG1102",
            Self::InvalidBufferRange { .. } => "FG1103",
            Self::InvalidTextureView { .. } => "FG1104",
            Self::ConflictingAccesses { .. } => "FG1105",
            Self::InvalidNodeOperation { .. } => "FG1106",
            Self::InvalidRoot { .. } => "FG1107",
            Self::UnsupportedTextureFormatUsage { .. } => "FG1108",
            Self::ForeignHandle { .. } => "FG2001",
            Self::UnclosedPass { .. } => "FG2002",
            Self::InvalidDebugGroupLabel { .. } => "FG2003",
            Self::DebugGroupStackUnderflow => "FG2004",
            Self::UnclosedDebugGroup { .. } => "FG2005",
            Self::MissingGpuDevice => "FG4001",
            Self::MissingNativeBinding { .. } => "FG4002",
            Self::NativeDescriptorMismatch { .. } => "FG4003",
            Self::MissingNodeExecutor { .. } => "FG4004",
            Self::WrongPassToken { .. } => "FG4005",
            Self::UnsupportedTransientExecution { .. } => "FG4006",
            Self::CallbackFailed { .. } => "FG4007",
            Self::UnsupportedExecutableNode { .. } => "FG4008",
            Self::InvalidNodeExecutor { .. } => "FG4009",
            Self::Internal { .. } => "FG9001",
        }
    }

    pub const fn pass(&self) -> Option<PassId> {
        match self {
            Self::UnclosedPass { pass, .. }
            | Self::ConflictingAccesses { pass, .. }
            | Self::InvalidNodeOperation { pass, .. }
            | Self::ReadBeforeWrite { pass, .. }
            | Self::PreserveBeforeWrite { pass, .. }
            | Self::ReadAfterDiscard { pass, .. }
            | Self::MissingNodeExecutor { pass, .. }
            | Self::InvalidNodeExecutor { pass, .. }
            | Self::UnsupportedExecutableNode { pass, .. }
            | Self::CallbackFailed { pass, .. } => Some(*pass),
            Self::WrongPassToken { executing_pass, .. } => Some(*executing_pass),
            _ => None,
        }
    }

    pub const fn resource(&self) -> Option<ResourceId> {
        match self {
            Self::InvalidBufferRange { resource, .. }
            | Self::InvalidTextureView { resource, .. }
            | Self::ConflictingAccesses { resource, .. }
            | Self::ReadBeforeWrite { resource, .. }
            | Self::PreserveBeforeWrite { resource, .. }
            | Self::ReadAfterDiscard { resource, .. }
            | Self::RootReferencesUndefinedContents { resource, .. }
            | Self::UsageMismatch { resource, .. }
            | Self::MissingNativeBinding { resource }
            | Self::NativeDescriptorMismatch { resource, .. }
            | Self::UnsupportedTransientExecution { resource } => Some(*resource),
            Self::InvalidRoot { resource, .. }
            | Self::UnsupportedTextureFormatUsage { resource, .. } => Some(*resource),
            Self::InvalidNodeOperation { resource, .. } => *resource,
            _ => None,
        }
    }
}
