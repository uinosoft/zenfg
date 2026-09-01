use crate::{AccessRole, DebugGroupId, NodeKind, PassId, ResourceId, RootReason};

/// All recording, compilation, and execution errors emitted by the FrameGraph.
#[non_exhaustive]
#[derive(Clone, Debug, thiserror::Error, PartialEq, Eq)]
pub enum FrameGraphError {
    /// A texture or buffer descriptor violates wgpu or FrameGraph constraints.
    #[error("invalid resource descriptor: {message}")]
    InvalidResourceDescriptor {
        /// Human-readable constraint violation.
        message: String,
    },

    /// A declared byte range falls outside its logical buffer.
    #[error(
        "buffer range {offset}..{end} is outside resource {resource} with size {resource_size}"
    )]
    InvalidBufferRange {
        /// Buffer whose range is invalid.
        resource: ResourceId,
        /// Requested first byte.
        offset: u64,
        /// Requested exclusive end byte.
        end: u64,
        /// Logical buffer size in bytes.
        resource_size: u64,
    },

    /// A texture view descriptor is incompatible with its texture.
    #[error("invalid texture view for resource {resource}: {message}")]
    InvalidTextureView {
        /// Texture on which the view was requested.
        resource: ResourceId,
        /// Human-readable incompatibility.
        message: String,
    },

    /// A logical handle from another graph or recording was used.
    #[error(
        "handle belongs to owner {actual_owner}, recording {actual_recording}; expected owner {expected_owner}, recording {expected_recording}"
    )]
    ForeignHandle {
        /// Owner identity required by the current recording.
        expected_owner: u64,
        /// Recording identity required by the current frame.
        expected_recording: u64,
        /// Owner identity carried by the supplied handle.
        actual_owner: u64,
        /// Recording identity carried by the supplied handle.
        actual_recording: u64,
    },

    /// A [`PassBuilder`](crate::PassBuilder) was dropped without being finished.
    #[error("pass {pass} ({label}) was dropped without finish()")]
    UnclosedPass {
        /// Identity reserved for the unfinished pass.
        pass: PassId,
        /// Caller-supplied pass label.
        label: String,
    },

    /// A debug-group label is empty or otherwise invalid.
    #[error("debug group label is invalid: {message}")]
    InvalidDebugGroupLabel {
        /// Human-readable label constraint.
        message: String,
    },

    /// A debug-group pop was attempted with no open group.
    #[error("cannot pop a debug group because the stack is empty")]
    DebugGroupStackUnderflow,

    /// Compilation found an explicitly opened debug group still active.
    #[error("debug group {group} ({label}) was not closed before compile")]
    UnclosedDebugGroup {
        /// Innermost group left open.
        group: DebugGroupId,
        /// Caller-supplied group label.
        label: String,
    },

    /// One pass declares access combinations that cannot safely coexist.
    #[error("pass {pass} declares conflicting accesses to resource {resource}: {message}")]
    ConflictingAccesses {
        /// Pass containing the conflict.
        pass: PassId,
        /// Resource accessed incompatibly.
        resource: ResourceId,
        /// Human-readable conflict description.
        message: String,
    },

    /// A declarative clear, copy, attachment, or executor operation is invalid.
    #[error("invalid operation declared by pass {pass}: {message}")]
    InvalidNodeOperation {
        /// Pass containing the invalid operation.
        pass: PassId,
        /// Related resource, when the operation identifies one.
        resource: Option<ResourceId>,
        /// Human-readable operation constraint.
        message: String,
    },

    /// A root reason is incompatible with the resource's origin, kind, or usage.
    #[error("invalid {reason:?} root for resource {resource}: {message}")]
    InvalidRoot {
        /// Resource marked as a root.
        resource: ResourceId,
        /// Requested retention reason.
        reason: RootReason,
        /// Human-readable root constraint.
        message: String,
    },

    /// A texture format does not support a declared access role.
    #[error(
        "texture resource {resource} with format {format:?} cannot be used as {role:?}: {message}"
    )]
    UnsupportedTextureFormatUsage {
        /// Incompatible texture resource.
        resource: ResourceId,
        /// Declared pipeline role.
        role: AccessRole,
        /// Texture format checked against device-independent capabilities.
        format: wgpu::TextureFormat,
        /// Human-readable capability mismatch.
        message: String,
    },

    /// A read consumes contents that have never been defined.
    #[error("pass {pass} reads undefined contents of resource {resource} at {range}")]
    ReadBeforeWrite {
        /// Reading pass.
        pass: PassId,
        /// Undefined resource.
        resource: ResourceId,
        /// Human-readable affected range.
        range: String,
    },

    /// A preserving write consumes contents that have never been defined.
    #[error("pass {pass} preserves undefined contents of resource {resource} at {range}")]
    PreserveBeforeWrite {
        /// Preserving writer.
        pass: PassId,
        /// Undefined resource.
        resource: ResourceId,
        /// Human-readable affected range.
        range: String,
    },

    /// A pass consumes contents invalidated by an earlier discard.
    #[error("pass {pass} accesses discarded contents of resource {resource} at {range}")]
    ReadAfterDiscard {
        /// Consuming pass.
        pass: PassId,
        /// Discarded resource.
        resource: ResourceId,
        /// Human-readable affected range.
        range: String,
    },

    /// An observable root ends the frame with undefined contents.
    #[error("root references undefined contents of resource {resource} at {range}")]
    RootReferencesUndefinedContents {
        /// Root resource.
        resource: ResourceId,
        /// Human-readable undefined range.
        range: String,
    },

    /// Retained work requires usage flags unavailable to an imported or fixed resource.
    #[error(
        "resource {resource} exposes usage bits {available:#x}, but retained work requires {required:#x}"
    )]
    UsageMismatch {
        /// Resource with insufficient exposed usage.
        resource: ResourceId,
        /// Required wgpu usage bits.
        required: u64,
        /// Available wgpu usage bits.
        available: u64,
    },

    /// GPU execution was requested from a CPU-only graph.
    #[error("GPU execution requires FrameGraph::with_device()")]
    MissingGpuDevice,

    /// A retained imported or surface resource has no native binding.
    #[error("resource {resource} has no native wgpu binding")]
    MissingNativeBinding {
        /// Unbound logical resource.
        resource: ResourceId,
    },

    /// A native imported binding does not implement the recorded logical contract.
    #[error(
        "native binding for resource {resource} does not match its logical descriptor: {message}"
    )]
    NativeDescriptorMismatch {
        /// Logical resource being bound.
        resource: ResourceId,
        /// Human-readable descriptor or usage mismatch.
        message: String,
    },

    /// A retained executable node was finished without its required callback.
    #[error("pass {pass} has no {expected} executor")]
    MissingNodeExecutor {
        /// Node lacking an executor.
        pass: PassId,
        /// Expected executor kind.
        expected: &'static str,
    },

    /// A builder finish method does not match the node kind.
    #[error("pass {pass} cannot use a {expected} executor for node kind {actual:?}")]
    InvalidNodeExecutor {
        /// Mismatched node.
        pass: PassId,
        /// Executor kind required by the finish method.
        expected: &'static str,
        /// Actual recorded node kind.
        actual: NodeKind,
    },

    /// An execution callback tried to resolve a token declared by another pass.
    #[error(
        "access token for pass {token_pass} was resolved while executing pass {executing_pass}"
    )]
    WrongPassToken {
        /// Pass whose callback is currently executing.
        executing_pass: PassId,
        /// Pass that declared the supplied token.
        token_pass: PassId,
    },

    /// A transient reached an execution path that cannot allocate it.
    ///
    /// This variant is retained for forward-compatible runtime diagnostics.
    #[error(
        "transient resource {resource} cannot be executed before the GPU allocator is implemented"
    )]
    UnsupportedTransientExecution {
        /// Transient resource that could not be materialized.
        resource: ResourceId,
    },

    /// A retained node kind has no runtime implementation.
    #[error("node {pass} of kind {kind:?} has no executable runtime implementation")]
    UnsupportedExecutableNode {
        /// Unsupported retained node.
        pass: PassId,
        /// Node kind lacking runtime support.
        kind: NodeKind,
    },

    /// Generic failure explicitly reported by a user-supplied execution callback.
    #[error("callback for pass {pass} failed: {message}")]
    CallbackFailed {
        /// Pass whose callback failed.
        pass: PassId,
        /// Callback-provided failure message.
        message: String,
    },

    /// An internal invariant failed; callers should report this as a bug.
    #[error("FrameGraph internal invariant failed: {message}")]
    Internal {
        /// Human-readable invariant failure.
        message: String,
    },
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

    /// Returns the most relevant pass identity carried by this error.
    ///
    /// For [`Self::WrongPassToken`] this is the currently executing pass.
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

    /// Returns the most relevant resource identity carried by this error.
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
