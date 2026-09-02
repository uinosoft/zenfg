use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use zenfg::{
    BufferDesc, BufferRange, BufferTextureCopyLocation, ColorAttachmentOps, CompileOptions,
    DepthAttachmentOps, ExecutionOptions, FrameGraph, FrameGraphError, GpuTimingNodeKind,
    GpuTimingReport, GpuTimingUnavailableReason, ImportBufferOptions, ImportTextureOptions,
    InitialContents, RootReason, TextureCopyLocation, TextureDesc, TextureViewDesc, UsagePolicy,
    WriteContents,
};

fn noop_device() -> (wgpu::Device, wgpu::Queue) {
    wgpu::Device::noop(&wgpu::DeviceDescriptor::default())
}

fn timestamp_device() -> (wgpu::Device, wgpu::Queue) {
    wgpu::Device::noop(&wgpu::DeviceDescriptor {
        required_features: wgpu::Features::TIMESTAMP_QUERY,
        ..Default::default()
    })
}

fn take_timing(readback: &mut zenfg::GpuTimingReadback) -> GpuTimingReport {
    for _ in 0..100 {
        if let Some(report) = readback.try_take() {
            return report;
        }
        std::thread::yield_now();
    }
    panic!("GPU timing readback did not complete")
}

fn native_buffer(device: &wgpu::Device, size: u64, usage: wgpu::BufferUsages) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("execution-test-buffer"),
        size,
        usage,
        mapped_at_creation: false,
    })
}

fn native_texture(device: &wgpu::Device, usage: wgpu::TextureUsages) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("execution-view-cache-texture"),
        size: wgpu::Extent3d {
            width: 4,
            height: 4,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage,
        view_formats: &[],
    })
}

#[test]
fn executes_multisample_resolve_and_read_only_depth() {
    let (device, queue) = noop_device();
    let called = Arc::new(Mutex::new(Vec::new()));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();

    let mut msaa_desc = TextureDesc::new_2d("msaa", 4, 4, wgpu::TextureFormat::Rgba8Unorm);
    msaa_desc.sample_count = 4;
    let msaa = frame.create_texture(msaa_desc).unwrap();
    let resolved = frame
        .create_texture(TextureDesc::new_2d(
            "resolved",
            4,
            4,
            wgpu::TextureFormat::Rgba8Unorm,
        ))
        .unwrap();
    let mut depth_desc = TextureDesc::new_2d("depth", 4, 4, wgpu::TextureFormat::Depth32Float);
    depth_desc.sample_count = 4;
    let depth = frame.create_texture(depth_desc).unwrap();

    let resolve_called = called.clone();
    let mut resolve = frame.render_pass("resolve");
    let _ = resolve
        .color_attachment_with_resolve(
            msaa,
            resolved,
            ColorAttachmentOps::clear_store(wgpu::Color::BLACK),
        )
        .unwrap();
    let _ = resolve
        .depth_attachment(depth, DepthAttachmentOps::clear_store(1.0))
        .unwrap();
    resolve
        .finish_render(move |_| {
            resolve_called.lock().unwrap().push("resolve");
            Ok(())
        })
        .unwrap();

    let depth_called = called.clone();
    let mut read_depth = frame.render_pass("read-only-depth");
    read_depth.set_side_effect(true);
    let _ = read_depth.depth_attachment_read_only(depth).unwrap();
    read_depth
        .finish_render(move |_| {
            depth_called.lock().unwrap().push("depth");
            Ok(())
        })
        .unwrap();
    frame
        .mark_texture_root(resolved, RootReason::Output)
        .unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert_eq!(*called.lock().unwrap(), ["resolve", "depth"]);
}

#[test]
fn gpu_debug_groups_survive_nested_paths_and_external_boundaries() {
    let (device, queue) = noop_device();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    frame
        .with_debug_group("Mesh", |frame| {
            let first_calls = calls.clone();
            frame.command_pass("first").finish_command(move |_| {
                first_calls.lock().unwrap().push("first");
                Ok(())
            })?;
            let external_calls = calls.clone();
            frame
                .external_submission("external")
                .finish_external(move |_| {
                    external_calls.lock().unwrap().push("external");
                    Ok(())
                })?;
            frame.with_debug_group("Draw", |frame| {
                let second_calls = calls.clone();
                frame.command_pass("second").finish_command(move |_| {
                    second_calls.lock().unwrap().push("second");
                    Ok(())
                })?;
                Ok(())
            })
        })
        .unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_options(
            &queue,
            ExecutionOptions::default().with_gpu_debug_groups(true),
        )
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), ["first", "external", "second"]);
}

#[test]
fn gpu_debug_groups_support_sparse_retained_ids() {
    let (device, queue) = noop_device();
    let called = Arc::new(Mutex::new(false));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();

    frame
        .with_debug_group("Frame Targets", |frame| {
            let _ = frame.create_buffer(BufferDesc::new("unused-target", 4))?;
            Ok(())
        })
        .unwrap();
    frame
        .with_debug_group("Mesh", |frame| {
            let callback_called = called.clone();
            frame.command_pass("draw").finish_command(move |_| {
                *callback_called.lock().unwrap() = true;
                Ok(())
            })
        })
        .unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_options(
            &queue,
            ExecutionOptions::default().with_gpu_debug_groups(true),
        )
        .unwrap();
    assert!(*called.lock().unwrap());
}

#[test]
fn executes_command_and_resolves_native_buffer() {
    let (device, queue) = noop_device();
    let native = native_buffer(&device, 64, wgpu::BufferUsages::STORAGE);
    let called = Arc::new(Mutex::new(false));

    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame
        .import_buffer(
            BufferDesc {
                label: "input".into(),
                size: 64,
                usage: UsagePolicy::Fixed(wgpu::BufferUsages::STORAGE),
            },
            ImportBufferOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(wgpu::BufferUsages::STORAGE),
            },
        )
        .unwrap();
    frame.bind_imported_buffer(buffer, &native).unwrap();

    let mut pass = frame.command_pass("read");
    let token = pass
        .storage_buffer_read(buffer, BufferRange::whole())
        .unwrap();
    let callback_called = called.clone();
    pass.finish_command(move |ctx| {
        let resolved = ctx.resources.buffer(token)?;
        assert_eq!(resolved, &native);
        *callback_called.lock().unwrap() = true;
        Ok(())
    })
    .unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert!(*called.lock().unwrap());
}

#[test]
fn resolves_texture_and_execution_view() {
    let (device, queue) = noop_device();
    let native = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("execution-test-texture"),
        size: wgpu::Extent3d {
            width: 4,
            height: 4,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });

    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let texture = frame
        .import_texture(
            TextureDesc {
                label: "input".into(),
                size: native.size(),
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                view_formats: vec![],
                usage: UsagePolicy::Fixed(wgpu::TextureUsages::TEXTURE_BINDING),
            },
            ImportTextureOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(wgpu::TextureUsages::TEXTURE_BINDING),
            },
        )
        .unwrap();
    frame.bind_imported_texture(texture, &native).unwrap();
    let mut pass = frame.command_pass("sample");
    let token = pass.sampled_texture(texture).unwrap();
    pass.finish_command(move |ctx| {
        let _ = ctx.resources.texture(token)?;
        let _ = ctx.resources.texture_view(token)?;
        Ok(())
    })
    .unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
}

#[test]
fn culled_callback_is_not_invoked() {
    let (device, queue) = noop_device();
    let called = Arc::new(Mutex::new(false));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let mut pass = frame.command_pass("culled");
    pass.set_side_effect(false);
    let callback_called = called.clone();
    pass.finish_command(move |_| {
        *callback_called.lock().unwrap() = true;
        Ok(())
    })
    .unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert!(!*called.lock().unwrap());
}

#[test]
fn culled_callback_capture_is_dropped_during_compile() {
    struct DropProbe(Arc<AtomicUsize>);
    impl Drop for DropProbe {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    let (device, _) = noop_device();
    let dropped = Arc::new(AtomicUsize::new(0));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let mut culled = frame.command_pass("culled-drop-probe");
    culled.set_side_effect(false);
    let probe = DropProbe(dropped.clone());
    culled
        .finish_command(move |_| {
            let _ = &probe;
            Ok(())
        })
        .unwrap();

    let compiled = frame.compile(CompileOptions::default()).unwrap();
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
    drop(compiled);
    assert_eq!(dropped.load(Ordering::SeqCst), 1);

    let mut frame = graph.begin_frame();
    let retained_probe = DropProbe(dropped.clone());
    frame
        .command_pass("retained-drop-probe")
        .finish_command(move |_| {
            let _ = &retained_probe;
            Ok(())
        })
        .unwrap();
    let compiled = frame.compile(CompileOptions::default()).unwrap();
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
    drop(compiled);
    assert_eq!(dropped.load(Ordering::SeqCst), 2);
}

#[test]
fn explicit_texture_view_is_reused_across_retained_roles() {
    let (device, queue) = noop_device();
    let usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING;
    let native = native_texture(&device, usage);
    let resolved = Arc::new(Mutex::new(Vec::<wgpu::TextureView>::new()));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let texture = frame
        .import_texture(
            TextureDesc {
                usage: UsagePolicy::Fixed(usage),
                ..TextureDesc::new_2d("shared", 4, 4, wgpu::TextureFormat::Rgba8Unorm)
            },
            ImportTextureOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(usage),
            },
        )
        .unwrap();
    frame.bind_imported_texture(texture, &native).unwrap();
    let view = frame
        .create_texture_view(texture, TextureViewDesc::default())
        .unwrap();

    let sampled_views = resolved.clone();
    let mut sampled = frame.command_pass("sampled");
    let sampled_token = sampled.sampled_texture(view).unwrap();
    sampled
        .finish_command(move |ctx| {
            sampled_views
                .lock()
                .unwrap()
                .push(ctx.resources.texture_view(sampled_token)?.clone());
            Ok(())
        })
        .unwrap();
    let storage_views = resolved.clone();
    let mut storage = frame.command_pass("storage");
    let storage_token = storage.storage_texture_read(view).unwrap();
    storage
        .finish_command(move |ctx| {
            storage_views
                .lock()
                .unwrap()
                .push(ctx.resources.texture_view(storage_token)?.clone());
            Ok(())
        })
        .unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    let resolved = resolved.lock().unwrap();
    assert_eq!(resolved.len(), 2);
    assert_eq!(resolved[0], resolved[1]);
}

#[test]
fn implicit_view_cache_reuses_compatible_roles_and_separates_incompatible_roles() {
    let (device, queue) = noop_device();
    let usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING;
    let native = native_texture(&device, usage);
    let resolved = Arc::new(Mutex::new(Vec::<wgpu::TextureView>::new()));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let texture = frame
        .import_texture(
            TextureDesc {
                usage: UsagePolicy::Fixed(usage),
                ..TextureDesc::new_2d("raw", 4, 4, wgpu::TextureFormat::Rgba8Unorm)
            },
            ImportTextureOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(usage),
            },
        )
        .unwrap();
    frame.bind_imported_texture(texture, &native).unwrap();

    let write_views = resolved.clone();
    let mut write = frame.command_pass("storage-write");
    let write_token = write
        .storage_texture_write(texture, WriteContents::Overwrite)
        .unwrap();
    write
        .finish_command(move |ctx| {
            write_views
                .lock()
                .unwrap()
                .push(ctx.resources.texture_view(write_token)?.clone());
            Ok(())
        })
        .unwrap();
    let read_views = resolved.clone();
    let mut read = frame.command_pass("storage-read");
    let read_token = read.storage_texture_read(texture).unwrap();
    read.finish_command(move |ctx| {
        read_views
            .lock()
            .unwrap()
            .push(ctx.resources.texture_view(read_token)?.clone());
        Ok(())
    })
    .unwrap();
    let sampled_views = resolved.clone();
    let mut sampled = frame.command_pass("sampled-read");
    let sampled_token = sampled.sampled_texture(texture).unwrap();
    sampled
        .finish_command(move |ctx| {
            sampled_views
                .lock()
                .unwrap()
                .push(ctx.resources.texture_view(sampled_token)?.clone());
            Ok(())
        })
        .unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    let resolved = resolved.lock().unwrap();
    assert_eq!(resolved.len(), 3);
    assert_eq!(resolved[0], resolved[1]);
    assert_ne!(resolved[1], resolved[2]);
}

#[test]
fn distinct_explicit_view_handles_remain_distinct() {
    let (device, queue) = noop_device();
    let usage = wgpu::TextureUsages::TEXTURE_BINDING;
    let native = native_texture(&device, usage);
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let texture = frame
        .import_texture(
            TextureDesc {
                usage: UsagePolicy::Fixed(usage),
                ..TextureDesc::new_2d("explicit", 4, 4, wgpu::TextureFormat::Rgba8Unorm)
            },
            ImportTextureOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(usage),
            },
        )
        .unwrap();
    frame.bind_imported_texture(texture, &native).unwrap();
    let first = frame
        .create_texture_view(texture, TextureViewDesc::default())
        .unwrap();
    let second = frame
        .create_texture_view(texture, TextureViewDesc::default())
        .unwrap();
    let distinct = Arc::new(Mutex::new(false));
    let result = distinct.clone();
    let mut pass = frame.command_pass("two-logical-views");
    let first_token = pass.sampled_texture(first).unwrap();
    let second_token = pass.sampled_texture(second).unwrap();
    pass.finish_command(move |ctx| {
        *result.lock().unwrap() =
            ctx.resources.texture_view(first_token)? != ctx.resources.texture_view(second_token)?;
        Ok(())
    })
    .unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert!(*distinct.lock().unwrap());
}

#[test]
fn preflight_rejects_unbound_resource_before_callbacks() {
    let (device, queue) = noop_device();
    let called = Arc::new(Mutex::new(false));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame
        .import_buffer(
            BufferDesc::new("unbound", 4),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let mut pass = frame.command_pass("read");
    let _ = pass
        .storage_buffer_read(buffer, BufferRange::whole())
        .unwrap();
    let callback_called = called.clone();
    pass.finish_command(move |_| {
        *callback_called.lock().unwrap() = true;
        Ok(())
    })
    .unwrap();
    let error = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap_err();
    assert!(matches!(
        error,
        FrameGraphError::MissingNativeBinding { .. }
    ));
    assert!(!*called.lock().unwrap());
}

#[test]
fn executes_transient_command_and_retains_physical_resource() {
    let (device, queue) = noop_device();
    let called = Arc::new(Mutex::new(false));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame
        .create_buffer(BufferDesc::new("transient", 4))
        .unwrap();
    let mut pass = frame.command_pass("write");
    let token = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    let callback_called = called.clone();
    pass.finish_command(move |ctx| {
        let _ = ctx.resources.buffer(token)?;
        *callback_called.lock().unwrap() = true;
        Ok(())
    })
    .unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert!(*called.lock().unwrap());
    assert_eq!(graph.resource_pool_stats().acquire_count, 1);
    assert_eq!(graph.resource_pool_stats().created_count, 1);
    assert_eq!(graph.resource_pool_stats().retained_count, 1);
    assert_eq!(graph.resource_pool_stats().estimated_retained_bytes, 4);
}

#[test]
fn wrong_pass_token_is_rejected_at_execution() {
    let (device, queue) = noop_device();
    let native = native_buffer(&device, 4, wgpu::BufferUsages::STORAGE);
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame
        .import_buffer(
            BufferDesc::new("shared", 4),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    frame.bind_imported_buffer(buffer, &native).unwrap();
    let mut first = frame.command_pass("first");
    let first_token = first
        .storage_buffer_read(buffer, BufferRange::whole())
        .unwrap();
    first.finish_command(|_| Ok(())).unwrap();
    frame
        .command_pass("second")
        .finish_command(move |ctx| {
            let _ = ctx.resources.buffer(first_token)?;
            Ok(())
        })
        .unwrap();
    let error = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap_err();
    assert!(matches!(error, FrameGraphError::WrongPassToken { .. }));
}

#[test]
fn external_submission_is_an_ordered_segment() {
    let (device, queue) = noop_device();
    let order = Arc::new(Mutex::new(Vec::new()));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let first_order = order.clone();
    frame
        .command_pass("first")
        .finish_command(move |_| {
            first_order.lock().unwrap().push(1);
            Ok(())
        })
        .unwrap();
    let external_order = order.clone();
    frame
        .external_submission("external")
        .finish_external(move |ctx| {
            external_order.lock().unwrap().push(2);
            let encoder = ctx
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
            ctx.queue.submit(Some(encoder.finish()));
            Ok(())
        })
        .unwrap();
    let last_order = order.clone();
    frame
        .command_pass("last")
        .finish_command(move |_| {
            last_order.lock().unwrap().push(3);
            Ok(())
        })
        .unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert_eq!(*order.lock().unwrap(), vec![1, 2, 3]);
}

#[test]
fn native_descriptor_mismatch_is_reported_while_recording() {
    let (device, _) = noop_device();
    let native = native_buffer(&device, 4, wgpu::BufferUsages::STORAGE);
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame
        .import_buffer(
            BufferDesc::new("too-large", 8),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let error = frame.bind_imported_buffer(buffer, &native).unwrap_err();
    assert_eq!(error.code(), "FG4003");
}

#[test]
fn cpu_only_graph_cannot_execute() {
    let (_, queue) = noop_device();
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    frame
        .command_pass("command")
        .finish_command(|_| Ok(()))
        .unwrap();
    let error = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap_err();
    assert_eq!(error.code(), "FG4001");
}

#[test]
fn retained_command_requires_an_executor() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    frame.command_pass("missing").finish().unwrap();
    let error = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap_err();
    assert_eq!(error.code(), "FG4004");
}

#[test]
fn one_native_object_cannot_back_two_logical_imports() {
    let (device, _) = noop_device();
    let native = native_buffer(&device, 4, wgpu::BufferUsages::STORAGE);
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let first = frame
        .import_buffer(
            BufferDesc::new("first", 4),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    frame.bind_imported_buffer(first, &native).unwrap();
    let second = frame
        .import_buffer(
            BufferDesc::new("second", 4),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let error = frame.bind_imported_buffer(second, &native).unwrap_err();
    assert_eq!(error.code(), "FG4003");
}

#[test]
fn structured_render_and_compute_callbacks_execute_in_order() {
    let (device, queue) = noop_device();
    let order = Arc::new(Mutex::new(Vec::new()));
    let color_native = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("structured-color"),
        size: wgpu::Extent3d {
            width: 4,
            height: 4,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let buffer_native = native_buffer(
        &device,
        4,
        wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
    );
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame
        .import_buffer(
            BufferDesc::new("structured-buffer", 4),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    frame.bind_imported_buffer(buffer, &buffer_native).unwrap();
    let color = frame
        .import_surface_texture(
            TextureDesc {
                label: "structured-color".into(),
                size: color_native.size(),
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                view_formats: vec![],
                usage: UsagePolicy::Fixed(wgpu::TextureUsages::RENDER_ATTACHMENT),
            },
            Some(wgpu::TextureUsages::RENDER_ATTACHMENT),
        )
        .unwrap();
    frame.bind_imported_texture(color, &color_native).unwrap();

    let compute_order = order.clone();
    let mut compute = frame.compute_pass("structured-compute");
    compute.set_side_effect(true);
    let token = compute
        .storage_buffer_read(buffer, BufferRange::whole())
        .unwrap();
    compute
        .finish_compute(move |ctx| {
            let _ = ctx.resources.buffer(token)?;
            compute_order.lock().unwrap().push(1);
            Ok(())
        })
        .unwrap();

    let render_order = order.clone();
    let mut render = frame.render_pass("structured-render");
    let _ = render
        .color_attachment(color, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
        .unwrap();
    render
        .finish_render(move |_| {
            render_order.lock().unwrap().push(2);
            Ok(())
        })
        .unwrap();
    frame.mark_present(color).unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert_eq!(*order.lock().unwrap(), vec![1, 2]);
}

#[test]
fn render_supports_multiple_color_attachments_and_a_pure_depth_pass() {
    let (device, queue) = noop_device();
    let color_descriptor = || wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d {
            width: 4,
            height: 4,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    };
    let color_a_native = device.create_texture(&color_descriptor());
    let color_b_native = device.create_texture(&color_descriptor());
    let depth_native = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("depth"),
        format: wgpu::TextureFormat::Depth32Float,
        ..color_descriptor()
    });

    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let color_desc = |label: &str| TextureDesc {
        label: label.into(),
        size: color_a_native.size(),
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        view_formats: vec![],
        usage: UsagePolicy::Fixed(wgpu::TextureUsages::RENDER_ATTACHMENT),
    };
    let color_a = frame
        .import_surface_texture(
            color_desc("color-a"),
            Some(wgpu::TextureUsages::RENDER_ATTACHMENT),
        )
        .unwrap();
    let color_b = frame
        .import_texture(
            color_desc("color-b"),
            ImportTextureOptions::new(InitialContents::Undefined),
        )
        .unwrap();
    let depth = frame
        .import_texture(
            TextureDesc {
                format: wgpu::TextureFormat::Depth32Float,
                ..color_desc("depth")
            },
            ImportTextureOptions::new(InitialContents::Undefined),
        )
        .unwrap();
    frame
        .bind_imported_texture(color_a, &color_a_native)
        .unwrap();
    frame
        .bind_imported_texture(color_b, &color_b_native)
        .unwrap();
    frame.bind_imported_texture(depth, &depth_native).unwrap();

    let mut multi = frame.render_pass("multiple-colors");
    let _ = multi
        .color_attachment(color_a, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
        .unwrap();
    let _ = multi
        .color_attachment(
            color_b,
            ColorAttachmentOps::clear_store(wgpu::Color::TRANSPARENT),
        )
        .unwrap();
    let _ = multi
        .depth_attachment(depth, DepthAttachmentOps::clear_store(1.0))
        .unwrap();
    multi.finish_render(|_| Ok(())).unwrap();

    let mut depth_only = frame.render_pass("depth-only");
    depth_only.set_side_effect(true);
    let _ = depth_only
        .depth_attachment(depth, DepthAttachmentOps::load_store())
        .unwrap();
    depth_only.finish_render(|_| Ok(())).unwrap();
    frame.mark_present(color_a).unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
}

#[test]
fn declarative_copy_directions_and_clear_encode() {
    let (device, queue) = noop_device();
    let source_usage = wgpu::BufferUsages::COPY_SRC;
    let readback_usage = wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST;
    let source_native = native_buffer(&device, 1024, source_usage);
    let destination_native = native_buffer(&device, 1024, readback_usage);
    let texture_usage = wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST;
    let make_texture = || {
        device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width: 4,
                height: 4,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: texture_usage,
            view_formats: &[],
        })
    };
    let texture_a_native = make_texture();
    let texture_b_native = make_texture();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let source = frame
        .import_buffer(
            BufferDesc::new("copy-source", 1024),
            ImportBufferOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(source_usage),
            },
        )
        .unwrap();
    let destination = frame
        .import_buffer(
            BufferDesc::new("copy-destination", 1024),
            ImportBufferOptions {
                initial_contents: InitialContents::Defined,
                exposed_usage: Some(readback_usage),
            },
        )
        .unwrap();
    frame.bind_imported_buffer(source, &source_native).unwrap();
    frame
        .bind_imported_buffer(destination, &destination_native)
        .unwrap();
    let texture_a = frame
        .import_texture(
            TextureDesc {
                label: "copy-texture-a".into(),
                size: texture_a_native.size(),
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                view_formats: vec![],
                usage: UsagePolicy::Fixed(texture_usage),
            },
            ImportTextureOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let texture_b = frame
        .import_texture(
            TextureDesc {
                label: "copy-texture-b".into(),
                size: texture_b_native.size(),
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                view_formats: vec![],
                usage: UsagePolicy::Fixed(texture_usage),
            },
            ImportTextureOptions::new(InitialContents::Defined),
        )
        .unwrap();
    frame
        .bind_imported_texture(texture_a, &texture_a_native)
        .unwrap();
    frame
        .bind_imported_texture(texture_b, &texture_b_native)
        .unwrap();

    frame
        .clear_buffer("clear", destination, BufferRange::new(0, 4))
        .unwrap();
    let layout = wgpu::TexelCopyBufferLayout {
        offset: 0,
        bytes_per_row: Some(256),
        rows_per_image: Some(4),
    };
    let extent = wgpu::Extent3d {
        width: 4,
        height: 4,
        depth_or_array_layers: 1,
    };
    let mut buffer_to_buffer = frame.copy_pass("buffer-to-buffer");
    buffer_to_buffer
        .copy_buffer_to_buffer(source, 0, destination, 800, 4)
        .unwrap();
    buffer_to_buffer.finish().unwrap();

    let mut buffer_to_texture = frame.copy_pass("buffer-to-texture");
    buffer_to_texture
        .copy_buffer_to_texture(
            BufferTextureCopyLocation::new(source, layout),
            TextureCopyLocation::new(texture_a),
            extent,
        )
        .unwrap();
    buffer_to_texture.finish().unwrap();

    let mut texture_to_texture = frame.copy_pass("texture-to-texture");
    texture_to_texture
        .copy_texture_to_texture(
            TextureCopyLocation::new(texture_a),
            TextureCopyLocation::new(texture_b),
            extent,
        )
        .unwrap();
    texture_to_texture.finish().unwrap();

    let mut texture_to_buffer = frame.copy_pass("texture-to-buffer");
    texture_to_buffer
        .copy_texture_to_buffer(
            TextureCopyLocation::new(texture_b),
            BufferTextureCopyLocation::new(destination, layout),
            extent,
        )
        .unwrap();
    texture_to_buffer.finish().unwrap();
    frame
        .mark_readback(destination, BufferRange::whole())
        .unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
}

#[test]
fn invalid_late_structured_node_is_rejected_before_callbacks() {
    let (device, queue) = noop_device();
    let called = Arc::new(Mutex::new(false));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let first_called = called.clone();
    let mut first = frame.compute_pass("first");
    first.set_side_effect(true);
    first
        .finish_compute(move |_| {
            *first_called.lock().unwrap() = true;
            Ok(())
        })
        .unwrap();
    let unbound = frame
        .import_buffer(
            BufferDesc::new("late-unbound", 4),
            ImportBufferOptions::new(InitialContents::Defined),
        )
        .unwrap();
    let mut late = frame.compute_pass("late");
    late.set_side_effect(true);
    let _ = late
        .storage_buffer_read(unbound, BufferRange::whole())
        .unwrap();
    late.finish_compute(|_| Ok(())).unwrap();

    let error = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap_err();
    assert!(matches!(
        error,
        FrameGraphError::MissingNativeBinding { .. }
    ));
    assert!(!*called.lock().unwrap());
}

#[test]
fn structured_finish_rejects_the_wrong_node_kind() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let error = frame
        .compute_pass("wrong")
        .finish_render(|_| Ok(()))
        .unwrap_err();
    assert_eq!(error.code(), "FG1106");
}

#[test]
fn timed_execution_reports_only_retained_render_and_compute_nodes() {
    let (device, queue) = timestamp_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let color = frame
        .create_texture(TextureDesc::new_2d(
            "timed-color",
            1,
            1,
            wgpu::TextureFormat::Rgba8Unorm,
        ))
        .unwrap();

    frame
        .with_debug_group("Mesh", |frame| {
            let mut compute = frame.compute_pass("compute");
            compute.set_side_effect(true);
            compute.finish_compute(|context| {
                assert_eq!(context.frame_index, 42);
                Ok(())
            })?;

            let mut render = frame.render_pass("render");
            let _ = render
                .color_attachment(color, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))?;
            render.finish_render(|context| {
                assert_eq!(context.frame_index, 42);
                Ok(())
            })?;

            let mut culled = frame.compute_pass("culled");
            culled.set_side_effect(false);
            culled.finish_compute(|_| panic!("culled callback executed"))?;

            frame.command_pass("command").finish_command(|context| {
                assert_eq!(context.frame_index, 42);
                Ok(())
            })?;
            Ok(())
        })
        .unwrap();
    frame.mark_texture_root(color, RootReason::Output).unwrap();

    let mut readback = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default().with_frame_index(42))
        .unwrap();
    assert_eq!(readback.frame_index(), 42);

    let GpuTimingReport::Available {
        frame_index,
        nodes,
        debug_groups,
        ..
    } = take_timing(&mut readback)
    else {
        panic!("expected available timestamps")
    };
    assert_eq!(frame_index, 42);
    assert_eq!(
        nodes
            .iter()
            .map(|node| (node.label.as_str(), node.kind))
            .collect::<Vec<_>>(),
        [
            ("compute", GpuTimingNodeKind::Compute),
            ("render", GpuTimingNodeKind::Render),
        ]
    );
    assert_eq!(debug_groups.len(), 1);
    assert_eq!(debug_groups[0].label, "Mesh");
}

#[test]
fn timed_execution_is_non_fatal_when_timestamps_are_unsupported() {
    let (device, queue) = noop_device();
    let called = Arc::new(Mutex::new(false));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let callback_called = called.clone();
    let mut compute = frame.compute_pass("compute");
    compute.set_side_effect(true);
    compute
        .finish_compute(move |_| {
            *callback_called.lock().unwrap() = true;
            Ok(())
        })
        .unwrap();

    let mut readback = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default().with_frame_index(9))
        .unwrap();
    assert!(*called.lock().unwrap());
    assert_eq!(
        readback.try_take(),
        Some(GpuTimingReport::Unavailable {
            frame_index: 9,
            reason: GpuTimingUnavailableReason::Unsupported,
        })
    );
    assert_eq!(readback.try_take(), None);
}

#[test]
fn a_second_timing_request_is_busy_until_mapping_completes() {
    let (device, queue) = timestamp_device();
    let mut graph = FrameGraph::with_device(&device);

    let mut first_frame = graph.begin_frame();
    let mut first_pass = first_frame.compute_pass("first");
    first_pass.set_side_effect(true);
    first_pass.finish_compute(|_| Ok(())).unwrap();
    let mut first = first_frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default())
        .unwrap();

    let mut second_frame = graph.begin_frame();
    let mut second_pass = second_frame.compute_pass("second");
    second_pass.set_side_effect(true);
    second_pass.finish_compute(|_| Ok(())).unwrap();
    let mut second = second_frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default().with_frame_index(2))
        .unwrap();
    assert_eq!(
        second.try_take(),
        Some(GpuTimingReport::Unavailable {
            frame_index: 2,
            reason: GpuTimingUnavailableReason::Busy,
        })
    );
    assert!(matches!(
        take_timing(&mut first),
        GpuTimingReport::Available { .. }
    ));
}

#[test]
fn timed_execution_without_render_or_compute_is_immediately_available() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    frame
        .command_pass("command")
        .finish_command(|context| {
            assert_eq!(context.frame_index, 11);
            Ok(())
        })
        .unwrap();
    let mut readback = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default().with_frame_index(11))
        .unwrap();
    assert_eq!(
        readback.try_take(),
        Some(GpuTimingReport::Available {
            frame_index: 11,
            frame_duration: std::time::Duration::ZERO,
            nodes: Vec::new(),
            debug_groups: Vec::new(),
        })
    );
}

#[test]
fn timing_resolves_across_an_external_submission_boundary() {
    let (device, queue) = timestamp_device();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();

    let first_calls = calls.clone();
    let mut first = frame.compute_pass("first");
    first.set_side_effect(true);
    first
        .finish_compute(move |_| {
            first_calls.lock().unwrap().push("first");
            Ok(())
        })
        .unwrap();
    let external_calls = calls.clone();
    frame
        .external_submission("external")
        .finish_external(move |context| {
            assert_eq!(context.frame_index, 23);
            external_calls.lock().unwrap().push("external");
            Ok(())
        })
        .unwrap();
    let second_calls = calls.clone();
    let mut second = frame.compute_pass("second");
    second.set_side_effect(true);
    second
        .finish_compute(move |_| {
            second_calls.lock().unwrap().push("second");
            Ok(())
        })
        .unwrap();

    let mut readback = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default().with_frame_index(23))
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), ["first", "external", "second"]);
    let GpuTimingReport::Available { nodes, .. } = take_timing(&mut readback) else {
        panic!("expected available timestamps")
    };
    assert_eq!(
        nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        ["first", "second"]
    );
}

#[test]
fn callback_error_clears_the_profiler_pending_state() {
    let (device, queue) = timestamp_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut failing_frame = graph.begin_frame();
    let mut failing_pass = failing_frame.compute_pass("failing");
    failing_pass.set_side_effect(true);
    failing_pass
        .finish_compute(|_| {
            Err(FrameGraphError::Internal {
                message: "expected callback failure".into(),
            })
        })
        .unwrap();
    assert!(
        failing_frame
            .compile(CompileOptions::default())
            .unwrap()
            .execute_with_gpu_timing(&queue, ExecutionOptions::default())
            .is_err()
    );

    let mut next_frame = graph.begin_frame();
    let mut next_pass = next_frame.compute_pass("next");
    next_pass.set_side_effect(true);
    next_pass.finish_compute(|_| Ok(())).unwrap();
    let mut readback = next_frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default())
        .unwrap();
    assert!(matches!(
        take_timing(&mut readback),
        GpuTimingReport::Available { .. }
    ));
}

#[test]
fn dropping_the_graph_completes_a_pending_readback_as_failed() {
    let (device, queue) = timestamp_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let mut pass = frame.compute_pass("compute");
    pass.set_side_effect(true);
    pass.finish_compute(|_| Ok(())).unwrap();
    let mut readback = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default().with_frame_index(77))
        .unwrap();
    drop(graph);
    assert_eq!(
        readback.try_take(),
        Some(GpuTimingReport::Unavailable {
            frame_index: 77,
            reason: GpuTimingUnavailableReason::ReadbackFailed,
        })
    );
}

#[test]
fn callback_panic_does_not_leave_gpu_timing_busy() {
    let (device, queue) = timestamp_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut panicking_frame = graph.begin_frame();
    let mut panicking_pass = panicking_frame.compute_pass("panicking");
    panicking_pass.set_side_effect(true);
    panicking_pass
        .finish_compute(|_| panic!("expected callback panic"))
        .unwrap();
    let compiled = panicking_frame.compile(CompileOptions::default()).unwrap();
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = compiled.execute_with_gpu_timing(&queue, ExecutionOptions::default());
    }));
    assert!(panic.is_err());

    let mut next_frame = graph.begin_frame();
    let mut next_pass = next_frame.compute_pass("next");
    next_pass.set_side_effect(true);
    next_pass.finish_compute(|_| Ok(())).unwrap();
    let mut readback = next_frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default())
        .unwrap();
    assert!(matches!(
        take_timing(&mut readback),
        GpuTimingReport::Available { .. }
    ));
}

#[test]
fn too_many_timed_nodes_is_non_fatal_and_immediately_reported() {
    let (device, queue) = timestamp_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    for index in 0..(wgpu::QUERY_SET_MAX_QUERIES / 2 + 1) {
        let mut pass = frame.compute_pass(format!("compute-{index}"));
        pass.set_side_effect(true);
        pass.finish_compute(|_| Ok(())).unwrap();
    }
    let mut readback = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute_with_gpu_timing(&queue, ExecutionOptions::default().with_frame_index(88))
        .unwrap();
    assert_eq!(
        readback.try_take(),
        Some(GpuTimingReport::Unavailable {
            frame_index: 88,
            reason: GpuTimingUnavailableReason::TooManyTimedNodes,
        })
    );
}
