use std::sync::{Arc, Mutex};

use zenfg::{
    BufferDesc, BufferRange, ColorAttachmentOps, CompileOptions, FrameGraph, FrameGraphError,
    RootReason, TextureDesc, WriteContents,
};

fn noop_device() -> (wgpu::Device, wgpu::Queue) {
    wgpu::Device::noop(&wgpu::DeviceDescriptor::default())
}

#[test]
fn all_executable_node_kinds_resolve_transient_resources() {
    let (device, queue) = noop_device();
    let order = Arc::new(Mutex::new(Vec::new()));
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();

    let cleared = frame.create_buffer(BufferDesc::new("cleared", 16)).unwrap();
    frame
        .clear_buffer("clear", cleared, BufferRange::whole())
        .unwrap();

    let copied = frame.create_buffer(BufferDesc::new("copied", 16)).unwrap();
    let mut copy = frame.copy_pass("copy");
    copy.copy_buffer_to_buffer(cleared, 0, copied, 0, 16)
        .unwrap();
    copy.finish().unwrap();
    frame
        .mark_buffer_root(copied, BufferRange::whole(), RootReason::Output)
        .unwrap();

    let computed = frame
        .create_buffer(BufferDesc::new("computed", 16))
        .unwrap();
    let mut compute = frame.compute_pass("compute");
    let compute_token = compute
        .storage_buffer_write(computed, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    let compute_order = order.clone();
    compute
        .finish_compute(move |ctx| {
            let _ = ctx.resources.buffer(compute_token)?;
            compute_order.lock().unwrap().push("compute");
            Ok(())
        })
        .unwrap();
    frame
        .mark_buffer_root(computed, BufferRange::whole(), RootReason::Output)
        .unwrap();

    let color = frame
        .create_texture(TextureDesc::new_2d(
            "color",
            4,
            4,
            wgpu::TextureFormat::Rgba8Unorm,
        ))
        .unwrap();
    let mut render = frame.render_pass("render");
    let color_token = render
        .color_attachment(color, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
        .unwrap();
    let render_order = order.clone();
    render
        .finish_render(move |ctx| {
            let _ = ctx.resources.texture_view(color_token)?;
            render_order.lock().unwrap().push("render");
            Ok(())
        })
        .unwrap();
    frame.mark_texture_root(color, RootReason::Output).unwrap();

    let commanded = frame
        .create_buffer(BufferDesc::new("commanded", 16))
        .unwrap();
    let mut command = frame.command_pass("command");
    let command_token = command
        .storage_buffer_write(commanded, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    let command_order = order.clone();
    command
        .finish_command(move |ctx| {
            let _ = ctx.resources.buffer(command_token)?;
            command_order.lock().unwrap().push("command");
            Ok(())
        })
        .unwrap();

    let external = frame
        .create_buffer(BufferDesc::new("external", 16))
        .unwrap();
    let mut submission = frame.external_submission("external");
    let external_token = submission
        .storage_buffer_write(external, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    let external_order = order.clone();
    submission
        .finish_external(move |ctx| {
            let _ = ctx.resources.buffer(external_token)?;
            external_order.lock().unwrap().push("external");
            Ok(())
        })
        .unwrap();

    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert_eq!(
        *order.lock().unwrap(),
        vec!["compute", "render", "command", "external"]
    );
    assert!(graph.resource_pool_stats().retained_count > 0);
}

#[test]
fn non_overlapping_logical_resources_acquire_one_physical_allocation() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let first = frame.create_buffer(BufferDesc::new("first", 100)).unwrap();
    let second = frame.create_buffer(BufferDesc::new("second", 100)).unwrap();

    for (label, buffer) in [("first", first), ("second", second)] {
        let mut pass = frame.compute_pass(label);
        let token = pass
            .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        pass.finish_compute(move |ctx| {
            let _ = ctx.resources.buffer(token)?;
            Ok(())
        })
        .unwrap();
        frame
            .mark_buffer_root(buffer, BufferRange::whole(), RootReason::Output)
            .unwrap();
    }

    let compiled = frame.compile(CompileOptions::default()).unwrap();
    assert_eq!(compiled.allocations().len(), 1);
    compiled.execute(&queue).unwrap();
    let stats = graph.resource_pool_stats();
    assert_eq!(stats.acquire_count, 1);
    assert_eq!(stats.created_count, 1);
    assert_eq!(stats.retained_count, 1);
    assert_eq!(stats.estimated_retained_bytes, 128);
}

#[test]
fn overlapping_logical_resources_acquire_distinct_physical_allocations() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let first = frame.create_buffer(BufferDesc::new("first", 16)).unwrap();
    let second = frame.create_buffer(BufferDesc::new("second", 16)).unwrap();

    let mut produce = frame.compute_pass("produce-first");
    let first_write = produce
        .storage_buffer_write(first, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    produce
        .finish_compute(move |ctx| {
            let _ = ctx.resources.buffer(first_write)?;
            Ok(())
        })
        .unwrap();

    let mut consume = frame.compute_pass("consume-first-produce-second");
    let first_read = consume
        .storage_buffer_read(first, BufferRange::whole())
        .unwrap();
    let second_write = consume
        .storage_buffer_write(second, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    consume
        .finish_compute(move |ctx| {
            let _ = ctx.resources.buffer(first_read)?;
            let _ = ctx.resources.buffer(second_write)?;
            Ok(())
        })
        .unwrap();
    frame
        .mark_buffer_root(second, BufferRange::whole(), RootReason::Output)
        .unwrap();

    let compiled = frame.compile(CompileOptions::default()).unwrap();
    assert_eq!(compiled.allocations().len(), 2);
    compiled.execute(&queue).unwrap();
    assert_eq!(graph.resource_pool_stats().acquire_count, 2);
    assert_eq!(graph.resource_pool_stats().created_count, 2);
}

#[test]
fn compatible_buffer_buckets_are_reused_across_frames() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);

    for (index, size) in [100, 120].into_iter().enumerate() {
        let mut frame = graph.begin_frame();
        let buffer = frame
            .create_buffer(BufferDesc::new(format!("buffer-{index}"), size))
            .unwrap();
        let mut pass = frame.command_pass(format!("write-{index}"));
        let token = pass
            .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        pass.finish_command(move |ctx| {
            let _ = ctx.resources.buffer(token)?;
            Ok(())
        })
        .unwrap();
        frame
            .compile(CompileOptions::default())
            .unwrap()
            .execute(&queue)
            .unwrap();
    }

    let stats = graph.resource_pool_stats();
    assert_eq!(stats.acquire_count, 2);
    assert_eq!(stats.created_count, 1);
    assert_eq!(stats.reuse_count, 1);
    assert_eq!(stats.retained_count, 1);
    assert_eq!(stats.estimated_retained_bytes, 128);
}

#[test]
fn compatible_textures_and_views_are_reused_across_frames() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);

    for index in 0..2 {
        let mut frame = graph.begin_frame();
        let texture = frame
            .create_texture(TextureDesc::new_2d(
                format!("texture-{index}"),
                8,
                8,
                wgpu::TextureFormat::Rgba8Unorm,
            ))
            .unwrap();
        let mut render = frame.render_pass(format!("render-{index}"));
        let token = render
            .color_attachment(texture, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
            .unwrap();
        render
            .finish_render(move |ctx| {
                let _ = ctx.resources.texture(token)?;
                let _ = ctx.resources.texture_view(token)?;
                Ok(())
            })
            .unwrap();
        frame
            .mark_texture_root(texture, RootReason::Output)
            .unwrap();
        frame
            .compile(CompileOptions::default())
            .unwrap()
            .execute(&queue)
            .unwrap();
    }

    let stats = graph.resource_pool_stats();
    assert_eq!(stats.acquire_count, 2);
    assert_eq!(stats.created_count, 1);
    assert_eq!(stats.reuse_count, 1);
    assert_eq!(stats.retained_count, 1);
}

#[test]
fn distinct_usage_keys_do_not_reuse_the_same_buffer() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);

    let mut frame = graph.begin_frame();
    let storage = frame.create_buffer(BufferDesc::new("storage", 16)).unwrap();
    let mut pass = frame.command_pass("storage-write");
    let _ = pass
        .storage_buffer_write(storage, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish_command(|_| Ok(())).unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();

    let mut frame = graph.begin_frame();
    let copy = frame.create_buffer(BufferDesc::new("copy", 16)).unwrap();
    frame
        .clear_buffer("clear", copy, BufferRange::whole())
        .unwrap();
    frame
        .mark_buffer_root(copy, BufferRange::whole(), RootReason::Output)
        .unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();

    let stats = graph.resource_pool_stats();
    assert_eq!(stats.acquire_count, 2);
    assert_eq!(stats.created_count, 2);
    assert_eq!(stats.reuse_count, 0);
    assert_eq!(stats.retained_count, 2);
}

#[test]
fn callback_error_returns_transient_to_pool() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);

    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("error", 16)).unwrap();
    let mut pass = frame.command_pass("error");
    let token = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish_command(move |ctx| {
        let _ = ctx.resources.buffer(token)?;
        Err(FrameGraphError::CallbackFailed {
            pass: token.pass_id(),
            message: "expected".into(),
        })
    })
    .unwrap();
    let error = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap_err();
    assert_eq!(error.code(), "FG4007");
    assert_eq!(graph.resource_pool_stats().retained_count, 1);

    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("reuse", 16)).unwrap();
    let mut pass = frame.command_pass("reuse");
    let _ = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish_command(|_| Ok(())).unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert_eq!(graph.resource_pool_stats().created_count, 1);
    assert_eq!(graph.resource_pool_stats().reuse_count, 1);
}

#[test]
fn panic_unwind_returns_transient_to_pool() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("panic", 16)).unwrap();
    let mut pass = frame.command_pass("panic");
    let token = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish_command(move |ctx| {
        let _ = ctx.resources.buffer(token)?;
        panic!("expected callback panic");
    })
    .unwrap();
    let compiled = frame.compile(CompileOptions::default()).unwrap();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = compiled.execute(&queue);
    }));
    assert!(result.is_err());
    assert_eq!(graph.resource_pool_stats().retained_count, 1);
    assert_eq!(graph.resource_pool_stats().estimated_retained_bytes, 16);
}

#[test]
fn external_error_returns_transient_to_pool() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame
        .create_buffer(BufferDesc::new("external-error", 16))
        .unwrap();
    let mut pass = frame.external_submission("external-error");
    let token = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish_external(move |ctx| {
        let _ = ctx.resources.buffer(token)?;
        Err(FrameGraphError::CallbackFailed {
            pass: token.pass_id(),
            message: "expected".into(),
        })
    })
    .unwrap();
    let error = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap_err();
    assert_eq!(error.code(), "FG4007");
    assert_eq!(graph.resource_pool_stats().retained_count, 1);
}

#[test]
fn preflight_failure_and_culled_transient_do_not_acquire() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);

    let mut frame = graph.begin_frame();
    let retained = frame
        .create_buffer(BufferDesc::new("retained", 16))
        .unwrap();
    let mut missing = frame.command_pass("missing");
    let _ = missing
        .storage_buffer_write(retained, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    missing.finish().unwrap();
    let error = frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap_err();
    assert_eq!(error.code(), "FG4004");
    assert_eq!(graph.resource_pool_stats().acquire_count, 0);

    let called = Arc::new(Mutex::new(false));
    let mut frame = graph.begin_frame();
    let culled = frame.create_buffer(BufferDesc::new("culled", 16)).unwrap();
    let mut pass = frame.compute_pass("culled");
    let _ = pass
        .storage_buffer_write(culled, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    let callback_called = called.clone();
    pass.finish_compute(move |_| {
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
    assert_eq!(graph.resource_pool_stats().acquire_count, 0);
}

#[test]
fn clearing_pool_preserves_cumulative_counters() {
    let (device, queue) = noop_device();
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("buffer", 16)).unwrap();
    let mut pass = frame.command_pass("write");
    let _ = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish_command(|_| Ok(())).unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();

    graph.clear_resource_pool();
    let cleared = graph.resource_pool_stats();
    assert_eq!(cleared.acquire_count, 1);
    assert_eq!(cleared.created_count, 1);
    assert_eq!(cleared.retained_count, 0);
    assert_eq!(cleared.estimated_retained_bytes, 0);

    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("buffer", 16)).unwrap();
    let mut pass = frame.command_pass("write");
    let _ = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish_command(|_| Ok(())).unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert_eq!(graph.resource_pool_stats().created_count, 2);
}

#[test]
fn cpu_only_pool_api_is_empty_and_clear_is_a_noop() {
    let mut graph = FrameGraph::new();
    assert_eq!(graph.resource_pool_stats(), Default::default());
    graph.clear_resource_pool();
    assert_eq!(graph.resource_pool_stats(), Default::default());
}
