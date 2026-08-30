use crate::{BufferRange, TextureSubresourceRange};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum ResourceKind {
    Texture,
    Buffer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum NodeKind {
    Render,
    Compute,
    Copy,
    ClearBuffer,
    Command,
    ExternalSubmission,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum AccessMode {
    Read,
    Write,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum WriteContents {
    Overwrite,
    Preserve,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum AccessRole {
    SampledTexture,
    StorageTextureRead,
    StorageTextureWrite,
    ColorAttachment,
    DepthAttachment,
    TextureCopySrc,
    TextureCopyDst,
    UniformBuffer,
    StorageBufferRead,
    StorageBufferWrite,
    VertexBuffer,
    IndexBuffer,
    IndirectBuffer,
    BufferCopySrc,
    BufferCopyDst,
}

impl AccessRole {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum AttachmentStoreOp {
    Store,
    Discard,
}

/// Load/store operations for one color attachment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ColorAttachmentLoadOp {
    Load,
    Clear(wgpu::Color),
}

/// Load/store operations for one color attachment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ColorAttachmentOps {
    pub load: ColorAttachmentLoadOp,
    pub store: AttachmentStoreOp,
    /// A selected z slice for a 3D color attachment.
    pub depth_slice: Option<u32>,
}

impl ColorAttachmentOps {
    pub const fn clear_store(clear: wgpu::Color) -> Self {
        Self {
            load: ColorAttachmentLoadOp::Clear(clear),
            store: AttachmentStoreOp::Store,
            depth_slice: None,
        }
    }

    pub const fn load_store() -> Self {
        Self {
            load: ColorAttachmentLoadOp::Load,
            store: AttachmentStoreOp::Store,
            depth_slice: None,
        }
    }

    pub const fn clear_discard(clear: wgpu::Color) -> Self {
        Self {
            load: ColorAttachmentLoadOp::Clear(clear),
            store: AttachmentStoreOp::Discard,
            depth_slice: None,
        }
    }

    pub const fn load_discard() -> Self {
        Self {
            load: ColorAttachmentLoadOp::Load,
            store: AttachmentStoreOp::Discard,
            depth_slice: None,
        }
    }

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
    Load,
    Clear(f32),
}

/// Load/store operations for one writable, pure-depth attachment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DepthAttachmentOps {
    pub load: DepthAttachmentLoadOp,
    pub store: AttachmentStoreOp,
}

impl DepthAttachmentOps {
    pub const fn clear_store(clear: f32) -> Self {
        Self {
            load: DepthAttachmentLoadOp::Clear(clear),
            store: AttachmentStoreOp::Store,
        }
    }

    pub const fn load_store() -> Self {
        Self {
            load: DepthAttachmentLoadOp::Load,
            store: AttachmentStoreOp::Store,
        }
    }

    pub const fn clear_discard(clear: f32) -> Self {
        Self {
            load: DepthAttachmentLoadOp::Clear(clear),
            store: AttachmentStoreOp::Discard,
        }
    }

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum RootReason {
    Present,
    Output,
    Readback,
    DebugCapture,
    PersistentState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum DependencyKind {
    Value,
    Ordering,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum HazardKind {
    Raw,
    War,
    Waw,
    Preserve,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum UndefinedCause {
    Transient,
    ImportedUndefined,
    Surface,
    Discarded,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ResourceRange {
    Buffer(BufferRange),
    Texture(Vec<TextureSubresourceRange>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ReportLevel {
    None,
    Summary,
    Full,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CompileOptions {
    pub report_level: ReportLevel,
}

impl CompileOptions {
    pub const fn full_report() -> Self {
        Self {
            report_level: ReportLevel::Full,
        }
    }

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
    pub const fn with_gpu_debug_groups(mut self, enabled: bool) -> Self {
        self.gpu_debug_groups = enabled;
        self
    }

    pub const fn with_frame_index(mut self, frame_index: u64) -> Self {
        self.frame_index = frame_index;
        self
    }
}
