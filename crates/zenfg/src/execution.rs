use std::collections::HashMap;

use crate::{
    AccessId, AccessToken, BufferAccessMarker, ColorAttachmentOps, DebugGroupId,
    DepthAttachmentOps, ExecutionOptions, ExecutionSegmentKind, FrameGraphError, NodeKind, PassId,
    ResourceId, ResourceOrigin, ResourceUsage, TextureAccessMarker,
    compiler::{CompiledFrame, PhysicalAllocationPlan, allocation_key_and_bytes},
    gpu_timing::{ActiveGpuTiming, TimingSetup},
    model::{AccessRecord, NodeRecord, ResourceRecord},
    resource_pool::TransientResourceLease,
};

#[derive(Clone, Debug)]
pub(crate) enum NativeResource {
    Buffer(wgpu::Buffer),
    Texture(wgpu::Texture),
}

impl NativeResource {
    pub(crate) fn same_object(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Buffer(left), Self::Buffer(right)) => left == right,
            (Self::Texture(left), Self::Texture(right)) => left == right,
            _ => false,
        }
    }

    pub(crate) fn destroy(self) {
        match self {
            Self::Buffer(buffer) => buffer.destroy(),
            Self::Texture(texture) => texture.destroy(),
        }
    }
}

pub(crate) type CommandCallback<'frame> =
    Box<dyn for<'execute> FnOnce(CommandContext<'execute>) -> Result<(), FrameGraphError> + 'frame>;
pub(crate) type ExternalCallback<'frame> = Box<
    dyn for<'execute> FnOnce(ExternalSubmissionContext<'execute>) -> Result<(), FrameGraphError>
        + 'frame,
>;

pub(crate) type RenderCallback<'frame> = Box<
    dyn for<'execute> FnOnce(RenderPassContext<'execute>) -> Result<(), FrameGraphError> + 'frame,
>;
pub(crate) type ComputeCallback<'frame> = Box<
    dyn for<'execute> FnOnce(ComputePassContext<'execute>) -> Result<(), FrameGraphError> + 'frame,
>;

#[derive(Clone, Copy, Debug)]
pub(crate) struct RenderColorAttachment {
    pub(crate) access: AccessId,
    pub(crate) resolve_access: Option<AccessId>,
    pub(crate) ops: ColorAttachmentOps,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct RenderDepthAttachment {
    pub(crate) access: AccessId,
    pub(crate) ops: Option<DepthAttachmentOps>,
    pub(crate) read_only: bool,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct TextureCopyLocationRecord {
    pub(crate) resource: ResourceId,
    pub(crate) mip_level: u32,
    pub(crate) origin: wgpu::Origin3d,
    pub(crate) aspect: wgpu::TextureAspect,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum CopyOperation {
    BufferToBuffer {
        source: ResourceId,
        source_offset: u64,
        destination: ResourceId,
        destination_offset: u64,
        size: u64,
    },
    BufferToTexture {
        source: ResourceId,
        source_layout: wgpu::TexelCopyBufferLayout,
        destination: TextureCopyLocationRecord,
        copy_size: wgpu::Extent3d,
    },
    TextureToBuffer {
        source: TextureCopyLocationRecord,
        destination: ResourceId,
        destination_layout: wgpu::TexelCopyBufferLayout,
        copy_size: wgpu::Extent3d,
    },
    TextureToTexture {
        source: TextureCopyLocationRecord,
        destination: TextureCopyLocationRecord,
        copy_size: wgpu::Extent3d,
    },
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ClearBufferOperation {
    pub(crate) buffer: ResourceId,
    pub(crate) offset: u64,
    pub(crate) size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ExecutionTextureViewDescriptor {
    pub(crate) label: String,
    pub(crate) format: wgpu::TextureFormat,
    pub(crate) dimension: wgpu::TextureViewDimension,
    pub(crate) usage: wgpu::TextureUsages,
    pub(crate) aspect: wgpu::TextureAspect,
    pub(crate) base_mip_level: u32,
    pub(crate) mip_level_count: u32,
    pub(crate) base_array_layer: u32,
    pub(crate) array_layer_count: Option<u32>,
}

#[derive(Clone, Debug)]
pub(crate) struct ExecutionViewPlan {
    pub(crate) resource: ResourceId,
    pub(crate) descriptor: ExecutionTextureViewDescriptor,
    pub(crate) accesses: Vec<AccessId>,
}

pub(crate) enum NodeExecutor<'frame> {
    Render {
        color_attachments: Vec<RenderColorAttachment>,
        depth_attachment: Option<RenderDepthAttachment>,
        callback: RenderCallback<'frame>,
    },
    Compute(ComputeCallback<'frame>),
    Copy(Vec<CopyOperation>),
    ClearBuffer(Vec<ClearBufferOperation>),
    Command(CommandCallback<'frame>),
    External(ExternalCallback<'frame>),
}

pub struct RenderPassContext<'execute> {
    pub device: &'execute wgpu::Device,
    pub pass: wgpu::RenderPass<'execute>,
    pub resources: ExecutionResources<'execute>,
    pub frame_index: u64,
}

pub struct ComputePassContext<'execute> {
    pub device: &'execute wgpu::Device,
    pub pass: wgpu::ComputePass<'execute>,
    pub resources: ExecutionResources<'execute>,
    pub frame_index: u64,
}

pub struct CommandContext<'execute> {
    pub device: &'execute wgpu::Device,
    pub encoder: &'execute mut wgpu::CommandEncoder,
    pub resources: ExecutionResources<'execute>,
    pub frame_index: u64,
}

pub struct ExternalSubmissionContext<'execute> {
    pub device: &'execute wgpu::Device,
    pub queue: &'execute wgpu::Queue,
    pub resources: ExecutionResources<'execute>,
    pub frame_index: u64,
}

#[derive(Clone, Copy)]
pub struct ExecutionResources<'execute> {
    pass: PassId,
    accesses: &'execute HashMap<AccessId, AccessRecord>,
    native: &'execute HashMap<ResourceId, NativeResource>,
    views: &'execute HashMap<AccessId, wgpu::TextureView>,
}

impl<'execute> ExecutionResources<'execute> {
    pub fn buffer<Role: BufferAccessMarker>(
        &self,
        token: AccessToken<'_, Role>,
    ) -> Result<&'execute wgpu::Buffer, FrameGraphError> {
        let access =
            self.validate_token(token.pass_id(), token.access_id(), token.resource_id())?;
        match self.native.get(&access.resource) {
            Some(NativeResource::Buffer(buffer)) => Ok(buffer),
            Some(NativeResource::Texture(_)) => Err(FrameGraphError::Internal {
                message: format!("buffer access {} resolved to a texture", access.id),
            }),
            None => Err(FrameGraphError::MissingNativeBinding {
                resource: access.resource,
            }),
        }
    }

    pub fn texture<Role: TextureAccessMarker>(
        &self,
        token: AccessToken<'_, Role>,
    ) -> Result<&'execute wgpu::Texture, FrameGraphError> {
        let access =
            self.validate_token(token.pass_id(), token.access_id(), token.resource_id())?;
        match self.native.get(&access.resource) {
            Some(NativeResource::Texture(texture)) => Ok(texture),
            Some(NativeResource::Buffer(_)) => Err(FrameGraphError::Internal {
                message: format!("texture access {} resolved to a buffer", access.id),
            }),
            None => Err(FrameGraphError::MissingNativeBinding {
                resource: access.resource,
            }),
        }
    }

    pub fn texture_view<Role: TextureAccessMarker>(
        &self,
        token: AccessToken<'_, Role>,
    ) -> Result<&'execute wgpu::TextureView, FrameGraphError> {
        let access =
            self.validate_token(token.pass_id(), token.access_id(), token.resource_id())?;
        self.views
            .get(&access.id)
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("texture access {} has no execution view", access.id),
            })
    }

    fn validate_token(
        &self,
        token_pass: PassId,
        access_id: AccessId,
        resource: ResourceId,
    ) -> Result<&'execute AccessRecord, FrameGraphError> {
        if token_pass != self.pass {
            return Err(FrameGraphError::WrongPassToken {
                executing_pass: self.pass,
                token_pass,
            });
        }
        let access = self
            .accesses
            .get(&access_id)
            .filter(|access| access.pass == token_pass && access.resource == resource)
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("unknown access token {access_id} for pass {token_pass}"),
            })?;
        Ok(access)
    }
}

pub(crate) fn execute(
    frame: CompiledFrame<'_>,
    queue: &wgpu::Queue,
    options: ExecutionOptions,
) -> Result<(), FrameGraphError> {
    execute_internal(frame, queue, options, false).map(|_| ())
}

pub(crate) fn execute_with_gpu_timing(
    frame: CompiledFrame<'_>,
    queue: &wgpu::Queue,
    options: ExecutionOptions,
) -> Result<crate::GpuTimingReadback, FrameGraphError> {
    execute_internal(frame, queue, options, true)?.ok_or_else(|| FrameGraphError::Internal {
        message: "timed execution completed without a GPU timing readback".into(),
    })
}

fn execute_internal(
    frame: CompiledFrame<'_>,
    queue: &wgpu::Queue,
    options: ExecutionOptions,
    gpu_timing: bool,
) -> Result<Option<crate::GpuTimingReadback>, FrameGraphError> {
    let CompiledFrame {
        graph,
        plan,
        report: _,
        resources,
        native_resources,
        mut executors,
    } = frame;
    let device = graph
        .device
        .clone()
        .ok_or(FrameGraphError::MissingGpuDevice)?;

    preflight(
        &plan.retained_nodes,
        &plan.usages,
        &plan.physical_allocations,
        &resources,
        &native_resources,
        &executors,
    )?;

    let (mut active_timing, immediate_readback) = if gpu_timing {
        match graph.gpu_profiler.prepare(
            &device,
            queue,
            options.frame_index,
            &plan.retained_nodes,
            &plan.debug_groups,
        ) {
            TimingSetup::Immediate(readback) => (None, Some(readback)),
            TimingSetup::Active(timing) => (Some(timing), None),
        }
    } else {
        (None, None)
    };
    let timing_resolve_segment = active_timing.as_ref().and_then(|_| {
        plan.execution_segments
            .iter()
            .rposition(|segment| segment.kind == ExecutionSegmentKind::FrameGraph)
    });

    let resources_by_id = resources
        .iter()
        .map(|resource| (resource.id, resource))
        .collect::<HashMap<_, _>>();
    let mut transient_lease = TransientResourceLease::new(&mut graph.resource_pool);
    let mut execution_native = native_resources;
    for allocation in &plan.physical_allocations {
        let representative = allocation
            .resource_ids
            .first()
            .and_then(|resource| resources_by_id.get(resource).copied())
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("allocation {} has no logical resources", allocation.id),
            })?;
        let native = transient_lease.acquire(
            &device,
            &allocation.key,
            representative.label(),
            allocation.estimated_byte_size,
        );
        for resource in &allocation.resource_ids {
            execution_native.insert(*resource, native.clone());
        }
    }

    let access_map = plan
        .retained_nodes
        .iter()
        .flat_map(|node| node.accesses.iter().cloned())
        .map(|access| (access.id, access))
        .collect::<HashMap<_, _>>();
    let execution_views = create_execution_views(&plan.execution_views, &execution_native)?;
    let node_map = plan
        .retained_nodes
        .iter()
        .map(|node| (node.id, node))
        .collect::<HashMap<_, _>>();

    for (segment_index, segment) in plan.execution_segments.iter().enumerate() {
        match segment.kind {
            ExecutionSegmentKind::FrameGraph => {
                let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some(&format!("frame-graph.segment.{segment_index}")),
                });
                let mut open_debug_groups = Vec::new();
                for pass in &segment.nodes {
                    let node =
                        node_map
                            .get(pass)
                            .copied()
                            .ok_or_else(|| FrameGraphError::Internal {
                                message: format!(
                                    "execution segment references unknown pass {pass}"
                                ),
                            })?;
                    if options.gpu_debug_groups {
                        transition_debug_groups(
                            &mut encoder,
                            &mut open_debug_groups,
                            node.debug_group,
                            &plan.debug_groups,
                        )?;
                    }
                    let executor =
                        executors
                            .remove(pass)
                            .ok_or(FrameGraphError::MissingNodeExecutor {
                                pass: *pass,
                                expected: executor_name(node.kind),
                            })?;
                    let resources = ExecutionResources {
                        pass: *pass,
                        accesses: &access_map,
                        native: &execution_native,
                        views: &execution_views,
                    };
                    match (node.kind, executor) {
                        (
                            NodeKind::Render,
                            NodeExecutor::Render {
                                color_attachments,
                                depth_attachment,
                                callback,
                            },
                        ) => {
                            let colors = color_attachments
                                .iter()
                                .map(|attachment| {
                                    Ok(Some(wgpu::RenderPassColorAttachment {
                                        view: execution_views.get(&attachment.access).ok_or_else(
                                            || FrameGraphError::Internal {
                                                message: format!(
                                                    "render attachment {} has no execution view",
                                                    attachment.access
                                                ),
                                            },
                                        )?,
                                        resolve_target: attachment
                                            .resolve_access
                                            .map(|access| {
                                                execution_views.get(&access).ok_or_else(|| {
                                                    FrameGraphError::Internal {
                                                        message: format!(
                                                            "resolve attachment {access} has no execution view"
                                                        ),
                                                    }
                                                })
                                            })
                                            .transpose()?,
                                        depth_slice: attachment.ops.depth_slice,
                                        ops: wgpu::Operations {
                                            load: color_load_op(attachment.ops.load),
                                            store: store_op(attachment.ops.store),
                                        },
                                    }))
                                })
                                .collect::<Result<Vec<_>, FrameGraphError>>()?;
                            let depth = depth_attachment
                                .map(|attachment| {
                                    Ok(wgpu::RenderPassDepthStencilAttachment {
                                        view: execution_views.get(&attachment.access).ok_or_else(
                                            || FrameGraphError::Internal {
                                                message: format!(
                                                    "depth attachment {} has no execution view",
                                                    attachment.access
                                                ),
                                            },
                                        )?,
                                        depth_ops: attachment.ops.map(|ops| wgpu::Operations {
                                            load: depth_load_op(ops.load),
                                            store: store_op(ops.store),
                                        }),
                                        stencil_ops: None,
                                    })
                                })
                                .transpose()?;
                            let timestamp_writes =
                                timestamp_indices(&active_timing, *pass).map(|(begin, end)| {
                                    wgpu::RenderPassTimestampWrites {
                                        query_set: active_timing.as_ref().unwrap().query_set(),
                                        beginning_of_pass_write_index: Some(begin),
                                        end_of_pass_write_index: Some(end),
                                    }
                                });
                            let render_pass =
                                encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                                    label: Some(&node.label),
                                    color_attachments: &colors,
                                    depth_stencil_attachment: depth,
                                    timestamp_writes,
                                    occlusion_query_set: None,
                                    multiview_mask: None,
                                });
                            callback(RenderPassContext {
                                device: &device,
                                pass: render_pass,
                                resources,
                                frame_index: options.frame_index,
                            })?;
                        }
                        (NodeKind::Compute, NodeExecutor::Compute(callback)) => {
                            let timestamp_writes =
                                timestamp_indices(&active_timing, *pass).map(|(begin, end)| {
                                    wgpu::ComputePassTimestampWrites {
                                        query_set: active_timing.as_ref().unwrap().query_set(),
                                        beginning_of_pass_write_index: Some(begin),
                                        end_of_pass_write_index: Some(end),
                                    }
                                });
                            let compute_pass =
                                encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                                    label: Some(&node.label),
                                    timestamp_writes,
                                });
                            callback(ComputePassContext {
                                device: &device,
                                pass: compute_pass,
                                resources,
                                frame_index: options.frame_index,
                            })?;
                        }
                        (NodeKind::Copy, NodeExecutor::Copy(operations)) => {
                            for operation in &operations {
                                encode_copy_operation(&mut encoder, operation, &execution_native)?;
                            }
                        }
                        (NodeKind::ClearBuffer, NodeExecutor::ClearBuffer(operations)) => {
                            for operation in operations {
                                let buffer = native_buffer(&execution_native, operation.buffer)?;
                                encoder.clear_buffer(
                                    buffer,
                                    operation.offset,
                                    Some(operation.size),
                                );
                            }
                        }
                        (NodeKind::Command, NodeExecutor::Command(callback)) => {
                            callback(CommandContext {
                                device: &device,
                                encoder: &mut encoder,
                                resources,
                                frame_index: options.frame_index,
                            })?;
                        }
                        _ => {
                            return Err(FrameGraphError::InvalidNodeExecutor {
                                pass: *pass,
                                expected: executor_name(node.kind),
                                actual: node.kind,
                            });
                        }
                    }
                }
                while open_debug_groups.pop().is_some() {
                    encoder.pop_debug_group();
                }
                if timing_resolve_segment == Some(segment_index) {
                    active_timing
                        .as_ref()
                        .expect("timing resolve segment requires an active timing session")
                        .encode_resolve(&mut encoder);
                }
                queue.submit(Some(encoder.finish()));
            }
            ExecutionSegmentKind::ExternalSubmission => {
                let pass = *segment
                    .nodes
                    .first()
                    .ok_or_else(|| FrameGraphError::Internal {
                        message: "external execution segment has no pass".into(),
                    })?;
                let node =
                    node_map
                        .get(&pass)
                        .copied()
                        .ok_or_else(|| FrameGraphError::Internal {
                            message: format!("execution segment references unknown pass {pass}"),
                        })?;
                let executor =
                    executors
                        .remove(&pass)
                        .ok_or(FrameGraphError::MissingNodeExecutor {
                            pass,
                            expected: "external-submission",
                        })?;
                let NodeExecutor::External(callback) = executor else {
                    return Err(FrameGraphError::InvalidNodeExecutor {
                        pass,
                        expected: "external-submission",
                        actual: node.kind,
                    });
                };
                callback(ExternalSubmissionContext {
                    device: &device,
                    queue,
                    resources: ExecutionResources {
                        pass,
                        accesses: &access_map,
                        native: &execution_native,
                        views: &execution_views,
                    },
                    frame_index: options.frame_index,
                })?;
            }
        }
    }
    if let Some(mut timing) = active_timing.take() {
        timing.begin_readback();
        return Ok(Some(timing.take_readback()));
    }
    Ok(immediate_readback)
}

fn timestamp_indices(timing: &Option<Box<ActiveGpuTiming>>, pass: PassId) -> Option<(u32, u32)> {
    timing
        .as_ref()
        .and_then(|timing| timing.query_indices(pass))
}

fn transition_debug_groups(
    encoder: &mut wgpu::CommandEncoder,
    open: &mut Vec<DebugGroupId>,
    target: Option<DebugGroupId>,
    groups: &[crate::model::DebugGroupRecord],
) -> Result<(), FrameGraphError> {
    let target_path = debug_group_path(target, groups)?;
    let common = open
        .iter()
        .zip(&target_path)
        .take_while(|(left, right)| left == right)
        .count();
    while open.len() > common {
        encoder.pop_debug_group();
        open.pop();
    }
    for group in &target_path[common..] {
        let record = groups
            .get(group.get() as usize)
            .filter(|record| record.id == *group)
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("unknown debug group {group}"),
            })?;
        encoder.push_debug_group(&record.label);
        open.push(*group);
    }
    Ok(())
}

fn debug_group_path(
    mut group: Option<DebugGroupId>,
    groups: &[crate::model::DebugGroupRecord],
) -> Result<Vec<DebugGroupId>, FrameGraphError> {
    let mut path = Vec::new();
    while let Some(id) = group {
        let record = groups
            .get(id.get() as usize)
            .filter(|record| record.id == id)
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("unknown debug group {id}"),
            })?;
        path.push(id);
        group = record.parent;
    }
    path.reverse();
    Ok(path)
}

fn preflight(
    nodes: &[NodeRecord],
    usages: &HashMap<ResourceId, ResourceUsage>,
    allocations: &[PhysicalAllocationPlan],
    resources: &[ResourceRecord],
    native: &HashMap<ResourceId, NativeResource>,
    executors: &HashMap<PassId, NodeExecutor<'_>>,
) -> Result<(), FrameGraphError> {
    let resources_by_id = resources
        .iter()
        .map(|resource| (resource.id, resource))
        .collect::<HashMap<_, _>>();
    let mut allocation_by_resource = HashMap::new();
    for allocation in allocations {
        if allocation.resource_ids.is_empty() {
            return Err(FrameGraphError::Internal {
                message: format!("allocation {} has no logical resources", allocation.id),
            });
        }
        for resource_id in &allocation.resource_ids {
            let resource = resources_by_id.get(resource_id).copied().ok_or_else(|| {
                FrameGraphError::Internal {
                    message: format!(
                        "allocation {} references unknown resource {resource_id}",
                        allocation.id
                    ),
                }
            })?;
            if resource.origin != ResourceOrigin::Transient {
                return Err(FrameGraphError::Internal {
                    message: format!(
                        "allocation {} references non-transient resource {resource_id}",
                        allocation.id
                    ),
                });
            }
            let usage =
                usages
                    .get(resource_id)
                    .copied()
                    .ok_or_else(|| FrameGraphError::Internal {
                        message: format!("transient resource {resource_id} has no effective usage"),
                    })?;
            let (expected_key, expected_bytes) = allocation_key_and_bytes(resource, usage)?;
            if expected_key != allocation.key
                || expected_bytes != allocation.estimated_byte_size
                || allocation_by_resource
                    .insert(*resource_id, allocation.id)
                    .is_some()
            {
                return Err(FrameGraphError::Internal {
                    message: format!(
                        "allocation {} is incompatible with transient resource {resource_id}",
                        allocation.id
                    ),
                });
            }
        }
    }
    for node in nodes {
        match node.kind {
            NodeKind::Command => match executors.get(&node.id) {
                Some(NodeExecutor::Command(_)) => {}
                Some(_) => {
                    return Err(FrameGraphError::InvalidNodeExecutor {
                        pass: node.id,
                        expected: "command",
                        actual: node.kind,
                    });
                }
                None => {
                    return Err(FrameGraphError::MissingNodeExecutor {
                        pass: node.id,
                        expected: "command",
                    });
                }
            },
            NodeKind::ExternalSubmission => match executors.get(&node.id) {
                Some(NodeExecutor::External(_)) => {}
                Some(_) => {
                    return Err(FrameGraphError::InvalidNodeExecutor {
                        pass: node.id,
                        expected: "external-submission",
                        actual: node.kind,
                    });
                }
                None => {
                    return Err(FrameGraphError::MissingNodeExecutor {
                        pass: node.id,
                        expected: "external-submission",
                    });
                }
            },
            NodeKind::Render => match executors.get(&node.id) {
                Some(NodeExecutor::Render { .. }) => {}
                Some(_) => return invalid_executor(node, "render"),
                None => return missing_executor(node, "render"),
            },
            NodeKind::Compute => match executors.get(&node.id) {
                Some(NodeExecutor::Compute(_)) => {}
                Some(_) => return invalid_executor(node, "compute"),
                None => return missing_executor(node, "compute"),
            },
            NodeKind::Copy => match executors.get(&node.id) {
                Some(NodeExecutor::Copy(operations)) if !operations.is_empty() => {}
                Some(NodeExecutor::Copy(_)) | None => {
                    return missing_executor(node, "copy operations");
                }
                Some(_) => return invalid_executor(node, "copy operations"),
            },
            NodeKind::ClearBuffer => match executors.get(&node.id) {
                Some(NodeExecutor::ClearBuffer(operations)) if !operations.is_empty() => {}
                Some(NodeExecutor::ClearBuffer(_)) | None => {
                    return missing_executor(node, "clear-buffer operations");
                }
                Some(_) => return invalid_executor(node, "clear-buffer operation"),
            },
        }

        for access in &node.accesses {
            let resource = resources_by_id
                .get(&access.resource)
                .copied()
                .ok_or_else(|| FrameGraphError::Internal {
                    message: format!(
                        "pass {} references unknown resource {}",
                        node.id, access.resource
                    ),
                })?;
            if resource.origin == ResourceOrigin::Transient {
                if !allocation_by_resource.contains_key(&resource.id) {
                    return Err(FrameGraphError::Internal {
                        message: format!(
                            "retained transient resource {} has no physical allocation",
                            resource.id
                        ),
                    });
                }
            } else {
                let binding =
                    native
                        .get(&resource.id)
                        .ok_or(FrameGraphError::MissingNativeBinding {
                            resource: resource.id,
                        })?;
                validate_effective_usage(resource.id, usages.get(&resource.id), binding)?;
            }
        }
    }
    Ok(())
}

fn executor_name(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Render => "render",
        NodeKind::Compute => "compute",
        NodeKind::Copy => "copy operations",
        NodeKind::ClearBuffer => "clear-buffer operation",
        NodeKind::Command => "command",
        NodeKind::ExternalSubmission => "external-submission",
    }
}

fn color_load_op(value: crate::ColorAttachmentLoadOp) -> wgpu::LoadOp<wgpu::Color> {
    match value {
        crate::ColorAttachmentLoadOp::Load => wgpu::LoadOp::Load,
        crate::ColorAttachmentLoadOp::Clear(value) => wgpu::LoadOp::Clear(value),
    }
}

fn depth_load_op(value: crate::DepthAttachmentLoadOp) -> wgpu::LoadOp<f32> {
    match value {
        crate::DepthAttachmentLoadOp::Load => wgpu::LoadOp::Load,
        crate::DepthAttachmentLoadOp::Clear(value) => wgpu::LoadOp::Clear(value),
    }
}

fn store_op(value: crate::AttachmentStoreOp) -> wgpu::StoreOp {
    match value {
        crate::AttachmentStoreOp::Store => wgpu::StoreOp::Store,
        crate::AttachmentStoreOp::Discard => wgpu::StoreOp::Discard,
    }
}

fn invalid_executor<T>(node: &NodeRecord, expected: &'static str) -> Result<T, FrameGraphError> {
    Err(FrameGraphError::InvalidNodeExecutor {
        pass: node.id,
        expected,
        actual: node.kind,
    })
}

fn missing_executor<T>(node: &NodeRecord, expected: &'static str) -> Result<T, FrameGraphError> {
    Err(FrameGraphError::MissingNodeExecutor {
        pass: node.id,
        expected,
    })
}

fn native_buffer(
    native: &HashMap<ResourceId, NativeResource>,
    resource: ResourceId,
) -> Result<&wgpu::Buffer, FrameGraphError> {
    match native.get(&resource) {
        Some(NativeResource::Buffer(buffer)) => Ok(buffer),
        Some(NativeResource::Texture(_)) => Err(FrameGraphError::Internal {
            message: format!("buffer operation resolved resource {resource} to a texture"),
        }),
        None => Err(FrameGraphError::MissingNativeBinding { resource }),
    }
}

fn native_texture(
    native: &HashMap<ResourceId, NativeResource>,
    resource: ResourceId,
) -> Result<&wgpu::Texture, FrameGraphError> {
    match native.get(&resource) {
        Some(NativeResource::Texture(texture)) => Ok(texture),
        Some(NativeResource::Buffer(_)) => Err(FrameGraphError::Internal {
            message: format!("texture operation resolved resource {resource} to a buffer"),
        }),
        None => Err(FrameGraphError::MissingNativeBinding { resource }),
    }
}

fn texture_copy_info<'a>(
    native: &'a HashMap<ResourceId, NativeResource>,
    location: &TextureCopyLocationRecord,
) -> Result<wgpu::TexelCopyTextureInfo<'a>, FrameGraphError> {
    Ok(wgpu::TexelCopyTextureInfo {
        texture: native_texture(native, location.resource)?,
        mip_level: location.mip_level,
        origin: location.origin,
        aspect: location.aspect,
    })
}

fn encode_copy_operation(
    encoder: &mut wgpu::CommandEncoder,
    operation: &CopyOperation,
    native: &HashMap<ResourceId, NativeResource>,
) -> Result<(), FrameGraphError> {
    match operation {
        CopyOperation::BufferToBuffer {
            source,
            source_offset,
            destination,
            destination_offset,
            size,
        } => encoder.copy_buffer_to_buffer(
            native_buffer(native, *source)?,
            *source_offset,
            native_buffer(native, *destination)?,
            *destination_offset,
            *size,
        ),
        CopyOperation::BufferToTexture {
            source,
            source_layout,
            destination,
            copy_size,
        } => encoder.copy_buffer_to_texture(
            wgpu::TexelCopyBufferInfo {
                buffer: native_buffer(native, *source)?,
                layout: *source_layout,
            },
            texture_copy_info(native, destination)?,
            *copy_size,
        ),
        CopyOperation::TextureToBuffer {
            source,
            destination,
            destination_layout,
            copy_size,
        } => encoder.copy_texture_to_buffer(
            texture_copy_info(native, source)?,
            wgpu::TexelCopyBufferInfo {
                buffer: native_buffer(native, *destination)?,
                layout: *destination_layout,
            },
            *copy_size,
        ),
        CopyOperation::TextureToTexture {
            source,
            destination,
            copy_size,
        } => encoder.copy_texture_to_texture(
            texture_copy_info(native, source)?,
            texture_copy_info(native, destination)?,
            *copy_size,
        ),
    }
    Ok(())
}

fn validate_effective_usage(
    resource: ResourceId,
    usage: Option<&ResourceUsage>,
    native: &NativeResource,
) -> Result<(), FrameGraphError> {
    match (usage, native) {
        (Some(ResourceUsage::Buffer(required)), NativeResource::Buffer(buffer))
            if !buffer.usage().contains(*required) =>
        {
            Err(FrameGraphError::NativeDescriptorMismatch {
                resource,
                message: format!(
                    "native buffer usage {:#x} does not contain effective usage {:#x}",
                    buffer.usage().bits(),
                    required.bits()
                ),
            })
        }
        (Some(ResourceUsage::Texture(required)), NativeResource::Texture(texture))
            if !texture.usage().contains(*required) =>
        {
            Err(FrameGraphError::NativeDescriptorMismatch {
                resource,
                message: format!(
                    "native texture usage {:#x} does not contain effective usage {:#x}",
                    texture.usage().bits(),
                    required.bits()
                ),
            })
        }
        (Some(ResourceUsage::Buffer(_)), NativeResource::Texture(_))
        | (Some(ResourceUsage::Texture(_)), NativeResource::Buffer(_)) => {
            Err(FrameGraphError::NativeDescriptorMismatch {
                resource,
                message: "native resource kind does not match logical resource kind".into(),
            })
        }
        _ => Ok(()),
    }
}

fn create_execution_views(
    plans: &[ExecutionViewPlan],
    native: &HashMap<ResourceId, NativeResource>,
) -> Result<HashMap<AccessId, wgpu::TextureView>, FrameGraphError> {
    let mut result = HashMap::new();
    for plan in plans {
        let Some(NativeResource::Texture(texture)) = native.get(&plan.resource) else {
            return Err(FrameGraphError::MissingNativeBinding {
                resource: plan.resource,
            });
        };
        let descriptor = &plan.descriptor;
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: (!descriptor.label.is_empty()).then_some(descriptor.label.as_str()),
            format: Some(descriptor.format),
            dimension: Some(descriptor.dimension),
            usage: Some(descriptor.usage),
            aspect: descriptor.aspect,
            base_mip_level: descriptor.base_mip_level,
            mip_level_count: Some(descriptor.mip_level_count),
            base_array_layer: descriptor.base_array_layer,
            array_layer_count: descriptor.array_layer_count,
        });
        for access in &plan.accesses {
            result.insert(*access, view.clone());
        }
    }
    Ok(result)
}
