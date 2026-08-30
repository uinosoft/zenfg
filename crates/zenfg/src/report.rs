use crate::{
    AccessId, AccessMode, AccessRole, AllocationId, BufferDesc, DebugGroupId, DependencyKind,
    HazardKind, NodeKind, PassId, ResourceId, ResourceKind, ResourceOrigin, ResourceRange,
    RootReason, TextureDesc, TextureViewDesc, UndefinedCause, ValueId, ViewId,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CompilationTimings {
    pub validation_ns: u64,
    pub dependency_ns: u64,
    pub retention_ns: u64,
    pub planning_ns: u64,
    pub report_ns: u64,
    pub total_ns: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CompilationSummary {
    pub recorded_node_count: usize,
    pub retained_node_count: usize,
    pub culled_node_count: usize,
    pub resource_count: usize,
    pub view_count: usize,
    pub access_count: usize,
    pub value_count: usize,
    pub dependency_count: usize,
    pub allocation_count: usize,
    pub logical_transient_bytes: u64,
    pub physical_allocation_bytes: u64,
    pub timings: CompilationTimings,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ResourceUsage {
    Texture(wgpu::TextureUsages),
    Buffer(wgpu::BufferUsages),
}

impl ResourceUsage {
    pub const fn bits(self) -> u64 {
        match self {
            Self::Texture(value) => value.bits() as u64,
            Self::Buffer(value) => value.bits() as u64,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ResourceDescriptor {
    Texture(TextureDesc),
    Buffer(BufferDesc),
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct NodeReport {
    pub id: PassId,
    #[cfg_attr(feature = "serde", serde(skip))]
    pub recording_order: u32,
    pub kind: NodeKind,
    pub label: String,
    pub side_effect: bool,
    #[cfg_attr(feature = "serde", serde(skip))]
    pub debug_group: Option<DebugGroupId>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum CulledNodeReason {
    #[default]
    NotReachableFromRoot,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CulledNodeReport {
    pub id: PassId,
    #[cfg_attr(feature = "serde", serde(skip))]
    pub recording_order: u32,
    pub kind: NodeKind,
    pub label: String,
    pub side_effect: bool,
    #[cfg_attr(feature = "serde", serde(skip))]
    pub debug_group: Option<DebugGroupId>,
    #[cfg_attr(feature = "serde", serde(skip))]
    pub reason: CulledNodeReason,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ResourceReport {
    pub id: ResourceId,
    pub kind: ResourceKind,
    pub label: String,
    pub origin: ResourceOrigin,
    pub initial_contents: crate::InitialContents,
    pub descriptor: ResourceDescriptor,
    pub effective_usage: ResourceUsage,
    pub estimated_byte_size: u64,
    pub lifetime: Option<ResourceLifetime>,
    pub allocation: Option<AllocationId>,
    #[cfg_attr(feature = "serde", serde(skip))]
    pub debug_group: Option<DebugGroupId>,
}

/// One recording-only diagnostic scope in group-open order.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DebugGroupReport {
    pub id: DebugGroupId,
    pub parent: Option<DebugGroupId>,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ViewReport {
    pub id: ViewId,
    pub texture: ResourceId,
    pub descriptor: TextureViewDesc,
    pub range: ResourceRange,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AccessReport {
    pub id: AccessId,
    pub pass: PassId,
    pub resource: ResourceId,
    pub view: Option<ViewId>,
    pub role: AccessRole,
    pub mode: AccessMode,
    pub consumes_previous: bool,
    pub produces_value: bool,
    pub range: ResourceRange,
    pub value: Option<ValueId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ValueKind {
    External,
    Write,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ValueReport {
    pub id: ValueId,
    pub resource: ResourceId,
    pub producer: Option<PassId>,
    pub kind: ValueKind,
    pub range: ResourceRange,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DependencyReport {
    pub from: PassId,
    pub to: PassId,
    pub resource: ResourceId,
    pub kind: DependencyKind,
    pub hazard: HazardKind,
    pub range: ResourceRange,
    pub value: Option<ValueId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RootReport {
    pub resource: ResourceId,
    pub reason: RootReason,
    pub range: ResourceRange,
    pub producers: Vec<PassId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ResourceLifetime {
    pub first_use: usize,
    pub last_use: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AllocationReport {
    pub id: AllocationId,
    pub kind: ResourceKind,
    pub compatibility_key: String,
    pub resource_ids: Vec<ResourceId>,
    pub estimated_byte_size: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ExecutionSegmentKind {
    FrameGraph,
    ExternalSubmission,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ExecutionSegmentReport {
    pub kind: ExecutionSegmentKind,
    pub nodes: Vec<PassId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Diagnostic {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub pass: Option<PassId>,
    pub resource: Option<ResourceId>,
    pub undefined_cause: Option<UndefinedCause>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FullCompilationReport {
    pub nodes: Vec<NodeReport>,
    pub culled_nodes: Vec<CulledNodeReport>,
    pub resources: Vec<ResourceReport>,
    pub views: Vec<ViewReport>,
    pub accesses: Vec<AccessReport>,
    pub values: Vec<ValueReport>,
    pub dependencies: Vec<DependencyReport>,
    pub roots: Vec<RootReport>,
    pub allocations: Vec<AllocationReport>,
    pub execution_segments: Vec<ExecutionSegmentReport>,
    pub diagnostics: Vec<Diagnostic>,
    #[cfg_attr(feature = "serde", serde(skip))]
    pub debug_groups: Vec<DebugGroupReport>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CompilationReport {
    pub summary: CompilationSummary,
    pub full: Option<FullCompilationReport>,
}
