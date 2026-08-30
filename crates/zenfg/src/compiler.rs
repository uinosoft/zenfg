use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fmt,
    ops::Range,
    time::Instant,
};

use crate::{
    AccessMode, AccessReport, AccessRole, AllocationId, AllocationReport, CompilationReport,
    CompilationSummary, CompilationTimings, CompileOptions, CulledNodeReason, CulledNodeReport,
    DebugGroupReport, DependencyKind, DependencyReport, ExecutionOptions, ExecutionSegmentKind,
    ExecutionSegmentReport, Frame, FrameGraphError, FullCompilationReport, HazardKind,
    InitialContents, NodeKind, NodeReport, PassId, ReportLevel, ResourceDescriptor, ResourceId,
    ResourceKind, ResourceLifetime, ResourceOrigin, ResourceRange, ResourceReport, ResourceUsage,
    RootReport, TextureSubresourceRange, UndefinedCause, UsagePolicy, ValueId, ValueKind,
    ValueReport, ViewId, ViewReport,
    execution::{ExecutionTextureViewDescriptor, ExecutionViewPlan},
    model::{
        AccessRecord, DebugGroupRecord, NodeRecord, NormalizedRange, ResourceRecord, ViewRecord,
    },
};

#[derive(Clone, Debug)]
pub(crate) struct CompiledPlan {
    pub(crate) retained_nodes: Vec<NodeRecord>,
    pub(crate) usages: HashMap<ResourceId, ResourceUsage>,
    pub(crate) allocations: Vec<AllocationReport>,
    pub(crate) physical_allocations: Vec<PhysicalAllocationPlan>,
    pub(crate) execution_views: Vec<ExecutionViewPlan>,
    pub(crate) execution_segments: Vec<ExecutionSegmentReport>,
    pub(crate) debug_groups: Vec<DebugGroupRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum AllocationKey {
    Buffer {
        size: u64,
        usage: wgpu::BufferUsages,
    },
    Texture {
        format: wgpu::TextureFormat,
        size: (u32, u32, u32),
        dimension: wgpu::TextureDimension,
        mip_level_count: u32,
        sample_count: u32,
        view_formats: Vec<wgpu::TextureFormat>,
        usage: wgpu::TextureUsages,
    },
}

impl AllocationKey {
    pub(crate) fn kind(&self) -> ResourceKind {
        match self {
            Self::Buffer { .. } => ResourceKind::Buffer,
            Self::Texture { .. } => ResourceKind::Texture,
        }
    }

    pub(crate) fn compatibility_key(&self) -> String {
        match self {
            Self::Buffer { size, usage } => format!("buffer|{size}|{}", usage.bits()),
            Self::Texture {
                format,
                size,
                dimension,
                mip_level_count,
                sample_count,
                view_formats,
                usage,
            } => format!(
                "texture|{format:?}|{}x{}x{}|{dimension:?}|{mip_level_count}|{sample_count}|{}|{}",
                size.0,
                size.1,
                size.2,
                view_formats
                    .iter()
                    .map(|format| format!("{format:?}"))
                    .collect::<Vec<_>>()
                    .join(","),
                usage.bits()
            ),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PhysicalAllocationPlan {
    pub(crate) id: AllocationId,
    pub(crate) key: AllocationKey,
    pub(crate) resource_ids: Vec<ResourceId>,
    pub(crate) estimated_byte_size: u64,
}

impl PhysicalAllocationPlan {
    fn report(&self) -> AllocationReport {
        AllocationReport {
            id: self.id,
            kind: self.key.kind(),
            compatibility_key: self.key.compatibility_key(),
            resource_ids: self.resource_ids.clone(),
            estimated_byte_size: self.estimated_byte_size,
        }
    }
}

/// An owned compilation result. GPU execution is available for device-backed graphs.
pub struct CompiledFrame<'frame> {
    pub(crate) graph: &'frame mut crate::FrameGraph,
    pub(crate) plan: CompiledPlan,
    pub(crate) report: Option<CompilationReport>,
    pub(crate) resources: Vec<ResourceRecord>,
    pub(crate) native_resources: HashMap<ResourceId, crate::execution::NativeResource>,
    pub(crate) executors: HashMap<PassId, crate::execution::NodeExecutor<'frame>>,
}

impl fmt::Debug for CompiledFrame<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CompiledFrame")
            .field("retained_nodes", &self.plan.retained_nodes.len())
            .field("resources", &self.resources.len())
            .field("native_resources", &self.native_resources.len())
            .field("executors", &self.executors.len())
            .field("report", &self.report)
            .finish()
    }
}

impl<'frame> CompiledFrame<'frame> {
    pub fn report(&self) -> Option<&CompilationReport> {
        self.report.as_ref()
    }

    /// Takes the optional compilation report without cloning it.
    pub fn take_report(&mut self) -> Option<CompilationReport> {
        self.report.take()
    }

    pub fn retained_node_count(&self) -> usize {
        self.plan.retained_nodes.len()
    }

    pub fn resource_usage(&self, resource: ResourceId) -> Option<ResourceUsage> {
        self.plan.usages.get(&resource).copied()
    }

    pub fn allocations(&self) -> &[AllocationReport] {
        &self.plan.allocations
    }

    pub fn execution_segments(&self) -> &[ExecutionSegmentReport] {
        &self.plan.execution_segments
    }

    pub fn execute(self, queue: &wgpu::Queue) -> Result<(), FrameGraphError> {
        self.execute_with_options(queue, ExecutionOptions::default())
    }

    pub fn execute_with_options(
        self,
        queue: &wgpu::Queue,
        options: ExecutionOptions,
    ) -> Result<(), FrameGraphError> {
        crate::execution::execute(self, queue, options)
    }

    /// Executes this frame once and starts a non-blocking GPU timestamp readback.
    pub fn execute_with_gpu_timing(
        self,
        queue: &wgpu::Queue,
        options: ExecutionOptions,
    ) -> Result<crate::GpuTimingReadback, FrameGraphError> {
        crate::execution::execute_with_gpu_timing(self, queue, options)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ContentState {
    Undefined(UndefinedCause),
    Defined {
        value: ValueId,
        producer: Option<PassId>,
    },
}

#[derive(Clone, Debug)]
struct Segment {
    start: u64,
    end: u64,
    content: ContentState,
    readers: BTreeSet<PassId>,
    last_writer: Option<PassId>,
}

#[derive(Clone, Debug, Default)]
struct IntervalState {
    segments: Vec<Segment>,
}

impl IntervalState {
    fn new(end: u64, content: ContentState) -> Self {
        Self {
            segments: if end == 0 {
                Vec::new()
            } else {
                vec![Segment {
                    start: 0,
                    end,
                    content,
                    readers: BTreeSet::new(),
                    last_writer: None,
                }]
            },
        }
    }

    fn split_at(&mut self, point: u64) {
        let Some(index) = self
            .segments
            .iter()
            .position(|segment| segment.start < point && point < segment.end)
        else {
            return;
        };
        let right = Segment {
            start: point,
            ..self.segments[index].clone()
        };
        self.segments[index].end = point;
        self.segments.insert(index + 1, right);
    }

    fn prepare(&mut self, range: Range<u64>) -> Range<usize> {
        self.split_at(range.start);
        self.split_at(range.end);
        let start = self
            .segments
            .iter()
            .position(|segment| segment.start >= range.start && segment.end <= range.end)
            .unwrap_or(self.segments.len());
        let end = self.segments[start..]
            .iter()
            .take_while(|segment| segment.end <= range.end)
            .count()
            + start;
        start..end
    }
}

#[derive(Clone, Debug)]
enum ResourceState {
    Buffer(IntervalState),
    Texture(BTreeMap<(u32, u8), IntervalState>),
}

#[derive(Default)]
struct Analysis {
    dependencies: Vec<DependencyReport>,
    value_predecessors: BTreeMap<PassId, BTreeSet<PassId>>,
    values: Vec<ValueReport>,
    root_reports: Vec<RootReport>,
}

pub(crate) fn compile<'frame>(
    mut frame: Frame<'frame>,
    options: CompileOptions,
) -> Result<CompiledFrame<'frame>, FrameGraphError> {
    let total_start = Instant::now();
    let mut timings = CompilationTimings::default();

    let validation_start = Instant::now();
    validate_recording(&frame)?;
    timings.validation_ns = elapsed_ns(validation_start);

    let dependency_start = Instant::now();
    let (mut states, mut analysis, mut next_value) = initialize_states(&frame.resources)?;
    analyze_nodes(
        &mut frame.nodes,
        &mut states,
        &mut analysis,
        &mut next_value,
    )?;
    analyze_roots(&frame, &mut states, &mut analysis)?;
    timings.dependency_ns = elapsed_ns(dependency_start);

    let retention_start = Instant::now();
    let retained = collect_retained(&frame.nodes, &analysis);
    timings.retention_ns = elapsed_ns(retention_start);

    let planning_start = Instant::now();
    let usages = derive_usages(&frame.resources, &frame.nodes, &retained)?;
    let lifetimes = compute_lifetimes(&frame.nodes, &retained);
    let (physical_allocations, allocation_by_resource) =
        build_allocations(&frame.resources, &usages, &lifetimes)?;
    let allocations = physical_allocations
        .iter()
        .map(PhysicalAllocationPlan::report)
        .collect::<Vec<_>>();
    let retained_nodes: Vec<_> = frame
        .nodes
        .iter()
        .filter(|node| retained.contains(&node.id))
        .cloned()
        .collect();
    let execution_views =
        build_execution_view_plans(&retained_nodes, &frame.resources, &frame.views)?;
    let execution_segments = build_execution_segments(&retained_nodes);
    let runtime_debug_groups = retained_debug_groups(&frame.debug_groups, &retained_nodes);
    timings.planning_ns = elapsed_ns(planning_start);

    let plan = CompiledPlan {
        retained_nodes,
        usages: usages.clone(),
        allocations: allocations.clone(),
        physical_allocations,
        execution_views,
        execution_segments: execution_segments.clone(),
        debug_groups: runtime_debug_groups,
    };

    let report = if options.report_level == ReportLevel::None {
        None
    } else {
        let report_start = Instant::now();
        let mut summary = build_summary(
            &frame,
            &retained,
            &analysis,
            &allocations,
            &lifetimes,
            &usages,
            timings,
        );
        let full = if options.report_level == ReportLevel::Full {
            Some(build_full_report(
                &frame,
                &retained,
                &analysis,
                &usages,
                &lifetimes,
                &allocations,
                &allocation_by_resource,
                execution_segments,
            ))
        } else {
            None
        };
        summary.timings.report_ns = elapsed_ns(report_start);
        summary.timings.total_ns = elapsed_ns(total_start);
        Some(CompilationReport { summary, full })
    };

    let Frame {
        graph,
        resources,
        views: _,
        native_resources,
        executors,
        ..
    } = frame;
    let mut runtime_resource_ids = plan
        .retained_nodes
        .iter()
        .flat_map(|node| node.accesses.iter().map(|access| access.resource))
        .collect::<BTreeSet<_>>();
    for allocation in &plan.physical_allocations {
        runtime_resource_ids.extend(allocation.resource_ids.iter().copied());
    }
    let resources = resources
        .into_iter()
        .filter(|resource| runtime_resource_ids.contains(&resource.id))
        .collect();
    let mut native_resources = native_resources;
    native_resources.retain(|resource, _| runtime_resource_ids.contains(resource));
    let mut executors = executors;
    executors.retain(|pass, _| retained.contains(pass));

    Ok(CompiledFrame {
        graph,
        plan,
        report,
        resources,
        native_resources,
        executors,
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum ExecutionViewKey {
    Explicit(ViewId),
    Implicit {
        resource: ResourceId,
        descriptor: ExecutionTextureViewDescriptor,
    },
}

fn build_execution_view_plans(
    nodes: &[NodeRecord],
    resources: &[ResourceRecord],
    views: &[ViewRecord],
) -> Result<Vec<ExecutionViewPlan>, FrameGraphError> {
    let resources = resources
        .iter()
        .map(|resource| (resource.id, resource))
        .collect::<HashMap<_, _>>();
    let views = views
        .iter()
        .map(|view| (view.id, view))
        .collect::<HashMap<_, _>>();
    let mut indices = HashMap::<ExecutionViewKey, usize>::new();
    let mut plans = Vec::<ExecutionViewPlan>::new();

    for access in nodes.iter().flat_map(|node| &node.accesses) {
        let Some(usage) = access.role.texture_usage() else {
            continue;
        };
        if matches!(
            access.role,
            AccessRole::TextureCopySrc | AccessRole::TextureCopyDst
        ) {
            continue;
        }
        let resource =
            resources
                .get(&access.resource)
                .copied()
                .ok_or_else(|| FrameGraphError::Internal {
                    message: format!("unknown texture resource {}", access.resource),
                })?;
        let ResourceDescriptor::Texture(texture) = &resource.descriptor else {
            return Err(FrameGraphError::Internal {
                message: format!("texture access {} references a buffer", access.id),
            });
        };
        let explicit = access.view.and_then(|view| views.get(&view).copied());
        let descriptor = execution_view_descriptor(texture, access, explicit, usage)?;
        let key = match access.view {
            Some(view) => ExecutionViewKey::Explicit(view),
            None => ExecutionViewKey::Implicit {
                resource: access.resource,
                descriptor: descriptor.clone(),
            },
        };
        if let Some(index) = indices.get(&key).copied() {
            let plan = &mut plans[index];
            plan.descriptor.usage |= usage;
            plan.accesses.push(access.id);
        } else {
            let index = plans.len();
            indices.insert(key, index);
            plans.push(ExecutionViewPlan {
                resource: access.resource,
                descriptor,
                accesses: vec![access.id],
            });
        }
    }
    Ok(plans)
}

fn execution_view_descriptor(
    texture: &crate::TextureDesc,
    access: &AccessRecord,
    explicit: Option<&ViewRecord>,
    usage: wgpu::TextureUsages,
) -> Result<ExecutionTextureViewDescriptor, FrameGraphError> {
    let NormalizedRange::Texture(regions) = &access.range else {
        return Err(FrameGraphError::Internal {
            message: format!("texture access {} has a buffer range", access.id),
        });
    };
    let first = regions.first().ok_or_else(|| FrameGraphError::Internal {
        message: format!("texture access {} has an empty range", access.id),
    })?;
    let dimension = explicit
        .and_then(|view| view.descriptor.dimension)
        .unwrap_or_else(|| infer_view_dimension(texture));
    let (base_array_layer, array_layer_count) = if texture.dimension == wgpu::TextureDimension::D3 {
        (0, None)
    } else {
        (
            explicit
                .map(|view| view.descriptor.base_array_layer)
                .unwrap_or(first.base_slice),
            Some(
                explicit
                    .and_then(|view| view.descriptor.array_layer_count)
                    .unwrap_or(first.slice_count),
            ),
        )
    };
    Ok(ExecutionTextureViewDescriptor {
        label: explicit
            .map(|view| view.descriptor.label.clone())
            .unwrap_or_default(),
        format: explicit
            .and_then(|view| view.descriptor.format)
            .unwrap_or(texture.format),
        dimension,
        usage,
        aspect: first.aspect,
        base_mip_level: explicit
            .map(|view| view.descriptor.base_mip_level)
            .unwrap_or(first.base_mip_level),
        mip_level_count: explicit
            .and_then(|view| view.descriptor.mip_level_count)
            .unwrap_or(u32::try_from(regions.len()).unwrap_or(u32::MAX)),
        base_array_layer,
        array_layer_count,
    })
}

fn infer_view_dimension(texture: &crate::TextureDesc) -> wgpu::TextureViewDimension {
    match texture.dimension {
        wgpu::TextureDimension::D1 => wgpu::TextureViewDimension::D1,
        wgpu::TextureDimension::D2 if texture.size.depth_or_array_layers == 1 => {
            wgpu::TextureViewDimension::D2
        }
        wgpu::TextureDimension::D2 => wgpu::TextureViewDimension::D2Array,
        wgpu::TextureDimension::D3 => wgpu::TextureViewDimension::D3,
    }
}

fn retained_debug_groups(
    groups: &[DebugGroupRecord],
    nodes: &[NodeRecord],
) -> Vec<DebugGroupRecord> {
    let by_id = groups
        .iter()
        .map(|group| (group.id, group))
        .collect::<HashMap<_, _>>();
    let mut retained = BTreeSet::new();
    for node in nodes {
        let mut current = node.debug_group;
        while let Some(group) = current {
            if !retained.insert(group) {
                break;
            }
            current = by_id.get(&group).and_then(|record| record.parent);
        }
    }
    groups
        .iter()
        .filter(|group| retained.contains(&group.id))
        .cloned()
        .collect()
}

fn validate_recording(frame: &Frame<'_>) -> Result<(), FrameGraphError> {
    for node in &frame.nodes {
        for access in &node.accesses {
            let resource = frame.resource(access.resource)?;
            if resource.kind() != access.role.kind() {
                return Err(FrameGraphError::Internal {
                    message: format!(
                        "access {} role {:?} does not match resource kind {:?}",
                        access.id,
                        access.role,
                        resource.kind()
                    ),
                });
            }
            if !role_allowed_in_node(node.kind, access.role) {
                return Err(FrameGraphError::InvalidNodeOperation {
                    pass: node.id,
                    resource: Some(access.resource),
                    message: format!(
                        "access role {:?} is not valid for a {:?} node",
                        access.role, node.kind
                    ),
                });
            }
        }
    }
    Ok(())
}

fn role_allowed_in_node(kind: NodeKind, role: AccessRole) -> bool {
    match kind {
        NodeKind::Render => !matches!(
            role,
            AccessRole::TextureCopySrc
                | AccessRole::TextureCopyDst
                | AccessRole::BufferCopySrc
                | AccessRole::BufferCopyDst
        ),
        NodeKind::Compute => matches!(
            role,
            AccessRole::SampledTexture
                | AccessRole::StorageTextureRead
                | AccessRole::StorageTextureWrite
                | AccessRole::UniformBuffer
                | AccessRole::StorageBufferRead
                | AccessRole::StorageBufferWrite
                | AccessRole::IndirectBuffer
        ),
        NodeKind::Copy => matches!(
            role,
            AccessRole::TextureCopySrc
                | AccessRole::TextureCopyDst
                | AccessRole::BufferCopySrc
                | AccessRole::BufferCopyDst
        ),
        NodeKind::ClearBuffer => role == AccessRole::BufferCopyDst,
        NodeKind::Command | NodeKind::ExternalSubmission => true,
    }
}

fn initialize_states(
    resources: &[ResourceRecord],
) -> Result<(Vec<ResourceState>, Analysis, u32), FrameGraphError> {
    let mut analysis = Analysis::default();
    let mut next_value = 0u32;
    let mut states = Vec::with_capacity(resources.len());
    for resource in resources {
        let initial = match resource.initial_contents {
            InitialContents::Defined => {
                let value = ValueId::new(next_value);
                next_value =
                    next_value
                        .checked_add(1)
                        .ok_or_else(|| FrameGraphError::Internal {
                            message: "value id overflow".into(),
                        })?;
                analysis.values.push(ValueReport {
                    id: value,
                    resource: resource.id,
                    producer: None,
                    kind: ValueKind::External,
                    range: full_resource_range(resource)?,
                });
                ContentState::Defined {
                    value,
                    producer: None,
                }
            }
            InitialContents::Undefined => ContentState::Undefined(match resource.origin {
                ResourceOrigin::Transient => UndefinedCause::Transient,
                ResourceOrigin::Imported => UndefinedCause::ImportedUndefined,
                ResourceOrigin::Surface => UndefinedCause::Surface,
            }),
        };
        match &resource.descriptor {
            ResourceDescriptor::Buffer(desc) => {
                states.push(ResourceState::Buffer(IntervalState::new(
                    desc.size, initial,
                )));
            }
            ResourceDescriptor::Texture(desc) => {
                let mut subresources = BTreeMap::new();
                for region in crate::graph::full_texture_range(desc) {
                    subresources.insert(
                        (region.base_mip_level, aspect_key(region.aspect)),
                        IntervalState::new(region.slice_count as u64, initial),
                    );
                }
                states.push(ResourceState::Texture(subresources));
            }
        }
    }
    Ok((states, analysis, next_value))
}

fn analyze_nodes(
    nodes: &mut [NodeRecord],
    states: &mut [ResourceState],
    analysis: &mut Analysis,
    next_value: &mut u32,
) -> Result<(), FrameGraphError> {
    for node in nodes {
        for access in &mut node.accesses {
            if access.range.is_empty() {
                continue;
            }
            let new_value = if access.mode == AccessMode::Write && access.produces_value {
                let value = ValueId::new(*next_value);
                *next_value =
                    next_value
                        .checked_add(1)
                        .ok_or_else(|| FrameGraphError::Internal {
                            message: "value id overflow".into(),
                        })?;
                access.value = Some(value);
                analysis.values.push(ValueReport {
                    id: value,
                    resource: access.resource,
                    producer: Some(node.id),
                    kind: ValueKind::Write,
                    range: access.range.report(),
                });
                Some(value)
            } else {
                None
            };
            let state = states
                .get_mut(access.resource.get() as usize)
                .ok_or_else(|| FrameGraphError::Internal {
                    message: format!("missing state for resource {}", access.resource),
                })?;
            match (&access.range, state) {
                (NormalizedRange::Buffer(range), ResourceState::Buffer(state)) => {
                    process_interval(state, range.clone(), None, access, new_value, analysis)?;
                }
                (NormalizedRange::Texture(regions), ResourceState::Texture(states)) => {
                    for region in regions {
                        let state = states
                            .get_mut(&(region.base_mip_level, aspect_key(region.aspect)))
                            .ok_or_else(|| FrameGraphError::Internal {
                                message: format!(
                                    "missing texture state for resource {}, mip {}",
                                    access.resource, region.base_mip_level
                                ),
                            })?;
                        process_interval(
                            state,
                            region.base_slice as u64
                                ..(region.base_slice + region.slice_count) as u64,
                            Some(region),
                            access,
                            new_value,
                            analysis,
                        )?;
                    }
                }
                _ => {
                    return Err(FrameGraphError::Internal {
                        message: format!("range kind mismatch for resource {}", access.resource),
                    });
                }
            }
        }
    }
    Ok(())
}

fn process_interval(
    state: &mut IntervalState,
    range: Range<u64>,
    texture_region: Option<&TextureSubresourceRange>,
    access: &AccessRecord,
    new_value: Option<ValueId>,
    analysis: &mut Analysis,
) -> Result<(), FrameGraphError> {
    if range.is_empty() {
        return Ok(());
    }
    let indices = state.prepare(range);
    for segment in &mut state.segments[indices] {
        let report_range = piece_range(access, texture_region, segment.start, segment.end);
        match access.mode {
            AccessMode::Read => {
                let (value, producer) =
                    require_defined(segment.content, access, &report_range, false)?;
                if let Some(producer) = producer {
                    add_dependency(
                        analysis,
                        producer,
                        access.pass,
                        access.resource,
                        DependencyKind::Value,
                        HazardKind::Raw,
                        report_range.clone(),
                        Some(value),
                    );
                }
                segment.readers.insert(access.pass);
            }
            AccessMode::Write => {
                if access.consumes_previous {
                    let (value, producer) =
                        require_defined(segment.content, access, &report_range, true)?;
                    if let Some(producer) = producer {
                        add_dependency(
                            analysis,
                            producer,
                            access.pass,
                            access.resource,
                            DependencyKind::Value,
                            HazardKind::Preserve,
                            report_range.clone(),
                            Some(value),
                        );
                    }
                }
                for reader in segment.readers.iter().copied() {
                    add_dependency(
                        analysis,
                        reader,
                        access.pass,
                        access.resource,
                        DependencyKind::Ordering,
                        HazardKind::War,
                        report_range.clone(),
                        None,
                    );
                }
                if let Some(writer) = segment.last_writer {
                    add_dependency(
                        analysis,
                        writer,
                        access.pass,
                        access.resource,
                        DependencyKind::Ordering,
                        HazardKind::Waw,
                        report_range.clone(),
                        None,
                    );
                }
                segment.content = if access.produces_value {
                    ContentState::Defined {
                        value: new_value.expect("write value"),
                        producer: Some(access.pass),
                    }
                } else {
                    ContentState::Undefined(UndefinedCause::Discarded)
                };
                segment.last_writer = Some(access.pass);
                segment.readers.clear();
            }
        }
    }
    Ok(())
}

fn require_defined(
    content: ContentState,
    access: &AccessRecord,
    range: &ResourceRange,
    preserve: bool,
) -> Result<(ValueId, Option<PassId>), FrameGraphError> {
    match content {
        ContentState::Defined { value, producer } => Ok((value, producer)),
        ContentState::Undefined(UndefinedCause::Discarded) => {
            Err(FrameGraphError::ReadAfterDiscard {
                pass: access.pass,
                resource: access.resource,
                range: describe_range(range),
            })
        }
        ContentState::Undefined(_) if preserve => Err(FrameGraphError::PreserveBeforeWrite {
            pass: access.pass,
            resource: access.resource,
            range: describe_range(range),
        }),
        ContentState::Undefined(_) => Err(FrameGraphError::ReadBeforeWrite {
            pass: access.pass,
            resource: access.resource,
            range: describe_range(range),
        }),
    }
}

#[allow(clippy::too_many_arguments)]
fn add_dependency(
    analysis: &mut Analysis,
    from: PassId,
    to: PassId,
    resource: ResourceId,
    kind: DependencyKind,
    hazard: HazardKind,
    range: ResourceRange,
    value: Option<ValueId>,
) {
    if from == to {
        return;
    }
    let dependency = DependencyReport {
        from,
        to,
        resource,
        kind,
        hazard,
        range,
        value,
    };
    if !analysis.dependencies.contains(&dependency) {
        analysis.dependencies.push(dependency);
    }
    if kind == DependencyKind::Value {
        analysis
            .value_predecessors
            .entry(to)
            .or_default()
            .insert(from);
    }
}

fn analyze_roots(
    frame: &Frame<'_>,
    states: &mut [ResourceState],
    analysis: &mut Analysis,
) -> Result<(), FrameGraphError> {
    for root in &frame.roots {
        let state = states
            .get_mut(root.resource.get() as usize)
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("missing root state for resource {}", root.resource),
            })?;
        let mut producers = BTreeSet::new();
        match (&root.range, state) {
            (NormalizedRange::Buffer(range), ResourceState::Buffer(state)) => {
                collect_root_interval(state, range.clone(), None, root.resource, &mut producers)?;
            }
            (NormalizedRange::Texture(regions), ResourceState::Texture(states)) => {
                for region in regions {
                    let state = states
                        .get_mut(&(region.base_mip_level, aspect_key(region.aspect)))
                        .ok_or_else(|| FrameGraphError::Internal {
                            message: "missing texture root state".into(),
                        })?;
                    collect_root_interval(
                        state,
                        region.base_slice as u64..(region.base_slice + region.slice_count) as u64,
                        Some(region),
                        root.resource,
                        &mut producers,
                    )?;
                }
            }
            _ => {
                return Err(FrameGraphError::Internal {
                    message: "root range kind mismatch".into(),
                });
            }
        }
        analysis.root_reports.push(RootReport {
            resource: root.resource,
            reason: root.reason,
            range: root.range.report(),
            producers: producers.into_iter().collect(),
        });
    }
    Ok(())
}

fn collect_root_interval(
    state: &mut IntervalState,
    range: Range<u64>,
    texture_region: Option<&TextureSubresourceRange>,
    resource: ResourceId,
    producers: &mut BTreeSet<PassId>,
) -> Result<(), FrameGraphError> {
    if range.is_empty() {
        return Ok(());
    }
    let indices = state.prepare(range);
    for segment in &state.segments[indices] {
        match segment.content {
            ContentState::Defined { producer, .. } => {
                if let Some(producer) = producer {
                    producers.insert(producer);
                }
            }
            ContentState::Undefined(_) => {
                let range = if let Some(region) = texture_region {
                    ResourceRange::Texture(vec![TextureSubresourceRange {
                        base_slice: segment.start as u32,
                        slice_count: (segment.end - segment.start) as u32,
                        ..*region
                    }])
                } else {
                    ResourceRange::Buffer(crate::BufferRange::new(
                        segment.start,
                        segment.end - segment.start,
                    ))
                };
                return Err(FrameGraphError::RootReferencesUndefinedContents {
                    resource,
                    range: describe_range(&range),
                });
            }
        }
    }
    Ok(())
}

fn collect_retained(nodes: &[NodeRecord], analysis: &Analysis) -> BTreeSet<PassId> {
    let mut retained = BTreeSet::new();
    let mut stack: Vec<_> = nodes
        .iter()
        .filter(|node| node.side_effect)
        .map(|node| node.id)
        .chain(
            analysis
                .root_reports
                .iter()
                .flat_map(|root| root.producers.iter().copied()),
        )
        .collect();
    while let Some(node) = stack.pop() {
        if !retained.insert(node) {
            continue;
        }
        if let Some(predecessors) = analysis.value_predecessors.get(&node) {
            stack.extend(predecessors.iter().copied());
        }
    }
    retained
}

fn derive_usages(
    resources: &[ResourceRecord],
    nodes: &[NodeRecord],
    retained: &BTreeSet<PassId>,
) -> Result<HashMap<ResourceId, ResourceUsage>, FrameGraphError> {
    let mut texture_required = HashMap::<ResourceId, wgpu::TextureUsages>::new();
    let mut buffer_required = HashMap::<ResourceId, wgpu::BufferUsages>::new();
    for node in nodes.iter().filter(|node| retained.contains(&node.id)) {
        for access in &node.accesses {
            if let Some(usage) = access.role.texture_usage() {
                *texture_required
                    .entry(access.resource)
                    .or_insert(wgpu::TextureUsages::empty()) |= usage;
            }
            if let Some(usage) = access.role.buffer_usage() {
                *buffer_required
                    .entry(access.resource)
                    .or_insert(wgpu::BufferUsages::empty()) |= usage;
            }
        }
    }
    let mut result = HashMap::with_capacity(resources.len());
    for resource in resources {
        match &resource.descriptor {
            ResourceDescriptor::Texture(desc) => {
                let required = texture_required
                    .get(&resource.id)
                    .copied()
                    .unwrap_or_else(wgpu::TextureUsages::empty);
                let available = match resource.origin {
                    ResourceOrigin::Transient => match desc.usage {
                        UsagePolicy::Infer => required,
                        UsagePolicy::Fixed(value) => value,
                    },
                    ResourceOrigin::Imported | ResourceOrigin::Surface => {
                        resource.exposed_texture_usage.unwrap_or(required)
                    }
                };
                if !available.contains(required) {
                    return Err(FrameGraphError::UsageMismatch {
                        resource: resource.id,
                        required: required.bits() as u64,
                        available: available.bits() as u64,
                    });
                }
                result.insert(resource.id, ResourceUsage::Texture(available));
            }
            ResourceDescriptor::Buffer(desc) => {
                let required = buffer_required
                    .get(&resource.id)
                    .copied()
                    .unwrap_or_else(wgpu::BufferUsages::empty);
                let available = match resource.origin {
                    ResourceOrigin::Transient => match desc.usage {
                        UsagePolicy::Infer => required,
                        UsagePolicy::Fixed(value) => value,
                    },
                    ResourceOrigin::Imported | ResourceOrigin::Surface => {
                        resource.exposed_buffer_usage.unwrap_or(required)
                    }
                };
                if !available.contains(required) {
                    return Err(FrameGraphError::UsageMismatch {
                        resource: resource.id,
                        required: required.bits() as u64,
                        available: available.bits() as u64,
                    });
                }
                result.insert(resource.id, ResourceUsage::Buffer(available));
            }
        }
    }
    Ok(result)
}

fn compute_lifetimes(
    nodes: &[NodeRecord],
    retained: &BTreeSet<PassId>,
) -> HashMap<ResourceId, ResourceLifetime> {
    let mut result = HashMap::new();
    for (index, node) in nodes
        .iter()
        .filter(|node| retained.contains(&node.id))
        .enumerate()
    {
        for access in &node.accesses {
            result
                .entry(access.resource)
                .and_modify(|lifetime: &mut ResourceLifetime| {
                    lifetime.first_use = lifetime.first_use.min(index);
                    lifetime.last_use = lifetime.last_use.max(index);
                })
                .or_insert(ResourceLifetime {
                    first_use: index,
                    last_use: index,
                });
        }
    }
    result
}

fn build_allocations(
    resources: &[ResourceRecord],
    usages: &HashMap<ResourceId, ResourceUsage>,
    lifetimes: &HashMap<ResourceId, ResourceLifetime>,
) -> Result<
    (
        Vec<PhysicalAllocationPlan>,
        HashMap<ResourceId, AllocationId>,
    ),
    FrameGraphError,
> {
    #[derive(Debug)]
    struct Builder {
        id: AllocationId,
        key: AllocationKey,
        last_use: usize,
        resources: Vec<ResourceId>,
        bytes: u64,
    }

    let mut candidates: Vec<_> = resources
        .iter()
        .filter(|resource| resource.origin == ResourceOrigin::Transient)
        .filter_map(|resource| {
            lifetimes
                .get(&resource.id)
                .map(|lifetime| (resource, *lifetime))
        })
        .collect();
    candidates
        .sort_by_key(|(resource, lifetime)| (lifetime.first_use, lifetime.last_use, resource.id));

    let mut builders: Vec<Builder> = Vec::new();
    let mut by_resource = HashMap::new();
    for (resource, lifetime) in candidates {
        let usage = usages
            .get(&resource.id)
            .copied()
            .ok_or_else(|| FrameGraphError::Internal {
                message: format!("missing usage for resource {}", resource.id),
            })?;
        let (key, bytes) = allocation_key_and_bytes(resource, usage)?;
        if let Some(existing) = builders
            .iter_mut()
            .find(|allocation| allocation.key == key && allocation.last_use < lifetime.first_use)
        {
            existing.last_use = lifetime.last_use;
            existing.resources.push(resource.id);
            by_resource.insert(resource.id, existing.id);
            continue;
        }
        let id = AllocationId::new(u32::try_from(builders.len()).map_err(|_| {
            FrameGraphError::Internal {
                message: "allocation id overflow".into(),
            }
        })?);
        builders.push(Builder {
            id,
            key,
            last_use: lifetime.last_use,
            resources: vec![resource.id],
            bytes,
        });
        by_resource.insert(resource.id, id);
    }
    Ok((
        builders
            .into_iter()
            .map(|builder| PhysicalAllocationPlan {
                id: builder.id,
                key: builder.key,
                resource_ids: builder.resources,
                estimated_byte_size: builder.bytes,
            })
            .collect(),
        by_resource,
    ))
}

pub(crate) fn allocation_key_and_bytes(
    resource: &ResourceRecord,
    usage: ResourceUsage,
) -> Result<(AllocationKey, u64), FrameGraphError> {
    match (&resource.descriptor, usage) {
        (ResourceDescriptor::Buffer(desc), ResourceUsage::Buffer(usage)) => {
            let size = allocation_buffer_size(desc.size)?;
            Ok((AllocationKey::Buffer { size, usage }, size))
        }
        (ResourceDescriptor::Texture(desc), ResourceUsage::Texture(usage)) => {
            let mut formats = desc.view_formats.clone();
            formats.sort_by_key(|format| format!("{format:?}"));
            formats.dedup();
            Ok((
                AllocationKey::Texture {
                    format: desc.format,
                    size: (
                        desc.size.width,
                        desc.size.height,
                        desc.size.depth_or_array_layers,
                    ),
                    dimension: desc.dimension,
                    mip_level_count: desc.mip_level_count,
                    sample_count: desc.sample_count,
                    view_formats: formats,
                    usage,
                },
                estimate_texture_bytes(desc),
            ))
        }
        _ => Err(FrameGraphError::Internal {
            message: format!("usage kind mismatch for resource {}", resource.id),
        }),
    }
}

fn allocation_buffer_size(size: u64) -> Result<u64, FrameGraphError> {
    size.max(1).checked_next_power_of_two().ok_or_else(|| {
        FrameGraphError::InvalidResourceDescriptor {
            message: format!("buffer size {size} cannot be rounded to a power-of-two bucket"),
        }
    })
}

fn estimate_texture_bytes(desc: &crate::TextureDesc) -> u64 {
    let (block_width, block_height) = desc.format.block_dimensions();
    let aspect = if desc.format.has_depth_aspect() {
        Some(wgpu::TextureAspect::DepthOnly)
    } else {
        None
    };
    let block_bytes = desc.format.block_copy_size(aspect).unwrap_or(4) as u64;
    let mut total = 0u64;
    for mip in 0..desc.mip_level_count {
        let width = (desc.size.width >> mip).max(1) as u64;
        let height = (desc.size.height >> mip).max(1) as u64;
        let depth = if desc.dimension == wgpu::TextureDimension::D3 {
            (desc.size.depth_or_array_layers >> mip).max(1) as u64
        } else {
            desc.size.depth_or_array_layers as u64
        };
        total = total.saturating_add(
            width
                .div_ceil(block_width as u64)
                .saturating_mul(height.div_ceil(block_height as u64))
                .saturating_mul(depth)
                .saturating_mul(block_bytes)
                .saturating_mul(desc.sample_count as u64),
        );
    }
    total
}

fn build_execution_segments(nodes: &[NodeRecord]) -> Vec<ExecutionSegmentReport> {
    let mut result = Vec::new();
    let mut graph_nodes = Vec::new();
    for node in nodes {
        if node.kind == NodeKind::ExternalSubmission {
            if !graph_nodes.is_empty() {
                result.push(ExecutionSegmentReport {
                    kind: ExecutionSegmentKind::FrameGraph,
                    nodes: core::mem::take(&mut graph_nodes),
                });
            }
            result.push(ExecutionSegmentReport {
                kind: ExecutionSegmentKind::ExternalSubmission,
                nodes: vec![node.id],
            });
        } else {
            graph_nodes.push(node.id);
        }
    }
    if !graph_nodes.is_empty() {
        result.push(ExecutionSegmentReport {
            kind: ExecutionSegmentKind::FrameGraph,
            nodes: graph_nodes,
        });
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn build_summary(
    frame: &Frame<'_>,
    retained: &BTreeSet<PassId>,
    analysis: &Analysis,
    allocations: &[AllocationReport],
    lifetimes: &HashMap<ResourceId, ResourceLifetime>,
    usages: &HashMap<ResourceId, ResourceUsage>,
    timings: CompilationTimings,
) -> CompilationSummary {
    let logical_transient_bytes = frame
        .resources
        .iter()
        .filter(|resource| resource.origin == ResourceOrigin::Transient)
        .filter(|resource| lifetimes.contains_key(&resource.id))
        .map(|resource| resource_estimated_bytes(resource, usages[&resource.id]))
        .sum();
    CompilationSummary {
        recorded_node_count: frame.nodes.len(),
        retained_node_count: retained.len(),
        culled_node_count: frame.nodes.len() - retained.len(),
        resource_count: frame.resources.len(),
        view_count: frame.views.len(),
        access_count: frame.nodes.iter().map(|node| node.accesses.len()).sum(),
        value_count: analysis.values.len(),
        dependency_count: analysis.dependencies.len(),
        allocation_count: allocations.len(),
        logical_transient_bytes,
        physical_allocation_bytes: allocations
            .iter()
            .map(|entry| entry.estimated_byte_size)
            .sum(),
        timings,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_full_report(
    frame: &Frame<'_>,
    retained: &BTreeSet<PassId>,
    analysis: &Analysis,
    usages: &HashMap<ResourceId, ResourceUsage>,
    lifetimes: &HashMap<ResourceId, ResourceLifetime>,
    allocations: &[AllocationReport],
    allocation_by_resource: &HashMap<ResourceId, AllocationId>,
    execution_segments: Vec<ExecutionSegmentReport>,
) -> FullCompilationReport {
    let node_report = |recording_order: usize, node: &NodeRecord| NodeReport {
        id: node.id,
        recording_order: u32::try_from(recording_order).unwrap_or(u32::MAX),
        kind: node.kind,
        label: node.label.clone(),
        side_effect: node.side_effect,
        debug_group: node.debug_group,
    };
    FullCompilationReport {
        nodes: frame
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| retained.contains(&node.id))
            .map(|(order, node)| node_report(order, node))
            .collect(),
        culled_nodes: frame
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| !retained.contains(&node.id))
            .map(|(recording_order, node)| CulledNodeReport {
                id: node.id,
                recording_order: u32::try_from(recording_order).unwrap_or(u32::MAX),
                kind: node.kind,
                label: node.label.clone(),
                side_effect: node.side_effect,
                debug_group: node.debug_group,
                reason: CulledNodeReason::NotReachableFromRoot,
            })
            .collect(),
        resources: frame
            .resources
            .iter()
            .map(|resource| ResourceReport {
                id: resource.id,
                kind: resource.kind(),
                label: resource.label().to_owned(),
                origin: resource.origin,
                initial_contents: resource.initial_contents,
                descriptor: resource.descriptor.clone(),
                effective_usage: usages[&resource.id],
                estimated_byte_size: resource_estimated_bytes(resource, usages[&resource.id]),
                lifetime: lifetimes.get(&resource.id).copied(),
                allocation: allocation_by_resource.get(&resource.id).copied(),
                debug_group: resource.debug_group,
            })
            .collect(),
        views: frame
            .views
            .iter()
            .map(|view| ViewReport {
                id: view.id,
                texture: view.texture,
                descriptor: view.descriptor.clone(),
                range: view.range.report(),
            })
            .collect(),
        accesses: frame
            .nodes
            .iter()
            .flat_map(|node| node.accesses.iter())
            .map(|access| AccessReport {
                id: access.id,
                pass: access.pass,
                resource: access.resource,
                view: access.view,
                role: access.role,
                mode: access.mode,
                consumes_previous: access.consumes_previous,
                produces_value: access.produces_value,
                range: access.range.report(),
                value: access.value,
            })
            .collect(),
        values: analysis.values.clone(),
        dependencies: analysis.dependencies.clone(),
        roots: analysis.root_reports.clone(),
        allocations: allocations.to_vec(),
        execution_segments,
        diagnostics: Vec::new(),
        debug_groups: frame
            .debug_groups
            .iter()
            .map(|group| DebugGroupReport {
                id: group.id,
                parent: group.parent,
                label: group.label.clone(),
            })
            .collect(),
    }
}

fn resource_estimated_bytes(resource: &ResourceRecord, _usage: ResourceUsage) -> u64 {
    match &resource.descriptor {
        ResourceDescriptor::Buffer(desc) => desc.size,
        ResourceDescriptor::Texture(desc) => estimate_texture_bytes(desc),
    }
}

fn full_resource_range(resource: &ResourceRecord) -> Result<ResourceRange, FrameGraphError> {
    Ok(match &resource.descriptor {
        ResourceDescriptor::Buffer(desc) => {
            ResourceRange::Buffer(crate::BufferRange::new(0, desc.size))
        }
        ResourceDescriptor::Texture(desc) => {
            ResourceRange::Texture(crate::graph::full_texture_range(desc))
        }
    })
}

fn piece_range(
    access: &AccessRecord,
    texture_region: Option<&TextureSubresourceRange>,
    start: u64,
    end: u64,
) -> ResourceRange {
    match texture_region {
        Some(region) => ResourceRange::Texture(vec![TextureSubresourceRange {
            base_slice: start as u32,
            slice_count: (end - start) as u32,
            ..*region
        }]),
        None => {
            debug_assert!(matches!(access.range, NormalizedRange::Buffer(_)));
            ResourceRange::Buffer(crate::BufferRange::new(start, end - start))
        }
    }
}

fn describe_range(range: &ResourceRange) -> String {
    match range {
        ResourceRange::Buffer(range) => {
            format!(
                "bytes {}..{}",
                range.offset,
                range.offset + range.size.unwrap_or(0)
            )
        }
        ResourceRange::Texture(regions) => regions
            .iter()
            .map(|region| {
                format!(
                    "mip {} slices {}..{} {:?}",
                    region.base_mip_level,
                    region.base_slice,
                    region.base_slice + region.slice_count,
                    region.aspect
                )
            })
            .collect::<Vec<_>>()
            .join(", "),
    }
}

fn aspect_key(aspect: wgpu::TextureAspect) -> u8 {
    match aspect {
        wgpu::TextureAspect::All => 0,
        wgpu::TextureAspect::StencilOnly => 1,
        wgpu::TextureAspect::DepthOnly => 2,
        wgpu::TextureAspect::Plane0 => 3,
        wgpu::TextureAspect::Plane1 => 4,
        wgpu::TextureAspect::Plane2 => 5,
    }
}

fn elapsed_ns(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_nanos()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use crate::{
        BufferDesc, BufferRange, ColorAttachmentOps, CompileOptions, FrameGraph,
        ImportBufferOptions, ImportTextureOptions, InitialContents, TextureDesc, TextureViewDesc,
        WriteContents,
    };

    #[test]
    fn explicit_execution_view_unions_only_retained_usage() {
        let mut graph = FrameGraph::new();
        let mut frame = graph.begin_frame();
        let texture = frame
            .import_texture(
                TextureDesc::new_2d("shared", 4, 4, wgpu::TextureFormat::Rgba8Unorm),
                ImportTextureOptions::new(InitialContents::Defined),
            )
            .unwrap();
        let view = frame
            .create_texture_view(texture, TextureViewDesc::default())
            .unwrap();
        let mut sampled = frame.command_pass("sampled");
        let _ = sampled.sampled_texture(view).unwrap();
        sampled.finish_command(|_| Ok(())).unwrap();
        let mut storage = frame.command_pass("storage");
        let _ = storage.storage_texture_read(view).unwrap();
        storage.finish_command(|_| Ok(())).unwrap();
        let mut culled_attachment = frame.render_pass("culled-attachment");
        culled_attachment.set_side_effect(false);
        let _ = culled_attachment
            .color_attachment(view, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
            .unwrap();
        culled_attachment.finish_render(|_| Ok(())).unwrap();

        let compiled = frame.compile(CompileOptions::default()).unwrap();
        assert_eq!(compiled.plan.execution_views.len(), 1);
        assert_eq!(compiled.plan.execution_views[0].accesses.len(), 2);
        assert_eq!(
            compiled.plan.execution_views[0].descriptor.usage,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING
        );
    }

    #[test]
    fn aliased_logical_textures_keep_distinct_execution_views() {
        let mut graph = FrameGraph::new();
        let mut frame = graph.begin_frame();
        let first = frame
            .create_texture(TextureDesc::new_2d(
                "first",
                4,
                4,
                wgpu::TextureFormat::Rgba8Unorm,
            ))
            .unwrap();
        let second = frame
            .create_texture(TextureDesc::new_2d(
                "second",
                4,
                4,
                wgpu::TextureFormat::Rgba8Unorm,
            ))
            .unwrap();
        let mut first_pass = frame.command_pass("first-write");
        let _ = first_pass
            .storage_texture_write(first, WriteContents::Overwrite)
            .unwrap();
        first_pass.finish_command(|_| Ok(())).unwrap();
        let mut second_pass = frame.command_pass("second-write");
        let _ = second_pass
            .storage_texture_write(second, WriteContents::Overwrite)
            .unwrap();
        second_pass.finish_command(|_| Ok(())).unwrap();

        let compiled = frame.compile(CompileOptions::default()).unwrap();
        assert_eq!(compiled.plan.physical_allocations.len(), 1);
        assert_eq!(compiled.plan.execution_views.len(), 2);
        assert_ne!(
            compiled.plan.execution_views[0].resource,
            compiled.plan.execution_views[1].resource
        );
    }

    #[test]
    fn compiled_runtime_sidecar_contains_only_retained_state() {
        let (device, _) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
        let native = |label| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: 4,
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            })
        };
        let retained_native = native("retained");
        let culled_native = native("culled");
        let mut graph = FrameGraph::with_device(&device);
        let mut frame = graph.begin_frame();
        let retained = frame
            .import_buffer(
                BufferDesc::new("retained", 4),
                ImportBufferOptions::new(InitialContents::Defined),
            )
            .unwrap();
        let culled = frame
            .import_buffer(
                BufferDesc::new("culled", 4),
                ImportBufferOptions::new(InitialContents::Defined),
            )
            .unwrap();
        frame
            .bind_imported_buffer(retained, &retained_native)
            .unwrap();
        frame.bind_imported_buffer(culled, &culled_native).unwrap();
        let mut retained_pass = frame.command_pass("retained");
        let _ = retained_pass
            .storage_buffer_read(retained, BufferRange::whole())
            .unwrap();
        retained_pass.finish_command(|_| Ok(())).unwrap();
        let mut culled_pass = frame.command_pass("culled");
        culled_pass.set_side_effect(false);
        let _ = culled_pass
            .storage_buffer_read(culled, BufferRange::whole())
            .unwrap();
        culled_pass.finish_command(|_| Ok(())).unwrap();

        let compiled = frame.compile(CompileOptions::full_report()).unwrap();
        assert_eq!(compiled.resources.len(), 1);
        assert_eq!(compiled.native_resources.len(), 1);
        assert_eq!(compiled.executors.len(), 1);
        let report = compiled.report().unwrap().full.as_ref().unwrap();
        assert_eq!(report.resources.len(), 2);
        assert_eq!(report.nodes.len(), 1);
        assert_eq!(report.culled_nodes.len(), 1);
    }
}
