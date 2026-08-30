use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotVersion {
    pub major: u32,
    pub minor: u32,
}

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCapture {
    pub frame_index: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migration: Option<SnapshotMigration>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMigration {
    pub source_format: SnapshotMigrationSourceFormat,
    pub unavailable_facts: Vec<SnapshotUnavailableFact>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotMigrationSourceFormat {
    LegacyV0,
    T3dV1,
}

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotResourceKind {
    Texture,
    Buffer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotResourceOrigin {
    Transient,
    Imported,
    Surface,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotInitialContents {
    Defined,
    Undefined,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotLifetime {
    pub first_use: u64,
    pub last_use: u64,
}

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTextureSize {
    pub width: u64,
    pub height: u64,
    pub depth_or_array_layers: u64,
}

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotAccessMode {
    Read,
    Write,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotWriteContents {
    Overwrite,
    Preserve,
}

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotBufferRange {
    pub offset: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDependency {
    pub from_node_id: String,
    pub to_node_id: String,
    pub resource_id: String,
    pub kind: SnapshotDependencyKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotDependencyKind {
    Value,
    Ordering,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRoot {
    pub reason: SnapshotRootReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
}

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotDecodeSource {
    V1,
    LegacyV0,
    T3dV1,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotDecodeResult {
    pub snapshot: FrameGraphSnapshotV1,
    pub source: SnapshotDecodeSource,
    pub migrated: bool,
    pub issues: Vec<crate::SnapshotIssue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSegment {
    pub id: String,
    pub order: u64,
    pub kind: SnapshotSegmentKind,
    pub node_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotSegmentKind {
    FrameGraph,
    ExternalSubmission,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMemory {
    pub allocation_report: SnapshotAllocationReport,
    pub pool_report: SnapshotPoolReport,
}

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAllocation {
    pub id: String,
    pub kind: SnapshotResourceKind,
    pub compatibility_class_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_byte_size: Option<u64>,
}

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTimings {
    pub gpu: SnapshotGpuTimings,
}

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotGpuNodeTiming {
    pub node_id: String,
    pub duration_micros: f64,
}

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotDiagnosticSeverity {
    Info,
    Warning,
    Error,
}
