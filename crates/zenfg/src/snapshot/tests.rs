use std::time::Duration;

use crate::{
    AccessId, AccessMode, AccessReport, AccessRole, AllocationId, AllocationReport, BufferDesc,
    BufferRange, CompilationReport, CulledNodeReason, CulledNodeReport, DebugGroupId,
    DebugGroupReport, DependencyKind, DependencyReport, Diagnostic, DiagnosticSeverity,
    ExecutionSegmentKind, ExecutionSegmentReport, FullCompilationReport, GpuTimingNodeKind,
    GpuTimingNodeReport, GpuTimingReport, HazardKind, InitialContents, NodeKind, NodeReport,
    PassId, ResourceDescriptor, ResourceId, ResourceKind, ResourceLifetime, ResourceOrigin,
    ResourcePoolStats, ResourceRange, ResourceReport, ResourceUsage, RootReason, RootReport,
    TextureDesc, TextureSubresourceRange, TextureViewDesc, UsagePolicy, ValueId, ViewId,
    ViewReport,
};

use super::{
    CreateFrameGraphSnapshotOptions, SnapshotAccessKind, SnapshotAccessMode,
    SnapshotAllocationReport, SnapshotDependencyKind, SnapshotDiagnosticSeverity,
    SnapshotExportError, SnapshotGpuTimings, SnapshotJsonError, SnapshotNodeCompileState,
    SnapshotNodeKind, SnapshotPoolReport, SnapshotResourceKind, SnapshotResourceOrigin,
    SnapshotRootReason, SnapshotSegmentKind, SnapshotUsageFlag, SnapshotWriteContents,
    create_frame_graph_snapshot, to_json_pretty, validate_typed_frame_graph_snapshot,
};

#[test]
fn golden_snapshot_covers_v1_wire_mapping() {
    let (report, timing, pool) = fixture_report();
    let mut options = CreateFrameGraphSnapshotOptions::new(7);
    options.captured_at = Some("2026-08-29T12:00:00Z");
    options.backend = Some("vulkan");
    options.gpu_timing = Some(&timing);
    options.pool_stats = Some(pool);
    let snapshot = create_frame_graph_snapshot(&report, options).unwrap();

    assert_eq!(snapshot.format, "zenfg.frame-graph-snapshot");
    assert_eq!(snapshot.version.major, 1);
    assert_eq!(snapshot.version.minor, 0);
    assert_eq!(
        snapshot.graph.groups[1].parent_id.as_deref(),
        Some("group:0")
    );
    assert_eq!(snapshot.graph.nodes[1].id, "node:2");
    assert!(matches!(
        snapshot.graph.nodes[1].compile_state,
        SnapshotNodeCompileState::Culled { .. }
    ));
    assert!(matches!(
        snapshot.graph.nodes[2].compile_state,
        SnapshotNodeCompileState::Retained { execution_order: 1 }
    ));
    assert_eq!(
        snapshot
            .graph
            .accesses
            .iter()
            .filter(|access| access.id.starts_with("access:0:"))
            .count(),
        2
    );
    let region = snapshot.graph.accesses[0].texture_region.as_ref().unwrap();
    assert_eq!(region.base_depth_slice, Some(0));
    assert_eq!(region.base_array_layer, None);
    assert_eq!(
        snapshot.graph.accesses[0].texture_view_id.as_deref(),
        Some("view:0")
    );
    assert_eq!(
        snapshot
            .graph
            .accesses
            .iter()
            .find(|access| access.id == "access:2")
            .unwrap()
            .access,
        SnapshotAccessKind::BufferStorageWrite
    );
    assert_eq!(snapshot.graph.dependencies.len(), 1);
    assert!(snapshot.graph.roots.iter().any(|root| {
        root.reason == SnapshotRootReason::SideEffect && root.node_id.as_deref() == Some("node:1")
    }));
    assert!(snapshot.graph.roots.iter().any(|root| {
        root.reason == SnapshotRootReason::PersistentState
            && root.resource_id.as_deref() == Some("resource:4")
    }));
    assert_eq!(
        snapshot.graph.segments[1].kind.to_string_for_test(),
        "external-submission"
    );
    assert!(matches!(
        snapshot.memory.allocation_report,
        SnapshotAllocationReport::Available { .. }
    ));
    assert!(matches!(
        snapshot.memory.pool_report,
        SnapshotPoolReport::Available { .. }
    ));
    assert!(matches!(
        snapshot.timings.gpu,
        SnapshotGpuTimings::Available { .. }
    ));

    let json = to_json_pretty(&snapshot).unwrap();
    let mut actual: serde_json::Value = serde_json::from_str(&json).unwrap();
    let mut expected: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/snapshot-v1.json")).unwrap();
    normalize_integral_json_numbers(&mut actual);
    normalize_integral_json_numbers(&mut expected);
    assert_eq!(actual, expected);
}

#[test]
fn identical_producer_inputs_encode_deterministically() {
    let (report, timing, pool) = fixture_report();
    let mut options = CreateFrameGraphSnapshotOptions::new(7);
    options.captured_at = Some("2026-08-29T12:00:00Z");
    options.backend = Some("vulkan");
    options.gpu_timing = Some(&timing);
    options.pool_stats = Some(pool);

    let first = create_frame_graph_snapshot(&report, options).unwrap();
    let second = create_frame_graph_snapshot(&report, options).unwrap();
    assert_eq!(
        to_json_pretty(&first).unwrap(),
        to_json_pretty(&second).unwrap()
    );
}

#[test]
fn snapshot_requires_a_full_report() {
    let report = CompilationReport {
        summary: Default::default(),
        full: None,
    };
    assert!(matches!(
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(0)),
        Err(SnapshotExportError::FullReportRequired)
    ));
}

#[test]
fn snapshot_rejects_unsafe_integers_and_timing_mismatch() {
    let (mut report, timing, _) = fixture_report();
    report.full.as_mut().unwrap().resources[0].estimated_byte_size = 9_007_199_254_740_992;
    assert!(matches!(
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(7)),
        Err(SnapshotExportError::UnsafeInteger { .. })
    ));

    let (report, _, _) = fixture_report();
    let mut options = CreateFrameGraphSnapshotOptions::new(8);
    options.gpu_timing = Some(&timing);
    assert!(matches!(
        create_frame_graph_snapshot(&report, options),
        Err(SnapshotExportError::TimingFrameMismatch { .. })
    ));
}

#[test]
fn snapshot_rejects_unknown_usage_bits_and_illegal_accesses() {
    let (mut report, _, _) = fixture_report();
    report.full.as_mut().unwrap().resources[0].effective_usage =
        ResourceUsage::Texture(wgpu::TextureUsages::from_bits_retain(1 << 31));
    assert!(matches!(
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(7)),
        Err(SnapshotExportError::UnsupportedTextureUsage { .. })
    ));

    let (mut report, _, _) = fixture_report();
    report.full.as_mut().unwrap().accesses[1].mode = AccessMode::Write;
    assert!(matches!(
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(7)),
        Err(SnapshotExportError::InvalidReport { .. })
    ));
}

#[test]
fn snapshot_validates_the_typed_result_before_returning() {
    let (report, _, _) = fixture_report();
    let mut options = CreateFrameGraphSnapshotOptions::new(7);
    options.backend = Some("");
    let error = create_frame_graph_snapshot(&report, options).unwrap_err();
    match error {
        SnapshotExportError::InvalidSnapshot {
            source: SnapshotJsonError::Validation { issues },
        } => {
            assert!(issues.iter().any(|issue| {
                issue.code == "empty-string" && issue.path == "/producer/runtime/backend"
            }));
        }
        other => panic!("expected typed Snapshot validation error, got {other:?}"),
    }

    let (report, _, _) = fixture_report();
    let snapshot =
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(7)).unwrap();
    assert!(validate_typed_frame_graph_snapshot(&snapshot).is_ok());
}

#[test]
fn snapshot_rejects_malformed_texture_view_ranges_without_panicking() {
    let (mut report, _, _) = fixture_report();
    report.full.as_mut().unwrap().views[0]
        .descriptor
        .base_mip_level = 99;
    let result = std::panic::catch_unwind(|| {
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(7))
    });
    assert!(
        result.is_ok(),
        "malformed view range must return an error, not panic"
    );
    assert!(matches!(
        result.unwrap(),
        Err(SnapshotExportError::InvalidReport { .. })
    ));
}

#[test]
fn snapshot_rejects_malformed_resource_descriptors_without_panicking() {
    let (mut report, _, _) = fixture_report();
    let full = report.full.as_mut().unwrap();
    full.resources[0].descriptor = ResourceDescriptor::Buffer(BufferDesc {
        label: "wrong-kind".into(),
        size: 256,
        usage: UsagePolicy::Infer,
    });
    full.resources[0].effective_usage = ResourceUsage::Buffer(wgpu::BufferUsages::STORAGE);
    let result = std::panic::catch_unwind(|| {
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(7))
    });
    assert!(
        result.is_ok(),
        "malformed resource data must return an error, not panic"
    );
    assert!(matches!(
        result.unwrap(),
        Err(SnapshotExportError::InvalidReport { .. })
    ));
}

#[test]
fn all_supported_usage_bits_are_converted_in_protocol_order() {
    let (mut report, _, _) = fixture_report();
    let full = report.full.as_mut().unwrap();
    full.resources[0].effective_usage = ResourceUsage::Texture(
        wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::RENDER_ATTACHMENT,
    );
    full.resources[1].effective_usage = ResourceUsage::Buffer(
        wgpu::BufferUsages::MAP_READ
            | wgpu::BufferUsages::MAP_WRITE
            | wgpu::BufferUsages::COPY_SRC
            | wgpu::BufferUsages::COPY_DST
            | wgpu::BufferUsages::INDEX
            | wgpu::BufferUsages::VERTEX
            | wgpu::BufferUsages::UNIFORM
            | wgpu::BufferUsages::STORAGE
            | wgpu::BufferUsages::INDIRECT
            | wgpu::BufferUsages::QUERY_RESOLVE,
    );
    let snapshot =
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(7)).unwrap();
    assert_eq!(
        snapshot.graph.resources[0].usage_flags,
        [
            SnapshotUsageFlag::CopySrc,
            SnapshotUsageFlag::CopyDst,
            SnapshotUsageFlag::TextureBinding,
            SnapshotUsageFlag::StorageBinding,
            SnapshotUsageFlag::RenderAttachment,
        ]
    );
    assert_eq!(
        snapshot.graph.resources[1].usage_flags,
        [
            SnapshotUsageFlag::MapRead,
            SnapshotUsageFlag::MapWrite,
            SnapshotUsageFlag::CopySrc,
            SnapshotUsageFlag::CopyDst,
            SnapshotUsageFlag::Index,
            SnapshotUsageFlag::Vertex,
            SnapshotUsageFlag::Uniform,
            SnapshotUsageFlag::Storage,
            SnapshotUsageFlag::Indirect,
            SnapshotUsageFlag::QueryResolve,
        ]
    );
}

#[test]
fn absent_optional_runtime_reports_are_explicitly_unavailable() {
    let (report, _, _) = fixture_report();
    let snapshot =
        create_frame_graph_snapshot(&report, CreateFrameGraphSnapshotOptions::new(7)).unwrap();
    assert!(matches!(
        snapshot.memory.pool_report,
        SnapshotPoolReport::Unavailable { .. }
    ));
    assert!(matches!(
        snapshot.timings.gpu,
        SnapshotGpuTimings::Unavailable { .. }
    ));
}

#[test]
fn all_v1_enum_spellings_are_locked() {
    assert_json_strings(
        &[
            SnapshotNodeKind::Render,
            SnapshotNodeKind::Compute,
            SnapshotNodeKind::Copy,
            SnapshotNodeKind::ClearBuffer,
            SnapshotNodeKind::Command,
            SnapshotNodeKind::ExternalSubmission,
        ],
        &[
            "render",
            "compute",
            "copy",
            "clear-buffer",
            "command",
            "external-submission",
        ],
    );
    assert_json_strings(
        &[SnapshotResourceKind::Texture, SnapshotResourceKind::Buffer],
        &["texture", "buffer"],
    );
    assert_json_strings(
        &[
            SnapshotResourceOrigin::Transient,
            SnapshotResourceOrigin::Imported,
            SnapshotResourceOrigin::Surface,
        ],
        &["transient", "imported", "surface"],
    );
    assert_json_strings(
        &[
            SnapshotUsageFlag::MapRead,
            SnapshotUsageFlag::MapWrite,
            SnapshotUsageFlag::CopySrc,
            SnapshotUsageFlag::CopyDst,
            SnapshotUsageFlag::Index,
            SnapshotUsageFlag::Vertex,
            SnapshotUsageFlag::Uniform,
            SnapshotUsageFlag::Storage,
            SnapshotUsageFlag::Indirect,
            SnapshotUsageFlag::QueryResolve,
            SnapshotUsageFlag::TextureBinding,
            SnapshotUsageFlag::StorageBinding,
            SnapshotUsageFlag::RenderAttachment,
        ],
        &[
            "map-read",
            "map-write",
            "copy-src",
            "copy-dst",
            "index",
            "vertex",
            "uniform",
            "storage",
            "indirect",
            "query-resolve",
            "texture-binding",
            "storage-binding",
            "render-attachment",
        ],
    );
    assert_json_strings(
        &[
            SnapshotAccessKind::TextureSampled,
            SnapshotAccessKind::TextureStorageRead,
            SnapshotAccessKind::TextureStorageWrite,
            SnapshotAccessKind::TextureColorAttachmentWrite,
            SnapshotAccessKind::TextureDepthRead,
            SnapshotAccessKind::TextureDepthWrite,
            SnapshotAccessKind::TextureCopySrc,
            SnapshotAccessKind::TextureCopyDst,
            SnapshotAccessKind::BufferUniform,
            SnapshotAccessKind::BufferStorageRead,
            SnapshotAccessKind::BufferStorageWrite,
            SnapshotAccessKind::BufferVertex,
            SnapshotAccessKind::BufferIndex,
            SnapshotAccessKind::BufferIndirect,
            SnapshotAccessKind::BufferCopySrc,
            SnapshotAccessKind::BufferCopyDst,
        ],
        &[
            "texture-sampled",
            "texture-storage-read",
            "texture-storage-write",
            "texture-color-attachment-write",
            "texture-depth-read",
            "texture-depth-write",
            "texture-copy-src",
            "texture-copy-dst",
            "buffer-uniform",
            "buffer-storage-read",
            "buffer-storage-write",
            "buffer-vertex",
            "buffer-index",
            "buffer-indirect",
            "buffer-copy-src",
            "buffer-copy-dst",
        ],
    );
    assert_json_strings(
        &[SnapshotAccessMode::Read, SnapshotAccessMode::Write],
        &["read", "write"],
    );
    assert_json_strings(
        &[
            SnapshotWriteContents::Overwrite,
            SnapshotWriteContents::Preserve,
        ],
        &["overwrite", "preserve"],
    );
    assert_json_strings(
        &[
            SnapshotDependencyKind::Value,
            SnapshotDependencyKind::Ordering,
        ],
        &["value", "ordering"],
    );
    assert_json_strings(
        &[
            SnapshotRootReason::Present,
            SnapshotRootReason::Output,
            SnapshotRootReason::Readback,
            SnapshotRootReason::SideEffect,
            SnapshotRootReason::DebugCapture,
            SnapshotRootReason::PersistentState,
        ],
        &[
            "present",
            "output",
            "readback",
            "side-effect",
            "debug-capture",
            "persistent-state",
        ],
    );
    assert_json_strings(
        &[
            SnapshotSegmentKind::FrameGraph,
            SnapshotSegmentKind::ExternalSubmission,
        ],
        &["frame-graph", "external-submission"],
    );
    assert_json_strings(
        &[
            SnapshotDiagnosticSeverity::Info,
            SnapshotDiagnosticSeverity::Warning,
            SnapshotDiagnosticSeverity::Error,
        ],
        &["info", "warning", "error"],
    );
}

fn assert_json_strings<T: serde::Serialize>(values: &[T], expected: &[&str]) {
    let actual = serde_json::to_value(values).unwrap();
    assert_eq!(actual, serde_json::json!(expected));
}

fn normalize_integral_json_numbers(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Array(values) => {
            values.iter_mut().for_each(normalize_integral_json_numbers)
        }
        serde_json::Value::Object(values) => values
            .values_mut()
            .for_each(normalize_integral_json_numbers),
        serde_json::Value::Number(number) => {
            if let Some(value) = number.as_f64()
                && value.fract() == 0.0
                && value >= 0.0
                && value <= u64::MAX as f64
            {
                *number = serde_json::Number::from(value as u64);
            }
        }
        _ => {}
    }
}

trait SegmentKindTestName {
    fn to_string_for_test(self) -> &'static str;
}

impl SegmentKindTestName for super::SnapshotSegmentKind {
    fn to_string_for_test(self) -> &'static str {
        match self {
            Self::FrameGraph => "frame-graph",
            Self::ExternalSubmission => "external-submission",
        }
    }
}

fn fixture_report() -> (CompilationReport, GpuTimingReport, ResourcePoolStats) {
    let node_0 = PassId::new(0);
    let node_1 = PassId::new(1);
    let node_2 = PassId::new(2);
    let texture_0 = ResourceId::new(0);
    let buffer_1 = ResourceId::new(1);
    let texture_2 = ResourceId::new(2);
    let buffer_3 = ResourceId::new(3);
    let buffer_4 = ResourceId::new(4);
    let view_0 = ViewId::new(0);
    let view_1 = ViewId::new(1);
    let group_0 = DebugGroupId::new(0);
    let group_1 = DebugGroupId::new(1);
    let texture_range = |base_slice, slice_count| TextureSubresourceRange {
        base_mip_level: 0,
        mip_level_count: 1,
        base_slice,
        slice_count,
        aspect: wgpu::TextureAspect::All,
    };
    let buffer_descriptor = |label: &str, size| {
        ResourceDescriptor::Buffer(BufferDesc {
            label: label.into(),
            size,
            usage: UsagePolicy::Infer,
        })
    };
    let buffer_report = |id, label: &str, origin, lifetime, allocation, usage| ResourceReport {
        id,
        kind: ResourceKind::Buffer,
        label: label.into(),
        origin,
        initial_contents: if origin == ResourceOrigin::Imported {
            InitialContents::Defined
        } else {
            InitialContents::Undefined
        },
        descriptor: buffer_descriptor(label, 256),
        effective_usage: ResourceUsage::Buffer(usage),
        estimated_byte_size: 256,
        lifetime,
        allocation,
        debug_group: Some(group_0),
    };
    let full = FullCompilationReport {
        nodes: vec![
            NodeReport {
                id: node_0,
                recording_order: 0,
                kind: NodeKind::Render,
                label: "GBuffer".into(),
                side_effect: false,
                debug_group: Some(group_1),
            },
            NodeReport {
                id: node_1,
                recording_order: 2,
                kind: NodeKind::ExternalSubmission,
                label: "Interop Submit".into(),
                side_effect: true,
                debug_group: Some(group_0),
            },
        ],
        culled_nodes: vec![CulledNodeReport {
            id: node_2,
            recording_order: 1,
            kind: NodeKind::Compute,
            label: "Unused Compute".into(),
            side_effect: false,
            debug_group: Some(group_1),
            reason: CulledNodeReason::NotReachableFromRoot,
        }],
        resources: vec![
            ResourceReport {
                id: texture_0,
                kind: ResourceKind::Texture,
                label: "Volume".into(),
                origin: ResourceOrigin::Transient,
                initial_contents: InitialContents::Undefined,
                descriptor: ResourceDescriptor::Texture(TextureDesc {
                    label: "Volume".into(),
                    size: wgpu::Extent3d {
                        width: 8,
                        height: 8,
                        depth_or_array_layers: 4,
                    },
                    mip_level_count: 2,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D3,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    view_formats: vec![wgpu::TextureFormat::Rgba8UnormSrgb],
                    usage: UsagePolicy::Infer,
                }),
                effective_usage: ResourceUsage::Texture(
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                ),
                estimated_byte_size: 1_024,
                lifetime: Some(ResourceLifetime {
                    first_use: 0,
                    last_use: 1,
                }),
                allocation: Some(AllocationId::new(0)),
                debug_group: Some(group_1),
            },
            buffer_report(
                buffer_1,
                "Camera",
                ResourceOrigin::Imported,
                None,
                None,
                wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            ),
            ResourceReport {
                id: texture_2,
                kind: ResourceKind::Texture,
                label: "Culled Cube".into(),
                origin: ResourceOrigin::Imported,
                initial_contents: InitialContents::Defined,
                descriptor: ResourceDescriptor::Texture(TextureDesc {
                    label: "Culled Cube".into(),
                    size: wgpu::Extent3d {
                        width: 4,
                        height: 4,
                        depth_or_array_layers: 6,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    view_formats: vec![],
                    usage: UsagePolicy::Infer,
                }),
                effective_usage: ResourceUsage::Texture(wgpu::TextureUsages::TEXTURE_BINDING),
                estimated_byte_size: 384,
                lifetime: None,
                allocation: None,
                debug_group: None,
            },
            buffer_report(
                buffer_3,
                "Alias A",
                ResourceOrigin::Transient,
                Some(ResourceLifetime {
                    first_use: 0,
                    last_use: 0,
                }),
                Some(AllocationId::new(1)),
                wgpu::BufferUsages::STORAGE,
            ),
            buffer_report(
                buffer_4,
                "Alias B",
                ResourceOrigin::Transient,
                Some(ResourceLifetime {
                    first_use: 1,
                    last_use: 1,
                }),
                Some(AllocationId::new(1)),
                wgpu::BufferUsages::STORAGE,
            ),
        ],
        views: vec![
            ViewReport {
                id: view_0,
                texture: texture_0,
                descriptor: TextureViewDesc {
                    label: "Volume View".into(),
                    format: None,
                    dimension: Some(wgpu::TextureViewDimension::D3),
                    aspect: wgpu::TextureAspect::All,
                    base_mip_level: 0,
                    mip_level_count: Some(1),
                    base_array_layer: 0,
                    array_layer_count: None,
                },
                range: ResourceRange::Texture(vec![texture_range(0, 4)]),
            },
            ViewReport {
                id: view_1,
                texture: texture_2,
                descriptor: TextureViewDesc {
                    label: "Cube View".into(),
                    format: Some(wgpu::TextureFormat::Rgba8Unorm),
                    dimension: Some(wgpu::TextureViewDimension::Cube),
                    aspect: wgpu::TextureAspect::All,
                    base_mip_level: 0,
                    mip_level_count: Some(1),
                    base_array_layer: 0,
                    array_layer_count: Some(6),
                },
                range: ResourceRange::Texture(vec![texture_range(0, 6)]),
            },
        ],
        accesses: vec![
            AccessReport {
                id: AccessId::new(0),
                pass: node_0,
                resource: texture_0,
                view: Some(view_0),
                role: AccessRole::ColorAttachment,
                mode: AccessMode::Write,
                consumes_previous: false,
                produces_value: true,
                range: ResourceRange::Texture(vec![texture_range(0, 1), texture_range(1, 1)]),
                value: Some(ValueId::new(0)),
            },
            AccessReport {
                id: AccessId::new(1),
                pass: node_0,
                resource: buffer_1,
                view: None,
                role: AccessRole::UniformBuffer,
                mode: AccessMode::Read,
                consumes_previous: true,
                produces_value: false,
                range: ResourceRange::Buffer(BufferRange::new(0, 64)),
                value: None,
            },
            AccessReport {
                id: AccessId::new(2),
                pass: node_0,
                resource: buffer_3,
                view: None,
                role: AccessRole::StorageBufferWrite,
                mode: AccessMode::Write,
                consumes_previous: true,
                produces_value: true,
                range: ResourceRange::Buffer(BufferRange::whole()),
                value: Some(ValueId::new(1)),
            },
            AccessReport {
                id: AccessId::new(3),
                pass: node_1,
                resource: texture_0,
                view: Some(view_0),
                role: AccessRole::SampledTexture,
                mode: AccessMode::Read,
                consumes_previous: true,
                produces_value: false,
                range: ResourceRange::Texture(vec![texture_range(0, 4)]),
                value: Some(ValueId::new(0)),
            },
            AccessReport {
                id: AccessId::new(4),
                pass: node_1,
                resource: buffer_4,
                view: None,
                role: AccessRole::StorageBufferWrite,
                mode: AccessMode::Write,
                consumes_previous: false,
                produces_value: true,
                range: ResourceRange::Buffer(BufferRange::whole()),
                value: Some(ValueId::new(2)),
            },
            AccessReport {
                id: AccessId::new(5),
                pass: node_2,
                resource: texture_2,
                view: Some(view_1),
                role: AccessRole::SampledTexture,
                mode: AccessMode::Read,
                consumes_previous: true,
                produces_value: false,
                range: ResourceRange::Texture(vec![texture_range(0, 6)]),
                value: None,
            },
        ],
        values: vec![],
        dependencies: vec![
            DependencyReport {
                from: node_0,
                to: node_1,
                resource: texture_0,
                kind: DependencyKind::Value,
                hazard: HazardKind::Raw,
                range: ResourceRange::Texture(vec![texture_range(0, 4)]),
                value: Some(ValueId::new(0)),
            },
            DependencyReport {
                from: node_0,
                to: node_1,
                resource: texture_0,
                kind: DependencyKind::Value,
                hazard: HazardKind::Raw,
                range: ResourceRange::Texture(vec![texture_range(0, 4)]),
                value: Some(ValueId::new(0)),
            },
            DependencyReport {
                from: node_2,
                to: node_1,
                resource: texture_2,
                kind: DependencyKind::Ordering,
                hazard: HazardKind::Raw,
                range: ResourceRange::Texture(vec![texture_range(0, 6)]),
                value: None,
            },
        ],
        roots: vec![
            RootReport {
                resource: texture_0,
                reason: RootReason::Output,
                range: ResourceRange::Texture(vec![texture_range(0, 4)]),
                producers: vec![node_0],
            },
            RootReport {
                resource: buffer_4,
                reason: RootReason::PersistentState,
                range: ResourceRange::Buffer(BufferRange::whole()),
                producers: vec![node_1],
            },
        ],
        allocations: vec![
            AllocationReport {
                id: AllocationId::new(0),
                kind: ResourceKind::Texture,
                compatibility_key: "volume-rgba8".into(),
                resource_ids: vec![texture_0],
                estimated_byte_size: 1_024,
            },
            AllocationReport {
                id: AllocationId::new(1),
                kind: ResourceKind::Buffer,
                compatibility_key: "storage-256".into(),
                resource_ids: vec![buffer_3, buffer_4],
                estimated_byte_size: 256,
            },
        ],
        execution_segments: vec![
            ExecutionSegmentReport {
                kind: ExecutionSegmentKind::FrameGraph,
                nodes: vec![node_0],
            },
            ExecutionSegmentReport {
                kind: ExecutionSegmentKind::ExternalSubmission,
                nodes: vec![node_1],
            },
        ],
        diagnostics: vec![Diagnostic {
            code: "FG-DEMO".into(),
            severity: DiagnosticSeverity::Warning,
            message: "Fixture diagnostic".into(),
            pass: Some(node_0),
            resource: Some(texture_0),
            undefined_cause: None,
        }],
        debug_groups: vec![
            DebugGroupReport {
                id: group_0,
                parent: None,
                label: "Frame".into(),
            },
            DebugGroupReport {
                id: group_1,
                parent: Some(group_0),
                label: "Lighting".into(),
            },
        ],
    };
    let report = CompilationReport {
        summary: Default::default(),
        full: Some(full),
    };
    let timing = GpuTimingReport::Available {
        frame_index: 7,
        frame_duration: Duration::from_micros(1_500),
        nodes: vec![GpuTimingNodeReport {
            pass: node_0,
            kind: GpuTimingNodeKind::Render,
            label: "GBuffer".into(),
            debug_group: Some(group_1),
            duration: Duration::from_micros(900),
        }],
        debug_groups: vec![],
    };
    let pool = ResourcePoolStats {
        acquire_count: 3,
        reuse_count: 1,
        created_count: 2,
        retained_count: 2,
        estimated_retained_bytes: 1_280,
    };
    (report, timing, pool)
}
