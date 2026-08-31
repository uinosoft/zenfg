use crate::{BufferRange, TextureSubresourceRange};

/// Kind of logical resource recorded in a frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum ResourceKind {
    /// A texture or texture view.
    Texture,
    /// A buffer and byte range.
    Buffer,
}

/// Kind of work represented by a graph node.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum NodeKind {
    /// A structured render pass.
    Render,
    /// A structured compute pass.
    Compute,
    /// One or more declarative copy operations.
    Copy,
    /// One or more declarative buffer clears.
    ClearBuffer,
    /// Direct encoding into a FrameGraph-owned command encoder.
    Command,
    /// Caller submission that splits FrameGraph-owned encoder segments.
    ExternalSubmission,
}

/// Whether an access reads or writes a logical resource.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum AccessMode {
    /// Requires previously defined contents.
    Read,
    /// Produces a new logical value.
    Write,
}

/// Content behavior of a write access.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum WriteContents {
    /// Replaces the selected range without requiring its old contents.
    Overwrite,
    /// Modifies the selected range while retaining its old contents.
    Preserve,
}

/// Pipeline role declared for one resource access.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum AccessRole {
    /// Read-only sampled texture binding.
    SampledTexture,
    /// Read-only storage texture binding.
    StorageTextureRead,
    /// Writable storage texture binding.
    StorageTextureWrite,
    /// Writable color attachment.
    ColorAttachment,
    /// Read-only or writable depth attachment.
    DepthAttachment,
    /// Texture copy source.
    TextureCopySrc,
    /// Texture copy destination.
    TextureCopyDst,
    /// Uniform buffer binding.
    UniformBuffer,
    /// Read-only storage buffer binding.
    StorageBufferRead,
    /// Writable storage buffer binding.
    StorageBufferWrite,
    /// Vertex buffer input.
    VertexBuffer,
    /// Index buffer input.
    IndexBuffer,
    /// Indirect-command input.
    IndirectBuffer,
    /// Buffer copy source.
    BufferCopySrc,
    /// Buffer copy destination.
    BufferCopyDst,
}

impl AccessRole {
    /// Returns the resource kind accepted by this role.
    pub const fn kind(self) -> ResourceKind {
        match self {
            Self::SampledTexture
            | Self::StorageTextureRead
            | Self::StorageTextureWrite
            | Self::ColorAttachment
            | Self::DepthAttachment
            | Self::TextureCopySrc
            | Self::TextureCopyDst => ResourceKind::Texture,
            Self::UniformBuffer
            | Self::StorageBufferRead
            | Self::StorageBufferWrite
            | Self::VertexBuffer
            | Self::IndexBuffer
            | Self::IndirectBuffer
            | Self::BufferCopySrc
            | Self::BufferCopyDst => ResourceKind::Buffer,
        }
    }

    /// Returns the wgpu texture usage required by this role, if it is a texture role.
    pub const fn texture_usage(self) -> Option<wgpu::TextureUsages> {
        match self {
            Self::SampledTexture => Some(wgpu::TextureUsages::TEXTURE_BINDING),
            Self::StorageTextureRead | Self::StorageTextureWrite => {
                Some(wgpu::TextureUsages::STORAGE_BINDING)
            }
            Self::ColorAttachment | Self::DepthAttachment => {
                Some(wgpu::TextureUsages::RENDER_ATTACHMENT)
            }
            Self::TextureCopySrc => Some(wgpu::TextureUsages::COPY_SRC),
            Self::TextureCopyDst => Some(wgpu::TextureUsages::COPY_DST),
            _ => None,
        }
    }

    /// Returns the wgpu buffer usage required by this role, if it is a buffer role.
    pub const fn buffer_usage(self) -> Option<wgpu::BufferUsages> {
        match self {
            Self::UniformBuffer => Some(wgpu::BufferUsages::UNIFORM),
            Self::StorageBufferRead | Self::StorageBufferWrite => Some(wgpu::BufferUsages::STORAGE),
            Self::VertexBuffer => Some(wgpu::BufferUsages::VERTEX),
            Self::IndexBuffer => Some(wgpu::BufferUsages::INDEX),
            Self::IndirectBuffer => Some(wgpu::BufferUsages::INDIRECT),
            Self::BufferCopySrc => Some(wgpu::BufferUsages::COPY_SRC),
            Self::BufferCopyDst => Some(wgpu::BufferUsages::COPY_DST),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub(crate) enum AttachmentLoadOp {
    Load,
    Clear,
}

/// Whether attachment contents remain defined after the pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum AttachmentStoreOp {
    /// Store the result and keep the selected subresources defined.
    Store,
    /// Discard the result, making the selected subresources undefined.
    Discard,
}

/// Load/store operations for one color attachment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ColorAttachmentLoadOp {
    /// Load previously defined attachment contents.
    Load,
    /// Initialize the attachment to the supplied color.
    Clear(wgpu::Color),
}

/// Load/store operations for one color attachment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ColorAttachmentOps {
    /// Operation used to initialize the attachment at pass start.
    pub load: ColorAttachmentLoadOp,
    /// Operation applied to attachment contents at pass end.
    pub store: AttachmentStoreOp,
    /// A selected z slice for a 3D color attachment.
    pub depth_slice: Option<u32>,
}

impl ColorAttachmentOps {
    /// Clears to `clear`, then stores the rendered contents.
    pub const fn clear_store(clear: wgpu::Color) -> Self {
        Self {
            load: ColorAttachmentLoadOp::Clear(clear),
            store: AttachmentStoreOp::Store,
            depth_slice: None,
        }
    }

    /// Loads existing contents, then stores the rendered contents.
    pub const fn load_store() -> Self {
        Self {
            load: ColorAttachmentLoadOp::Load,
            store: AttachmentStoreOp::Store,
            depth_slice: None,
        }
    }

    /// Clears to `clear`, then discards the rendered contents.
    pub const fn clear_discard(clear: wgpu::Color) -> Self {
        Self {
            load: ColorAttachmentLoadOp::Clear(clear),
            store: AttachmentStoreOp::Discard,
            depth_slice: None,
        }
    }

    /// Loads existing contents, then discards the rendered contents.
    pub const fn load_discard() -> Self {
        Self {
            load: ColorAttachmentLoadOp::Load,
            store: AttachmentStoreOp::Discard,
            depth_slice: None,
        }
    }

    /// Selects a single z slice when the attachment is a 3D texture.
    pub const fn with_depth_slice(mut self, depth_slice: u32) -> Self {
        self.depth_slice = Some(depth_slice);
        self
    }

    pub(crate) const fn semantic(self) -> (AttachmentLoadOp, AttachmentStoreOp) {
        let load = match self.load {
            ColorAttachmentLoadOp::Load => AttachmentLoadOp::Load,
            ColorAttachmentLoadOp::Clear(_) => AttachmentLoadOp::Clear,
        };
        (load, self.store)
    }
}

/// Load/store operations for one writable, pure-depth attachment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DepthAttachmentLoadOp {
    /// Load previously defined depth contents.
    Load,
    /// Initialize depth to the supplied value.
    Clear(f32),
}

/// Load/store operations for one writable, pure-depth attachment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DepthAttachmentOps {
    /// Operation used to initialize depth at pass start.
    pub load: DepthAttachmentLoadOp,
    /// Operation applied to depth contents at pass end.
    pub store: AttachmentStoreOp,
}

impl DepthAttachmentOps {
    /// Clears depth to `clear`, then stores rendered depth.
    pub const fn clear_store(clear: f32) -> Self {
        Self {
            load: DepthAttachmentLoadOp::Clear(clear),
            store: AttachmentStoreOp::Store,
        }
    }

    /// Loads existing depth, then stores rendered depth.
    pub const fn load_store() -> Self {
        Self {
            load: DepthAttachmentLoadOp::Load,
            store: AttachmentStoreOp::Store,
        }
    }

    /// Clears depth to `clear`, then discards rendered depth.
    pub const fn clear_discard(clear: f32) -> Self {
        Self {
            load: DepthAttachmentLoadOp::Clear(clear),
            store: AttachmentStoreOp::Discard,
        }
    }

    /// Loads existing depth, then discards rendered depth.
    pub const fn load_discard() -> Self {
        Self {
            load: DepthAttachmentLoadOp::Load,
            store: AttachmentStoreOp::Discard,
        }
    }

    pub(crate) const fn semantic(self) -> (AttachmentLoadOp, AttachmentStoreOp) {
        let load = match self.load {
            DepthAttachmentLoadOp::Load => AttachmentLoadOp::Load,
            DepthAttachmentLoadOp::Clear(_) => AttachmentLoadOp::Clear,
        };
        (load, self.store)
    }
}

/// Why the contents of a resource must remain live after graph compilation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum RootReason {
    /// Surface texture contents will be presented by the caller.
    Present,
    /// Generic caller-visible output.
    Output,
    /// Imported buffer contents will be mapped for readback.
    Readback,
    /// Contents are retained for diagnostic capture.
    DebugCapture,
    /// Imported resource contents become state for a future frame.
    PersistentState,
}

/// Whether a dependency carries data or only constrains execution order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum DependencyKind {
    /// The consumer reads a value produced by the predecessor.
    Value,
    /// The predecessor only protects access ordering.
    Ordering,
}

/// Hazard that caused a graph dependency.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum HazardKind {
    /// Read-after-write dependency.
    Raw,
    /// Write-after-read dependency.
    War,
    /// Write-after-write dependency.
    Waw,
    /// A preserving write that consumes the previous value.
    Preserve,
}

/// Origin of undefined contents reported by the compiler.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum UndefinedCause {
    /// Newly created transient resource.
    Transient,
    /// Imported resource declared with undefined initial contents.
    ImportedUndefined,
    /// Newly acquired surface texture.
    Surface,
    /// Contents invalidated by a discard store operation.
    Discarded,
}

/// Normalized region of a logical resource used in reports.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ResourceRange {
    /// Byte range within a buffer.
    Buffer(BufferRange),
    /// One or more normalized texture subresource ranges.
    Texture(Vec<TextureSubresourceRange>),
}

/// Amount of compilation diagnostics to retain.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ReportLevel {
    /// Do not allocate a compilation report.
    None,
    /// Retain counts and compilation timings only.
    Summary,
    /// Retain the summary and full graph/planning tables.
    Full,
}

/// Options controlling CPU compilation and report generation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CompileOptions {
    /// Requested report detail. Defaults to [`ReportLevel::None`].
    pub report_level: ReportLevel,
}

impl CompileOptions {
    /// Requests a summary and all full report tables.
    pub const fn full_report() -> Self {
        Self {
            report_level: ReportLevel::Full,
        }
    }

    /// Requests counts and compilation timings without full tables.
    pub const fn summary_report() -> Self {
        Self {
            report_level: ReportLevel::Summary,
        }
    }
}

impl Default for CompileOptions {
    fn default() -> Self {
        Self {
            report_level: ReportLevel::None,
        }
    }
}

/// Options controlling one GPU execution without changing the compiled plan.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct ExecutionOptions {
    /// Emit recording debug-group paths on FrameGraph-owned command encoders.
    pub gpu_debug_groups: bool,
    /// Caller-defined identity propagated to execution callbacks and timing reports.
    pub frame_index: u64,
}

impl ExecutionOptions {
    /// Enables or disables emission of retained recording groups as GPU debug markers.
    pub const fn with_gpu_debug_groups(mut self, enabled: bool) -> Self {
        self.gpu_debug_groups = enabled;
        self
    }

    /// Sets the caller-defined frame identity passed to callbacks and timing reports.
    pub const fn with_frame_index(mut self, frame_index: u64) -> Self {
        self.frame_index = frame_index;
        self
    }
}
