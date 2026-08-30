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

pub trait AccessMarker: sealed::Sealed + Copy {}

pub trait BufferAccessMarker: AccessMarker {}

pub trait TextureAccessMarker: AccessMarker {}

macro_rules! define_marker {
    ($($name:ident),+ $(,)?) => {$ (
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
    pub const fn pass_id(self) -> PassId {
        self.pass
    }

    pub const fn access_id(self) -> AccessId {
        self.access
    }

    pub const fn resource_id(self) -> ResourceId {
        self.resource
    }
}

/// Builder for one graph node. It must be completed with [`Self::finish`].
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

    pub fn id(&self) -> PassId {
        self.node.as_ref().expect("open pass").id
    }

    pub fn set_side_effect(&mut self, side_effect: bool) -> &mut Self {
        self.node.as_mut().expect("open pass").side_effect = side_effect;
        self
    }

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

    pub fn color_attachment_with_resolve(
        &mut self,
        source: impl Into<TextureTarget<'frame>>,
        resolve_target: impl Into<TextureTarget<'frame>>,
        ops: ColorAttachmentOps,
    ) -> Result<AccessToken<'frame, ColorAttachment>, FrameGraphError> {
        let (load, store) = ops.semantic();
        let source = self.attachment_access(
            source.into(),
            AccessRole::ColorAttachment,
            load,
            store,
            ops.depth_slice,
        )?;
        let resolve = self.attachment_access::<ColorAttachment>(
            resolve_target.into(),
            AccessRole::ColorAttachment,
            AttachmentLoadOp::Clear,
            AttachmentStoreOp::Store,
            None,
        )?;
        self.color_attachments.push(RenderColorAttachment {
            access: source.access,
            resolve_access: Some(resolve.access),
            ops,
        });
        Ok(source)
    }

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

    pub fn copy_buffer_to_buffer(
        &mut self,
        source: Buffer<'frame>,
        source_offset: u64,
        destination: Buffer<'frame>,
        destination_offset: u64,
        size: u64,
    ) -> Result<&mut Self, FrameGraphError> {
        self.require_kind(NodeKind::Copy, "buffer-to-buffer copy")?;
        if size == 0
            || !source_offset.is_multiple_of(wgpu::COPY_BUFFER_ALIGNMENT)
            || !destination_offset.is_multiple_of(wgpu::COPY_BUFFER_ALIGNMENT)
            || !size.is_multiple_of(wgpu::COPY_BUFFER_ALIGNMENT)
        {
            return Err(self.invalid_operation(
                None,
                "buffer copy offsets and non-zero size must be 4-byte aligned",
            ));
        }
        let source_range = BufferRange::new(source_offset, size);
        let destination_range = BufferRange::new(destination_offset, size);
        let _ = self.buffer_copy_src(source, source_range)?;
        let _ = self.buffer_copy_dst(destination, destination_range, WriteContents::Overwrite)?;
        self.copy_operations.push(CopyOperation::BufferToBuffer {
            source: source.id,
            source_offset,
            destination: destination.id,
            destination_offset,
            size,
        });
        Ok(self)
    }

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
            destination.record.aspect,
            copy_size,
        )?;
        let _ = self.add_access::<BufferCopySrc>(
            buffer.resource,
            AccessRole::BufferCopySrc,
            AccessMode::Read,
            true,
            false,
            NormalizedRange::Buffer(buffer.range.clone()),
            None,
        )?;
        let _ = self.add_access::<TextureCopyDst>(
            destination.record.resource,
            AccessRole::TextureCopyDst,
            AccessMode::Write,
            !destination.full_subresources,
            true,
            NormalizedRange::Texture(destination.range),
            None,
        )?;
        self.copy_operations.push(CopyOperation::BufferToTexture {
            source: buffer.resource,
            source_layout: source.layout,
            destination: destination.record,
            copy_size,
        });
        Ok(self)
    }

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
            source.record.aspect,
            copy_size,
        )?;
        let _ = self.add_access::<TextureCopySrc>(
            source.record.resource,
            AccessRole::TextureCopySrc,
            AccessMode::Read,
            true,
            false,
            NormalizedRange::Texture(source.range),
            None,
        )?;
        let _ = self.add_access::<BufferCopyDst>(
            buffer.resource,
            AccessRole::BufferCopyDst,
            AccessMode::Write,
            !buffer.tightly_packed,
            true,
            NormalizedRange::Buffer(buffer.range.clone()),
            None,
        )?;
        self.copy_operations.push(CopyOperation::TextureToBuffer {
            source: source.record,
            destination: buffer.resource,
            destination_layout: destination.layout,
            copy_size,
        });
        Ok(self)
    }

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
        if source.format.remove_srgb_suffix() != destination.format.remove_srgb_suffix()
            || source.dimension != destination.dimension
            || source.record.aspect != destination.record.aspect
        {
            return Err(self.invalid_operation(
                Some(destination.record.resource),
                format!(
                    "copy formats {:?} and {:?} are not copy-compatible",
                    source.format, destination.format
                ),
            ));
        }
        let _ = self.add_access::<TextureCopySrc>(
            source.record.resource,
            AccessRole::TextureCopySrc,
            AccessMode::Read,
            true,
            false,
            NormalizedRange::Texture(source.range),
            None,
        )?;
        let _ = self.add_access::<TextureCopyDst>(
            destination.record.resource,
            AccessRole::TextureCopyDst,
            AccessMode::Write,
            !destination.full_subresources,
            true,
            NormalizedRange::Texture(destination.range),
            None,
        )?;
        self.copy_operations.push(CopyOperation::TextureToTexture {
            source: source.record,
            destination: destination.record,
            copy_size,
        });
        Ok(self)
    }

    pub fn finish(mut self) -> Result<PassId, FrameGraphError> {
        self.finish_node()
    }

    pub fn finish_render<F>(mut self, callback: F) -> Result<PassId, FrameGraphError>
    where
        F: for<'execute> FnOnce(crate::RenderPassContext<'execute>) -> Result<(), FrameGraphError>
            + 'frame,
    {
        self.require_kind(NodeKind::Render, "render executor")?;
        if self.color_attachments.is_empty() && self.depth_attachments.is_empty() {
            return Err(
                self.invalid_operation(None, "render nodes require at least one attachment")
            );
        }
        if self.depth_attachments.len() > 1 {
            return Err(self.invalid_operation(None, "render nodes support one depth attachment"));
        }
        let id = self.id();
        self.frame.executors.insert(
            id,
            crate::execution::NodeExecutor::Render {
                color_attachments: core::mem::take(&mut self.color_attachments),
                depth_attachment: self.depth_attachments.pop(),
                callback: Box::new(callback),
            },
        );
        self.finish_node()
    }

    pub fn finish_compute<F>(mut self, callback: F) -> Result<PassId, FrameGraphError>
    where
        F: for<'execute> FnOnce(crate::ComputePassContext<'execute>) -> Result<(), FrameGraphError>
            + 'frame,
    {
        self.require_kind(NodeKind::Compute, "compute executor")?;
        let id = self.id();
        self.frame.executors.insert(
            id,
            crate::execution::NodeExecutor::Compute(Box::new(callback)),
        );
        self.finish_node()
    }

    pub fn finish_command<F>(mut self, callback: F) -> Result<PassId, FrameGraphError>
    where
        F: for<'execute> FnOnce(crate::CommandContext<'execute>) -> Result<(), FrameGraphError>
            + 'frame,
    {
        let node = self.node.as_ref().expect("open pass");
        if node.kind != NodeKind::Command {
            return Err(FrameGraphError::InvalidNodeExecutor {
                pass: node.id,
                expected: "command",
                actual: node.kind,
            });
        }
        let id = node.id;
        self.frame.executors.insert(
            id,
            crate::execution::NodeExecutor::Command(Box::new(callback)),
        );
        self.finish_node()
    }

    pub fn finish_external<F>(mut self, callback: F) -> Result<PassId, FrameGraphError>
    where
        F: for<'execute> FnOnce(
                crate::ExternalSubmissionContext<'execute>,
            ) -> Result<(), FrameGraphError>
            + 'frame,
    {
        let node = self.node.as_ref().expect("open pass");
        if node.kind != NodeKind::ExternalSubmission {
            return Err(FrameGraphError::InvalidNodeExecutor {
                pass: node.id,
                expected: "external-submission",
                actual: node.kind,
            });
        }
        let id = node.id;
        self.frame.executors.insert(
            id,
            crate::execution::NodeExecutor::External(Box::new(callback)),
        );
        self.finish_node()
    }

    fn finish_node(&mut self) -> Result<PassId, FrameGraphError> {
        let open = self.node.as_ref().expect("open pass");
        if open.kind == NodeKind::Render {
            validate_render_attachments(
                self.frame,
                open.id,
                &self.color_attachments,
                self.depth_attachments.first().copied(),
                open,
            )?;
        }
        if open.kind == NodeKind::Copy && !self.copy_operations.is_empty() {
            self.frame.executors.insert(
                open.id,
                crate::execution::NodeExecutor::Copy(core::mem::take(&mut self.copy_operations)),
            );
        }
        let node = self.node.take().ok_or_else(|| FrameGraphError::Internal {
            message: "pass was already finished".into(),
        })?;
        let id = node.id;
        self.frame.nodes.push(node);
        self.closed = true;
        Ok(id)
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
    let features = format.guaranteed_format_features(
        frame
            .graph
            .device_features
            .unwrap_or_else(wgpu::Features::all),
    );
    let required_usage = role
        .texture_usage()
        .ok_or_else(|| FrameGraphError::Internal {
            message: format!("texture role {role:?} has no texture usage"),
        })?;
    if !features.allowed_usages.contains(required_usage) {
        return Err(FrameGraphError::UnsupportedTextureFormatUsage {
            resource,
            role,
            format,
            message: format!("required usage {required_usage:?} is not supported"),
        });
    }
    if desc.sample_count > 1 && !features.flags.sample_count_supported(desc.sample_count) {
        return Err(FrameGraphError::UnsupportedTextureFormatUsage {
            resource,
            role,
            format,
            message: format!("sample count {} is not supported", desc.sample_count),
        });
    }
    match role {
        AccessRole::ColorAttachment if depth => Err(FrameGraphError::InvalidTextureView {
            resource,
            message: "depth formats cannot be color attachments".into(),
        }),
        AccessRole::DepthAttachment if !depth => Err(FrameGraphError::InvalidTextureView {
            resource,
            message: "color formats cannot be depth attachments".into(),
        }),
        AccessRole::StorageTextureRead | AccessRole::StorageTextureWrite if depth => {
            Err(FrameGraphError::InvalidTextureView {
                resource,
                message: "depth storage textures are not supported".into(),
            })
        }
        AccessRole::StorageTextureRead
            if !features
                .flags
                .contains(wgpu::TextureFormatFeatureFlags::STORAGE_READ_ONLY) =>
        {
            Err(FrameGraphError::UnsupportedTextureFormatUsage {
                resource,
                role,
                format,
                message: "storage reads are not supported".into(),
            })
        }
        AccessRole::StorageTextureWrite
            if !features
                .flags
                .contains(wgpu::TextureFormatFeatureFlags::STORAGE_WRITE_ONLY) =>
        {
            Err(FrameGraphError::UnsupportedTextureFormatUsage {
                resource,
                role,
                format,
                message: "storage writes are not supported".into(),
            })
        }
        AccessRole::TextureCopySrc | AccessRole::TextureCopyDst if desc.sample_count > 1 => {
            Err(FrameGraphError::InvalidTextureView {
                resource,
                message: "multisampled textures cannot be copied".into(),
            })
        }
        _ => Ok(()),
    }
}

#[derive(Clone, Debug)]
struct ValidatedTextureCopy {
    record: TextureCopyLocationRecord,
    range: Vec<TextureSubresourceRange>,
    format: wgpu::TextureFormat,
    dimension: wgpu::TextureDimension,
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
    if desc.sample_count != 1 {
        return Err(invalid("multisampled textures cannot be copied".into()));
    }
    let aspect = if desc.format.has_depth_aspect() {
        if !matches!(
            location.aspect,
            wgpu::TextureAspect::All | wgpu::TextureAspect::DepthOnly
        ) {
            return Err(invalid(
                "depth copies require All or DepthOnly aspect".into(),
            ));
        }
        wgpu::TextureAspect::DepthOnly
    } else {
        if location.aspect != wgpu::TextureAspect::All {
            return Err(invalid("color copies require the All aspect".into()));
        }
        wgpu::TextureAspect::All
    };
    if desc.format.block_copy_size(Some(aspect)).is_none() {
        return Err(invalid(format!(
            "format {:?} cannot be copied for aspect {:?}",
            desc.format, aspect
        )));
    }

    let mip = location.mip_level;
    let mip_width = (desc.size.width >> mip).max(1);
    let mip_height = match desc.dimension {
        wgpu::TextureDimension::D1 => 1,
        _ => (desc.size.height >> mip).max(1),
    };
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
    if end_x > mip_width || end_y > mip_height || end_z > mip_slices {
        return Err(invalid(format!(
            "copy region {:?}+{:?} exceeds mip extent {}x{}x{}",
            location.origin, copy_size, mip_width, mip_height, mip_slices
        )));
    }
    match desc.dimension {
        wgpu::TextureDimension::D1
            if location.origin.y != 0
                || location.origin.z != 0
                || copy_size.height != 1
                || copy_size.depth_or_array_layers != 1 =>
        {
            return Err(invalid(
                "D1 copies require y/z origin 0 and height/depth 1".into(),
            ));
        }
        _ => {}
    }
    let (block_width, block_height) = desc.format.block_dimensions();
    let x_aligned = location.origin.x.is_multiple_of(block_width)
        && (copy_size.width.is_multiple_of(block_width) || end_x == mip_width);
    let y_aligned = location.origin.y.is_multiple_of(block_height)
        && (copy_size.height.is_multiple_of(block_height) || end_y == mip_height);
    if !x_aligned || !y_aligned {
        return Err(invalid(format!(
            "copy origin and extent must respect the {}x{} texel block",
            block_width, block_height
        )));
    }

    Ok(ValidatedTextureCopy {
        record: TextureCopyLocationRecord {
            resource,
            mip_level: mip,
            origin: location.origin,
            aspect,
        },
        range: vec![TextureSubresourceRange {
            base_mip_level: mip,
            mip_level_count: 1,
            base_slice: location.origin.z,
            slice_count: copy_size.depth_or_array_layers,
            aspect,
        }],
        format: desc.format,
        dimension: desc.dimension,
        full_subresources: location.origin.x == 0
            && location.origin.y == 0
            && copy_size.width == mip_width
            && copy_size.height == mip_height,
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
    let block_size = u64::from(
        format
            .block_copy_size(Some(aspect))
            .ok_or_else(|| invalid(format!("format {format:?} cannot be copied")))?,
    );
    if !location.layout.offset.is_multiple_of(block_size)
        || !location
            .layout
            .offset
            .is_multiple_of(wgpu::COPY_BUFFER_ALIGNMENT)
    {
        return Err(invalid(format!(
            "buffer offset {} must be aligned to block size {} and COPY_BUFFER_ALIGNMENT",
            location.layout.offset, block_size
        )));
    }
    let info = location
        .layout
        .get_buffer_texture_copy_info(format, aspect, &copy_size)
        .map_err(|error| invalid(format!("invalid buffer texture layout: {error:?}")))?;
    if (info.height_blocks > 1 || info.depth_or_array_layers > 1)
        && location.layout.bytes_per_row.is_none()
    {
        return Err(invalid(
            "bytes_per_row is required for multi-row or multi-layer copies".into(),
        ));
    }
    if info.depth_or_array_layers > 1 && location.layout.rows_per_image.is_none() {
        return Err(invalid(
            "rows_per_image is required for multi-layer copies".into(),
        ));
    }
    if let Some(bytes_per_row) = location.layout.bytes_per_row
        && !bytes_per_row.is_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
    {
        return Err(invalid(format!(
            "bytes_per_row {bytes_per_row} must be aligned to COPY_BYTES_PER_ROW_ALIGNMENT"
        )));
    }
    let end = location
        .layout
        .offset
        .checked_add(info.bytes_in_copy)
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
        tightly_packed: info.row_stride_bytes == info.row_bytes_dense
            && info.image_stride_rows == info.image_rows_dense,
    })
}

fn validate_render_attachments(
    frame: &Frame<'_>,
    pass: PassId,
    colors: &[RenderColorAttachment],
    depth: Option<RenderDepthAttachment>,
    node: &NodeRecord,
) -> Result<(), FrameGraphError> {
    let invalid = |resource, message: String| FrameGraphError::InvalidNodeOperation {
        pass,
        resource,
        message,
    };
    let mut reference_extent = None;
    for color in colors {
        if let crate::ColorAttachmentLoadOp::Clear(value) = color.ops.load
            && ![value.r, value.g, value.b, value.a]
                .into_iter()
                .all(f64::is_finite)
        {
            return Err(invalid(None, "color clear values must be finite".into()));
        }
        let extent = attachment_extent(frame, node, color.access)?;
        if let Some(reference) = reference_extent
            && reference != (extent.0, extent.1, extent.2)
        {
            return Err(invalid(
                Some(extent.3),
                "all render attachments must have matching width, height, and sample count".into(),
            ));
        }
        reference_extent = Some((extent.0, extent.1, extent.2));
        if let Some(resolve_access) = color.resolve_access {
            let resolve_extent = attachment_extent(frame, node, resolve_access)?;
            let source_format = attachment_format(frame, node, color.access)?;
            let resolve_format = attachment_format(frame, node, resolve_access)?;
            if extent.2 == 1 {
                return Err(invalid(
                    Some(extent.3),
                    "resolve sources must be multisampled".into(),
                ));
            }
            if resolve_extent.2 != 1 {
                return Err(invalid(
                    Some(resolve_extent.3),
                    "resolve targets must be single-sampled".into(),
                ));
            }
            if (extent.0, extent.1) != (resolve_extent.0, resolve_extent.1) {
                return Err(invalid(
                    Some(resolve_extent.3),
                    "resolve source and target extents must match".into(),
                ));
            }
            if source_format != resolve_format {
                return Err(invalid(
                    Some(resolve_extent.3),
                    format!(
                        "resolve source format {source_format:?} does not match target format {resolve_format:?}"
                    ),
                ));
            }
            let format_features = source_format.guaranteed_format_features(
                frame
                    .graph
                    .device_features
                    .unwrap_or_else(wgpu::Features::all),
            );
            if !format_features
                .flags
                .contains(wgpu::TextureFormatFeatureFlags::MULTISAMPLE_RESOLVE)
            {
                return Err(FrameGraphError::UnsupportedTextureFormatUsage {
                    resource: extent.3,
                    role: AccessRole::ColorAttachment,
                    format: source_format,
                    message: "format does not support multisample resolve".into(),
                });
            }
        }
    }
    if let Some(depth) = depth {
        if let Some(ops) = depth.ops {
            if let crate::DepthAttachmentLoadOp::Clear(value) = ops.load
                && (!value.is_finite() || !(0.0..=1.0).contains(&value))
            {
                return Err(invalid(
                    None,
                    "depth clear value must be finite and within 0..=1".into(),
                ));
            }
        } else if !depth.read_only {
            return Err(invalid(
                None,
                "writable depth attachments require load/store operations".into(),
            ));
        }
        let extent = attachment_extent(frame, node, depth.access)?;
        if let Some(reference) = reference_extent
            && reference != (extent.0, extent.1, extent.2)
        {
            return Err(invalid(
                Some(extent.3),
                "all render attachments must have matching width, height, and sample count".into(),
            ));
        }
    }
    Ok(())
}

fn attachment_format(
    frame: &Frame<'_>,
    node: &NodeRecord,
    access: AccessId,
) -> Result<wgpu::TextureFormat, FrameGraphError> {
    let access = node
        .accesses
        .iter()
        .find(|record| record.id == access)
        .ok_or_else(|| FrameGraphError::Internal {
            message: format!("attachment references unknown access {access}"),
        })?;
    let resource = frame.resource(access.resource)?;
    let desc = resource
        .texture()
        .ok_or_else(|| FrameGraphError::Internal {
            message: "attachment access resolved to a buffer".into(),
        })?;
    Ok(access
        .view
        .and_then(|id| frame.views.get(id.get() as usize))
        .and_then(|view| view.descriptor.format)
        .unwrap_or(desc.format))
}

fn attachment_extent(
    frame: &Frame<'_>,
    node: &NodeRecord,
    access: AccessId,
) -> Result<(u32, u32, u32, ResourceId), FrameGraphError> {
    let access = node
        .accesses
        .iter()
        .find(|record| record.id == access)
        .ok_or_else(|| FrameGraphError::Internal {
            message: format!("attachment references unknown access {access}"),
        })?;
    let desc =
        frame
            .resource(access.resource)?
            .texture()
            .ok_or_else(|| FrameGraphError::Internal {
                message: "attachment access resolved to a buffer".into(),
            })?;
    let NormalizedRange::Texture(regions) = &access.range else {
        return Err(FrameGraphError::Internal {
            message: "attachment access has a buffer range".into(),
        });
    };
    let mip = regions
        .first()
        .ok_or_else(|| FrameGraphError::Internal {
            message: "attachment access has an empty range".into(),
        })?
        .base_mip_level;
    Ok((
        (desc.size.width >> mip).max(1),
        match desc.dimension {
            wgpu::TextureDimension::D1 => 1,
            _ => (desc.size.height >> mip).max(1),
        },
        desc.sample_count,
        access.resource,
    ))
}
