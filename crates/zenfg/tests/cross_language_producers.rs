#![cfg(feature = "snapshot")]

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use zenfg::{
    BufferDesc, BufferRange, ColorAttachmentOps, CompilationReport, CompileOptions, Frame,
    FrameGraph, RootReason, TextureDesc, TextureViewDesc, WriteContents,
    snapshot::{
        CreateFrameGraphSnapshotOptions, create_frame_graph_snapshot, parse_frame_graph_snapshot,
        to_json_pretty, validate_frame_graph_snapshot,
    },
};

type ProducerCase = (&'static str, fn() -> CompilationReport);

const CASES: &[ProducerCase] = &[
    ("linear-dependency", linear_dependency),
    ("overwrite-culling", overwrite_culling),
    ("preserve-discard", preserve_discard),
    ("buffer-range", buffer_range),
    ("texture-subresource", texture_subresource),
    ("external-submission", external_submission),
    ("aliasing", aliasing),
];

#[test]
fn mirror_producers_are_deterministic_and_cross_validate_typescript_output() {
    let output_root = env::var_os("ZENFG_CROSS_LANGUAGE_OUTPUT_DIR").map(PathBuf::from);
    let rust_output = output_root.as_ref().map(|root| root.join("raw/rust"));
    if let Some(directory) = &rust_output {
        fs::create_dir_all(directory).expect("create Rust producer output directory");
    }

    for (name, producer) in CASES {
        let first = produce_snapshot_json(*producer);
        if let Some(directory) = &rust_output {
            fs::write(directory.join(snapshot_file(name)), &first)
                .expect("write Rust producer Snapshot");
        }
        let second = produce_snapshot_json(*producer);
        if first != second
            && let Some(root) = &output_root
        {
            let repeat_directory = root.join("raw/rust-repeat");
            fs::create_dir_all(&repeat_directory)
                .expect("create repeated Rust producer output directory");
            fs::write(repeat_directory.join(snapshot_file(name)), &second)
                .expect("write repeated Rust producer Snapshot");
        }
        assert_eq!(first, second, "{name}: Rust producer is not deterministic");

        let value: serde_json::Value =
            serde_json::from_str(&first).expect("Rust producer emitted JSON");
        assert!(
            validate_frame_graph_snapshot(&value).is_empty(),
            "{name}: Rust producer emitted an invalid Snapshot"
        );
        parse_frame_graph_snapshot(&first).expect("Rust producer output must decode");
    }

    if let Some(root) = output_root {
        validate_typescript_snapshots(&root);
    }
}

fn produce_snapshot_json(producer: fn() -> CompilationReport) -> String {
    let report = producer();
    let mut options = CreateFrameGraphSnapshotOptions::new(0);
    options.captured_at = Some("2026-08-30T00:00:00.000Z");
    options.backend = Some("noop");
    let snapshot = create_frame_graph_snapshot(&report, options)
        .expect("runtime report must export as Snapshot V1");
    to_json_pretty(&snapshot).expect("runtime Snapshot must validate and encode")
}

fn validate_typescript_snapshots(output_root: &Path) {
    let typescript_output = output_root.join("raw/typescript");
    for (name, _) in CASES {
        let path = typescript_output.join(snapshot_file(name));
        let text = fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "{name}: failed to read TypeScript producer output {}: {error}",
                path.display()
            )
        });
        let value: serde_json::Value = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("{name}: invalid TypeScript JSON: {error}"));
        let issues = validate_frame_graph_snapshot(&value);
        assert!(
            issues.is_empty(),
            "{name}: Rust validator rejected TypeScript producer output: {issues:#?}"
        );
        parse_frame_graph_snapshot(&text).unwrap_or_else(|error| {
            panic!("{name}: Rust decoder rejected TypeScript output: {error}")
        });
    }
}

fn snapshot_file(name: &str) -> String {
    format!("{name}.fgsnapshot.json")
}

fn compile(record: impl FnOnce(&mut Frame<'_>)) -> CompilationReport {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    record(&mut frame);
    let mut compiled = frame
        .compile(CompileOptions::full_report())
        .expect("mirror producer graph must compile");
    compiled.take_report().expect("full report was requested")
}

fn linear_dependency() -> CompilationReport {
    compile(|frame| {
        frame.push_debug_group("linear.group").unwrap();
        let input = frame
            .create_buffer(BufferDesc::new("linear.input", 64))
            .unwrap();
        let output = frame
            .create_buffer(BufferDesc::new("linear.output", 64))
            .unwrap();
        frame.push_debug_group("linear.work").unwrap();
        let mut write = frame.command_pass("linear.write");
        write.set_side_effect(false);
        let _ = write
            .storage_buffer_write(input, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        write.finish().unwrap();
        let mut transform = frame.command_pass("linear.transform");
        transform.set_side_effect(false);
        let _ = transform
            .storage_buffer_read(input, BufferRange::whole())
            .unwrap();
        let _ = transform
            .storage_buffer_write(output, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        transform.finish().unwrap();
        frame.pop_debug_group().unwrap();
        frame
            .mark_buffer_root(output, BufferRange::whole(), RootReason::Output)
            .unwrap();
        frame.pop_debug_group().unwrap();
    })
}

fn overwrite_culling() -> CompilationReport {
    compile(|frame| {
        let value = frame
            .create_buffer(BufferDesc::new("overwrite.value", 64))
            .unwrap();
        let mut dead = frame.command_pass("overwrite.dead-write");
        dead.set_side_effect(false);
        let _ = dead
            .storage_buffer_write(value, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        dead.finish().unwrap();
        let mut live = frame.command_pass("overwrite.live-write");
        live.set_side_effect(false);
        let _ = live
            .storage_buffer_write(value, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        live.finish().unwrap();
        let mut consume = frame.command_pass("overwrite.consume");
        consume.set_side_effect(true);
        let _ = consume
            .storage_buffer_read(value, BufferRange::whole())
            .unwrap();
        consume.finish().unwrap();
    })
}

fn preserve_discard() -> CompilationReport {
    compile(|frame| {
        let mut descriptor = TextureDesc::new_2d(
            "preserve-discard.texture",
            8,
            8,
            wgpu::TextureFormat::Rgba8Unorm,
        );
        descriptor.mip_level_count = 2;
        let texture = frame.create_texture(descriptor).unwrap();
        let mip0 = frame
            .create_texture_view(
                texture,
                TextureViewDesc {
                    label: "preserve-discard.mip-0".into(),
                    base_mip_level: 0,
                    mip_level_count: Some(1),
                    ..Default::default()
                },
            )
            .unwrap();
        let mip1 = frame
            .create_texture_view(
                texture,
                TextureViewDesc {
                    label: "preserve-discard.mip-1".into(),
                    base_mip_level: 1,
                    mip_level_count: Some(1),
                    ..Default::default()
                },
            )
            .unwrap();

        let mut seed = frame.render_pass("preserve.seed");
        let _ = seed
            .color_attachment(mip0, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
            .unwrap();
        seed.finish().unwrap();
        let mut preserve = frame.render_pass("preserve.load");
        preserve.set_side_effect(true);
        let _ = preserve
            .color_attachment(mip0, ColorAttachmentOps::load_store())
            .unwrap();
        preserve.finish().unwrap();
        let mut discard_seed = frame.render_pass("discard.seed");
        discard_seed.set_side_effect(false);
        let _ = discard_seed
            .color_attachment(mip1, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
            .unwrap();
        discard_seed.finish().unwrap();
        let mut discard = frame.render_pass("discard.overwrite-discard");
        discard.set_side_effect(true);
        let _ = discard
            .color_attachment(mip1, ColorAttachmentOps::clear_discard(wgpu::Color::BLACK))
            .unwrap();
        discard.finish().unwrap();
    })
}

fn buffer_range() -> CompilationReport {
    compile(|frame| {
        let ranged = frame
            .create_buffer(BufferDesc::new("range.buffer", 64))
            .unwrap();
        let mut left = frame.command_pass("range.write-left");
        left.set_side_effect(false);
        let _ = left
            .storage_buffer_write(ranged, BufferRange::new(0, 8), WriteContents::Overwrite)
            .unwrap();
        left.finish().unwrap();
        let mut right = frame.command_pass("range.write-right");
        right.set_side_effect(false);
        let _ = right
            .storage_buffer_write(ranged, BufferRange::new(8, 8), WriteContents::Overwrite)
            .unwrap();
        right.finish().unwrap();
        let mut crossing = frame.command_pass("range.read-crossing");
        crossing.set_side_effect(true);
        let _ = crossing
            .storage_buffer_read(ranged, BufferRange::new(4, 8))
            .unwrap();
        crossing.finish().unwrap();
    })
}

fn texture_subresource() -> CompilationReport {
    compile(|frame| {
        let mut descriptor =
            TextureDesc::new_2d("subresource.texture", 8, 8, wgpu::TextureFormat::Rgba8Unorm);
        descriptor.mip_level_count = 2;
        descriptor.size.depth_or_array_layers = 2;
        let texture = frame.create_texture(descriptor).unwrap();
        let non_overlap = frame
            .create_texture_view(
                texture,
                TextureViewDesc {
                    label: "subresource.other-mip-0-layer-0".into(),
                    base_mip_level: 0,
                    mip_level_count: Some(1),
                    base_array_layer: 0,
                    array_layer_count: Some(1),
                    ..Default::default()
                },
            )
            .unwrap();
        let target = frame
            .create_texture_view(
                texture,
                TextureViewDesc {
                    label: "subresource.target-mip-1-layer-1".into(),
                    base_mip_level: 1,
                    mip_level_count: Some(1),
                    base_array_layer: 1,
                    array_layer_count: Some(1),
                    ..Default::default()
                },
            )
            .unwrap();

        let mut dead = frame.command_pass("subresource.dead-non-overlap");
        dead.set_side_effect(false);
        let _ = dead
            .storage_texture_write(non_overlap, WriteContents::Overwrite)
            .unwrap();
        dead.finish().unwrap();
        let mut write = frame.command_pass("subresource.write-target");
        write.set_side_effect(false);
        let _ = write
            .storage_texture_write(target, WriteContents::Overwrite)
            .unwrap();
        write.finish().unwrap();
        let mut read = frame.command_pass("subresource.read-target");
        read.set_side_effect(true);
        let _ = read.storage_texture_read(target).unwrap();
        read.finish().unwrap();
    })
}

fn external_submission() -> CompilationReport {
    compile(|frame| {
        let value = frame
            .create_buffer(BufferDesc::new("external.value", 64))
            .unwrap();
        let mut before = frame.command_pass("external.before");
        before.set_side_effect(false);
        let _ = before
            .storage_buffer_write(value, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        before.finish().unwrap();
        let mut external = frame.external_submission("external.submit");
        external.set_side_effect(false);
        let _ = external
            .storage_buffer_write(value, BufferRange::whole(), WriteContents::Preserve)
            .unwrap();
        external.finish().unwrap();
        let mut after = frame.command_pass("external.after");
        after.set_side_effect(true);
        let _ = after
            .storage_buffer_read(value, BufferRange::whole())
            .unwrap();
        after.finish().unwrap();
    })
}

fn aliasing() -> CompilationReport {
    compile(|frame| {
        let first = frame
            .create_buffer(BufferDesc::new("alias.first", 64))
            .unwrap();
        let second = frame
            .create_buffer(BufferDesc::new("alias.second", 64))
            .unwrap();
        let overlap = frame
            .create_buffer(BufferDesc::new("alias.overlap", 64))
            .unwrap();
        let mut write_first = frame.command_pass("alias.write-first");
        write_first.set_side_effect(false);
        let _ = write_first
            .storage_buffer_write(first, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        let _ = write_first
            .storage_buffer_write(overlap, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        write_first.finish().unwrap();
        let mut consume_first = frame.command_pass("alias.consume-first");
        consume_first.set_side_effect(false);
        let _ = consume_first
            .storage_buffer_read(first, BufferRange::whole())
            .unwrap();
        let _ = consume_first
            .storage_buffer_write(overlap, BufferRange::whole(), WriteContents::Preserve)
            .unwrap();
        consume_first.finish().unwrap();
        let mut write_second = frame.command_pass("alias.write-second");
        write_second.set_side_effect(false);
        let _ = write_second
            .storage_buffer_read(overlap, BufferRange::whole())
            .unwrap();
        let _ = write_second
            .storage_buffer_write(second, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        write_second.finish().unwrap();
        let mut consume_second = frame.command_pass("alias.consume-second");
        consume_second.set_side_effect(true);
        let _ = consume_second
            .storage_buffer_read(second, BufferRange::whole())
            .unwrap();
        let _ = consume_second
            .storage_buffer_read(overlap, BufferRange::whole())
            .unwrap();
        consume_second.finish().unwrap();
    })
}
