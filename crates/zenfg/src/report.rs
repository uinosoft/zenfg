use crate::{
    AccessId, AccessMode, AccessRole, AllocationId, BufferDesc, DebugGroupId, DependencyKind,
    HazardKind, NodeKind, PassId, ResourceId, ResourceKind, ResourceOrigin, ResourceRange,
    RootReason, TextureDesc, TextureViewDesc, UndefinedCause, ValueId, ViewId,
};

/// CPU time spent in each compilation phase, in nanoseconds.
#[allow(missing_docs)]
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

/// Counts, memory estimates, and timings available at summary report level.
#[allow(missing_docs)]
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

/// Effective native usage inferred for a retained logical resource.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ResourceUsage {
    Texture(wgpu::TextureUsages),
    Buffer(wgpu::BufferUsages),
}

impl ResourceUsage {
    /// Returns the native wgpu bit representation as a common integer type.
    pub const fn bits(self) -> u64 {
        match self {
            Self::Texture(value) => value.bits() as u64,
            Self::Buffer(value) => value.bits() as u64,
        }
    }
}

/// Snapshotted logical descriptor of a reported resource.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ResourceDescriptor {
    Texture(TextureDesc),
    Buffer(BufferDesc),
}

/// One retained node in original recording order.
#[allow(missing_docs)]
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

/// Why a recorded node was removed from the retained plan.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum CulledNodeReason {
    #[default]
    NotReachableFromRoot,
}

/// One removed node in original recording order.
#[allow(missing_docs)]
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

/// Descriptor, usage, lifetime, and allocation facts for one logical resource.
#[allow(missing_docs)]
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
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DebugGroupReport {
    pub id: DebugGroupId,
    pub parent: Option<DebugGroupId>,
    pub label: String,
}

/// One normalized logical texture view.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ViewReport {
    pub id: ViewId,
    pub texture: ResourceId,
    pub descriptor: TextureViewDesc,
    pub range: ResourceRange,
}

/// One declared resource access in recording order.
#[allow(missing_docs)]
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

/// Origin of one logical content value.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ValueKind {
    External,
    Write,
}

/// One initial or pass-produced logical content value.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ValueReport {
    pub id: ValueId,
    pub resource: ResourceId,
    pub producer: Option<PassId>,
    pub kind: ValueKind,
    pub range: ResourceRange,
}

/// One value-carrying or ordering dependency between graph nodes.
#[allow(missing_docs)]
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

/// One observable resource range and the producers that keep it defined.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RootReport {
    pub resource: ResourceId,
    pub reason: RootReason,
    pub range: ResourceRange,
    pub producers: Vec<PassId>,
}

/// Inclusive retained execution-order interval of one logical resource.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ResourceLifetime {
    pub first_use: usize,
    pub last_use: usize,
}

/// One physical transient allocation and all aliased logical resources assigned to it.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AllocationReport {
    pub id: AllocationId,
    pub kind: ResourceKind,
    pub compatibility_key: String,
    pub resource_ids: Vec<ResourceId>,
    pub estimated_byte_size: u64,
}

/// Kind of encoder/submission segment in the retained execution plan.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ExecutionSegmentKind {
    FrameGraph,
    ExternalSubmission,
}

/// Ordered retained nodes belonging to one execution segment.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ExecutionSegmentReport {
    pub kind: ExecutionSegmentKind,
    pub nodes: Vec<PassId>,
}

/// Severity of a compilation diagnostic.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

/// Structured non-fatal diagnostic attached to a compilation report.
#[allow(missing_docs)]
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

/// Complete recording, retention, dependency, and allocation tables.
///
/// This is present only when compilation uses [`CompileOptions::full_report`](crate::CompileOptions::full_report).
#[allow(missing_docs)]
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

/// Optional compilation diagnostics selected by [`ReportLevel`](crate::ReportLevel).
///
/// The summary is always present when a report exists. [`Self::full`] is present
/// only at full report level.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CompilationReport {
    pub summary: CompilationSummary,
    pub full: Option<FullCompilationReport>,
}
