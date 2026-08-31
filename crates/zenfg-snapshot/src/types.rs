use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Major/minor version carried by every Snapshot document.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotVersion {
    pub major: u32,
    pub minor: u32,
}

/// Canonical, strongly typed ZenFG FrameGraph Snapshot 1.0 document.
///
/// This structure mirrors the portable JSON wire model. Prefer
/// [`crate::parse_frame_graph_snapshot`] or [`crate::decode_frame_graph_snapshot`]
/// over direct Serde deserialization so format/version checks, migrations, and
/// cross-record validation are applied. Prefer [`crate::to_json`] or
/// [`crate::to_json_pretty`] for validated encoding.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameGraphSnapshotV1 {
    pub format: String,
    pub version: SnapshotVersion,
    pub producer: SnapshotProducer,
    pub capture: SnapshotCapture,
    pub graph: SnapshotGraph,
    pub memory: SnapshotMemory,
    pub timings: SnapshotTimings,
    pub diagnostics: Vec<SnapshotDiagnostic>,
    pub extensions: BTreeMap<String, serde_json::Value>,
}

/// Identity and optional runtime metadata of the library that produced a capture.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotProducer {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<SnapshotRuntime>,
}

/// Optional graphics implementation, API, and native backend facts.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRuntime {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graphics_api: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
}

/// Frame identity, capture time, and optional migration provenance.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCapture {
    pub frame_index: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migration: Option<SnapshotMigration>,
}

/// Provenance and unavailable facts recorded when converting a historical format.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMigration {
    pub source_format: SnapshotMigrationSourceFormat,
    pub unavailable_facts: Vec<SnapshotUnavailableFact>,
}

/// Historical wire format from which a canonical V1 document was migrated.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotMigrationSourceFormat {
    LegacyV0,
    LegacyCandidateV1,
}

/// Canonical graph fact that a historical source format could not represent.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SnapshotUnavailableFact {
    #[serde(rename = "graph.groups")]
    GraphGroups,
    #[serde(rename = "graph.textureViews")]
    GraphTextureViews,
    #[serde(rename = "graph.nodes.recordingOrder")]
    GraphNodeRecordingOrder,
    #[serde(rename = "graph.accesses.regions")]
    GraphAccessRegions,
}

/// Relational graph tables that make up the portable captured frame.
#[allow(missing_docs)]
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGraph {
    pub groups: Vec<SnapshotGroup>,
    pub nodes: Vec<SnapshotNode>,
    pub resources: Vec<SnapshotResource>,
    pub texture_views: Vec<SnapshotTextureView>,
    pub accesses: Vec<SnapshotAccess>,
    pub dependencies: Vec<SnapshotDependency>,
    pub roots: Vec<SnapshotRoot>,
    pub segments: Vec<SnapshotSegment>,
}

/// One recording debug group and its optional parent relationship.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGroup {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable_key: Option<String>,
}

/// One recorded graph node with its original metadata and compile outcome.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotNode {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recording_order: Option<u64>,
    pub kind: SnapshotNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub side_effect: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub compile_state: SnapshotNodeCompileState,
}

/// Portable kind of work represented by a captured graph node.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotNodeKind {
    Render,
    Compute,
    Copy,
    ClearBuffer,
    Command,
    ExternalSubmission,
}

/// Whether a recorded node was retained, and its order or culling reason.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SnapshotNodeCompileState {
    Retained {
        #[serde(rename = "executionOrder")]
        execution_order: u64,
    },
    Culled {
        reason: String,
    },
}

/// One logical resource with descriptor, usage, lifetime, and allocation facts.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResource {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable_key: Option<String>,
    pub kind: SnapshotResourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub origin: SnapshotResourceOrigin,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_contents: Option<SnapshotInitialContents>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifetime: Option<SnapshotLifetime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allocation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_byte_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descriptor: Option<SnapshotResourceDescriptor>,
    pub usage_flags: Vec<SnapshotUsageFlag>,
}

/// Portable texture-or-buffer discriminator.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotResourceKind {
    Texture,
    Buffer,
}

/// Ownership and allocation origin of a captured logical resource.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotResourceOrigin {
    Transient,
    Imported,
    Surface,
}

/// Whether a resource range is readable at the start of the captured frame.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotInitialContents {
    Defined,
    Undefined,
}

/// Inclusive retained execution-order interval for one logical resource.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotLifetime {
    pub first_use: u64,
    pub last_use: u64,
}

/// Portable physical descriptor for a captured texture or buffer.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SnapshotResourceDescriptor {
    Texture {
        format: String,
        size: SnapshotTextureSize,
        dimension: String,
        #[serde(rename = "mipLevelCount")]
        mip_level_count: u64,
        #[serde(rename = "sampleCount")]
        sample_count: u64,
        #[serde(rename = "viewFormats")]
        view_formats: Vec<String>,
    },
    Buffer {
        size: u64,
    },
}

/// Three-dimensional texture extent using JSON-safe integer fields.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTextureSize {
    pub width: u64,
    pub height: u64,
    pub depth_or_array_layers: u64,
}

/// One normalized WebGPU usage flag in protocol-defined ordering.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotUsageFlag {
    MapRead,
    MapWrite,
    CopySrc,
    CopyDst,
    Index,
    Vertex,
    Uniform,
    Storage,
    Indirect,
    QueryResolve,
    TextureBinding,
    StorageBinding,
    RenderAttachment,
}

/// Fully normalized texture-view descriptor referenced by captured accesses.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTextureView {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable_key: Option<String>,
    pub resource_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub format: String,
    pub dimension: String,
    pub aspect: String,
    pub base_mip_level: u64,
    pub mip_level_count: u64,
    pub base_array_layer: u64,
    pub array_layer_count: u64,
    pub swizzle: String,
}

/// One declared node-to-resource access and its normalized affected region.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAccess {
    pub id: String,
    pub node_id: String,
    pub resource_id: String,
    pub access: SnapshotAccessKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub texture_view_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub texture_region: Option<SnapshotTextureRegion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffer_range: Option<SnapshotBufferRange>,
    pub mode: SnapshotAccessMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contents: Option<SnapshotWriteContents>,
    pub produces_value: bool,
}

/// Portable pipeline or copy role of one resource access.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotAccessKind {
    TextureSampled,
    TextureStorageRead,
    TextureStorageWrite,
    TextureColorAttachmentWrite,
    TextureDepthRead,
    TextureDepthWrite,
    TextureCopySrc,
    TextureCopyDst,
    BufferUniform,
    BufferStorageRead,
    BufferStorageWrite,
    BufferVertex,
    BufferIndex,
    BufferIndirect,
    BufferCopySrc,
    BufferCopyDst,
}

/// Whether a captured access reads or writes its resource.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotAccessMode {
    Read,
    Write,
}

/// Whether a write overwrites or preserves the prior logical value.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotWriteContents {
    Overwrite,
    Preserve,
}

/// Normalized mip, layer/depth-slice, and aspect region for a texture access.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTextureRegion {
    pub base_mip_level: u64,
    pub mip_level_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_array_layer: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub array_layer_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_depth_slice: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth_slice_count: Option<u64>,
    pub aspect: String,
}

/// Byte range for a captured buffer access; absent size means the remaining buffer.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotBufferRange {
    pub offset: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

/// One value-carrying or ordering edge between captured graph nodes.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDependency {
    pub from_node_id: String,
    pub to_node_id: String,
    pub resource_id: String,
    pub kind: SnapshotDependencyKind,
}

/// Whether a dependency carries a logical value or only constrains ordering.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotDependencyKind {
    Value,
    Ordering,
}

/// One observable resource/node root and its retention reason.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRoot {
    pub reason: SnapshotRootReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
}

/// Portable reason that a node or resource remains observable after compilation.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotRootReason {
    Present,
    Output,
    Readback,
    SideEffect,
    DebugCapture,
    PersistentState,
}

/// Input wire shape recognized by a successful decode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotDecodeSource {
    /// Canonical ZenFG Snapshot 1.0.
    V1,
    /// Historical unversioned debug-capture shape.
    LegacyV0,
    /// Historical pre-release Legacy Candidate V1 format.
    LegacyCandidateV1,
}

/// Canonical snapshot plus provenance and non-fatal migration diagnostics.
#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotDecodeResult {
    /// Validated canonical ZenFG Snapshot 1.0 value.
    pub snapshot: FrameGraphSnapshotV1,
    /// Original input format recognized by the decoder.
    pub source: SnapshotDecodeSource,
    /// Whether the decoder transformed a historical input.
    pub migrated: bool,
    /// Non-fatal warnings, including migration provenance notices.
    pub issues: Vec<crate::SnapshotIssue>,
}

/// One ordered frame-graph or external-submission execution segment.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSegment {
    pub id: String,
    pub order: u64,
    pub kind: SnapshotSegmentKind,
    pub node_ids: Vec<String>,
}

/// Ownership of command submission for one execution segment.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotSegmentKind {
    FrameGraph,
    ExternalSubmission,
}

/// Allocation-plan and cross-frame resource-pool facts for the capture.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMemory {
    pub allocation_report: SnapshotAllocationReport,
    pub pool_report: SnapshotPoolReport,
}

/// Available physical allocation table or an explicit unavailability reason.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SnapshotAllocationReport {
    Available {
        allocations: Vec<SnapshotAllocation>,
    },
    Unavailable {
        reason: String,
    },
}

/// One physical allocation compatibility class and estimated size.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAllocation {
    pub id: String,
    pub kind: SnapshotResourceKind,
    pub compatibility_class_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_byte_size: Option<u64>,
}

/// Available resource-pool counters or an explicit unavailability reason.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SnapshotPoolReport {
    Available {
        #[serde(rename = "acquireCount")]
        acquire_count: u64,
        #[serde(rename = "reuseCount")]
        reuse_count: u64,
        #[serde(rename = "createdCount")]
        created_count: u64,
        #[serde(rename = "retainedCount")]
        retained_count: u64,
        #[serde(
            rename = "estimatedRetainedBytes",
            skip_serializing_if = "Option::is_none"
        )]
        estimated_retained_bytes: Option<u64>,
    },
    Unavailable {
        reason: String,
    },
}

/// Optional timing families captured alongside the graph.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTimings {
    pub gpu: SnapshotGpuTimings,
}

/// Available GPU pass timings or an explicit unavailability reason.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SnapshotGpuTimings {
    Available {
        #[serde(rename = "frameSpanMicros")]
        frame_span_micros: f64,
        nodes: Vec<SnapshotGpuNodeTiming>,
    },
    Unavailable {
        reason: String,
    },
}

/// GPU duration, in microseconds, associated with one retained node.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGpuNodeTiming {
    pub node_id: String,
    pub duration_micros: f64,
}

/// Structured producer diagnostic with optional graph entity references.
#[allow(missing_docs)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDiagnostic {
    pub severity: SnapshotDiagnosticSeverity,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
}

/// Portable severity of a captured producer diagnostic.
#[allow(missing_docs)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotDiagnosticSeverity {
    Info,
    Warning,
    Error,
}
