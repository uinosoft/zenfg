#![doc = concat!(
    "Guide links below open development-branch documentation. For installed-version guidance, read the included docs/ and examples/ directories.\n\n",
    "[zenfg-composition]: https://uinosoft.github.io/zenfg/docs/concepts/zenfg.html#integration-levels\n",
    "[zenfg-resource-granularity]: https://uinosoft.github.io/zenfg/docs/concepts/zenfg.html#choosing-resource-declaration-granularity\n",
    "[zenfg-concepts]: https://uinosoft.github.io/zenfg/docs/concepts/zenfg.html\n",
    "[zenfg-pool-recipe]: https://uinosoft.github.io/zenfg/docs/examples/zenfg/resource-pool-control.html\n",
    "[zenfg-lifetime]: https://uinosoft.github.io/zenfg/docs/concepts/zenfg.html#lifetime-and-allocation\n",
    "[zenfg-migration]: https://uinosoft.github.io/zenfg/docs/migration/zenfg.html\n",
    "[zenfg-examples]: https://github.com/uinosoft/zenfg/tree/main/crates/zenfg/examples\n",
    include_str!("../docs/README.md")
)]
#![warn(missing_docs)]

mod compiler;
mod cpu_timing;
mod error;
mod execution;
mod gpu_timing;
mod graph;
mod ids;
mod model;
mod pass;
// Public report types are documented; item-level allows in `report.rs` defer
// only exhaustive field and variant documentation for the data-heavy tables.
mod report;
mod resource;
mod resource_pool;
mod types;

#[cfg(feature = "snapshot")]
pub mod snapshot;
pub use compiler::CompiledFrame;
pub use cpu_timing::{CpuTimingNodeReport, CpuTimingReport, ExecutionTiming, TimingMode};
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
    RootResolution, ValueKind, ValueReport, ViewReport,
};
pub use resource::{
    Buffer, BufferDesc, BufferRange, BufferTextureCopyLocation, ClearBufferOp, ImportBufferOptions,
    ImportTextureOptions, InitialContents, NormalizedTextureViewDesc, ResourceOrigin, Texture,
    TextureCopyLocation, TextureDesc, TextureSubresourceRange, TextureTarget, TextureView,
    TextureViewDesc, UsagePolicy,
};
pub use resource_pool::{
    PoolAllocationDescriptor, ResourcePoolEntryInfo, ResourcePoolEvictionReport, ResourcePoolScope,
    ResourcePoolStats,
};
pub use types::{
    AccessMode, AccessRole, AttachmentStoreOp, ColorAttachmentLoadOp, ColorAttachmentOps,
    CompileOptions, DependencyKind, DepthAttachmentLoadOp, DepthAttachmentOps, ExecutionOptions,
    HazardKind, NodeKind, ReportLevel, ResourceKind, ResourceRange, RootReason, UndefinedCause,
    WriteContents,
};
