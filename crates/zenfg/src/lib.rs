//! Renderer-agnostic, wgpu-specific FrameGraph compilation and transient-resource execution.

mod compiler;
mod error;
mod execution;
mod gpu_timing;
mod graph;
mod ids;
mod model;
mod pass;
mod report;
mod resource;
mod resource_pool;
mod types;

#[cfg(feature = "snapshot")]
pub mod snapshot;
pub use compiler::CompiledFrame;
pub use error::FrameGraphError;
pub use execution::{
    CommandContext, ComputePassContext, ExecutionResources, ExternalSubmissionContext,
    RenderPassContext,
};
pub use gpu_timing::{
    GpuTimingNodeKind, GpuTimingNodeReport, GpuTimingReadback, GpuTimingReport,
    GpuTimingUnavailableReason,
};
pub use graph::{Frame, FrameGraph};
pub use ids::{AccessId, AllocationId, DebugGroupId, PassId, ResourceId, ValueId, ViewId};
pub use pass::{
    AccessMarker, AccessToken, BufferAccessMarker, BufferCopyDst, BufferCopySrc, ColorAttachment,
    DepthAttachment, IndexBuffer, IndirectBuffer, PassBuilder, SampledTexture, StorageBufferRead,
    StorageBufferWrite, StorageTextureRead, StorageTextureWrite, TextureAccessMarker,
    TextureCopyDst, TextureCopySrc, UniformBuffer, VertexBuffer,
};
pub use report::{
    AccessReport, AllocationReport, CompilationReport, CompilationSummary, CompilationTimings,
    CulledNodeReason, CulledNodeReport, DebugGroupReport, DependencyReport, Diagnostic,
    DiagnosticSeverity, ExecutionSegmentKind, ExecutionSegmentReport, FullCompilationReport,
    NodeReport, ResourceDescriptor, ResourceLifetime, ResourceReport, ResourceUsage, RootReport,
    ValueKind, ValueReport, ViewReport,
};
pub use resource::{
    Buffer, BufferDesc, BufferRange, BufferTextureCopyLocation, ClearBufferOp, ImportBufferOptions,
    ImportTextureOptions, InitialContents, NormalizedTextureViewDesc, ResourceOrigin, Texture,
    TextureCopyLocation, TextureDesc, TextureSubresourceRange, TextureTarget, TextureView,
    TextureViewDesc, UsagePolicy,
};
pub use resource_pool::ResourcePoolStats;
pub use types::{
    AccessMode, AccessRole, AttachmentStoreOp, ColorAttachmentLoadOp, ColorAttachmentOps,
    CompileOptions, DependencyKind, DepthAttachmentLoadOp, DepthAttachmentOps, ExecutionOptions,
    HazardKind, NodeKind, ReportLevel, ResourceKind, ResourceRange, RootReason, UndefinedCause,
    WriteContents,
};
