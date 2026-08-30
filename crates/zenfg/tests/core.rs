use zenfg::{
    AccessRole, BufferDesc, BufferRange, BufferTextureCopyLocation, ClearBufferOp,
    ColorAttachmentOps, CompileOptions, CulledNodeReason, DependencyKind, FrameGraph,
    FrameGraphError, HazardKind, ImportBufferOptions, ImportTextureOptions, InitialContents,
    ReportLevel, RootReason, TextureCopyLocation, TextureDesc, TextureViewDesc, UsagePolicy,
    WriteContents,
};

fn full_options() -> CompileOptions {
    CompileOptions::full_report()
}

#[test]
fn recording_descriptor_queries_return_snapshotted_and_normalized_metadata() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let texture = frame
        .create_texture(TextureDesc {
            label: "array".into(),
            size: wgpu::Extent3d {
                width: 8,
                height: 8,
                depth_or_array_layers: 6,
            },
            mip_level_count: 4,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            view_formats: vec![wgpu::TextureFormat::Rgba8UnormSrgb],
            usage: UsagePolicy::Infer,
        })
        .unwrap();
    let buffer = frame.create_buffer(BufferDesc::new("data", 64)).unwrap();
    let view = frame
        .create_texture_view(
            texture,
            TextureViewDesc {
                label: "layers".into(),
                format: Some(wgpu::TextureFormat::Rgba8UnormSrgb),
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                base_mip_level: 1,
                mip_level_count: None,
                base_array_layer: 2,
                array_layer_count: Some(3),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(frame.texture_desc(texture).unwrap().label, "array");
    assert_eq!(frame.buffer_desc(buffer).unwrap().size, 64);
    let normalized = frame.texture_view_desc(view).unwrap();
    assert_eq!(normalized.label, "layers");
    assert_eq!(normalized.format, wgpu::TextureFormat::Rgba8UnormSrgb);
    assert_eq!(normalized.dimension, wgpu::TextureViewDimension::D2Array);
    assert_eq!(normalized.base_mip_level, 1);
    assert_eq!(normalized.mip_level_count, 3);
    assert_eq!(normalized.base_array_layer, 2);
    assert_eq!(normalized.array_layer_count, Some(3));
}

#[test]
fn d3_view_descriptor_normalizes_without_array_layers() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let texture = frame
        .create_texture(TextureDesc {
            label: "volume".into(),
            size: wgpu::Extent3d {
                width: 8,
                height: 4,
                depth_or_array_layers: 4,
            },
            mip_level_count: 3,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::R8Unorm,
            view_formats: vec![],
            usage: UsagePolicy::Infer,
        })
        .unwrap();
    let view = frame
        .create_texture_view(texture, TextureViewDesc::default())
        .unwrap();
    let normalized = frame.texture_view_desc(view).unwrap();
    assert_eq!(normalized.dimension, wgpu::TextureViewDimension::D3);
    assert_eq!(normalized.mip_level_count, 3);
    assert_eq!(normalized.base_array_layer, 0);
    assert_eq!(normalized.array_layer_count, None);
}

#[test]
fn roots_enforce_resource_kind_origin_and_readback_usage() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let transient = frame
        .create_buffer(BufferDesc::new("transient", 16))
        .unwrap();
    let error = frame
        .mark_buffer_root(transient, BufferRange::whole(), RootReason::PersistentState)
        .unwrap_err();
    assert_eq!(error.code(), "FG1107");

    let imported = frame
        .import_buffer(
            BufferDesc {
                label: "readback".into(),
                size: 16,
                usage: UsagePolicy::Fixed(
                    wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                ),
            },
            ImportBufferOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(wgpu::BufferUsages::COPY_DST),
            },
        )
        .unwrap();
    assert_eq!(
        frame
            .mark_readback(imported, BufferRange::whole())
            .unwrap_err()
            .code(),
        "FG1107"
    );

    let texture = frame
        .import_texture(
            TextureDesc::new_2d("texture", 1, 1, wgpu::TextureFormat::Rgba8Unorm),
            ImportTextureOptions::new(InitialContents::Defined),
        )
        .unwrap();
    assert_eq!(
        frame
            .mark_texture_root(texture, RootReason::Readback)
            .unwrap_err()
            .code(),
        "FG1107"
    );
    assert_eq!(
        frame
            .mark_buffer_root(imported, BufferRange::whole(), RootReason::Present)
            .unwrap_err()
            .code(),
        "FG1107"
    );
}

#[test]
fn unsupported_texture_roles_fail_even_when_the_node_would_be_culled() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let texture = frame
        .create_texture(TextureDesc::new_2d(
            "srgb-storage",
            4,
            4,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        ))
        .unwrap();
    let mut pass = frame.compute_pass("unused-invalid-storage");
    let error = pass
        .storage_texture_write(texture, WriteContents::Overwrite)
        .unwrap_err();
    assert_eq!(error.code(), "FG1108");
}

#[test]
fn unsupported_texture_sample_count_fails_even_when_the_node_would_be_culled() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let mut desc = TextureDesc::new_2d("compressed-msaa", 4, 4, wgpu::TextureFormat::Bc1RgbaUnorm);
    desc.sample_count = 4;
    let texture = frame.create_texture(desc).unwrap();
    let mut pass = frame.compute_pass("unused-invalid-sample-count");
    let error = pass.sampled_texture(texture).unwrap_err();
    assert_eq!(error.code(), "FG1108");
}

#[test]
fn read_only_depth_consumes_defined_contents_without_producing_a_value() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let depth = frame
        .create_texture(TextureDesc::new_2d(
            "depth",
            4,
            4,
            wgpu::TextureFormat::Depth32Float,
        ))
        .unwrap();
    let mut writer = frame.render_pass("depth-writer");
    let _ = writer
        .depth_attachment(depth, zenfg::DepthAttachmentOps::clear_store(1.0))
        .unwrap();
    writer.finish().unwrap();

    let mut reader = frame.render_pass("depth-reader");
    reader.set_side_effect(true);
    let _ = reader.depth_attachment_read_only(depth).unwrap();
    reader.finish().unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    let full = compiled.report().unwrap().full.as_ref().unwrap();
    let reader = full
        .nodes
        .iter()
        .find(|node| node.label == "depth-reader")
        .unwrap();
    let access = full
        .accesses
        .iter()
        .find(|access| access.pass == reader.id && access.role == AccessRole::DepthAttachment)
        .unwrap();
    assert_eq!(access.mode, zenfg::AccessMode::Read);
    assert!(access.consumes_previous);
    assert!(!access.produces_value);
    assert!(full.dependencies.iter().any(|dependency| {
        dependency.to == reader.id
            && dependency.kind == DependencyKind::Value
            && dependency.hazard == HazardKind::Raw
    }));
}

#[test]
fn resolve_target_is_an_overwrite_value_with_render_attachment_usage() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let mut source_desc = TextureDesc::new_2d("msaa", 4, 4, wgpu::TextureFormat::Rgba8Unorm);
    source_desc.sample_count = 4;
    let source = frame.create_texture(source_desc).unwrap();
    let resolved = frame
        .create_texture(TextureDesc::new_2d(
            "resolved",
            4,
            4,
            wgpu::TextureFormat::Rgba8Unorm,
        ))
        .unwrap();
    let mut pass = frame.render_pass("resolve");
    let _ = pass
        .color_attachment_with_resolve(
            source,
            resolved,
            ColorAttachmentOps::clear_store(wgpu::Color::BLACK),
        )
        .unwrap();
    pass.finish().unwrap();
    frame
        .mark_texture_root(resolved, RootReason::Output)
        .unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    assert_eq!(
        compiled.resource_usage(source.id()),
        Some(zenfg::ResourceUsage::Texture(
            wgpu::TextureUsages::RENDER_ATTACHMENT
        ))
    );
    assert_eq!(
        compiled.resource_usage(source.id()),
        compiled.resource_usage(resolved.id())
    );
    let full = compiled.report().unwrap().full.as_ref().unwrap();
    let accesses = full
        .accesses
        .iter()
        .filter(|access| access.role == AccessRole::ColorAttachment)
        .collect::<Vec<_>>();
    assert_eq!(accesses.len(), 2);
    let resolve_access = accesses
        .iter()
        .find(|access| access.resource == resolved.id())
        .unwrap();
    assert!(!resolve_access.consumes_previous);
    assert!(resolve_access.produces_value);
}

#[test]
fn resolve_rejects_single_sample_source() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let source = frame
        .create_texture(TextureDesc::new_2d(
            "single-sampled-source",
            4,
            4,
            wgpu::TextureFormat::Rgba8Unorm,
        ))
        .unwrap();
    let target = frame
        .create_texture(TextureDesc::new_2d(
            "target",
            4,
            4,
            wgpu::TextureFormat::Rgba8Unorm,
        ))
        .unwrap();
    let mut pass = frame.render_pass("invalid-resolve");
    let _ = pass
        .color_attachment_with_resolve(
            source,
            target,
            ColorAttachmentOps::clear_store(wgpu::Color::BLACK),
        )
        .unwrap();
    assert_eq!(pass.finish().unwrap_err().code(), "FG1106");
}

#[test]
fn resolve_rejects_multisampled_target() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let mut source_desc = TextureDesc::new_2d("source", 4, 4, wgpu::TextureFormat::Rgba8Unorm);
    source_desc.sample_count = 4;
    let source = frame.create_texture(source_desc.clone()).unwrap();
    source_desc.label = "target".into();
    let target = frame.create_texture(source_desc).unwrap();
    let mut pass = frame.render_pass("invalid-resolve-target-samples");
    let _ = pass
        .color_attachment_with_resolve(
            source,
            target,
            ColorAttachmentOps::clear_store(wgpu::Color::BLACK),
        )
        .unwrap();
    assert_eq!(pass.finish().unwrap_err().code(), "FG1106");
}

#[test]
fn resolve_rejects_mismatched_extent_and_format() {
    for target_desc in [
        TextureDesc::new_2d("wrong-extent", 2, 4, wgpu::TextureFormat::Rgba8Unorm),
        TextureDesc::new_2d("wrong-format", 4, 4, wgpu::TextureFormat::Bgra8Unorm),
    ] {
        let mut graph = FrameGraph::new();
        let mut frame = graph.begin_frame();
        let mut source_desc = TextureDesc::new_2d("source", 4, 4, wgpu::TextureFormat::Rgba8Unorm);
        source_desc.sample_count = 4;
        let source = frame.create_texture(source_desc).unwrap();
        let target = frame.create_texture(target_desc).unwrap();
        let mut pass = frame.render_pass("invalid-resolve-compatibility");
        let _ = pass
            .color_attachment_with_resolve(
                source,
                target,
                ColorAttachmentOps::clear_store(wgpu::Color::BLACK),
            )
            .unwrap();
        assert_eq!(pass.finish().unwrap_err().code(), "FG1106");
    }
}

#[test]
fn resolve_rejects_aliasing_source_and_target() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let mut desc = TextureDesc::new_2d("aliased", 4, 4, wgpu::TextureFormat::Rgba8Unorm);
    desc.sample_count = 4;
    let texture = frame.create_texture(desc).unwrap();
    let mut pass = frame.render_pass("aliased-resolve");
    let error = pass
        .color_attachment_with_resolve(
            texture,
            texture,
            ColorAttachmentOps::clear_store(wgpu::Color::BLACK),
        )
        .unwrap_err();
    assert_eq!(error.code(), "FG1105");
}

#[test]
fn read_only_depth_requires_defined_contents_even_if_side_effect_rooted() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let depth = frame
        .create_texture(TextureDesc::new_2d(
            "undefined-depth",
            4,
            4,
            wgpu::TextureFormat::Depth32Float,
        ))
        .unwrap();
    let mut pass = frame.render_pass("read-undefined-depth");
    pass.set_side_effect(true);
    let _ = pass.depth_attachment_read_only(depth).unwrap();
    pass.finish().unwrap();
    assert!(matches!(
        frame.compile(CompileOptions::default()).unwrap_err(),
        FrameGraphError::ReadBeforeWrite { .. }
    ));
}

#[test]
fn debug_groups_report_node_and_resource_provenance() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame
        .with_debug_group("  Mesh  ", |frame| {
            let buffer = frame.create_buffer(BufferDesc::new("buffer", 4))?;
            frame.with_debug_group("Visibility", |frame| {
                let mut pass = frame.compute_pass("write");
                let _ = pass.storage_buffer_write(
                    buffer,
                    BufferRange::whole(),
                    WriteContents::Overwrite,
                )?;
                pass.finish()?;
                Ok(())
            })?;
            Ok(buffer)
        })
        .unwrap();
    frame
        .mark_buffer_root(buffer, BufferRange::whole(), RootReason::Output)
        .unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    let full = compiled.report().unwrap().full.as_ref().unwrap();
    assert_eq!(
        full.debug_groups
            .iter()
            .map(|group| group.label.as_str())
            .collect::<Vec<_>>(),
        ["Mesh", "Visibility"]
    );
    assert_eq!(full.debug_groups[1].parent, Some(full.debug_groups[0].id));
    assert_eq!(full.nodes[0].debug_group, Some(full.debug_groups[1].id));
    assert_eq!(full.resources[0].debug_group, Some(full.debug_groups[0].id));
}

#[test]
fn debug_group_stack_errors_are_stable() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    assert_eq!(frame.pop_debug_group().unwrap_err().code(), "FG2004");
    assert_eq!(frame.push_debug_group("  ").unwrap_err().code(), "FG2003");
    frame.push_debug_group("open").unwrap();
    assert_eq!(
        frame.compile(CompileOptions::default()).unwrap_err().code(),
        "FG2005"
    );
}

#[test]
fn same_named_sibling_groups_keep_distinct_ids_and_culled_provenance() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let first = frame.push_debug_group("Repeated").unwrap();
    frame.pop_debug_group().unwrap();
    let second = frame.push_debug_group("Repeated").unwrap();
    let buffer = frame.create_buffer(BufferDesc::new("culled", 4)).unwrap();
    let mut pass = frame.compute_pass("culled-write");
    let _ = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish().unwrap();
    frame.pop_debug_group().unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    let full = compiled.report().unwrap().full.as_ref().unwrap();
    assert_ne!(first, second);
    assert_eq!(full.debug_groups[0].label, full.debug_groups[1].label);
    assert_eq!(full.culled_nodes.len(), 1);
    assert_eq!(full.culled_nodes[0].debug_group, Some(second));
    assert_eq!(
        full.culled_nodes[0].reason,
        CulledNodeReason::NotReachableFromRoot
    );
    assert_eq!(full.culled_nodes[0].recording_order, 0);
}

#[test]
fn reports_preserve_original_order_across_retained_and_culled_nodes() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let unused = frame.create_buffer(BufferDesc::new("unused", 4)).unwrap();
    let mut first = frame.compute_pass("recorded-first");
    let _ = first
        .storage_buffer_write(unused, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    first.finish().unwrap();
    let imported = frame
        .import_buffer(
            BufferDesc::new("input", 4),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let mut second = frame.command_pass("recorded-second");
    let _ = second
        .storage_buffer_read(imported, BufferRange::whole())
        .unwrap();
    second.finish_command(|_| Ok(())).unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    let report = compiled.report().unwrap().full.as_ref().unwrap();
    assert_eq!(report.culled_nodes[0].recording_order, 0);
    assert_eq!(report.nodes[0].recording_order, 1);
    assert_eq!(report.nodes[0].label, "recorded-second");
}

#[test]
fn linear_value_chain_retains_producers_and_infers_usage() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let input = frame.create_buffer(BufferDesc::new("input", 64)).unwrap();
    let output = frame.create_buffer(BufferDesc::new("output", 64)).unwrap();

    let mut producer = frame.compute_pass("producer");
    let _ = producer
        .storage_buffer_write(input, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    producer.finish().unwrap();

    let mut consumer = frame.compute_pass("consumer");
    let _ = consumer
        .storage_buffer_read(input, BufferRange::whole())
        .unwrap();
    let _ = consumer
        .storage_buffer_write(output, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    consumer.finish().unwrap();
    frame
        .mark_buffer_root(output, BufferRange::whole(), RootReason::Output)
        .unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    let report = compiled.report().unwrap();
    assert_eq!(report.summary.retained_node_count, 2);
    let full = report.full.as_ref().unwrap();
    assert!(
        full.dependencies
            .iter()
            .any(|edge| { edge.kind == DependencyKind::Value && edge.hazard == HazardKind::Raw })
    );
    assert_eq!(
        compiled.resource_usage(input.id()).unwrap().bits(),
        wgpu::BufferUsages::STORAGE.bits() as u64
    );
}

#[test]
fn overwrite_culls_an_unused_previous_writer_despite_waw_ordering() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("buffer", 16)).unwrap();
    for label in ["old", "new"] {
        let mut pass = frame.compute_pass(label);
        let _ = pass
            .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        pass.finish().unwrap();
    }
    frame
        .mark_buffer_root(buffer, BufferRange::whole(), RootReason::Output)
        .unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    let report = compiled.report().unwrap();
    assert_eq!(report.summary.retained_node_count, 1);
    assert_eq!(report.full.as_ref().unwrap().nodes[0].label, "new");
    assert!(
        report
            .full
            .as_ref()
            .unwrap()
            .dependencies
            .iter()
            .any(|edge| {
                edge.kind == DependencyKind::Ordering && edge.hazard == HazardKind::Waw
            })
    );
}

#[test]
fn partial_buffer_coverage_is_validated_exactly() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("buffer", 8)).unwrap();
    let mut write = frame.compute_pass("write-prefix");
    let _ = write
        .storage_buffer_write(buffer, BufferRange::new(0, 4), WriteContents::Overwrite)
        .unwrap();
    write.finish().unwrap();
    let mut read = frame.command_pass("read-all");
    let _ = read
        .storage_buffer_read(buffer, BufferRange::whole())
        .unwrap();
    read.finish().unwrap();

    assert!(matches!(
        frame.compile(CompileOptions::default()),
        Err(FrameGraphError::ReadBeforeWrite { .. })
    ));
}

#[test]
fn imported_defined_contents_can_be_read_without_a_graph_producer() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame
        .import_buffer(
            BufferDesc::new("external", 16),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let mut pass = frame.command_pass("consume-external");
    let _ = pass.uniform_buffer(buffer, BufferRange::whole()).unwrap();
    pass.finish().unwrap();
    let compiled = frame.compile(full_options()).unwrap();
    assert_eq!(compiled.retained_node_count(), 1);
    assert_eq!(compiled.report().unwrap().summary.value_count, 1);
}

#[test]
fn preserve_requires_defined_contents() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("buffer", 16)).unwrap();
    let mut pass = frame.compute_pass("preserve");
    let _ = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Preserve)
        .unwrap();
    pass.finish().unwrap();
    assert!(matches!(
        frame.compile(CompileOptions::default()),
        Err(FrameGraphError::PreserveBeforeWrite { .. })
    ));
}

#[test]
fn attachment_discard_invalidates_only_the_selected_view() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let mut desc = TextureDesc::new_2d("color", 32, 32, wgpu::TextureFormat::Rgba8Unorm);
    desc.mip_level_count = 2;
    let texture = frame.create_texture(desc).unwrap();
    let mip0 = frame
        .create_texture_view(
            texture,
            TextureViewDesc {
                label: "mip0".into(),
                mip_level_count: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
    let mip1 = frame
        .create_texture_view(
            texture,
            TextureViewDesc {
                label: "mip1".into(),
                base_mip_level: 1,
                mip_level_count: Some(1),
                ..Default::default()
            },
        )
        .unwrap();

    let mut discard = frame.render_pass("discard-mip0");
    let _ = discard
        .color_attachment(mip0, ColorAttachmentOps::clear_discard(wgpu::Color::BLACK))
        .unwrap();
    discard.finish().unwrap();
    let mut produce = frame.render_pass("produce-mip1");
    let _ = produce
        .color_attachment(mip1, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
        .unwrap();
    produce.finish().unwrap();
    frame.mark_texture_root(mip1, RootReason::Output).unwrap();
    assert!(frame.compile(full_options()).is_ok());
}

#[test]
fn storage_defaults_to_one_mip_and_attachments_reject_multi_mip_views() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let mut desc = TextureDesc::new_2d("mipped", 32, 32, wgpu::TextureFormat::Rgba8Unorm);
    desc.mip_level_count = 3;
    let texture = frame.create_texture(desc).unwrap();

    let mut storage = frame.compute_pass("storage-mip0");
    let _ = storage
        .storage_texture_write(texture, WriteContents::Overwrite)
        .unwrap();
    storage.finish().unwrap();
    let full_view = frame
        .create_texture_view(
            texture,
            TextureViewDesc {
                label: "all-mips".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let mut render = frame.render_pass("invalid-attachment");
    assert!(matches!(
        render.color_attachment(
            full_view,
            ColorAttachmentOps::clear_store(wgpu::Color::BLACK),
        ),
        Err(FrameGraphError::InvalidTextureView { .. })
    ));
    render.finish().unwrap();
    let mip0 = frame
        .create_texture_view(
            texture,
            TextureViewDesc {
                label: "mip0".into(),
                mip_level_count: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
    frame.mark_texture_root(mip0, RootReason::Output).unwrap();
    let compiled = frame.compile(full_options()).unwrap();
    let storage_access = compiled.report().unwrap().full.as_ref().unwrap().accesses[0].clone();
    let zenfg::ResourceRange::Texture(regions) = storage_access.range else {
        panic!("expected a texture range");
    };
    assert_eq!(regions.len(), 1);
    assert_eq!(regions[0].base_mip_level, 0);
}

#[test]
fn read_after_discard_is_structured_error() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let texture = frame
        .create_texture(TextureDesc::new_2d(
            "color",
            16,
            16,
            wgpu::TextureFormat::Rgba8Unorm,
        ))
        .unwrap();
    let mut discard = frame.render_pass("discard");
    let _ = discard
        .color_attachment(
            texture,
            ColorAttachmentOps::clear_discard(wgpu::Color::BLACK),
        )
        .unwrap();
    discard.finish().unwrap();
    let mut read = frame.command_pass("read");
    let _ = read.sampled_texture(texture).unwrap();
    read.finish().unwrap();
    let error = frame.compile(CompileOptions::default()).unwrap_err();
    assert_eq!(error.code(), "FG1003");
    assert!(matches!(error, FrameGraphError::ReadAfterDiscard { .. }));
}

#[test]
fn fixed_usage_is_checked_after_culling() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let culled = frame
        .create_buffer(BufferDesc {
            label: "culled-fixed".into(),
            size: 16,
            usage: UsagePolicy::Fixed(wgpu::BufferUsages::COPY_DST),
        })
        .unwrap();
    let mut unused = frame.compute_pass("culled-storage-write");
    let _ = unused
        .storage_buffer_write(culled, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    unused.finish().unwrap();
    assert!(frame.compile(CompileOptions::default()).is_ok());

    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame
        .create_buffer(BufferDesc {
            label: "fixed".into(),
            size: 16,
            usage: UsagePolicy::Fixed(wgpu::BufferUsages::COPY_DST),
        })
        .unwrap();
    let mut retained = frame.command_pass("retained-storage-write");
    let _ = retained
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    retained.finish().unwrap();
    assert!(matches!(
        frame.compile(CompileOptions::default()),
        Err(FrameGraphError::UsageMismatch { .. })
    ));

    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame
        .import_buffer(
            BufferDesc {
                label: "fixed".into(),
                size: 16,
                usage: UsagePolicy::Infer,
            },
            ImportBufferOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(wgpu::BufferUsages::COPY_DST),
            },
        )
        .unwrap();
    let mut retained = frame.command_pass("retained-storage-read");
    let _ = retained
        .storage_buffer_read(buffer, BufferRange::whole())
        .unwrap();
    retained.finish().unwrap();
    assert!(matches!(
        frame.compile(CompileOptions::default()),
        Err(FrameGraphError::UsageMismatch { .. })
    ));
}

#[test]
fn declarative_copy_and_clear_nodes_participate_in_content_flow() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let source = frame
        .import_buffer(
            BufferDesc::new("source", 16),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let copied = frame.create_buffer(BufferDesc::new("copied", 16)).unwrap();
    let cleared = frame.create_buffer(BufferDesc::new("cleared", 16)).unwrap();

    let mut copy = frame.copy_pass("copy");
    copy.copy_buffer_to_buffer(source, 0, copied, 0, 16)
        .unwrap();
    copy.finish().unwrap();
    frame
        .clear_buffer("clear", cleared, BufferRange::whole())
        .unwrap();

    let mut consume = frame.command_pass("consume");
    let _ = consume
        .storage_buffer_read(copied, BufferRange::whole())
        .unwrap();
    let _ = consume
        .storage_buffer_read(cleared, BufferRange::whole())
        .unwrap();
    consume.finish().unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    assert_eq!(compiled.retained_node_count(), 3);
    assert_eq!(
        compiled.resource_usage(copied.id()).unwrap().bits(),
        (wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::STORAGE).bits() as u64
    );
    assert_eq!(
        compiled.resource_usage(cleared.id()).unwrap().bits(),
        (wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::STORAGE).bits() as u64
    );
}

#[test]
fn grouped_clear_records_ordered_precise_accesses() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let first = frame.create_buffer(BufferDesc::new("first", 16)).unwrap();
    let second = frame.create_buffer(BufferDesc::new("second", 16)).unwrap();
    let clear = frame
        .clear_buffers(
            "clear-both",
            [
                ClearBufferOp::new(first, BufferRange::new(4, 4)),
                ClearBufferOp::new(second, BufferRange::new(8, 8)),
            ],
        )
        .unwrap();
    frame
        .mark_buffer_root(first, BufferRange::new(4, 4), RootReason::Output)
        .unwrap();
    frame
        .mark_buffer_root(second, BufferRange::new(8, 8), RootReason::Output)
        .unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    let report = compiled.report().unwrap().full.as_ref().unwrap();
    assert_eq!(report.nodes[0].id, clear);
    assert_eq!(report.nodes[0].recording_order, 0);
    let accesses = report
        .accesses
        .iter()
        .filter(|access| access.pass == clear)
        .collect::<Vec<_>>();
    assert_eq!(accesses.len(), 2);
    assert_eq!(accesses[0].resource, first.id());
    assert_eq!(accesses[0].role, AccessRole::BufferCopyDst);
    assert_eq!(accesses[1].resource, second.id());
    assert_eq!(accesses[1].role, AccessRole::BufferCopyDst);
}

#[test]
fn clear_and_copy_operations_report_stable_validation_errors() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame
        .create_buffer(BufferDesc::new("buffer", 1024))
        .unwrap();
    let error = frame
        .clear_buffer("misaligned-clear", buffer, BufferRange::new(2, 4))
        .unwrap_err();
    assert_eq!(error.code(), "FG1106");
    assert!(matches!(
        error,
        FrameGraphError::InvalidNodeOperation { .. }
    ));
    let error = frame
        .clear_buffers("empty-clear", core::iter::empty())
        .unwrap_err();
    assert_eq!(error.code(), "FG1106");

    let texture = frame
        .import_texture(
            TextureDesc::new_2d("texture", 4, 4, wgpu::TextureFormat::Rgba8Unorm),
            ImportTextureOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let mut copy = frame.copy_pass("misaligned-copy");
    let error = match copy.copy_buffer_to_texture(
        BufferTextureCopyLocation::new(
            buffer,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(16),
                rows_per_image: Some(4),
            },
        ),
        TextureCopyLocation::new(texture),
        wgpu::Extent3d {
            width: 4,
            height: 4,
            depth_or_array_layers: 1,
        },
    ) {
        Ok(_) => panic!("misaligned bytes_per_row must be rejected"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "FG1106");
}

#[test]
fn partial_texture_copy_preserves_the_previous_subresource_value() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let source = frame
        .import_buffer(
            BufferDesc::new("source", 1024),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let destination = frame
        .import_texture(
            TextureDesc::new_2d("destination", 4, 4, wgpu::TextureFormat::Rgba8Unorm),
            ImportTextureOptions::new(InitialContents::Defined),
        )
        .unwrap();

    let mut copy = frame.copy_pass("partial-copy");
    copy.copy_buffer_to_texture(
        BufferTextureCopyLocation::new(
            source,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(256),
                rows_per_image: Some(4),
            },
        ),
        TextureCopyLocation::new(destination),
        wgpu::Extent3d {
            width: 2,
            height: 4,
            depth_or_array_layers: 1,
        },
    )
    .unwrap();
    copy.finish().unwrap();
    frame
        .mark_texture_root(destination, RootReason::Output)
        .unwrap();

    let compiled = frame.compile(full_options()).unwrap();
    let destination_access = compiled
        .report()
        .unwrap()
        .full
        .as_ref()
        .unwrap()
        .accesses
        .iter()
        .find(|access| access.role == AccessRole::TextureCopyDst)
        .unwrap();
    assert!(destination_access.consumes_previous);
}

#[test]
fn a_surface_must_be_defined_before_present() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let surface = frame
        .import_surface_texture(
            TextureDesc::new_2d("surface", 16, 16, wgpu::TextureFormat::Bgra8Unorm),
            Some(wgpu::TextureUsages::RENDER_ATTACHMENT),
        )
        .unwrap();
    let mut clear = frame.render_pass("clear-surface");
    let _ = clear
        .color_attachment(surface, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
        .unwrap();
    clear.finish().unwrap();
    frame.mark_present(surface).unwrap();
    assert_eq!(
        frame
            .compile(CompileOptions::default())
            .unwrap()
            .retained_node_count(),
        1
    );
}

#[test]
fn non_overlapping_lifetimes_alias_and_overlapping_lifetimes_do_not() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let a = frame.create_buffer(BufferDesc::new("a", 100)).unwrap();
    let b = frame.create_buffer(BufferDesc::new("b", 100)).unwrap();
    for (label, buffer) in [("a", a), ("b", b)] {
        let mut pass = frame.compute_pass(label);
        let _ = pass
            .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        pass.finish().unwrap();
        frame
            .mark_buffer_root(buffer, BufferRange::whole(), RootReason::Output)
            .unwrap();
    }
    let compiled = frame.compile(full_options()).unwrap();
    assert_eq!(compiled.allocations().len(), 1);
    assert_eq!(compiled.allocations()[0].estimated_byte_size, 128);

    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let a = frame.create_buffer(BufferDesc::new("a", 100)).unwrap();
    let b = frame.create_buffer(BufferDesc::new("b", 100)).unwrap();
    let mut first = frame.compute_pass("a");
    let _ = first
        .storage_buffer_write(a, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    first.finish().unwrap();
    let mut second = frame.compute_pass("a-to-b");
    let _ = second.storage_buffer_read(a, BufferRange::whole()).unwrap();
    let _ = second
        .storage_buffer_write(b, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    second.finish().unwrap();
    frame
        .mark_buffer_root(b, BufferRange::whole(), RootReason::Output)
        .unwrap();
    let compiled = frame.compile(full_options()).unwrap();
    assert_eq!(compiled.allocations().len(), 2);
}

#[test]
fn texture_allocation_key_covers_every_physical_creation_field() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let mut descriptors = Vec::new();

    descriptors.push(TextureDesc::new_2d(
        "base",
        8,
        8,
        wgpu::TextureFormat::Rgba8Unorm,
    ));
    descriptors.push(TextureDesc::new_2d(
        "format",
        8,
        8,
        wgpu::TextureFormat::Rg8Unorm,
    ));
    descriptors.push(TextureDesc::new_2d(
        "extent",
        16,
        8,
        wgpu::TextureFormat::Rgba8Unorm,
    ));

    let mut mips = TextureDesc::new_2d("mips", 8, 8, wgpu::TextureFormat::Rgba8Unorm);
    mips.mip_level_count = 2;
    descriptors.push(mips);

    let mut samples = TextureDesc::new_2d("samples", 8, 8, wgpu::TextureFormat::Rgba8Unorm);
    samples.sample_count = 4;
    descriptors.push(samples);

    let mut view_formats =
        TextureDesc::new_2d("view-formats", 8, 8, wgpu::TextureFormat::Rgba8Unorm);
    view_formats.view_formats = vec![wgpu::TextureFormat::Rgba8UnormSrgb];
    descriptors.push(view_formats);

    for descriptor in descriptors {
        let texture = frame.create_texture(descriptor).unwrap();
        let view = frame
            .create_texture_view(
                texture,
                TextureViewDesc {
                    mip_level_count: Some(1),
                    array_layer_count: Some(1),
                    ..Default::default()
                },
            )
            .unwrap();
        let mut pass = frame.render_pass("write");
        let _ = pass
            .color_attachment(view, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
            .unwrap();
        pass.finish().unwrap();
        frame.mark_texture_root(view, RootReason::Output).unwrap();
    }

    let compiled = frame.compile(full_options()).unwrap();
    assert_eq!(compiled.allocations().len(), 6);
}

#[test]
fn texture_view_format_order_is_canonicalized_for_allocation_aliasing() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let formats = [
        vec![
            wgpu::TextureFormat::Rgba8Unorm,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        ],
        vec![
            wgpu::TextureFormat::Rgba8UnormSrgb,
            wgpu::TextureFormat::Rgba8Unorm,
        ],
    ];

    for (index, view_formats) in formats.into_iter().enumerate() {
        let mut descriptor = TextureDesc::new_2d(
            format!("texture-{index}"),
            8,
            8,
            wgpu::TextureFormat::Rgba8Unorm,
        );
        descriptor.view_formats = view_formats;
        let texture = frame.create_texture(descriptor).unwrap();
        let mut pass = frame.render_pass(format!("write-{index}"));
        let _ = pass
            .color_attachment(texture, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
            .unwrap();
        pass.finish().unwrap();
        frame
            .mark_texture_root(texture, RootReason::Output)
            .unwrap();
    }

    let compiled = frame.compile(full_options()).unwrap();
    assert_eq!(compiled.allocations().len(), 1);
}

#[test]
fn execution_segments_preserve_external_boundaries() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    frame.command_pass("before").finish().unwrap();
    frame.external_submission("external").finish().unwrap();
    frame.command_pass("after").finish().unwrap();
    let compiled = frame.compile(full_options()).unwrap();
    let segments = compiled.execution_segments();
    assert_eq!(segments.len(), 3);
    assert_eq!(
        segments[1].kind,
        zenfg::ExecutionSegmentKind::ExternalSubmission
    );
}

#[test]
fn dropped_pass_poisoning_is_reported_at_compile() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    drop(frame.compute_pass("forgotten"));
    assert!(matches!(
        frame.compile(CompileOptions::default()),
        Err(FrameGraphError::UnclosedPass { .. })
    ));
}

#[test]
fn handles_from_another_graph_are_rejected_at_runtime() {
    let mut a = FrameGraph::new();
    let mut b = FrameGraph::new();
    let mut frame_a = a.begin_frame();
    let foreign = frame_a
        .create_buffer(BufferDesc::new("foreign", 4))
        .unwrap();
    let mut frame_b = b.begin_frame();
    let mut pass = frame_b.compute_pass("bad");
    assert!(matches!(
        pass.storage_buffer_read(foreign, BufferRange::whole()),
        Err(FrameGraphError::ForeignHandle { .. })
    ));
}

#[test]
fn summary_and_none_reports_have_expected_shapes() {
    let mut graph = FrameGraph::new();
    let frame = graph.begin_frame();
    let compiled = frame
        .compile(CompileOptions {
            report_level: ReportLevel::Summary,
        })
        .unwrap();
    assert!(compiled.report().unwrap().full.is_none());

    drop(compiled);
    let frame = graph.begin_frame();
    let compiled = frame.compile(CompileOptions::default()).unwrap();
    assert!(compiled.report().is_none());
}
