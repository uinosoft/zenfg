use core::{
    marker::PhantomData,
    sync::atomic::{AtomicU64, Ordering},
};
use std::collections::HashMap;

use crate::{
    Buffer, BufferDesc, BufferRange, ClearBufferOp, CompileOptions, CompiledFrame, DebugGroupId,
    FrameGraphError, ImportBufferOptions, ImportTextureOptions, InitialContents, NodeKind,
    NormalizedTextureViewDesc, PassBuilder, PassId, ResourceDescriptor, ResourceId, ResourceOrigin,
    RootReason, Texture, TextureDesc, TextureSubresourceRange, TextureTarget, TextureView,
    TextureViewDesc, ViewId, compiler,
    execution::{ClearBufferOperation, NativeResource, NodeExecutor},
    gpu_timing::GpuProfiler,
    model::{DebugGroupRecord, NormalizedRange, ResourceRecord, RootRecord, ViewRecord},
    resource::normalize_texture_view_descriptor,
    resource_pool::{ResourcePool, ResourcePoolStats},
};

static NEXT_OWNER_ID: AtomicU64 = AtomicU64::new(1);

/// Long-lived owner of frame identities, transient allocations, and GPU timing state.
///
/// Use [`FrameGraph::new`] for CPU-only recording and compilation. Use
/// [`FrameGraph::with_device`] when compiled frames will be executed. Only one
/// [`Frame`] may borrow a graph at a time; dropping or compiling it permits the
/// next recording to begin.
#[derive(Debug)]
pub struct FrameGraph {
    owner: u64,
    next_recording: u64,
    pub(crate) device: Option<wgpu::Device>,
    pub(crate) device_features: Option<wgpu::Features>,
    pub(crate) resource_pool: ResourcePool,
    pub(crate) gpu_profiler: GpuProfiler,
}

impl FrameGraph {
    /// Creates a CPU-only graph compiler.
    ///
    /// Frames from this graph can be recorded, validated, compiled, reported,
    /// and exported, but [`CompiledFrame::execute`](crate::CompiledFrame::execute)
    /// returns [`FrameGraphError::MissingGpuDevice`].
    pub fn new() -> Self {
        Self {
            owner: NEXT_OWNER_ID.fetch_add(1, Ordering::Relaxed),
            next_recording: 1,
            device: None,
            device_features: None,
            resource_pool: ResourcePool::default(),
            gpu_profiler: GpuProfiler::default(),
        }
    }

    /// Creates a graph backed by a cloned wgpu device handle.
    ///
    /// The graph owns its transient resource pool and GPU timing resources. The
    /// queue, imported resources, pipelines, bind groups, and surface remain
    /// caller-owned.
    pub fn with_device(device: &wgpu::Device) -> Self {
        Self {
            owner: NEXT_OWNER_ID.fetch_add(1, Ordering::Relaxed),
            next_recording: 1,
            device: Some(device.clone()),
            device_features: Some(device.features()),
            resource_pool: ResourcePool::default(),
            gpu_profiler: GpuProfiler::default(),
        }
    }

    /// Returns cumulative allocation counters and current retained pool size.
    pub fn resource_pool_stats(&self) -> ResourcePoolStats {
        self.resource_pool.stats()
    }

    /// Destroys all transient resources currently retained for reuse.
    ///
    /// Cumulative acquire, reuse, and creation counters are preserved.
    pub fn clear_resource_pool(&mut self) {
        self.resource_pool.clear();
    }

    /// Begins a fresh, single-use frame recording.
    ///
    /// Logical handles returned by the frame cannot outlive this exclusive graph
    /// borrow. [`Frame::compile`] consumes the recording and returns a compiled
    /// frame that continues to hold the graph borrow through optional execution.
    pub fn begin_frame(&mut self) -> Frame<'_> {
        let owner = self.owner;
        let recording = self.next_recording;
        self.next_recording = self.next_recording.wrapping_add(1).max(1);
        Frame {
            graph: self,
            owner,
            recording,
            resources: Vec::new(),
            views: Vec::new(),
            nodes: Vec::new(),
            roots: Vec::new(),
            recording_error: None,
            next_access: 0,
            native_resources: HashMap::new(),
            executors: HashMap::new(),
            debug_groups: Vec::new(),
            debug_group_stack: Vec::new(),
            marker: PhantomData,
        }
    }
}

impl Default for FrameGraph {
    fn default() -> Self {
        Self::new()
    }
}

/// A single-use FrameGraph recording.
///
/// Create or import logical resources, declare accesses through pass builders,
/// and mark observable roots before calling [`Self::compile`]. Handles and
/// callbacks are tied to this recording. A pass builder must be finished; if it
/// is dropped open, compilation returns [`FrameGraphError::UnclosedPass`].
pub struct Frame<'frame> {
    pub(crate) graph: &'frame mut FrameGraph,
    pub(crate) owner: u64,
    pub(crate) recording: u64,
    pub(crate) resources: Vec<ResourceRecord>,
    pub(crate) views: Vec<ViewRecord>,
    pub(crate) nodes: Vec<crate::model::NodeRecord>,
    pub(crate) roots: Vec<RootRecord>,
    pub(crate) recording_error: Option<FrameGraphError>,
    pub(crate) next_access: u32,
    pub(crate) native_resources: HashMap<ResourceId, NativeResource>,
    pub(crate) executors: HashMap<PassId, NodeExecutor<'frame>>,
    pub(crate) debug_groups: Vec<DebugGroupRecord>,
    pub(crate) debug_group_stack: Vec<DebugGroupId>,
    marker: PhantomData<fn(&'frame mut FrameGraph) -> &'frame mut FrameGraph>,
}

impl<'frame> Frame<'frame> {
    /// Creates an undefined transient texture whose usage is derived at compile time.
    ///
    /// The descriptor is validated immediately. Native allocation is deferred
    /// until execution and only occurs if retained work uses the resource.
    pub fn create_texture(
        &mut self,
        desc: TextureDesc,
    ) -> Result<Texture<'frame>, FrameGraphError> {
        validate_texture_desc(&desc)?;
        self.register_texture(
            desc,
            ResourceOrigin::Transient,
            InitialContents::Undefined,
            None,
        )
    }

    /// Imports a caller-owned logical texture.
    ///
    /// Importing does not clone or bind a native texture. Device-backed execution
    /// additionally requires [`Self::bind_imported_texture`]. `options` defines
    /// whether reads may consume initial contents and which usage flags are exposed.
    pub fn import_texture(
        &mut self,
        desc: TextureDesc,
        options: ImportTextureOptions,
    ) -> Result<Texture<'frame>, FrameGraphError> {
        validate_texture_desc(&desc)?;
        self.register_texture(
            desc,
            ResourceOrigin::Imported,
            options.initial_contents,
            options.exposed_usage,
        )
    }

    /// Imports one caller-acquired surface texture for a present root.
    ///
    /// Surface contents always begin undefined. The caller remains responsible
    /// for acquisition and presentation, and must bind the acquired native texture
    /// before execution.
    pub fn import_surface_texture(
        &mut self,
        desc: TextureDesc,
        exposed_usage: Option<wgpu::TextureUsages>,
    ) -> Result<Texture<'frame>, FrameGraphError> {
        validate_texture_desc(&desc)?;
        self.register_texture(
            desc,
            ResourceOrigin::Surface,
            InitialContents::Undefined,
            exposed_usage,
        )
    }

    fn register_texture(
        &mut self,
        desc: TextureDesc,
        origin: ResourceOrigin,
        initial_contents: InitialContents,
        exposed_usage: Option<wgpu::TextureUsages>,
    ) -> Result<Texture<'frame>, FrameGraphError> {
        let id = self.next_resource_id()?;
        self.resources.push(ResourceRecord {
            id,
            origin,
            initial_contents,
            descriptor: ResourceDescriptor::Texture(desc),
            exposed_texture_usage: exposed_usage,
            exposed_buffer_usage: None,
            debug_group: self.current_debug_group(),
        });
        Ok(Texture {
            id,
            owner: self.owner,
            recording: self.recording,
            marker: PhantomData,
        })
    }

    /// Creates an undefined transient buffer whose usage is derived at compile time.
    pub fn create_buffer(&mut self, desc: BufferDesc) -> Result<Buffer<'frame>, FrameGraphError> {
        self.register_buffer(
            desc,
            ResourceOrigin::Transient,
            InitialContents::Undefined,
            None,
        )
    }

    /// Imports a caller-owned logical buffer.
    ///
    /// Importing only records its contract. Device-backed execution additionally
    /// requires [`Self::bind_imported_buffer`].
    pub fn import_buffer(
        &mut self,
        desc: BufferDesc,
        options: ImportBufferOptions,
    ) -> Result<Buffer<'frame>, FrameGraphError> {
        self.register_buffer(
            desc,
            ResourceOrigin::Imported,
            options.initial_contents,
            options.exposed_usage,
        )
    }

    /// Binds a native caller-owned buffer to an imported logical buffer.
    ///
    /// The native size and exposed usage are checked immediately. A native object
    /// may be bound to only one logical resource in a recording. The graph keeps a
    /// cloned wgpu handle through execution but never destroys the imported buffer.
    pub fn bind_imported_buffer(
        &mut self,
        buffer: Buffer<'frame>,
        native: &wgpu::Buffer,
    ) -> Result<(), FrameGraphError> {
        self.validate_handle(buffer.owner, buffer.recording)?;
        let resource = self.resource(buffer.id)?;
        if resource.origin == ResourceOrigin::Transient {
            return Err(FrameGraphError::NativeDescriptorMismatch {
                resource: buffer.id,
                message: "transient resources cannot be bound as imported resources".into(),
            });
        }
        let desc = resource.buffer().ok_or_else(|| FrameGraphError::Internal {
            message: "buffer handle resolved to a texture".into(),
        })?;
        if native.size() < desc.size {
            return Err(FrameGraphError::NativeDescriptorMismatch {
                resource: buffer.id,
                message: format!(
                    "native buffer size {} is smaller than logical size {}",
                    native.size(),
                    desc.size
                ),
            });
        }
        if let Some(exposed) = resource.exposed_buffer_usage
            && !native.usage().contains(exposed)
        {
            return Err(FrameGraphError::NativeDescriptorMismatch {
                resource: buffer.id,
                message: format!(
                    "native usage {:#x} does not contain exposed usage {:#x}",
                    native.usage().bits(),
                    exposed.bits()
                ),
            });
        }
        self.ensure_unique_native(&NativeResource::Buffer(native.clone()), buffer.id)?;
        self.native_resources
            .insert(buffer.id, NativeResource::Buffer(native.clone()));
        Ok(())
    }

    /// Binds a native caller-owned texture to an imported or surface texture.
    ///
    /// Size, format, dimension, mip count, sample count, and exposed usage must
    /// match the logical descriptor. The graph never acquires or presents a surface.
    pub fn bind_imported_texture(
        &mut self,
        texture: Texture<'frame>,
        native: &wgpu::Texture,
    ) -> Result<(), FrameGraphError> {
        self.validate_handle(texture.owner, texture.recording)?;
        let resource = self.resource(texture.id)?;
        if resource.origin == ResourceOrigin::Transient {
            return Err(FrameGraphError::NativeDescriptorMismatch {
                resource: texture.id,
                message: "transient resources cannot be bound as imported resources".into(),
            });
        }
        let desc = resource
            .texture()
            .ok_or_else(|| FrameGraphError::Internal {
                message: "texture handle resolved to a buffer".into(),
            })?;
        let matches = native.size() == desc.size
            && native.mip_level_count() == desc.mip_level_count
            && native.sample_count() == desc.sample_count
            && native.dimension() == desc.dimension
            && native.format() == desc.format;
        if !matches {
            return Err(FrameGraphError::NativeDescriptorMismatch {
                resource: texture.id,
                message: format!(
                    "native texture {:?}, {:?}, {} mips, {} samples, {:?} does not match logical descriptor {:?}, {:?}, {} mips, {} samples, {:?}",
                    native.size(),
                    native.dimension(),
                    native.mip_level_count(),
                    native.sample_count(),
                    native.format(),
                    desc.size,
                    desc.dimension,
                    desc.mip_level_count,
                    desc.sample_count,
                    desc.format,
                ),
            });
        }
        if let Some(exposed) = resource.exposed_texture_usage
            && !native.usage().contains(exposed)
        {
            return Err(FrameGraphError::NativeDescriptorMismatch {
                resource: texture.id,
                message: format!(
                    "native usage {:#x} does not contain exposed usage {:#x}",
                    native.usage().bits(),
                    exposed.bits()
                ),
            });
        }
        self.ensure_unique_native(&NativeResource::Texture(native.clone()), texture.id)?;
        self.native_resources
            .insert(texture.id, NativeResource::Texture(native.clone()));
        Ok(())
    }

    fn register_buffer(
        &mut self,
        desc: BufferDesc,
        origin: ResourceOrigin,
        initial_contents: InitialContents,
        exposed_usage: Option<wgpu::BufferUsages>,
    ) -> Result<Buffer<'frame>, FrameGraphError> {
        let id = self.next_resource_id()?;
        self.resources.push(ResourceRecord {
            id,
            origin,
            initial_contents,
            descriptor: ResourceDescriptor::Buffer(desc),
            exposed_texture_usage: None,
            exposed_buffer_usage: exposed_usage,
            debug_group: self.current_debug_group(),
        });
        Ok(Buffer {
            id,
            owner: self.owner,
            recording: self.recording,
            marker: PhantomData,
        })
    }

    /// Creates and validates an explicit logical view of a texture.
    ///
    /// Descriptor defaults are resolved against the snapshotted texture metadata.
    /// View handles remain valid only for this frame recording.
    pub fn create_texture_view(
        &mut self,
        texture: Texture<'frame>,
        desc: TextureViewDesc,
    ) -> Result<TextureView<'frame>, FrameGraphError> {
        self.validate_handle(texture.owner, texture.recording)?;
        let resource = self.resource(texture.id)?;
        let texture_desc = resource
            .texture()
            .ok_or_else(|| FrameGraphError::Internal {
                message: "texture handle resolved to a buffer".into(),
            })?;
        let range = normalize_view(texture.id, texture_desc, &desc)?;
        let id = ViewId::new(u32::try_from(self.views.len()).map_err(|_| {
            FrameGraphError::InvalidResourceDescriptor {
                message: "too many texture views in one frame".into(),
            }
        })?);
        self.views.push(ViewRecord {
            id,
            texture: texture.id,
            descriptor: desc,
            range,
        });
        Ok(TextureView {
            id,
            owner: self.owner,
            recording: self.recording,
            marker: PhantomData,
        })
    }

    /// Returns the descriptor snapshotted for a logical texture.
    pub fn texture_desc(&self, texture: Texture<'frame>) -> Result<&TextureDesc, FrameGraphError> {
        self.validate_handle(texture.owner, texture.recording)?;
        self.resource(texture.id)?
            .texture()
            .ok_or_else(|| FrameGraphError::Internal {
                message: "texture handle resolved to a buffer".into(),
            })
    }

    /// Returns the descriptor snapshotted for a logical buffer.
    pub fn buffer_desc(&self, buffer: Buffer<'frame>) -> Result<&BufferDesc, FrameGraphError> {
        self.validate_handle(buffer.owner, buffer.recording)?;
        self.resource(buffer.id)?
            .buffer()
            .ok_or_else(|| FrameGraphError::Internal {
                message: "buffer handle resolved to a texture".into(),
            })
    }

    /// Returns fully resolved metadata for a logical texture view.
    pub fn texture_view_desc(
        &self,
        view: TextureView<'frame>,
    ) -> Result<NormalizedTextureViewDesc, FrameGraphError> {
        self.validate_handle(view.owner, view.recording)?;
        let view = self.view(view.id)?;
        let texture =
            self.resource(view.texture)?
                .texture()
                .ok_or_else(|| FrameGraphError::Internal {
                    message: "texture view resolved to a buffer".into(),
                })?;
        Ok(normalize_texture_view_descriptor(texture, &view.descriptor))
    }

    /// Starts a structured render node.
    ///
    /// Finish it with [`PassBuilder::finish_render`] after declaring at least one
    /// color or depth attachment.
    pub fn render_pass(&mut self, label: impl Into<String>) -> PassBuilder<'_, 'frame> {
        self.pass(NodeKind::Render, label, false)
    }

    /// Starts a structured compute node, finished with [`PassBuilder::finish_compute`].
    pub fn compute_pass(&mut self, label: impl Into<String>) -> PassBuilder<'_, 'frame> {
        self.pass(NodeKind::Compute, label, false)
    }

    /// Starts a declarative copy node.
    ///
    /// Copy operations encode themselves during execution; finish with
    /// [`PassBuilder::finish`] rather than supplying a callback.
    pub fn copy_pass(&mut self, label: impl Into<String>) -> PassBuilder<'_, 'frame> {
        self.pass(NodeKind::Copy, label, false)
    }

    /// Starts a direct command-encoder callback node.
    ///
    /// Command nodes are side-effecting by default and are finished with
    /// [`PassBuilder::finish_command`]. Declare every resource touched by the
    /// callback so validation, ordering, usage inference, and allocation stay sound.
    pub fn command_pass(&mut self, label: impl Into<String>) -> PassBuilder<'_, 'frame> {
        self.pass(NodeKind::Command, label, true)
    }

    /// Starts a callback that may submit caller-owned command buffers directly.
    ///
    /// The node splits FrameGraph-owned command encoders into ordered execution
    /// segments. It is side-effecting by default and is finished with
    /// [`PassBuilder::finish_external`].
    pub fn external_submission(&mut self, label: impl Into<String>) -> PassBuilder<'_, 'frame> {
        self.pass(NodeKind::ExternalSubmission, label, true)
    }

    fn pass(
        &mut self,
        kind: NodeKind,
        label: impl Into<String>,
        side_effect: bool,
    ) -> PassBuilder<'_, 'frame> {
        let id = PassId::new(u32::try_from(self.nodes.len()).unwrap_or(u32::MAX));
        PassBuilder::new(self, id, kind, label.into(), side_effect)
    }

    /// Opens a recording-only diagnostic scope.
    pub fn push_debug_group(
        &mut self,
        label: impl Into<String>,
    ) -> Result<DebugGroupId, FrameGraphError> {
        let label = label.into();
        let label = label.trim();
        if label.is_empty() {
            return Err(FrameGraphError::InvalidDebugGroupLabel {
                message: "labels must contain at least one non-whitespace character".into(),
            });
        }
        let id = DebugGroupId::new(u32::try_from(self.debug_groups.len()).map_err(|_| {
            FrameGraphError::InvalidDebugGroupLabel {
                message: "too many debug groups in one frame".into(),
            }
        })?);
        self.debug_groups.push(DebugGroupRecord {
            id,
            parent: self.current_debug_group(),
            label: label.to_owned(),
        });
        self.debug_group_stack.push(id);
        Ok(id)
    }

    /// Closes the innermost recording debug scope.
    pub fn pop_debug_group(&mut self) -> Result<(), FrameGraphError> {
        self.debug_group_stack
            .pop()
            .map(|_| ())
            .ok_or(FrameGraphError::DebugGroupStackUnderflow)
    }

    /// Records work in an error-safe synchronous diagnostic scope.
    pub fn with_debug_group<T>(
        &mut self,
        label: impl Into<String>,
        record: impl FnOnce(&mut Self) -> Result<T, FrameGraphError>,
    ) -> Result<T, FrameGraphError> {
        let depth = self.debug_group_stack.len();
        let group = self.push_debug_group(label)?;
        let result = record(self);
        let balanced = self.debug_group_stack.len() == depth + 1
            && self.debug_group_stack.last().copied() == Some(group);
        self.debug_group_stack.truncate(depth);
        if !balanced && result.is_ok() {
            let label = self.debug_groups[group.get() as usize].label.clone();
            return Err(FrameGraphError::UnclosedDebugGroup { group, label });
        }
        result
    }

    pub(crate) fn current_debug_group(&self) -> Option<DebugGroupId> {
        self.debug_group_stack.last().copied()
    }

    /// Records one aligned zero-fill operation as a graph node.
    ///
    /// The range must be non-empty, within the logical buffer, and aligned to
    /// [`wgpu::COPY_BUFFER_ALIGNMENT`].
    pub fn clear_buffer(
        &mut self,
        label: impl Into<String>,
        buffer: Buffer<'frame>,
        range: BufferRange,
    ) -> Result<PassId, FrameGraphError> {
        self.clear_buffers(label, [ClearBufferOp::new(buffer, range)])
    }

    /// Records one node containing ordered zero-fill operations.
    pub fn clear_buffers(
        &mut self,
        label: impl Into<String>,
        operations: impl IntoIterator<Item = ClearBufferOp<'frame>>,
    ) -> Result<PassId, FrameGraphError> {
        let id = PassId::new(u32::try_from(self.nodes.len()).unwrap_or(u32::MAX));
        let operations = operations.into_iter().collect::<Vec<_>>();
        if operations.is_empty() {
            return Err(FrameGraphError::InvalidNodeOperation {
                pass: id,
                resource: None,
                message: "clear-buffer nodes require at least one operation".into(),
            });
        }
        let mut resolved_operations = Vec::with_capacity(operations.len());
        for operation in &operations {
            self.validate_handle(operation.target.owner, operation.target.recording)?;
            let descriptor = self
                .resource(operation.target.id)?
                .buffer()
                .ok_or_else(|| FrameGraphError::Internal {
                    message: "clear buffer handle resolved to a texture".into(),
                })?;
            let resolved = operation
                .range
                .resolve(operation.target.id, descriptor.size)?;
            let size = resolved.end - resolved.start;
            if size == 0
                || !resolved.start.is_multiple_of(wgpu::COPY_BUFFER_ALIGNMENT)
                || !size.is_multiple_of(wgpu::COPY_BUFFER_ALIGNMENT)
            {
                return Err(FrameGraphError::InvalidNodeOperation {
                    pass: id,
                    resource: Some(operation.target.id),
                    message: "clear range must be non-empty and 4-byte aligned".into(),
                });
            }
            resolved_operations.push(ClearBufferOperation {
                buffer: operation.target.id,
                offset: resolved.start,
                size,
            });
        }
        let mut pass = self.pass(NodeKind::ClearBuffer, label, false);
        for operation in operations {
            let _ = pass.buffer_copy_dst(
                operation.target,
                operation.range,
                crate::WriteContents::Overwrite,
            )?;
        }
        let id = pass.finish()?;
        self.executors
            .insert(id, NodeExecutor::ClearBuffer(resolved_operations));
        Ok(id)
    }

    /// Marks a buffer range as observable after graph execution.
    ///
    /// The selected range must contain defined data after retained work.
    /// `Present` is invalid for buffers; `Readback` and `PersistentState` impose
    /// stricter imported-resource usage contracts.
    pub fn mark_buffer_root(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
        reason: RootReason,
    ) -> Result<(), FrameGraphError> {
        self.validate_handle(buffer.owner, buffer.recording)?;
        let resource = self.resource(buffer.id)?;
        validate_root(resource, reason)?;
        let desc = resource.buffer().ok_or_else(|| FrameGraphError::Internal {
            message: "buffer handle resolved to a texture".into(),
        })?;
        self.roots.push(RootRecord {
            resource: buffer.id,
            reason,
            range: NormalizedRange::Buffer(range.resolve(buffer.id, desc.size)?),
        });
        Ok(())
    }

    /// Marks a texture or view range as observable after graph execution.
    ///
    /// Present roots accept only surface textures; persistent-state roots accept
    /// only imported resources. The selected range must end with defined contents.
    pub fn mark_texture_root(
        &mut self,
        target: impl Into<TextureTarget<'frame>>,
        reason: RootReason,
    ) -> Result<(), FrameGraphError> {
        let target = target.into();
        let (resource, range) = self.texture_target_range(target, false)?;
        validate_root(self.resource(resource)?, reason)?;
        self.roots.push(RootRecord {
            resource,
            reason,
            range,
        });
        Ok(())
    }

    /// Marks an entire surface texture as the frame's presentation output.
    pub fn mark_present(&mut self, texture: Texture<'frame>) -> Result<(), FrameGraphError> {
        self.mark_texture_root(texture, RootReason::Present)
    }

    /// Marks an imported `MAP_READ | COPY_DST` buffer range for caller readback.
    pub fn mark_readback(
        &mut self,
        buffer: Buffer<'frame>,
        range: BufferRange,
    ) -> Result<(), FrameGraphError> {
        self.mark_buffer_root(buffer, range, RootReason::Readback)
    }

    /// Consumes this recording and builds a validated execution plan.
    ///
    /// Compilation derives dependencies and usages, removes work unreachable
    /// from roots or side effects, validates the content model, assigns compatible
    /// non-overlapping transients to physical allocations, and optionally creates
    /// a report. No GPU commands are encoded. Recording errors such as an
    /// unfinished pass or debug group are returned here.
    pub fn compile(
        self,
        options: CompileOptions,
    ) -> Result<CompiledFrame<'frame>, FrameGraphError> {
        if let Some(error) = self.recording_error {
            return Err(error);
        }
        if let Some(group) = self.debug_group_stack.last().copied() {
            let label = self.debug_groups[group.get() as usize].label.clone();
            return Err(FrameGraphError::UnclosedDebugGroup { group, label });
        }
        compiler::compile(self, options)
    }

    pub(crate) fn resource(&self, id: ResourceId) -> Result<&ResourceRecord, FrameGraphError> {
        self.resources
            .get(id.get() as usize)
            .filter(|resource| resource.id == id)
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("unknown resource id {id}"),
            })
    }

    pub(crate) fn view(&self, id: ViewId) -> Result<&ViewRecord, FrameGraphError> {
        self.views
            .get(id.get() as usize)
            .filter(|view| view.id == id)
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("unknown texture view id {id}"),
            })
    }

    pub(crate) fn validate_handle(
        &self,
        owner: u64,
        recording: u64,
    ) -> Result<(), FrameGraphError> {
        if owner != self.owner || recording != self.recording {
            return Err(FrameGraphError::ForeignHandle {
                expected_owner: self.owner,
                expected_recording: self.recording,
                actual_owner: owner,
                actual_recording: recording,
            });
        }
        Ok(())
    }

    pub(crate) fn texture_target_range(
        &self,
        target: TextureTarget<'frame>,
        attachment: bool,
    ) -> Result<(ResourceId, NormalizedRange), FrameGraphError> {
        match target {
            TextureTarget::Texture(texture) => {
                self.validate_handle(texture.owner, texture.recording)?;
                let desc = self.resource(texture.id)?.texture().ok_or_else(|| {
                    FrameGraphError::Internal {
                        message: "texture handle resolved to a buffer".into(),
                    }
                })?;
                let mut range = full_texture_range(desc);
                if attachment {
                    let region =
                        range
                            .first_mut()
                            .ok_or_else(|| FrameGraphError::InvalidTextureView {
                                resource: texture.id,
                                message: "attachment has no subresources".into(),
                            })?;
                    region.slice_count = 1;
                    range.truncate(1);
                }
                Ok((texture.id, NormalizedRange::Texture(range)))
            }
            TextureTarget::View(view) => {
                self.validate_handle(view.owner, view.recording)?;
                let record = self
                    .views
                    .get(view.id.get() as usize)
                    .filter(|entry| entry.id == view.id)
                    .ok_or_else(|| FrameGraphError::Internal {
                        message: format!("unknown texture view id {}", view.id),
                    })?;
                if attachment {
                    match &record.range {
                        NormalizedRange::Texture(regions)
                            if regions.len() != 1 || regions[0].slice_count != 1 =>
                        {
                            return Err(FrameGraphError::InvalidTextureView {
                                resource: record.texture,
                                message: "attachments require exactly one mip and one slice".into(),
                            });
                        }
                        _ => {}
                    }
                }
                Ok((record.texture, record.range.clone()))
            }
        }
    }

    fn next_resource_id(&self) -> Result<ResourceId, FrameGraphError> {
        Ok(ResourceId::new(
            u32::try_from(self.resources.len()).map_err(|_| {
                FrameGraphError::InvalidResourceDescriptor {
                    message: "too many resources in one frame".into(),
                }
            })?,
        ))
    }

    fn ensure_unique_native(
        &self,
        candidate: &NativeResource,
        resource: ResourceId,
    ) -> Result<(), FrameGraphError> {
        if let Some((existing, _)) = self
            .native_resources
            .iter()
            .find(|(existing, native)| **existing != resource && native.same_object(candidate))
        {
            return Err(FrameGraphError::NativeDescriptorMismatch {
                resource,
                message: format!(
                    "the native resource is already bound to logical resource {existing}"
                ),
            });
        }
        Ok(())
    }
}

fn validate_root(resource: &ResourceRecord, reason: RootReason) -> Result<(), FrameGraphError> {
    let invalid = |message: &str| FrameGraphError::InvalidRoot {
        resource: resource.id,
        reason,
        message: message.into(),
    };
    match reason {
        RootReason::Present => {
            if resource.kind() != crate::ResourceKind::Texture {
                return Err(invalid("present roots require a texture"));
            }
            if resource.origin != ResourceOrigin::Surface {
                return Err(invalid("present roots require a surface resource"));
            }
        }
        RootReason::Readback => {
            if resource.kind() != crate::ResourceKind::Buffer {
                return Err(invalid("readback roots require a buffer"));
            }
            if resource.origin != ResourceOrigin::Imported {
                return Err(invalid("readback roots require an imported buffer"));
            }
            let expected = wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST;
            if resource.exposed_buffer_usage != Some(expected) {
                return Err(invalid(
                    "readback buffers must expose exactly MAP_READ | COPY_DST",
                ));
            }
        }
        RootReason::PersistentState if resource.origin != ResourceOrigin::Imported => {
            return Err(invalid(
                "persistent-state roots require an imported resource",
            ));
        }
        RootReason::Output | RootReason::DebugCapture | RootReason::PersistentState => {}
    }
    Ok(())
}

pub(crate) fn validate_texture_desc(desc: &TextureDesc) -> Result<(), FrameGraphError> {
    let size = desc.size;
    if size.width == 0 || size.height == 0 || size.depth_or_array_layers == 0 {
        return Err(FrameGraphError::InvalidResourceDescriptor {
            message: format!("texture {} has a zero extent", desc.label),
        });
    }
    if desc.mip_level_count == 0 {
        return Err(FrameGraphError::InvalidResourceDescriptor {
            message: format!("texture {} has zero mip levels", desc.label),
        });
    }
    let largest = match desc.dimension {
        wgpu::TextureDimension::D1 => size.width,
        wgpu::TextureDimension::D2 => size.width.max(size.height),
        wgpu::TextureDimension::D3 => size.width.max(size.height).max(size.depth_or_array_layers),
    };
    let max_mips = u32::BITS - largest.leading_zeros();
    if desc.mip_level_count > max_mips {
        return Err(FrameGraphError::InvalidResourceDescriptor {
            message: format!(
                "texture {} has {} mips, maximum for its extent is {max_mips}",
                desc.label, desc.mip_level_count
            ),
        });
    }
    if !matches!(desc.sample_count, 1 | 4) {
        return Err(FrameGraphError::InvalidResourceDescriptor {
            message: format!("texture {} sample count must be 1 or 4", desc.label),
        });
    }
    if desc.sample_count > 1
        && (desc.dimension != wgpu::TextureDimension::D2 || desc.mip_level_count != 1)
    {
        return Err(FrameGraphError::InvalidResourceDescriptor {
            message: format!(
                "multisampled texture {} must be 2D with one mip",
                desc.label
            ),
        });
    }
    if desc.dimension == wgpu::TextureDimension::D1
        && (size.height != 1 || size.depth_or_array_layers != 1)
    {
        return Err(FrameGraphError::InvalidResourceDescriptor {
            message: format!(
                "1D texture {} must have height and depth equal to 1",
                desc.label
            ),
        });
    }
    if desc.format.has_stencil_aspect() {
        return Err(FrameGraphError::InvalidResourceDescriptor {
            message: format!("stencil formats are not supported in v0.1 ({})", desc.label),
        });
    }
    Ok(())
}

fn normalize_view(
    resource: ResourceId,
    texture: &TextureDesc,
    view: &TextureViewDesc,
) -> Result<NormalizedRange, FrameGraphError> {
    let format = view.format.unwrap_or(texture.format);
    if format != texture.format && !texture.view_formats.contains(&format) {
        return Err(FrameGraphError::InvalidTextureView {
            resource,
            message: format!("format {format:?} is not in view_formats"),
        });
    }
    let mip_count = view
        .mip_level_count
        .unwrap_or_else(|| texture.mip_level_count.saturating_sub(view.base_mip_level));
    let mip_end = view.base_mip_level.checked_add(mip_count).ok_or_else(|| {
        FrameGraphError::InvalidTextureView {
            resource,
            message: "mip range overflow".into(),
        }
    })?;
    if mip_count == 0 || mip_end > texture.mip_level_count {
        return Err(FrameGraphError::InvalidTextureView {
            resource,
            message: "mip range is empty or outside the texture".into(),
        });
    }
    if texture.format.has_depth_aspect() {
        if !matches!(
            view.aspect,
            wgpu::TextureAspect::All | wgpu::TextureAspect::DepthOnly
        ) {
            return Err(FrameGraphError::InvalidTextureView {
                resource,
                message: "depth textures require All or DepthOnly aspect".into(),
            });
        }
    } else if view.aspect != wgpu::TextureAspect::All {
        return Err(FrameGraphError::InvalidTextureView {
            resource,
            message: "color textures require the All aspect".into(),
        });
    }

    validate_view_dimension(resource, texture, view, mip_count)?;

    let mut ranges = Vec::with_capacity(mip_count as usize);
    for mip in view.base_mip_level..mip_end {
        let total_slices = slices_at_mip(texture, mip);
        let (base_slice, slice_count) = if texture.dimension == wgpu::TextureDimension::D3 {
            (0, total_slices)
        } else {
            let count = view
                .array_layer_count
                .unwrap_or_else(|| total_slices.saturating_sub(view.base_array_layer));
            (view.base_array_layer, count)
        };
        if slice_count == 0 || base_slice.saturating_add(slice_count) > total_slices {
            return Err(FrameGraphError::InvalidTextureView {
                resource,
                message: format!("slice range is outside mip {mip}"),
            });
        }
        ranges.push(TextureSubresourceRange {
            base_mip_level: mip,
            mip_level_count: 1,
            base_slice,
            slice_count,
            aspect: if texture.format.has_depth_aspect() {
                wgpu::TextureAspect::DepthOnly
            } else {
                wgpu::TextureAspect::All
            },
        });
    }
    Ok(NormalizedRange::Texture(ranges))
}

fn validate_view_dimension(
    resource: ResourceId,
    texture: &TextureDesc,
    view: &TextureViewDesc,
    mip_count: u32,
) -> Result<(), FrameGraphError> {
    let Some(dimension) = view.dimension else {
        return Ok(());
    };
    let fail = |message: &str| {
        Err(FrameGraphError::InvalidTextureView {
            resource,
            message: message.into(),
        })
    };
    match dimension {
        wgpu::TextureViewDimension::D1 => {
            if texture.dimension != wgpu::TextureDimension::D1 {
                return fail("D1 views require a D1 texture");
            }
        }
        wgpu::TextureViewDimension::D2 => {
            if texture.dimension != wgpu::TextureDimension::D2
                || view.array_layer_count.unwrap_or(1) != 1
            {
                return fail("D2 views require a D2 texture and one array layer");
            }
        }
        wgpu::TextureViewDimension::D2Array => {
            if texture.dimension != wgpu::TextureDimension::D2 {
                return fail("D2Array views require a D2 texture");
            }
        }
        wgpu::TextureViewDimension::Cube | wgpu::TextureViewDimension::CubeArray => {
            if texture.dimension != wgpu::TextureDimension::D2
                || texture.size.width != texture.size.height
                || texture.sample_count != 1
                || mip_count == 0
            {
                return fail("cube views require a square, single-sampled D2 texture");
            }
            let layers = view.array_layer_count.unwrap_or_else(|| {
                texture
                    .size
                    .depth_or_array_layers
                    .saturating_sub(view.base_array_layer)
            });
            if (dimension == wgpu::TextureViewDimension::Cube && layers != 6)
                || (dimension == wgpu::TextureViewDimension::CubeArray
                    && (layers == 0 || !layers.is_multiple_of(6)))
            {
                return fail(
                    "cube views require six layers; cube arrays require a multiple of six",
                );
            }
        }
        wgpu::TextureViewDimension::D3 => {
            if texture.dimension != wgpu::TextureDimension::D3
                || view.base_array_layer != 0
                || view.array_layer_count.is_some()
            {
                return fail("D3 views require a D3 texture without array-layer selection");
            }
        }
    }
    Ok(())
}

pub(crate) fn full_texture_range(desc: &TextureDesc) -> Vec<TextureSubresourceRange> {
    (0..desc.mip_level_count)
        .map(|mip| TextureSubresourceRange {
            base_mip_level: mip,
            mip_level_count: 1,
            base_slice: 0,
            slice_count: slices_at_mip(desc, mip),
            aspect: if desc.format.has_depth_aspect() {
                wgpu::TextureAspect::DepthOnly
            } else {
                wgpu::TextureAspect::All
            },
        })
        .collect()
}

pub(crate) fn slices_at_mip(desc: &TextureDesc, mip: u32) -> u32 {
    if desc.dimension == wgpu::TextureDimension::D3 {
        (desc.size.depth_or_array_layers >> mip).max(1)
    } else {
        desc.size.depth_or_array_layers
    }
}
