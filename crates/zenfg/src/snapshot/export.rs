use std::{
    collections::{BTreeSet, HashMap, HashSet},
    time::Duration,
};

use crate::{
    AccessMode, AccessRole, CompilationReport, CulledNodeReason, DependencyKind,
    DiagnosticSeverity, ExecutionSegmentKind, FullCompilationReport, GpuTimingNodeKind,
    GpuTimingReport, GpuTimingUnavailableReason, NodeKind, PassId, ResourceDescriptor, ResourceId,
    ResourceKind, ResourceOrigin, ResourcePoolStats, ResourceRange, ResourceUsage, RootReason,
};

use super::{
    FRAME_GRAPH_SNAPSHOT_FORMAT, FRAME_GRAPH_SNAPSHOT_VERSION, FrameGraphSnapshotV1,
    SnapshotAccess, SnapshotAccessKind, SnapshotAccessMode, SnapshotAllocation,
    SnapshotAllocationReport, SnapshotBufferRange, SnapshotCapture, SnapshotDependency,
    SnapshotDependencyKind, SnapshotDiagnostic, SnapshotDiagnosticSeverity, SnapshotExportError,
    SnapshotGpuNodeTiming, SnapshotGpuTimings, SnapshotGraph, SnapshotGroup,
    SnapshotInitialContents, SnapshotLifetime, SnapshotMemory, SnapshotNode,
    SnapshotNodeCompileState, SnapshotNodeKind, SnapshotPoolReport, SnapshotProducer,
    SnapshotResource, SnapshotResourceDescriptor, SnapshotResourceKind, SnapshotResourceOrigin,
    SnapshotRoot, SnapshotRootReason, SnapshotRuntime, SnapshotSegment, SnapshotSegmentKind,
    SnapshotTextureRegion, SnapshotTextureSize, SnapshotTextureView, SnapshotTimings,
    SnapshotUsageFlag, SnapshotWriteContents,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Capture-time facts that are not part of the compilation report itself.
#[derive(Clone, Copy, Debug)]
pub struct CreateFrameGraphSnapshotOptions<'a> {
    pub frame_index: u64,
    pub captured_at: Option<&'a str>,
    pub backend: Option<&'a str>,
    pub gpu_timing: Option<&'a GpuTimingReport>,
    pub pool_stats: Option<ResourcePoolStats>,
}

impl<'a> CreateFrameGraphSnapshotOptions<'a> {
    pub const fn new(frame_index: u64) -> Self {
        Self {
            frame_index,
            captured_at: None,
            backend: None,
            gpu_timing: None,
            pool_stats: None,
        }
    }
}

/// Converts a full native compilation report into the Snapshot 1.0 wire model.
pub fn create_frame_graph_snapshot(
    report: &CompilationReport,
    options: CreateFrameGraphSnapshotOptions<'_>,
) -> Result<FrameGraphSnapshotV1, SnapshotExportError> {
    safe_integer("capture.frameIndex", options.frame_index)?;
    let full = report
        .full
        .as_ref()
        .ok_or(SnapshotExportError::FullReportRequired)?;
    let context = ExportContext::new(full)?;

    Ok(FrameGraphSnapshotV1 {
        format: FRAME_GRAPH_SNAPSHOT_FORMAT.into(),
        version: FRAME_GRAPH_SNAPSHOT_VERSION,
        producer: SnapshotProducer {
            name: "zenfg".into(),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            language: Some("rust".into()),
            runtime: Some(SnapshotRuntime {
                implementation: Some("wgpu".into()),
                graphics_api: Some("webgpu".into()),
                backend: options.backend.map(str::to_owned),
            }),
        },
        capture: SnapshotCapture {
            frame_index: options.frame_index,
            captured_at: options.captured_at.map(str::to_owned),
            migration: None,
        },
        graph: context.graph()?,
        memory: context.memory(options.pool_stats)?,
        timings: SnapshotTimings {
            gpu: context.gpu_timings(options.frame_index, options.gpu_timing)?,
        },
        diagnostics: context.diagnostics()?,
        extensions: Default::default(),
    })
}

struct ExportContext<'a> {
    full: &'a FullCompilationReport,
    resources: HashMap<ResourceId, &'a crate::ResourceReport>,
    execution_order: HashMap<PassId, usize>,
    retained: HashSet<PassId>,
}

impl<'a> ExportContext<'a> {
    fn new(full: &'a FullCompilationReport) -> Result<Self, SnapshotExportError> {
        let mut resources = HashMap::with_capacity(full.resources.len());
        for resource in &full.resources {
            if resources.insert(resource.id, resource).is_some() {
                return invalid(format!("duplicate resource {}", resource.id));
            }
        }

        let mut execution_order = HashMap::with_capacity(full.nodes.len());
        for (order, node) in full.nodes.iter().enumerate() {
            safe_usize("graph.nodes[].compileState.executionOrder", order)?;
            if execution_order.insert(node.id, order).is_some() {
                return invalid(format!("duplicate retained node {}", node.id));
            }
        }
        let retained = execution_order.keys().copied().collect();

        Ok(Self {
            full,
            resources,
            execution_order,
            retained,
        })
    }

    fn graph(&self) -> Result<SnapshotGraph, SnapshotExportError> {
        Ok(SnapshotGraph {
            groups: self.groups()?,
            nodes: self.nodes()?,
            resources: self.resources()?,
            texture_views: self.texture_views()?,
            accesses: self.accesses()?,
            dependencies: self.dependencies()?,
            roots: self.roots()?,
            segments: self.segments()?,
        })
    }

    fn groups(&self) -> Result<Vec<SnapshotGroup>, SnapshotExportError> {
        let ids: HashSet<_> = self
            .full
            .debug_groups
            .iter()
            .map(|group| group.id)
            .collect();
        let mut groups = Vec::with_capacity(self.full.debug_groups.len());
        for group in &self.full.debug_groups {
            if group.label.is_empty() {
                return invalid(format!("debug group {} has an empty label", group.id));
            }
            if group.parent.is_some_and(|parent| !ids.contains(&parent)) {
                return invalid(format!("debug group {} has an unknown parent", group.id));
            }
            groups.push(SnapshotGroup {
                id: group_id(group.id.get()),
                parent_id: group.parent.map(|id| group_id(id.get())),
                label: group.label.clone(),
                stable_key: None,
            });
        }
        Ok(groups)
    }

    fn nodes(&self) -> Result<Vec<SnapshotNode>, SnapshotExportError> {
        enum Source<'b> {
            Retained(&'b crate::NodeReport),
            Culled(&'b crate::CulledNodeReport),
        }

        let total = self.full.nodes.len() + self.full.culled_nodes.len();
        let mut sources = Vec::with_capacity(total);
        let mut ids = HashSet::with_capacity(total);
        let mut orders = HashSet::with_capacity(total);
        for node in &self.full.nodes {
            if !ids.insert(node.id) || !orders.insert(node.recording_order) {
                return invalid("duplicate node identity or recording order");
            }
            sources.push((node.recording_order, Source::Retained(node)));
        }
        for node in &self.full.culled_nodes {
            if !ids.insert(node.id) || !orders.insert(node.recording_order) {
                return invalid("duplicate node identity or recording order");
            }
            sources.push((node.recording_order, Source::Culled(node)));
        }
        sources.sort_unstable_by_key(|(order, _)| *order);
        if sources
            .iter()
            .enumerate()
            .any(|(expected, (actual, _))| usize::try_from(*actual).ok() != Some(expected))
        {
            return invalid("node recording order is not continuous");
        }

        sources
            .into_iter()
            .map(|(recording_order, source)| {
                safe_integer("graph.nodes[].recordingOrder", recording_order.into())?;
                match source {
                    Source::Retained(node) => Ok(SnapshotNode {
                        id: node_id(node.id.get()),
                        stable_key: None,
                        recording_order: Some(recording_order.into()),
                        kind: node_kind(node.kind)?,
                        label: Some(node.label.clone()),
                        side_effect: node.side_effect,
                        group_id: node.debug_group.map(|id| group_id(id.get())),
                        compile_state: SnapshotNodeCompileState::Retained {
                            execution_order: safe_usize(
                                "graph.nodes[].compileState.executionOrder",
                                self.execution_order[&node.id],
                            )?,
                        },
                    }),
                    Source::Culled(node) => {
                        let reason = match node.reason {
                            CulledNodeReason::NotReachableFromRoot => {
                                "not-reachable-from-root".to_owned()
                            }
                        };
                        Ok(SnapshotNode {
                            id: node_id(node.id.get()),
                            stable_key: None,
                            recording_order: Some(recording_order.into()),
                            kind: node_kind(node.kind)?,
                            label: Some(node.label.clone()),
                            side_effect: node.side_effect,
                            group_id: node.debug_group.map(|id| group_id(id.get())),
                            compile_state: SnapshotNodeCompileState::Culled { reason },
                        })
                    }
                }
            })
            .collect()
    }

    fn resources(&self) -> Result<Vec<SnapshotResource>, SnapshotExportError> {
        self.full
            .resources
            .iter()
            .map(|resource| {
                let (descriptor, usage_flags) =
                    match (&resource.descriptor, resource.effective_usage) {
                        (ResourceDescriptor::Texture(desc), ResourceUsage::Texture(usage)) => {
                            if desc.size.width == 0
                                || desc.size.height == 0
                                || desc.size.depth_or_array_layers == 0
                                || desc.mip_level_count == 0
                                || desc.sample_count == 0
                            {
                                return invalid(format!(
                                    "texture resource {} has a zero descriptor count",
                                    resource.id
                                ));
                            }
                            (
                                SnapshotResourceDescriptor::Texture {
                                    format: texture_format(desc.format),
                                    size: SnapshotTextureSize {
                                        width: desc.size.width.into(),
                                        height: desc.size.height.into(),
                                        depth_or_array_layers: desc
                                            .size
                                            .depth_or_array_layers
                                            .into(),
                                    },
                                    dimension: texture_dimension(desc.dimension).into(),
                                    mip_level_count: desc.mip_level_count.into(),
                                    sample_count: desc.sample_count.into(),
                                    view_formats: desc
                                        .view_formats
                                        .iter()
                                        .copied()
                                        .map(texture_format)
                                        .collect(),
                                },
                                texture_usage_flags(usage)?,
                            )
                        }
                        (ResourceDescriptor::Buffer(desc), ResourceUsage::Buffer(usage)) => {
                            safe_integer("graph.resources[].descriptor.size", desc.size)?;
                            (
                                SnapshotResourceDescriptor::Buffer { size: desc.size },
                                buffer_usage_flags(usage)?,
                            )
                        }
                        _ => {
                            return invalid(format!(
                                "resource {} kind/descriptor mismatch",
                                resource.id
                            ));
                        }
                    };
                safe_integer(
                    "graph.resources[].estimatedByteSize",
                    resource.estimated_byte_size,
                )?;
                let lifetime = resource
                    .lifetime
                    .map(|lifetime| {
                        if lifetime.first_use > lifetime.last_use
                            || lifetime.last_use >= self.full.nodes.len()
                        {
                            return invalid(format!(
                                "resource {} has an invalid retained lifetime",
                                resource.id
                            ));
                        }
                        Ok(SnapshotLifetime {
                            first_use: safe_usize(
                                "graph.resources[].lifetime.firstUse",
                                lifetime.first_use,
                            )?,
                            last_use: safe_usize(
                                "graph.resources[].lifetime.lastUse",
                                lifetime.last_use,
                            )?,
                        })
                    })
                    .transpose()?;
                Ok(SnapshotResource {
                    id: resource_id(resource.id.get()),
                    stable_key: None,
                    kind: resource_kind(resource.kind)?,
                    label: Some(resource.label.clone()),
                    origin: resource_origin(resource.origin)?,
                    initial_contents: Some(match resource.initial_contents {
                        crate::InitialContents::Defined => SnapshotInitialContents::Defined,
                        crate::InitialContents::Undefined => SnapshotInitialContents::Undefined,
                    }),
                    group_id: resource.debug_group.map(|id| group_id(id.get())),
                    lifetime,
                    allocation_id: resource.allocation.map(|id| allocation_id(id.get())),
                    estimated_byte_size: Some(resource.estimated_byte_size),
                    descriptor: Some(descriptor),
                    usage_flags,
                })
            })
            .collect()
    }

    fn texture_views(&self) -> Result<Vec<SnapshotTextureView>, SnapshotExportError> {
        let mut ids = HashSet::with_capacity(self.full.views.len());
        self.full
            .views
            .iter()
            .map(|view| {
                if !ids.insert(view.id) {
                    return invalid(format!("duplicate texture view {}", view.id));
                }
                let parent = self.resources.get(&view.texture).ok_or_else(|| {
                    SnapshotExportError::InvalidReport {
                        message: format!("view {} has an unknown texture", view.id),
                    }
                })?;
                let ResourceDescriptor::Texture(texture) = &parent.descriptor else {
                    return invalid(format!("view {} refers to a buffer", view.id));
                };
                let dimension = view
                    .descriptor
                    .dimension
                    .unwrap_or(match texture.dimension {
                        wgpu::TextureDimension::D1 => wgpu::TextureViewDimension::D1,
                        wgpu::TextureDimension::D2 if texture.size.depth_or_array_layers == 1 => {
                            wgpu::TextureViewDimension::D2
                        }
                        wgpu::TextureDimension::D2 => wgpu::TextureViewDimension::D2Array,
                        wgpu::TextureDimension::D3 => wgpu::TextureViewDimension::D3,
                    });
                let mip_level_count = view
                    .descriptor
                    .mip_level_count
                    .unwrap_or(texture.mip_level_count - view.descriptor.base_mip_level);
                let (base_array_layer, array_layer_count) = if texture.dimension
                    == wgpu::TextureDimension::D3
                {
                    (0, 1)
                } else {
                    (
                        view.descriptor.base_array_layer,
                        view.descriptor.array_layer_count.unwrap_or(
                            texture.size.depth_or_array_layers - view.descriptor.base_array_layer,
                        ),
                    )
                };
                if mip_level_count == 0 || array_layer_count == 0 {
                    return invalid(format!("texture view {} has a zero count", view.id));
                }
                let aspect = if view.descriptor.aspect == wgpu::TextureAspect::All
                    && texture.format.has_depth_aspect()
                {
                    wgpu::TextureAspect::DepthOnly
                } else {
                    view.descriptor.aspect
                };
                Ok(SnapshotTextureView {
                    id: view_id(view.id.get()),
                    stable_key: None,
                    resource_id: resource_id(view.texture.get()),
                    label: Some(view.descriptor.label.clone()),
                    format: texture_format(view.descriptor.format.unwrap_or(texture.format)),
                    dimension: texture_view_dimension(dimension).into(),
                    aspect: texture_aspect(aspect).into(),
                    base_mip_level: view.descriptor.base_mip_level.into(),
                    mip_level_count: mip_level_count.into(),
                    base_array_layer: base_array_layer.into(),
                    array_layer_count: array_layer_count.into(),
                    swizzle: "rgba".into(),
                })
            })
            .collect()
    }

    fn accesses(&self) -> Result<Vec<SnapshotAccess>, SnapshotExportError> {
        let mut result = Vec::new();
        let mut ids = HashSet::with_capacity(self.full.accesses.len());
        for access in &self.full.accesses {
            if !ids.insert(access.id) {
                return invalid(format!("duplicate access {}", access.id));
            }
            if !self.full.nodes.iter().any(|node| node.id == access.pass)
                && !self
                    .full
                    .culled_nodes
                    .iter()
                    .any(|node| node.id == access.pass)
            {
                return invalid(format!("access {} has an unknown node", access.id));
            }
            let resource = self.resources.get(&access.resource).ok_or_else(|| {
                SnapshotExportError::InvalidReport {
                    message: format!("access {} has an unknown resource", access.id),
                }
            })?;
            if access.role.kind() != resource.kind {
                return invalid(format!("access {} role/resource kind mismatch", access.id));
            }
            let (kind, expected_mode) = access_kind(access.role, access.mode)?;
            if access.mode != expected_mode {
                return invalid(format!(
                    "access {} has an illegal role/mode combination",
                    access.id
                ));
            }
            if access.mode == AccessMode::Read && access.produces_value {
                return invalid(format!("read access {} produces a value", access.id));
            }
            let (mode, contents) = match access.mode {
                AccessMode::Read => (SnapshotAccessMode::Read, None),
                AccessMode::Write => (
                    SnapshotAccessMode::Write,
                    Some(if access.consumes_previous {
                        SnapshotWriteContents::Preserve
                    } else {
                        SnapshotWriteContents::Overwrite
                    }),
                ),
            };
            let texture_view_id = access
                .view
                .map(|view| {
                    let report = self
                        .full
                        .views
                        .iter()
                        .find(|candidate| candidate.id == view);
                    if report.is_none_or(|report| report.texture != access.resource) {
                        return invalid(format!(
                            "access {} has an invalid texture view",
                            access.id
                        ));
                    }
                    Ok(view_id(view.get()))
                })
                .transpose()?;
            if matches!(
                access.role,
                AccessRole::TextureCopySrc | AccessRole::TextureCopyDst
            ) && texture_view_id.is_some()
            {
                return invalid(format!("texture copy access {} has a view", access.id));
            }

            match &access.range {
                ResourceRange::Buffer(range) => {
                    if access.view.is_some() || resource.kind != ResourceKind::Buffer {
                        return invalid(format!(
                            "buffer access {} has texture metadata",
                            access.id
                        ));
                    }
                    safe_integer("graph.accesses[].bufferRange.offset", range.offset)?;
                    if let Some(size) = range.size {
                        safe_integer("graph.accesses[].bufferRange.size", size)?;
                    }
                    result.push(SnapshotAccess {
                        id: access_id(access.id.get(), None),
                        node_id: node_id(access.pass.get()),
                        resource_id: resource_id(access.resource.get()),
                        access: kind,
                        texture_view_id: None,
                        texture_region: None,
                        buffer_range: Some(SnapshotBufferRange {
                            offset: range.offset,
                            size: range.size,
                        }),
                        mode,
                        contents,
                        produces_value: access.produces_value,
                    });
                }
                ResourceRange::Texture(regions) => {
                    if regions.is_empty() || resource.kind != ResourceKind::Texture {
                        return invalid(format!(
                            "texture access {} has no valid region",
                            access.id
                        ));
                    }
                    let ResourceDescriptor::Texture(texture) = &resource.descriptor else {
                        unreachable!()
                    };
                    for (index, region) in regions.iter().enumerate() {
                        if region.mip_level_count == 0 || region.slice_count == 0 {
                            return invalid(format!(
                                "texture access {} has a zero count",
                                access.id
                            ));
                        }
                        let (
                            base_array_layer,
                            array_layer_count,
                            base_depth_slice,
                            depth_slice_count,
                        ) = if texture.dimension == wgpu::TextureDimension::D3 {
                            (
                                None,
                                None,
                                Some(region.base_slice.into()),
                                Some(region.slice_count.into()),
                            )
                        } else {
                            (
                                Some(region.base_slice.into()),
                                Some(region.slice_count.into()),
                                None,
                                None,
                            )
                        };
                        result.push(SnapshotAccess {
                            id: access_id(access.id.get(), (regions.len() > 1).then_some(index)),
                            node_id: node_id(access.pass.get()),
                            resource_id: resource_id(access.resource.get()),
                            access: kind,
                            texture_view_id: texture_view_id.clone(),
                            texture_region: Some(SnapshotTextureRegion {
                                base_mip_level: region.base_mip_level.into(),
                                mip_level_count: region.mip_level_count.into(),
                                base_array_layer,
                                array_layer_count,
                                base_depth_slice,
                                depth_slice_count,
                                aspect: texture_aspect(region.aspect).into(),
                            }),
                            buffer_range: None,
                            mode,
                            contents,
                            produces_value: access.produces_value,
                        });
                    }
                }
            }
        }
        Ok(result)
    }

    fn dependencies(&self) -> Result<Vec<SnapshotDependency>, SnapshotExportError> {
        let mut dependencies = BTreeSet::new();
        for dependency in &self.full.dependencies {
            if !self.retained.contains(&dependency.from) || !self.retained.contains(&dependency.to)
            {
                continue;
            }
            if self.execution_order[&dependency.from] >= self.execution_order[&dependency.to] {
                return invalid(format!(
                    "dependency {} -> {} is not forward in execution order",
                    dependency.from, dependency.to
                ));
            }
            dependencies.insert(SnapshotDependency {
                from_node_id: node_id(dependency.from.get()),
                to_node_id: node_id(dependency.to.get()),
                resource_id: resource_id(dependency.resource.get()),
                kind: match dependency.kind {
                    DependencyKind::Value => SnapshotDependencyKind::Value,
                    DependencyKind::Ordering => SnapshotDependencyKind::Ordering,
                },
            });
        }
        Ok(dependencies.into_iter().collect())
    }

    fn roots(&self) -> Result<Vec<SnapshotRoot>, SnapshotExportError> {
        let mut roots = BTreeSet::new();
        for root in &self.full.roots {
            if !self.resources.contains_key(&root.resource) {
                return invalid(format!("root has an unknown resource {}", root.resource));
            }
            roots.insert(SnapshotRoot {
                reason: match root.reason {
                    RootReason::Present => SnapshotRootReason::Present,
                    RootReason::Output => SnapshotRootReason::Output,
                    RootReason::Readback => SnapshotRootReason::Readback,
                    RootReason::DebugCapture => SnapshotRootReason::DebugCapture,
                    RootReason::PersistentState => SnapshotRootReason::PersistentState,
                },
                node_id: None,
                resource_id: Some(resource_id(root.resource.get())),
            });
        }
        for node in &self.full.nodes {
            if node.side_effect {
                roots.insert(SnapshotRoot {
                    reason: SnapshotRootReason::SideEffect,
                    node_id: Some(node_id(node.id.get())),
                    resource_id: None,
                });
            }
        }
        Ok(roots.into_iter().collect())
    }

    fn segments(&self) -> Result<Vec<SnapshotSegment>, SnapshotExportError> {
        let mut flattened = Vec::with_capacity(self.full.nodes.len());
        let mut segments = Vec::with_capacity(self.full.execution_segments.len());
        for (order, segment) in self.full.execution_segments.iter().enumerate() {
            if segment.nodes.is_empty() {
                return invalid("execution segment must not be empty");
            }
            for node in &segment.nodes {
                if !self.retained.contains(node) {
                    return invalid(format!("execution segment contains culled node {node}"));
                }
                flattened.push(*node);
            }
            segments.push(SnapshotSegment {
                id: segment_id(order),
                order: safe_usize("graph.segments[].order", order)?,
                kind: match segment.kind {
                    ExecutionSegmentKind::FrameGraph => SnapshotSegmentKind::FrameGraph,
                    ExecutionSegmentKind::ExternalSubmission => {
                        SnapshotSegmentKind::ExternalSubmission
                    }
                },
                node_ids: segment.nodes.iter().map(|id| node_id(id.get())).collect(),
            });
        }
        if flattened
            != self
                .full
                .nodes
                .iter()
                .map(|node| node.id)
                .collect::<Vec<_>>()
        {
            return invalid("execution segments do not match retained execution order");
        }
        Ok(segments)
    }

    fn memory(
        &self,
        pool: Option<ResourcePoolStats>,
    ) -> Result<SnapshotMemory, SnapshotExportError> {
        let mut allocation_ids = HashSet::with_capacity(self.full.allocations.len());
        let allocations = self
            .full
            .allocations
            .iter()
            .map(|allocation| {
                if !allocation_ids.insert(allocation.id) || allocation.compatibility_key.is_empty()
                {
                    return invalid(format!("invalid or duplicate allocation {}", allocation.id));
                }
                safe_integer(
                    "memory.allocationReport.allocations[].estimatedByteSize",
                    allocation.estimated_byte_size,
                )?;
                Ok(SnapshotAllocation {
                    id: allocation_id(allocation.id.get()),
                    kind: resource_kind(allocation.kind)?,
                    compatibility_class_id: compatibility_id(&allocation.compatibility_key),
                    estimated_byte_size: Some(allocation.estimated_byte_size),
                })
            })
            .collect::<Result<_, _>>()?;
        let pool_report = match pool {
            Some(pool) => {
                safe_integer("memory.poolReport.acquireCount", pool.acquire_count)?;
                safe_integer("memory.poolReport.reuseCount", pool.reuse_count)?;
                safe_integer("memory.poolReport.createdCount", pool.created_count)?;
                safe_integer("memory.poolReport.retainedCount", pool.retained_count)?;
                safe_integer(
                    "memory.poolReport.estimatedRetainedBytes",
                    pool.estimated_retained_bytes,
                )?;
                SnapshotPoolReport::Available {
                    acquire_count: pool.acquire_count,
                    reuse_count: pool.reuse_count,
                    created_count: pool.created_count,
                    retained_count: pool.retained_count,
                    estimated_retained_bytes: Some(pool.estimated_retained_bytes),
                }
            }
            None => SnapshotPoolReport::Unavailable {
                reason: "not-captured".into(),
            },
        };
        Ok(SnapshotMemory {
            allocation_report: SnapshotAllocationReport::Available { allocations },
            pool_report,
        })
    }

    fn gpu_timings(
        &self,
        frame_index: u64,
        timing: Option<&GpuTimingReport>,
    ) -> Result<SnapshotGpuTimings, SnapshotExportError> {
        let Some(timing) = timing else {
            return Ok(SnapshotGpuTimings::Unavailable {
                reason: "not-captured".into(),
            });
        };
        let timing_frame = match timing {
            GpuTimingReport::Available { frame_index, .. }
            | GpuTimingReport::Unavailable { frame_index, .. } => *frame_index,
        };
        safe_integer("timings.gpu.frameIndex", timing_frame)?;
        if timing_frame != frame_index {
            return Err(SnapshotExportError::TimingFrameMismatch {
                capture_frame: frame_index,
                timing_frame,
            });
        }
        match timing {
            GpuTimingReport::Unavailable { reason, .. } => Ok(SnapshotGpuTimings::Unavailable {
                reason: timing_unavailable_reason(*reason)?.into(),
            }),
            GpuTimingReport::Available {
                frame_duration,
                nodes,
                ..
            } => {
                let mut seen = HashSet::with_capacity(nodes.len());
                let mut output = Vec::with_capacity(nodes.len());
                for node in nodes {
                    if !self.retained.contains(&node.pass) || !seen.insert(node.pass) {
                        return invalid(format!("invalid or duplicate timed node {}", node.pass));
                    }
                    let expected_kind = self
                        .full
                        .nodes
                        .iter()
                        .find(|report| report.id == node.pass)
                        .map(|report| report.kind)
                        .ok_or_else(|| SnapshotExportError::InvalidReport {
                            message: format!("timed node {} is not retained", node.pass),
                        })?;
                    let valid_kind = matches!(
                        (node.kind, expected_kind),
                        (GpuTimingNodeKind::Render, NodeKind::Render)
                            | (GpuTimingNodeKind::Compute, NodeKind::Compute)
                    );
                    if !valid_kind {
                        return invalid(format!("timed node {} kind mismatch", node.pass));
                    }
                    output.push(SnapshotGpuNodeTiming {
                        node_id: node_id(node.pass.get()),
                        duration_micros: duration_micros(
                            "timings.gpu.nodes[].durationMicros",
                            node.duration,
                        )?,
                    });
                }
                Ok(SnapshotGpuTimings::Available {
                    frame_span_micros: duration_micros(
                        "timings.gpu.frameSpanMicros",
                        *frame_duration,
                    )?,
                    nodes: output,
                })
            }
        }
    }

    fn diagnostics(&self) -> Result<Vec<SnapshotDiagnostic>, SnapshotExportError> {
        self.full
            .diagnostics
            .iter()
            .map(|diagnostic| {
                if diagnostic.code.is_empty() {
                    return invalid("diagnostic code must not be empty");
                }
                if diagnostic.pass.is_some_and(|id| {
                    !self.full.nodes.iter().any(|node| node.id == id)
                        && !self.full.culled_nodes.iter().any(|node| node.id == id)
                }) || diagnostic
                    .resource
                    .is_some_and(|id| !self.resources.contains_key(&id))
                {
                    return invalid("diagnostic references an unknown entity");
                }
                Ok(SnapshotDiagnostic {
                    severity: match diagnostic.severity {
                        DiagnosticSeverity::Info => SnapshotDiagnosticSeverity::Info,
                        DiagnosticSeverity::Warning => SnapshotDiagnosticSeverity::Warning,
                        DiagnosticSeverity::Error => SnapshotDiagnosticSeverity::Error,
                    },
                    code: diagnostic.code.clone(),
                    message: diagnostic.message.clone(),
                    node_id: diagnostic.pass.map(|id| node_id(id.get())),
                    resource_id: diagnostic.resource.map(|id| resource_id(id.get())),
                })
            })
            .collect()
    }
}

fn safe_integer(field: &'static str, value: u64) -> Result<u64, SnapshotExportError> {
    if value > MAX_SAFE_INTEGER {
        Err(SnapshotExportError::UnsafeInteger { field, value })
    } else {
        Ok(value)
    }
}

fn safe_usize(field: &'static str, value: usize) -> Result<u64, SnapshotExportError> {
    let value = u64::try_from(value).map_err(|_| SnapshotExportError::UnsafeInteger {
        field,
        value: u64::MAX,
    })?;
    safe_integer(field, value)
}

fn duration_micros(field: &'static str, duration: Duration) -> Result<f64, SnapshotExportError> {
    let value = duration.as_secs_f64() * 1_000_000.0;
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(SnapshotExportError::UnsupportedValue {
            field,
            value: format!("{duration:?}"),
        })
    }
}

fn invalid<T>(message: impl Into<String>) -> Result<T, SnapshotExportError> {
    Err(SnapshotExportError::InvalidReport {
        message: message.into(),
    })
}

fn node_kind(kind: NodeKind) -> Result<SnapshotNodeKind, SnapshotExportError> {
    match kind {
        NodeKind::Render => Ok(SnapshotNodeKind::Render),
        NodeKind::Compute => Ok(SnapshotNodeKind::Compute),
        NodeKind::Copy => Ok(SnapshotNodeKind::Copy),
        NodeKind::ClearBuffer => Ok(SnapshotNodeKind::ClearBuffer),
        NodeKind::Command => Ok(SnapshotNodeKind::Command),
        NodeKind::ExternalSubmission => Ok(SnapshotNodeKind::ExternalSubmission),
    }
}

fn resource_kind(kind: ResourceKind) -> Result<SnapshotResourceKind, SnapshotExportError> {
    match kind {
        ResourceKind::Texture => Ok(SnapshotResourceKind::Texture),
        ResourceKind::Buffer => Ok(SnapshotResourceKind::Buffer),
    }
}

fn resource_origin(origin: ResourceOrigin) -> Result<SnapshotResourceOrigin, SnapshotExportError> {
    match origin {
        ResourceOrigin::Transient => Ok(SnapshotResourceOrigin::Transient),
        ResourceOrigin::Imported => Ok(SnapshotResourceOrigin::Imported),
        ResourceOrigin::Surface => Ok(SnapshotResourceOrigin::Surface),
    }
}

fn access_kind(
    role: AccessRole,
    mode: AccessMode,
) -> Result<(SnapshotAccessKind, AccessMode), SnapshotExportError> {
    let value = match role {
        AccessRole::SampledTexture => (SnapshotAccessKind::TextureSampled, AccessMode::Read),
        AccessRole::StorageTextureRead => {
            (SnapshotAccessKind::TextureStorageRead, AccessMode::Read)
        }
        AccessRole::StorageTextureWrite => {
            (SnapshotAccessKind::TextureStorageWrite, AccessMode::Write)
        }
        AccessRole::ColorAttachment => (
            SnapshotAccessKind::TextureColorAttachmentWrite,
            AccessMode::Write,
        ),
        AccessRole::DepthAttachment => match mode {
            AccessMode::Read => (SnapshotAccessKind::TextureDepthRead, AccessMode::Read),
            AccessMode::Write => (SnapshotAccessKind::TextureDepthWrite, AccessMode::Write),
        },
        AccessRole::TextureCopySrc => (SnapshotAccessKind::TextureCopySrc, AccessMode::Read),
        AccessRole::TextureCopyDst => (SnapshotAccessKind::TextureCopyDst, AccessMode::Write),
        AccessRole::UniformBuffer => (SnapshotAccessKind::BufferUniform, AccessMode::Read),
        AccessRole::StorageBufferRead => (SnapshotAccessKind::BufferStorageRead, AccessMode::Read),
        AccessRole::StorageBufferWrite => {
            (SnapshotAccessKind::BufferStorageWrite, AccessMode::Write)
        }
        AccessRole::VertexBuffer => (SnapshotAccessKind::BufferVertex, AccessMode::Read),
        AccessRole::IndexBuffer => (SnapshotAccessKind::BufferIndex, AccessMode::Read),
        AccessRole::IndirectBuffer => (SnapshotAccessKind::BufferIndirect, AccessMode::Read),
        AccessRole::BufferCopySrc => (SnapshotAccessKind::BufferCopySrc, AccessMode::Read),
        AccessRole::BufferCopyDst => (SnapshotAccessKind::BufferCopyDst, AccessMode::Write),
    };
    Ok(value)
}

fn texture_usage_flags(
    usages: wgpu::TextureUsages,
) -> Result<Vec<SnapshotUsageFlag>, SnapshotExportError> {
    let known = wgpu::TextureUsages::COPY_SRC
        | wgpu::TextureUsages::COPY_DST
        | wgpu::TextureUsages::TEXTURE_BINDING
        | wgpu::TextureUsages::STORAGE_BINDING
        | wgpu::TextureUsages::RENDER_ATTACHMENT;
    let unknown = usages.bits() & !known.bits();
    if unknown != 0 {
        return Err(SnapshotExportError::UnsupportedTextureUsage { bits: unknown });
    }
    Ok([
        (wgpu::TextureUsages::COPY_SRC, SnapshotUsageFlag::CopySrc),
        (wgpu::TextureUsages::COPY_DST, SnapshotUsageFlag::CopyDst),
        (
            wgpu::TextureUsages::TEXTURE_BINDING,
            SnapshotUsageFlag::TextureBinding,
        ),
        (
            wgpu::TextureUsages::STORAGE_BINDING,
            SnapshotUsageFlag::StorageBinding,
        ),
        (
            wgpu::TextureUsages::RENDER_ATTACHMENT,
            SnapshotUsageFlag::RenderAttachment,
        ),
    ]
    .into_iter()
    .filter_map(|(usage, value)| usages.contains(usage).then_some(value))
    .collect())
}

fn buffer_usage_flags(
    usages: wgpu::BufferUsages,
) -> Result<Vec<SnapshotUsageFlag>, SnapshotExportError> {
    let known = wgpu::BufferUsages::MAP_READ
        | wgpu::BufferUsages::MAP_WRITE
        | wgpu::BufferUsages::COPY_SRC
        | wgpu::BufferUsages::COPY_DST
        | wgpu::BufferUsages::INDEX
        | wgpu::BufferUsages::VERTEX
        | wgpu::BufferUsages::UNIFORM
        | wgpu::BufferUsages::STORAGE
        | wgpu::BufferUsages::INDIRECT
        | wgpu::BufferUsages::QUERY_RESOLVE;
    let unknown = usages.bits() & !known.bits();
    if unknown != 0 {
        return Err(SnapshotExportError::UnsupportedBufferUsage { bits: unknown });
    }
    Ok([
        (wgpu::BufferUsages::MAP_READ, SnapshotUsageFlag::MapRead),
        (wgpu::BufferUsages::MAP_WRITE, SnapshotUsageFlag::MapWrite),
        (wgpu::BufferUsages::COPY_SRC, SnapshotUsageFlag::CopySrc),
        (wgpu::BufferUsages::COPY_DST, SnapshotUsageFlag::CopyDst),
        (wgpu::BufferUsages::INDEX, SnapshotUsageFlag::Index),
        (wgpu::BufferUsages::VERTEX, SnapshotUsageFlag::Vertex),
        (wgpu::BufferUsages::UNIFORM, SnapshotUsageFlag::Uniform),
        (wgpu::BufferUsages::STORAGE, SnapshotUsageFlag::Storage),
        (wgpu::BufferUsages::INDIRECT, SnapshotUsageFlag::Indirect),
        (
            wgpu::BufferUsages::QUERY_RESOLVE,
            SnapshotUsageFlag::QueryResolve,
        ),
    ]
    .into_iter()
    .filter_map(|(usage, value)| usages.contains(usage).then_some(value))
    .collect())
}

fn texture_dimension(dimension: wgpu::TextureDimension) -> &'static str {
    match dimension {
        wgpu::TextureDimension::D1 => "1d",
        wgpu::TextureDimension::D2 => "2d",
        wgpu::TextureDimension::D3 => "3d",
    }
}

fn texture_view_dimension(dimension: wgpu::TextureViewDimension) -> &'static str {
    match dimension {
        wgpu::TextureViewDimension::D1 => "1d",
        wgpu::TextureViewDimension::D2 => "2d",
        wgpu::TextureViewDimension::D2Array => "2d-array",
        wgpu::TextureViewDimension::Cube => "cube",
        wgpu::TextureViewDimension::CubeArray => "cube-array",
        wgpu::TextureViewDimension::D3 => "3d",
    }
}

fn texture_aspect(aspect: wgpu::TextureAspect) -> &'static str {
    match aspect {
        wgpu::TextureAspect::All => "all",
        wgpu::TextureAspect::StencilOnly => "stencil-only",
        wgpu::TextureAspect::DepthOnly => "depth-only",
        wgpu::TextureAspect::Plane0 => "plane-0",
        wgpu::TextureAspect::Plane1 => "plane-1",
        wgpu::TextureAspect::Plane2 => "plane-2",
    }
}

fn timing_unavailable_reason(
    reason: GpuTimingUnavailableReason,
) -> Result<&'static str, SnapshotExportError> {
    match reason {
        GpuTimingUnavailableReason::Unsupported => Ok("unsupported"),
        GpuTimingUnavailableReason::Busy => Ok("busy"),
        GpuTimingUnavailableReason::ReadbackFailed => Ok("readback-failed"),
        GpuTimingUnavailableReason::TooManyTimedNodes => Ok("too-many-timed-nodes"),
    }
}

fn texture_format(format: wgpu::TextureFormat) -> String {
    use wgpu::{AstcBlock, AstcChannel, TextureFormat as F};
    let name = match format {
        F::R8Unorm => "r8unorm",
        F::R8Snorm => "r8snorm",
        F::R8Uint => "r8uint",
        F::R8Sint => "r8sint",
        F::R16Uint => "r16uint",
        F::R16Sint => "r16sint",
        F::R16Unorm => "r16unorm",
        F::R16Snorm => "r16snorm",
        F::R16Float => "r16float",
        F::Rg8Unorm => "rg8unorm",
        F::Rg8Snorm => "rg8snorm",
        F::Rg8Uint => "rg8uint",
        F::Rg8Sint => "rg8sint",
        F::R32Uint => "r32uint",
        F::R32Sint => "r32sint",
        F::R32Float => "r32float",
        F::Rg16Uint => "rg16uint",
        F::Rg16Sint => "rg16sint",
        F::Rg16Unorm => "rg16unorm",
        F::Rg16Snorm => "rg16snorm",
        F::Rg16Float => "rg16float",
        F::Rgba8Unorm => "rgba8unorm",
        F::Rgba8UnormSrgb => "rgba8unorm-srgb",
        F::Rgba8Snorm => "rgba8snorm",
        F::Rgba8Uint => "rgba8uint",
        F::Rgba8Sint => "rgba8sint",
        F::Bgra8Unorm => "bgra8unorm",
        F::Bgra8UnormSrgb => "bgra8unorm-srgb",
        F::Rgb9e5Ufloat => "rgb9e5ufloat",
        F::Rgb10a2Uint => "rgb10a2uint",
        F::Rgb10a2Unorm => "rgb10a2unorm",
        F::Rg11b10Ufloat => "rg11b10ufloat",
        F::R64Uint => "r64uint",
        F::Rg32Uint => "rg32uint",
        F::Rg32Sint => "rg32sint",
        F::Rg32Float => "rg32float",
        F::Rgba16Uint => "rgba16uint",
        F::Rgba16Sint => "rgba16sint",
        F::Rgba16Unorm => "rgba16unorm",
        F::Rgba16Snorm => "rgba16snorm",
        F::Rgba16Float => "rgba16float",
        F::Rgba32Uint => "rgba32uint",
        F::Rgba32Sint => "rgba32sint",
        F::Rgba32Float => "rgba32float",
        F::Stencil8 => "stencil8",
        F::Depth16Unorm => "depth16unorm",
        F::Depth24Plus => "depth24plus",
        F::Depth24PlusStencil8 => "depth24plus-stencil8",
        F::Depth32Float => "depth32float",
        F::Depth32FloatStencil8 => "depth32float-stencil8",
        F::NV12 => "nv12",
        F::P010 => "p010",
        F::Bc1RgbaUnorm => "bc1-rgba-unorm",
        F::Bc1RgbaUnormSrgb => "bc1-rgba-unorm-srgb",
        F::Bc2RgbaUnorm => "bc2-rgba-unorm",
        F::Bc2RgbaUnormSrgb => "bc2-rgba-unorm-srgb",
        F::Bc3RgbaUnorm => "bc3-rgba-unorm",
        F::Bc3RgbaUnormSrgb => "bc3-rgba-unorm-srgb",
        F::Bc4RUnorm => "bc4-r-unorm",
        F::Bc4RSnorm => "bc4-r-snorm",
        F::Bc5RgUnorm => "bc5-rg-unorm",
        F::Bc5RgSnorm => "bc5-rg-snorm",
        F::Bc6hRgbUfloat => "bc6h-rgb-ufloat",
        F::Bc6hRgbFloat => "bc6h-rgb-float",
        F::Bc7RgbaUnorm => "bc7-rgba-unorm",
        F::Bc7RgbaUnormSrgb => "bc7-rgba-unorm-srgb",
        F::Etc2Rgb8Unorm => "etc2-rgb8unorm",
        F::Etc2Rgb8UnormSrgb => "etc2-rgb8unorm-srgb",
        F::Etc2Rgb8A1Unorm => "etc2-rgb8a1unorm",
        F::Etc2Rgb8A1UnormSrgb => "etc2-rgb8a1unorm-srgb",
        F::Etc2Rgba8Unorm => "etc2-rgba8unorm",
        F::Etc2Rgba8UnormSrgb => "etc2-rgba8unorm-srgb",
        F::EacR11Unorm => "eac-r11unorm",
        F::EacR11Snorm => "eac-r11snorm",
        F::EacRg11Unorm => "eac-rg11unorm",
        F::EacRg11Snorm => "eac-rg11snorm",
        F::Astc { block, channel } => {
            let block = match block {
                AstcBlock::B4x4 => "4x4",
                AstcBlock::B5x4 => "5x4",
                AstcBlock::B5x5 => "5x5",
                AstcBlock::B6x5 => "6x5",
                AstcBlock::B6x6 => "6x6",
                AstcBlock::B8x5 => "8x5",
                AstcBlock::B8x6 => "8x6",
                AstcBlock::B8x8 => "8x8",
                AstcBlock::B10x5 => "10x5",
                AstcBlock::B10x6 => "10x6",
                AstcBlock::B10x8 => "10x8",
                AstcBlock::B10x10 => "10x10",
                AstcBlock::B12x10 => "12x10",
                AstcBlock::B12x12 => "12x12",
            };
            let channel = match channel {
                AstcChannel::Unorm => "unorm",
                AstcChannel::UnormSrgb => "unorm-srgb",
                AstcChannel::Hdr => "hdr",
            };
            return format!("astc-{block}-{channel}");
        }
    };
    name.into()
}

fn node_id(id: u32) -> String {
    format!("node:{id}")
}

fn resource_id(id: u32) -> String {
    format!("resource:{id}")
}

fn view_id(id: u32) -> String {
    format!("view:{id}")
}

fn group_id(id: u32) -> String {
    format!("group:{id}")
}

fn allocation_id(id: u32) -> String {
    format!("allocation:{id}")
}

fn compatibility_id(key: &str) -> String {
    format!("compatibility:{key}")
}

fn access_id(id: u32, region: Option<usize>) -> String {
    match region {
        Some(region) => format!("access:{id}:{region}"),
        None => format!("access:{id}"),
    }
}

fn segment_id(order: usize) -> String {
    format!("segment:{order}")
}
