use core::marker::PhantomData;

use crate::{
    AccessId, AccessMode, AccessRole, AttachmentStoreOp, Buffer, BufferRange,
    BufferTextureCopyLocation, ColorAttachmentOps, DepthAttachmentOps, Frame, FrameGraphError,
    NodeKind, PassId, ResourceId, TextureCopyLocation, TextureSubresourceRange, TextureTarget,
    WriteContents,
    execution::{
        CopyOperation, RenderColorAttachment, RenderDepthAttachment, TextureCopyLocationRecord,
    },
    model::{AccessRecord, NodeRecord, NormalizedRange},
    types::AttachmentLoadOp,
};

mod sealed {
    pub trait Sealed {}
}

/// Sealed type-level role carried by an [`AccessToken`].
pub trait AccessMarker: sealed::Sealed + Copy {}

/// Access role that resolves to a [`wgpu::Buffer`] during execution.
pub trait BufferAccessMarker: AccessMarker {}

/// Access role that resolves to a [`wgpu::Texture`] or [`wgpu::TextureView`].
pub trait TextureAccessMarker: AccessMarker {}

macro_rules! define_marker {
    ($($name:ident),+ $(,)?) => {$ (
        #[doc = concat!("Type marker for the `", stringify!($name), "` access role.")]
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub struct $name;
        impl sealed::Sealed for $name {}
        impl AccessMarker for $name {}
    )+ };
}

define_marker!(
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
);

macro_rules! impl_buffer_marker {
    ($($name:ty),+ $(,)?) => {$ (
        impl BufferAccessMarker for $name {}
    )+ };
}

macro_rules! impl_texture_marker {
    ($($name:ty),+ $(,)?) => {$ (
        impl TextureAccessMarker for $name {}
    )+ };
}

impl_buffer_marker!(
    UniformBuffer,
    StorageBufferRead,
    StorageBufferWrite,
    VertexBuffer,
    IndexBuffer,
    IndirectBuffer,
    BufferCopySrc,
    BufferCopyDst,
);

impl_texture_marker!(
    SampledTexture,
    StorageTextureRead,
    StorageTextureWrite,
    ColorAttachment,
    DepthAttachment,
    TextureCopySrc,
    TextureCopyDst,
);

/// A typed identity for one declared access in one pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[must_use = "the access is recorded even when the token is ignored; keep the token for execution"]
pub struct AccessToken<'frame, Role: AccessMarker> {
    pass: PassId,
    access: AccessId,
    resource: ResourceId,
    marker: PhantomData<fn(&'frame mut Role) -> &'frame mut Role>,
}

impl<Role: AccessMarker> AccessToken<'_, Role> {
    /// Returns the pass that declared this access.
    pub const fn pass_id(self) -> PassId {
        self.pass
    }

    /// Returns the recording-local identity of this access.
    pub const fn access_id(self) -> AccessId {
        self.access
    }

    /// Returns the logical resource accessed by this token.
    pub const fn resource_id(self) -> ResourceId {
        self.resource
    }
}

/// Builder for one graph node and its declared resource accesses.
///
/// Access declarations validate ranges and conflicting roles immediately and
/// return typed tokens for callback-time resolution. Finish the builder with the
/// method matching its node kind. Dropping an open builder records an
/// [`FrameGraphError::UnclosedPass`] that is returned by compilation. A failed
/// consuming finish preserves its original error for compilation.
pub struct PassBuilder<'a, 'frame> {
    frame: &'a mut Frame<'frame>,
    node: Option<NodeRecord>,
    color_attachments: Vec<RenderColorAttachment>,
    depth_attachments: Vec<RenderDepthAttachment>,
    copy_operations: Vec<CopyOperation>,
    closed: bool,
}

impl<'a, 'frame> PassBuilder<'a, 'frame> {
    pub(crate) fn new(
        frame: &'a mut Frame<'frame>,
        id: PassId,
        kind: NodeKind,
        label: String,
        side_effect: bool,
    ) -> Self {
        let debug_group = frame.current_debug_group();
        Self {
            frame,
            node: Some(NodeRecord {
                id,
                kind,
                label,
                side_effect,
                accesses: Vec::new(),
                debug_group,
            }),
            color_attachments: Vec::new(),
            depth_attachments: Vec::new(),
            copy_operations: Vec::new(),
            closed: false,
        }
    }

    /// Returns the recording-local identity reserved for this node.
    pub fn id(&self) -> PassId {
        self.node.as_ref().expect("open pass").id
    }

    /// Controls whether this node is retained independently of output roots.
    ///
    /// Command and external-submission nodes begin side-effecting; structured
    /// render, compute, and copy nodes begin non-side-effecting.
    pub fn set_side_effect(&mut self, side_effect: bool) -> &mut Self {
        self.node.as_mut().expect("open pass").side_effect = side_effect;
        self
    }

    /// Declares a read-only sampled-texture access.
    pub fn sampled_texture(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
    ) -> Result<AccessToken<'frame, SampledTexture>, FrameGraphError> {
        self.texture_access(
            target.into(),
            AccessRole::SampledTexture,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares a read-only storage-texture access.
    pub fn storage_texture_read(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
    ) -> Result<AccessToken<'frame, StorageTextureRead>, FrameGraphError> {
        self.texture_access(
            target.into(),
            AccessRole::StorageTextureRead,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares a writable storage-texture access.
    ///
    /// [`WriteContents::Preserve`] requires defined input contents; `Overwrite`
    /// starts a new value without consuming the previous value.
    pub fn storage_texture_write(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
        contents: WriteContents,
    ) -> Result<AccessToken<'frame, StorageTextureWrite>, FrameGraphError> {
        self.texture_access(
            target.into(),
            AccessRole::StorageTextureWrite,
            AccessMode::Write,
            contents == WriteContents::Preserve,
            true,
        )
    }

    /// Declares and configures one writable color attachment.
    ///
    /// Loading requires defined contents. Discarding makes the selected
    /// subresources undefined after the pass.
    pub fn color_attachment(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
        ops: ColorAttachmentOps,
    ) -> Result<AccessToken<'frame, ColorAttachment>, FrameGraphError> {
        let (load, store) = ops.semantic();
        let token = self.attachment_access(
            target.into(),
            AccessRole::ColorAttachment,
            load,
            store,
            ops.depth_slice,
        )?;
        self.color_attachments.push(RenderColorAttachment {
            access: token.access,
            resolve_access: None,
            ops,
        });
        Ok(token)
    }

    /// Declares a multisampled color attachment and its single-sample resolve target.
    ///
    /// The source token is returned. Formats, extents, sample counts, and resolve
    /// compatibility are validated when the pass is finished.
    pub fn color_attachment_with_resolve(
        &mut self,
        source: impl Into<TextureTarget<'frame>>,
        resolve_target: impl Into<TextureTarget<'frame>>,
        ops: ColorAttachmentOps,
    ) -> Result<AccessToken<'frame, ColorAttachment>, FrameGraphError> {
        let (load, store) = ops.semantic();
        let checkpoint = self.access_checkpoint();
        let source = self.attachment_access(
            source.into(),
            AccessRole::ColorAttachment,
            load,
            store,
            ops.depth_slice,
        )?;
        let resolve = self
            .attachment_access::<ColorAttachment>(
                resolve_target.into(),
                AccessRole::ColorAttachment,
                AttachmentLoadOp::Clear,
                AttachmentStoreOp::Store,
                None,
            )
            .inspect_err(|_| {
                self.rollback_accesses(checkpoint);
            })?;
        self.color_attachments.push(RenderColorAttachment {
            access: source.access,
            resolve_access: Some(resolve.access),
            ops,
        });
        Ok(source)
    }

    /// Declares and configures one writable depth attachment.
    pub fn depth_attachment(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
        ops: DepthAttachmentOps,
    ) -> Result<AccessToken<'frame, DepthAttachment>, FrameGraphError> {
        let (load, store) = ops.semantic();
        let token = self.attachment_access(
            target.into(),
            AccessRole::DepthAttachment,
            load,
            store,
            None,
        )?;
        self.depth_attachments.push(RenderDepthAttachment {
            access: token.access,
            ops: Some(ops),
            read_only: false,
        });
        Ok(token)
    }

    /// Declares a read-only depth attachment that preserves defined contents.
    pub fn depth_attachment_read_only(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
    ) -> Result<AccessToken<'frame, DepthAttachment>, FrameGraphError> {
        let (resource, range, view) =
            self.normalize_attachment_target(target.into(), AccessRole::DepthAttachment, None)?;
        let token = self.add_access(
            resource,
            AccessRole::DepthAttachment,
            AccessMode::Read,
            true,
            false,
            range,
            view,
        )?;
        self.depth_attachments.push(RenderDepthAttachment {
            access: token.access,
            ops: None,
            read_only: true,
        });
        Ok(token)
    }

    /// Declares a texture copy-source read.
    pub fn texture_copy_src(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
    ) -> Result<AccessToken<'frame, TextureCopySrc>, FrameGraphError> {
        self.texture_access(
            target.into(),
            AccessRole::TextureCopySrc,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares a texture copy-destination write.
    pub fn texture_copy_dst(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
        contents: WriteContents,
    ) -> Result<AccessToken<'frame, TextureCopyDst>, FrameGraphError> {
        self.texture_access(
            target.into(),
            AccessRole::TextureCopyDst,
            AccessMode::Write,
            contents == WriteContents::Preserve,
            true,
        )
    }

    /// Declares a uniform-buffer read over `range`.
    pub fn uniform_buffer(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
    ) -> Result<AccessToken<'frame, UniformBuffer>, FrameGraphError> {
        self.buffer_access(
            buffer,
            range,
            AccessRole::UniformBuffer,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares a read-only storage-buffer access over `range`.
    pub fn storage_buffer_read(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
    ) -> Result<AccessToken<'frame, StorageBufferRead>, FrameGraphError> {
        self.buffer_access(
            buffer,
            range,
            AccessRole::StorageBufferRead,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares a writable storage-buffer access over `range`.
    pub fn storage_buffer_write(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
        contents: WriteContents,
    ) -> Result<AccessToken<'frame, StorageBufferWrite>, FrameGraphError> {
        self.buffer_access(
            buffer,
            range,
            AccessRole::StorageBufferWrite,
            AccessMode::Write,
            contents == WriteContents::Preserve,
            true,
        )
    }

    /// Declares a vertex-buffer read over `range`.
    pub fn vertex_buffer(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
    ) -> Result<AccessToken<'frame, VertexBuffer>, FrameGraphError> {
        self.buffer_access(
            buffer,
            range,
            AccessRole::VertexBuffer,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares an index-buffer read over `range`.
    pub fn index_buffer(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
    ) -> Result<AccessToken<'frame, IndexBuffer>, FrameGraphError> {
        self.buffer_access(
            buffer,
            range,
            AccessRole::IndexBuffer,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares an indirect-command buffer read over `range`.
    pub fn indirect_buffer(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
    ) -> Result<AccessToken<'frame, IndirectBuffer>, FrameGraphError> {
        self.buffer_access(
            buffer,
            range,
            AccessRole::IndirectBuffer,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares a buffer copy-source read over `range`.
    pub fn buffer_copy_src(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
    ) -> Result<AccessToken<'frame, BufferCopySrc>, FrameGraphError> {
        self.buffer_access(
            buffer,
            range,
            AccessRole::BufferCopySrc,
            AccessMode::Read,
            true,
            false,
        )
    }

    /// Declares a buffer copy-destination write over `range`.
    pub fn buffer_copy_dst(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
        contents: WriteContents,
    ) -> Result<AccessToken<'frame, BufferCopyDst>, FrameGraphError> {
        self.buffer_access(
            buffer,
            range,
            AccessRole::BufferCopyDst,
            AccessMode::Write,
            contents == WriteContents::Preserve,
            true,
        )
    }

    /// Appends one validated buffer-to-buffer operation to a copy node.
    ///
    /// Source and destination ranges are declared automatically. Native copy
    /// alignment is validated by wgpu.
    pub fn copy_buffer_to_buffer(
        &mut self,
        source: Buffer<'frame>,
        source_offset: u64,
        destination: Buffer<'frame>,
        destination_offset: u64,
        size: u64,
    ) -> Result<&mut Self, FrameGraphError> {
        self.require_kind(NodeKind::Copy, "buffer-to-buffer copy")?;
        if size == 0 {
            return Err(self.invalid_operation(None, "buffer copy size must be non-zero"));
        }
        let source_range = BufferRange::new(source_offset, size);
        let destination_range = BufferRange::new(destination_offset, size);
        let checkpoint = self.access_checkpoint();
        let _ = self.buffer_copy_src(source, source_range)?;
        let _ = self
            .buffer_copy_dst(destination, destination_range, WriteContents::Overwrite)
            .inspect_err(|_| {
                self.rollback_accesses(checkpoint);
            })?;
        self.copy_operations.push(CopyOperation::BufferToBuffer {
            source: source.id,
            source_offset,
            destination: destination.id,
            destination_offset,
            size,
        });
        Ok(self)
    }

    /// Appends one buffer-to-texture operation to a copy node. Native layout
    /// compatibility is validated by wgpu; FrameGraph tracks the conservative
    /// buffer footprint needed for dependency analysis.
    ///
    /// Logical bounds and conservative buffer footprints are calculated for
    /// dependency analysis; native format and layout validation remains with wgpu.
    pub fn copy_buffer_to_texture(
        &mut self,
        source: BufferTextureCopyLocation<'frame>,
        destination: TextureCopyLocation<'frame>,
        copy_size: wgpu::Extent3d,
    ) -> Result<&mut Self, FrameGraphError> {
        self.require_kind(NodeKind::Copy, "buffer-to-texture copy")?;
        let destination =
            validate_texture_copy_location(self.frame, self.id(), destination, copy_size)?;
        let buffer = validate_buffer_texture_copy(
            self.frame,
            self.id(),
            source,
            destination.format,
            destination.byte_aspect,
            copy_size,
        )?;
        let checkpoint = self.access_checkpoint();
        let _ = self.add_access::<BufferCopySrc>(
            buffer.resource,
            AccessRole::BufferCopySrc,
            AccessMode::Read,
            true,
            false,
            NormalizedRange::Buffer(buffer.range.clone()),
            None,
        )?;
        let _ = self
            .add_access::<TextureCopyDst>(
                destination.record.resource,
                AccessRole::TextureCopyDst,
                AccessMode::Write,
                !destination.full_subresources,
                true,
                NormalizedRange::Texture(destination.range),
                None,
            )
            .inspect_err(|_| {
                self.rollback_accesses(checkpoint);
            })?;
        self.copy_operations.push(CopyOperation::BufferToTexture {
            source: buffer.resource,
            source_layout: source.layout,
            destination: destination.record,
            copy_size,
        });
        Ok(self)
    }

    /// Appends one validated texture-to-buffer operation to a copy node.
    pub fn copy_texture_to_buffer(
        &mut self,
        source: TextureCopyLocation<'frame>,
        destination: BufferTextureCopyLocation<'frame>,
        copy_size: wgpu::Extent3d,
    ) -> Result<&mut Self, FrameGraphError> {
        self.require_kind(NodeKind::Copy, "texture-to-buffer copy")?;
        let source = validate_texture_copy_location(self.frame, self.id(), source, copy_size)?;
        let buffer = validate_buffer_texture_copy(
            self.frame,
            self.id(),
            destination,
            source.format,
            source.byte_aspect,
            copy_size,
        )?;
        let checkpoint = self.access_checkpoint();
        let _ = self.add_access::<TextureCopySrc>(
            source.record.resource,
            AccessRole::TextureCopySrc,
            AccessMode::Read,
            true,
            false,
            NormalizedRange::Texture(source.range),
            None,
        )?;
        let _ = self
            .add_access::<BufferCopyDst>(
                buffer.resource,
                AccessRole::BufferCopyDst,
                AccessMode::Write,
                !buffer.tightly_packed,
                true,
                NormalizedRange::Buffer(buffer.range.clone()),
                None,
            )
            .inspect_err(|_| {
                self.rollback_accesses(checkpoint);
            })?;
        self.copy_operations.push(CopyOperation::TextureToBuffer {
            source: source.record,
            destination: buffer.resource,
            destination_layout: destination.layout,
            copy_size,
        });
        Ok(self)
    }

    /// Appends one validated texture-to-texture operation to a copy node.
    ///
    /// Source and destination logical ranges are tracked by FrameGraph. Native
    /// format, dimension, aspect, and overlap compatibility is validated by wgpu.
    pub fn copy_texture_to_texture(
        &mut self,
        source: TextureCopyLocation<'frame>,
        destination: TextureCopyLocation<'frame>,
        copy_size: wgpu::Extent3d,
    ) -> Result<&mut Self, FrameGraphError> {
        self.require_kind(NodeKind::Copy, "texture-to-texture copy")?;
        let source = validate_texture_copy_location(self.frame, self.id(), source, copy_size)?;
        let destination =
            validate_texture_copy_location(self.frame, self.id(), destination, copy_size)?;
        let checkpoint = self.access_checkpoint();
        let _ = self.add_access::<TextureCopySrc>(
            source.record.resource,
            AccessRole::TextureCopySrc,
            AccessMode::Read,
            true,
            false,
            NormalizedRange::Texture(source.range),
            None,
        )?;
        let _ = self
            .add_access::<TextureCopyDst>(
                destination.record.resource,
                AccessRole::TextureCopyDst,
                AccessMode::Write,
                !destination.full_subresources,
                true,
                NormalizedRange::Texture(destination.range),
                None,
            )
            .inspect_err(|_| {
                self.rollback_accesses(checkpoint);
            })?;
        self.copy_operations.push(CopyOperation::TextureToTexture {
            source: source.record,
            destination: destination.record,
            copy_size,
        });
        Ok(self)
    }

    /// Completes a declarative node without installing a callback.
    ///
    /// Use this for copy nodes and CPU-only planning examples. Retained render,
    /// compute, command, or external nodes require their kind-specific finish
    /// method before GPU execution.
    pub fn finish(mut self) -> Result<PassId, FrameGraphError> {
        self.finish_node()
    }

    /// Completes a render node with a synchronous, one-shot execution callback.
    ///
    /// At least one color or depth attachment is required. The callback receives
    /// an active native render pass and may resolve only tokens declared by this
    /// builder. Returning a [`FrameGraphError`] aborts execution and propagates
    /// that structured error to the caller.
    pub fn finish_render<F>(mut self, callback: F) -> Result<PassId, FrameGraphError>
    where
        F: for<'execute> FnOnce(crate::RenderPassContext<'execute>) -> Result<(), FrameGraphError>
            + 'frame,
    {
        if let Err(error) = self.require_kind(NodeKind::Render, "render executor") {
            return Err(self.fail_finish(error));
        }
        if self.color_attachments.is_empty() && self.depth_attachments.is_empty() {
            let error =
                self.invalid_operation(None, "render nodes require at least one attachment");
            return Err(self.fail_finish(error));
        }
        if self.depth_attachments.len() > 1 {
            let error = self.invalid_operation(None, "render nodes support one depth attachment");
            return Err(self.fail_finish(error));
        }
        let id = self.finish_node()?;
        self.frame.executors.insert(
            id,
            crate::execution::NodeExecutor::Render {
                color_attachments: core::mem::take(&mut self.color_attachments),
                depth_attachment: self.depth_attachments.pop(),
                callback: Box::new(callback),
            },
        );
        Ok(id)
    }

    /// Completes a compute node with a synchronous, one-shot execution callback.
    pub fn finish_compute<F>(mut self, callback: F) -> Result<PassId, FrameGraphError>
    where
        F: for<'execute> FnOnce(crate::ComputePassContext<'execute>) -> Result<(), FrameGraphError>
            + 'frame,
    {
        if let Err(error) = self.require_kind(NodeKind::Compute, "compute executor") {
            return Err(self.fail_finish(error));
        }
        let id = self.finish_node()?;
        self.frame.executors.insert(
            id,
            crate::execution::NodeExecutor::Compute(Box::new(callback)),
        );
        Ok(id)
    }

    /// Completes a command node with direct access to the current graph encoder.
    ///
    /// The callback must not finish or submit the borrowed encoder.
    pub fn finish_command<F>(mut self, callback: F) -> Result<PassId, FrameGraphError>
    where
        F: for<'execute> FnOnce(crate::CommandContext<'execute>) -> Result<(), FrameGraphError>
            + 'frame,
    {
        let node = self.node.as_ref().expect("open pass");
        if node.kind != NodeKind::Command {
            let error = FrameGraphError::InvalidNodeExecutor {
                pass: node.id,
                expected: "command",
                actual: node.kind,
            };
            return Err(self.fail_finish(error));
        }
        let id = self.finish_node()?;
        self.frame.executors.insert(
            id,
            crate::execution::NodeExecutor::Command(Box::new(callback)),
        );
        Ok(id)
    }

    /// Completes an external-submission node with direct queue access.
    ///
    /// The preceding FrameGraph encoder segment is submitted before this callback;
    /// following retained work is encoded into a fresh segment.
    pub fn finish_external<F>(mut self, callback: F) -> Result<PassId, FrameGraphError>
    where
        F: for<'execute> FnOnce(
                crate::ExternalSubmissionContext<'execute>,
            ) -> Result<(), FrameGraphError>
            + 'frame,
    {
        let node = self.node.as_ref().expect("open pass");
        if node.kind != NodeKind::ExternalSubmission {
            let error = FrameGraphError::InvalidNodeExecutor {
                pass: node.id,
                expected: "external-submission",
                actual: node.kind,
            };
            return Err(self.fail_finish(error));
        }
        let id = self.finish_node()?;
        self.frame.executors.insert(
            id,
            crate::execution::NodeExecutor::External(Box::new(callback)),
        );
        Ok(id)
    }

    fn finish_node(&mut self) -> Result<PassId, FrameGraphError> {
        let open = self.node.as_ref().expect("open pass");
        if open.kind == NodeKind::Render
            && let Err(error) = validate_render_attachments(
                self.frame,
                open.id,
                &self.color_attachments,
                self.depth_attachments.first().copied(),
                open,
            )
        {
            return Err(self.fail_finish(error));
        }
        if open.kind == NodeKind::Copy && !self.copy_operations.is_empty() {
            self.frame.executors.insert(
                open.id,
                crate::execution::NodeExecutor::Copy(core::mem::take(&mut self.copy_operations)),
            );
        }
        let node = self.node.take().expect("open pass");
        let id = node.id;
        self.frame.nodes.push(node);
        self.closed = true;
        Ok(id)
    }

    fn access_checkpoint(&self) -> (usize, u32) {
        (
            self.node.as_ref().expect("open pass").accesses.len(),
            self.frame.next_access,
        )
    }

    fn rollback_accesses(&mut self, checkpoint: (usize, u32)) {
        self.node
            .as_mut()
            .expect("open pass")
            .accesses
            .truncate(checkpoint.0);
        self.frame.next_access = checkpoint.1;
    }

    fn fail_finish(&mut self, error: FrameGraphError) -> FrameGraphError {
        if self.frame.recording_error.is_none() {
            self.frame.recording_error = Some(error.clone());
        }
        self.closed = true;
        error
    }

    fn attachment_access<Role: AccessMarker>(
        &mut self,
        target: TextureTarget<'frame>,
        role: AccessRole,
        load: AttachmentLoadOp,
        store: AttachmentStoreOp,
        depth_slice: Option<u32>,
    ) -> Result<AccessToken<'frame, Role>, FrameGraphError> {
        let (resource, range, view) =
            self.normalize_attachment_target(target, role, depth_slice)?;
        self.add_access(
            resource,
            role,
            AccessMode::Write,
            load == AttachmentLoadOp::Load,
            store == AttachmentStoreOp::Store,
            range,
            view,
        )
    }

    fn normalize_attachment_target(
        &mut self,
        target: TextureTarget<'frame>,
        role: AccessRole,
        depth_slice: Option<u32>,
    ) -> Result<(ResourceId, NormalizedRange, Option<crate::ViewId>), FrameGraphError> {
        let direct_texture = matches!(target, TextureTarget::Texture(_));
        let view = match target {
            TextureTarget::Texture(_) => None,
            TextureTarget::View(view) => Some(view.id),
        };
        let (resource, mut range) = self.frame.texture_target_range(target, false)?;
        validate_texture_role(self.frame, resource, view, role)?;
        let desc = self.frame.resource(resource)?.texture().expect("texture");
        let regions = match &mut range {
            NormalizedRange::Texture(regions) => regions,
            NormalizedRange::Buffer(_) => unreachable!(),
        };
        if regions.is_empty() {
            return Err(FrameGraphError::InvalidTextureView {
                resource,
                message: "attachment has no selected subresource".into(),
            });
        }
        if !direct_texture && regions.len() != 1 {
            return Err(FrameGraphError::InvalidTextureView {
                resource,
                message: "attachments require a single-mip view".into(),
            });
        }
        regions.truncate(1);
        let region = &mut regions[0];
        if desc.dimension == wgpu::TextureDimension::D3 {
            let slice = depth_slice.ok_or_else(|| FrameGraphError::InvalidTextureView {
                resource,
                message: "3D color attachments require depth_slice".into(),
            })?;
            if slice < region.base_slice || slice >= region.base_slice + region.slice_count {
                return Err(FrameGraphError::InvalidTextureView {
                    resource,
                    message: format!("depth slice {slice} is outside the selected view"),
                });
            }
            region.base_slice = slice;
            region.slice_count = 1;
        } else {
            if depth_slice.is_some() {
                return Err(FrameGraphError::InvalidTextureView {
                    resource,
                    message: "depth_slice is only valid for 3D color attachments".into(),
                });
            }
            if !direct_texture && region.slice_count != 1 {
                return Err(FrameGraphError::InvalidTextureView {
                    resource,
                    message: "attachments require a single array layer".into(),
                });
            }
            region.slice_count = 1;
        }
        Ok((resource, range, view))
    }

    fn require_kind(
        &self,
        expected: NodeKind,
        operation: &'static str,
    ) -> Result<(), FrameGraphError> {
        let node = self.node.as_ref().expect("open pass");
        if node.kind == expected {
            Ok(())
        } else {
            Err(FrameGraphError::InvalidNodeOperation {
                pass: node.id,
                resource: None,
                message: format!(
                    "{operation} requires a {expected:?} node, found {:?}",
                    node.kind
                ),
            })
        }
    }

    fn invalid_operation(
        &self,
        resource: Option<ResourceId>,
        message: impl Into<String>,
    ) -> FrameGraphError {
        FrameGraphError::InvalidNodeOperation {
            pass: self.id(),
            resource,
            message: message.into(),
        }
    }

    fn texture_access<Role: AccessMarker>(
        &mut self,
        target: TextureTarget<'frame>,
        role: AccessRole,
        mode: AccessMode,
        consumes_previous: bool,
        produces_value: bool,
    ) -> Result<AccessToken<'frame, Role>, FrameGraphError> {
        let direct_texture = matches!(target, TextureTarget::Texture(_));
        let view = match target {
            TextureTarget::Texture(_) => None,
            TextureTarget::View(view) => Some(view.id),
        };
        let (resource, mut range) = self.frame.texture_target_range(target, false)?;
        validate_texture_role(self.frame, resource, view, role)?;
        if matches!(
            role,
            AccessRole::StorageTextureRead | AccessRole::StorageTextureWrite
        ) {
            let regions = match &mut range {
                NormalizedRange::Texture(regions) => regions,
                NormalizedRange::Buffer(_) => unreachable!(),
            };
            if !direct_texture && regions.len() != 1 {
                return Err(FrameGraphError::InvalidTextureView {
                    resource,
                    message: "storage texture access requires a single-mip view".into(),
                });
            }
            regions.truncate(1);
        }
        self.add_access(
            resource,
            role,
            mode,
            consumes_previous,
            produces_value,
            range,
            view,
        )
    }

    fn buffer_access<Role: AccessMarker>(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
        role: AccessRole,
        mode: AccessMode,
        consumes_previous: bool,
        produces_value: bool,
    ) -> Result<AccessToken<'frame, Role>, FrameGraphError> {
        self.frame.validate_handle(buffer.owner, buffer.recording)?;
        let desc =
            self.frame
                .resource(buffer.id)?
                .buffer()
                .ok_or_else(|| FrameGraphError::Internal {
                    message: "buffer handle resolved to a texture".into(),
                })?;
        let range = NormalizedRange::Buffer(range.resolve(buffer.id, desc.size)?);
        self.add_access(
            buffer.id,
            role,
            mode,
            consumes_previous,
            produces_value,
            range,
            None,
        )
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "stores the normalized access record"
    )]
    fn add_access<Role: AccessMarker>(
        &mut self,
        resource: ResourceId,
        role: AccessRole,
        mode: AccessMode,
        consumes_previous: bool,
        produces_value: bool,
        range: NormalizedRange,
        view: Option<crate::ViewId>,
    ) -> Result<AccessToken<'frame, Role>, FrameGraphError> {
        let node = self.node.as_mut().expect("open pass");
        for existing in &node.accesses {
            if existing.resource == resource
                && existing.range.overlaps(&range)
                && (existing.mode == AccessMode::Write || mode == AccessMode::Write)
            {
                return Err(FrameGraphError::ConflictingAccesses {
                    pass: node.id,
                    resource,
                    message:
                        "overlapping reads and writes must be represented as one preserving access"
                            .into(),
                });
            }
        }
        let id = AccessId::new(self.frame.next_access);
        self.frame.next_access = self.frame.next_access.checked_add(1).ok_or_else(|| {
            FrameGraphError::InvalidResourceDescriptor {
                message: "too many accesses in one frame".into(),
            }
        })?;
        node.accesses.push(AccessRecord {
            id,
            pass: node.id,
            resource,
            role,
            mode,
            consumes_previous,
            produces_value,
            range,
            view,
            value: None,
        });
        Ok(AccessToken {
            pass: node.id,
            access: id,
            resource,
            marker: PhantomData,
        })
    }
}

impl Drop for PassBuilder<'_, '_> {
    fn drop(&mut self) {
        if self.closed {
            return;
        }
        if let Some(node) = self.node.as_ref()
            && self.frame.recording_error.is_none()
        {
            self.frame.recording_error = Some(FrameGraphError::UnclosedPass {
                pass: node.id,
                label: node.label.clone(),
            });
        }
    }
}

fn validate_texture_role(
    frame: &Frame<'_>,
    resource: ResourceId,
    view: Option<crate::ViewId>,
    role: AccessRole,
) -> Result<(), FrameGraphError> {
    let desc = frame
        .resource(resource)?
        .texture()
        .ok_or_else(|| FrameGraphError::Internal {
            message: "texture access resolved to a buffer".into(),
        })?;
    let format = view
        .and_then(|id| frame.views.get(id.get() as usize))
        .and_then(|view| view.descriptor.format)
        .unwrap_or(desc.format);
    let depth = format.has_depth_aspect();
    match role {
        AccessRole::ColorAttachment if depth => Err(FrameGraphError::InvalidTextureView {
            resource,
            message: "depth formats cannot be color attachments".into(),
        }),
        AccessRole::DepthAttachment if !depth => Err(FrameGraphError::InvalidTextureView {
            resource,
            message: "color formats cannot be depth attachments".into(),
        }),
        _ => Ok(()),
    }
}

#[derive(Clone, Debug)]
struct ValidatedTextureCopy {
    record: TextureCopyLocationRecord,
    range: Vec<TextureSubresourceRange>,
    format: wgpu::TextureFormat,
    byte_aspect: wgpu::TextureAspect,
    full_subresources: bool,
}

#[derive(Clone, Debug)]
struct ValidatedBufferTextureCopy {
    resource: ResourceId,
    range: core::ops::Range<u64>,
    tightly_packed: bool,
}

fn validate_texture_copy_location(
    frame: &Frame<'_>,
    pass: PassId,
    location: TextureCopyLocation<'_>,
    copy_size: wgpu::Extent3d,
) -> Result<ValidatedTextureCopy, FrameGraphError> {
    frame.validate_handle(location.texture.owner, location.texture.recording)?;
    let resource = location.texture.id;
    let desc = frame
        .resource(resource)?
        .texture()
        .ok_or_else(|| FrameGraphError::Internal {
            message: "texture copy location resolved to a buffer".into(),
        })?;
    let invalid = |message: String| FrameGraphError::InvalidNodeOperation {
        pass,
        resource: Some(resource),
        message,
    };
    if copy_size.width == 0 || copy_size.height == 0 || copy_size.depth_or_array_layers == 0 {
        return Err(invalid("texture copy extent must be non-zero".into()));
    }
    if location.mip_level >= desc.mip_level_count {
        return Err(invalid(format!(
            "mip {} is outside {} mip levels",
            location.mip_level, desc.mip_level_count
        )));
    }
    let aspect = if desc.format.has_depth_aspect() {
        wgpu::TextureAspect::DepthOnly
    } else {
        wgpu::TextureAspect::All
    };
    let mip = location.mip_level;
    let mip_width = (desc.size.width >> mip).max(1);
    let mip_height = match desc.dimension {
        wgpu::TextureDimension::D1 => 1,
        _ => (desc.size.height >> mip).max(1),
    };
    let (block_width, block_height) = desc.format.block_dimensions();
    let physical_width =
        u64::from(mip_width).div_ceil(u64::from(block_width)) * u64::from(block_width);
    let physical_height =
        u64::from(mip_height).div_ceil(u64::from(block_height)) * u64::from(block_height);
    let mip_slices = crate::graph::slices_at_mip(desc, mip);
    let end_x = location
        .origin
        .x
        .checked_add(copy_size.width)
        .ok_or_else(|| invalid("texture copy x range overflows".into()))?;
    let end_y = location
        .origin
        .y
        .checked_add(copy_size.height)
        .ok_or_else(|| invalid("texture copy y range overflows".into()))?;
    let end_z = location
        .origin
        .z
        .checked_add(copy_size.depth_or_array_layers)
        .ok_or_else(|| invalid("texture copy z range overflows".into()))?;
    if u64::from(end_x) > physical_width || u64::from(end_y) > physical_height || end_z > mip_slices
    {
        return Err(invalid(format!(
            "copy region {:?}+{:?} exceeds mip extent {}x{}x{}",
            location.origin, copy_size, mip_width, mip_height, mip_slices
        )));
    }
    Ok(ValidatedTextureCopy {
        record: TextureCopyLocationRecord {
            resource,
            mip_level: mip,
            origin: location.origin,
            aspect: location.aspect,
        },
        range: vec![TextureSubresourceRange {
            base_mip_level: mip,
            mip_level_count: 1,
            base_slice: location.origin.z,
            slice_count: copy_size.depth_or_array_layers,
            aspect,
        }],
        format: desc.format,
        byte_aspect: aspect,
        full_subresources: location.origin.x == 0
            && location.origin.y == 0
            && u64::from(copy_size.width) == physical_width
            && u64::from(copy_size.height) == physical_height,
    })
}

fn validate_buffer_texture_copy(
    frame: &Frame<'_>,
    pass: PassId,
    location: BufferTextureCopyLocation<'_>,
    format: wgpu::TextureFormat,
    aspect: wgpu::TextureAspect,
    copy_size: wgpu::Extent3d,
) -> Result<ValidatedBufferTextureCopy, FrameGraphError> {
    frame.validate_handle(location.buffer.owner, location.buffer.recording)?;
    let resource = location.buffer.id;
    let desc = frame
        .resource(resource)?
        .buffer()
        .ok_or_else(|| FrameGraphError::Internal {
            message: "buffer texture copy location resolved to a texture".into(),
        })?;
    let invalid = |message: String| FrameGraphError::InvalidNodeOperation {
        pass,
        resource: Some(resource),
        message,
    };
    let bytes_per_block = u64::from(format.block_copy_size(Some(aspect)).ok_or_else(|| {
        invalid(format!(
            "format {format:?} cannot be copied for byte-range planning"
        ))
    })?);
    let (block_width, block_height) = format.block_dimensions();
    let width_blocks = copy_size.width.div_ceil(block_width);
    let height_blocks = copy_size.height.div_ceil(block_height);
    let bytes_in_last_row = u64::from(width_blocks) * bytes_per_block;
    let row_stride = u64::from(location.layout.bytes_per_row.unwrap_or(0)).max(bytes_in_last_row);
    let image_rows = u64::from(
        location
            .layout
            .rows_per_image
            .unwrap_or(0)
            .max(height_blocks),
    );
    let bytes_in_copy = if copy_size.depth_or_array_layers == 0 {
        0
    } else {
        row_stride
            .checked_mul(image_rows)
            .and_then(|stride| stride.checked_mul(u64::from(copy_size.depth_or_array_layers - 1)))
            .and_then(|images| {
                row_stride
                    .checked_mul(u64::from(height_blocks.saturating_sub(1)))
                    .and_then(|rows| images.checked_add(rows))
            })
            .and_then(|bytes| bytes.checked_add(bytes_in_last_row))
            .ok_or_else(|| invalid("buffer texture copy range overflows".into()))?
    };
    let end = location
        .layout
        .offset
        .checked_add(bytes_in_copy)
        .ok_or_else(|| invalid("buffer texture copy range overflows".into()))?;
    if end > desc.size {
        return Err(invalid(format!(
            "copy range {}..{} exceeds buffer size {}",
            location.layout.offset, end, desc.size
        )));
    }
    Ok(ValidatedBufferTextureCopy {
        resource,
        range: location.layout.offset..end,
        tightly_packed: row_stride == bytes_in_last_row && image_rows == u64::from(height_blocks),
    })
}

fn validate_render_attachments(
    _frame: &Frame<'_>,
    pass: PassId,
    _colors: &[RenderColorAttachment],
    depth: Option<RenderDepthAttachment>,
    _node: &NodeRecord,
) -> Result<(), FrameGraphError> {
    let invalid = |resource, message: String| FrameGraphError::InvalidNodeOperation {
        pass,
        resource,
        message,
    };
    if let Some(depth) = depth
        && depth.ops.is_none()
        && !depth.read_only
    {
        return Err(invalid(
            None,
            "writable depth attachments require load/store operations".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod completion_tests {
    use super::*;

    #[test]
    fn failed_render_finish_installs_no_executor() {
        let mut graph = crate::FrameGraph::new();
        let mut frame = graph.begin_frame();
        let error = frame
            .render_pass("empty")
            .finish_render(|_| Ok(()))
            .unwrap_err();
        assert!(matches!(
            error,
            FrameGraphError::InvalidNodeOperation { .. }
        ));
        assert!(frame.executors.is_empty());
        assert!(frame.nodes.is_empty());
        assert_eq!(frame.recording_error, Some(error));
    }
}
