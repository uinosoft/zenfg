use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, FrameGraphError, PoolAllocationDescriptor,
    ResourcePoolScope, TextureDesc, WriteContents,
};

fn run_buffers(
    graph: &mut FrameGraph,
    queue: &wgpu::Queue,
    scopes: &[Option<ResourcePoolScope>],
    overlap: bool,
) {
    let mut frame = graph.begin_frame();
    let buffers: Vec<_> = scopes
        .iter()
        .map(|scope| match scope {
            Some(scope) => frame
                .create_buffer_in(*scope, BufferDesc::new("scratch", 33))
                .unwrap(),
            None => frame.create_buffer(BufferDesc::new("scratch", 33)).unwrap(),
        })
        .collect();
    if overlap {
        let mut pass = frame.command_pass("overlap");
        for buffer in buffers {
            let _ = pass
                .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
                .unwrap();
        }
        pass.finish_command(|_| Ok(())).unwrap();
    } else {
        for buffer in buffers {
            let mut pass = frame.command_pass("write");
            let _ = pass
                .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
                .unwrap();
            pass.finish_command(|_| Ok(())).unwrap();
        }
    }
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(queue)
        .unwrap();
}

fn ages(graph: &mut FrameGraph) -> Vec<u64> {
    let mut ages = Vec::new();
    assert_eq!(
        graph
            .evict_resource_pool(|info| {
                ages.push(info.unused_executions);
                false
            })
            .evicted_count,
        0
    );
    ages.sort();
    ages
}

#[test]
fn scope_isolates_alias_and_reuse_and_survives_clear() {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    let a = graph.create_resource_pool_scope();
    let b = graph.create_resource_pool_scope();
    assert_ne!(a, b);
    let scopes = [Some(a), Some(a), Some(b), None, None];
    run_buffers(&mut graph, &queue, &scopes, false);
    assert_eq!(graph.resource_pool_stats().created_count, 3);
    run_buffers(&mut graph, &queue, &scopes, false);
    assert_eq!(graph.resource_pool_stats().reuse_count, 3);
    graph.clear_resource_pool_scope(a).unwrap();
    assert_eq!(graph.resource_pool_stats().retained_count, 2);
    run_buffers(&mut graph, &queue, &[Some(a)], false);
    assert_eq!(graph.resource_pool_stats().created_count, 4);
    let report = graph.evict_resource_pool(|info| info.scope.is_none());
    assert_eq!(report.evicted_count, 1);
    assert_eq!(report.estimated_evicted_bytes, 64);
    graph.clear_resource_pool();
    assert_eq!(graph.resource_pool_stats().retained_count, 0);
}

#[test]
fn foreign_scope_is_rejected_before_registration_even_for_empty_cpu_pool() {
    let mut other = FrameGraph::new();
    let foreign = other.create_resource_pool_scope();
    let mut graph = FrameGraph::new();
    assert_eq!(
        graph.clear_resource_pool_scope(foreign),
        Err(FrameGraphError::ForeignResourcePoolScope)
    );
    let mut frame = graph.begin_frame();
    assert_eq!(
        frame
            .create_buffer_in(foreign, BufferDesc::new("bad", 4))
            .unwrap_err()
            .code(),
        "FG2014"
    );
    let desc = TextureDesc::new_2d("bad", 1, 1, wgpu::TextureFormat::Rgba8Unorm);
    assert_eq!(
        frame.create_texture_in(foreign, desc).unwrap_err().code(),
        "FG2014"
    );
    assert_eq!(
        frame
            .create_buffer(BufferDesc::new("first", 4))
            .unwrap()
            .id()
            .get(),
        0
    );
    drop(frame);
    let scope = graph.create_resource_pool_scope();
    graph.clear_resource_pool_scope(scope).unwrap();
    assert_eq!(
        graph
            .evict_resource_pool(|_| panic!("empty pool"))
            .evicted_count,
        0
    );
}

#[test]
fn age_is_per_instance_and_preflight_compile_and_maintenance_do_not_advance_it() {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    run_buffers(&mut graph, &queue, &[None, None], true);
    assert_eq!(ages(&mut graph), [0, 0]);
    let mut frame = graph.begin_frame();
    let buffer = frame.create_buffer(BufferDesc::new("missing", 33)).unwrap();
    let mut pass = frame.command_pass("missing");
    let _ = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish().unwrap();
    assert!(
        frame
            .compile(CompileOptions::default())
            .unwrap()
            .execute(&queue)
            .is_err()
    );
    assert_eq!(ages(&mut graph), [0, 0]);
    graph
        .begin_frame()
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    run_buffers(&mut graph, &queue, &[None], false);
    assert_eq!(ages(&mut graph), [0, 2]);
    let report = graph.evict_resource_pool(|info| info.unused_executions > 1);
    assert_eq!(report.evicted_count, 1);
    assert_eq!(report.estimated_evicted_bytes, 64);
}

#[test]
fn callback_failure_counts_execution_and_keeps_acquired_metadata() {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    run_buffers(&mut graph, &queue, &[None], false);
    let scope = graph.create_resource_pool_scope();
    let mut frame = graph.begin_frame();
    let buffer = frame
        .create_buffer_in(scope, BufferDesc::new("failed", 33))
        .unwrap();
    let mut pass = frame.command_pass("failed");
    let token = pass
        .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
        .unwrap();
    pass.finish_command(move |_| {
        Err(FrameGraphError::CallbackFailed {
            pass: token.pass_id(),
            message: "expected".into(),
        })
    })
    .unwrap();
    assert!(
        frame
            .compile(CompileOptions::default())
            .unwrap()
            .execute(&queue)
            .is_err()
    );
    assert_eq!(ages(&mut graph), [0, 1]);
}

#[test]
fn selection_panic_is_atomic_and_fnmut_can_accumulate_a_selection() {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    run_buffers(&mut graph, &queue, &[None, None], true);
    let before = graph.resource_pool_stats();
    let mut calls = 0;
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        graph.evict_resource_pool(|_| {
            calls += 1;
            assert!(calls != 2, "predicate");
            true
        });
    }));
    assert!(panic.is_err());
    assert_eq!(calls, 2);
    assert_eq!(graph.resource_pool_stats(), before);
    let mut selected_bytes = 0;
    let report = graph.evict_resource_pool(|info| {
        if selected_bytes == 0 {
            selected_bytes += info.estimated_bytes;
            true
        } else {
            false
        }
    });
    assert_eq!(selected_bytes, 64);
    assert_eq!(report.evicted_count, 1);
    run_buffers(&mut graph, &queue, &[None], false);
    assert_eq!(graph.resource_pool_stats().created_count, 2);
}

#[test]
fn physical_specs_use_pool_capacity_and_normalized_texture_allocation() {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    let scope = graph.create_resource_pool_scope();
    run_buffers(&mut graph, &queue, &[Some(scope)], false);
    let mut frame = graph.begin_frame();
    let mut desc = TextureDesc::new_2d("texture", 4, 2, wgpu::TextureFormat::Rgba8Unorm);
    desc.view_formats = vec![wgpu::TextureFormat::Rgba8UnormSrgb];
    let texture = frame.create_texture_in(scope, desc).unwrap();
    let mut pass = frame.command_pass("texture");
    let _ = pass
        .texture_copy_dst(texture, WriteContents::Overwrite)
        .unwrap();
    pass.finish_command(|_| Ok(())).unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    let mut count = 0;
    graph.evict_resource_pool(|info| {
        assert_eq!(info.scope, Some(scope));
        match info.descriptor {
            PoolAllocationDescriptor::Buffer { size, usage } => {
                assert_eq!(size, 64);
                assert_eq!(info.estimated_bytes, 64);
                assert_eq!(usage, wgpu::BufferUsages::STORAGE);
            }
            PoolAllocationDescriptor::Texture {
                size,
                format,
                dimension,
                mip_level_count,
                sample_count,
                view_formats,
                usage,
            } => {
                assert_eq!(size.width, 4);
                assert_eq!(size.height, 2);
                assert_eq!(size.depth_or_array_layers, 1);
                assert_eq!(format, wgpu::TextureFormat::Rgba8Unorm);
                assert_eq!(dimension, wgpu::TextureDimension::D2);
                assert_eq!(mip_level_count, 1);
                assert_eq!(sample_count, 1);
                assert_eq!(view_formats, [wgpu::TextureFormat::Rgba8UnormSrgb]);
                assert_eq!(usage, wgpu::TextureUsages::COPY_DST);
                assert_eq!(info.estimated_bytes, 32);
            }
        }
        count += 1;
        false
    });
    assert_eq!(count, 2);
}

#[test]
fn imported_and_surface_objects_are_never_pool_candidates_and_remain_usable() {
    use zenfg::{ColorAttachmentOps, ImportBufferOptions, InitialContents};
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: 4,
        usage: wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let imported = frame
        .import_buffer(
            BufferDesc::new("import", 4),
            ImportBufferOptions::new(InitialContents::Undefined),
        )
        .unwrap();
    frame.bind_imported_buffer(imported, &buffer).unwrap();
    frame
        .clear_buffer("clear imported", imported, BufferRange::whole())
        .unwrap();
    let surface = frame
        .import_surface_texture(
            TextureDesc::new_2d("surface", 1, 1, wgpu::TextureFormat::Rgba8Unorm),
            Some(wgpu::TextureUsages::RENDER_ATTACHMENT),
        )
        .unwrap();
    frame.bind_imported_texture(surface, &texture).unwrap();
    let mut pass = frame.render_pass("surface");
    let _ = pass
        .color_attachment(surface, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
        .unwrap();
    pass.finish_render(|_| Ok(())).unwrap();
    frame.mark_present(surface).unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .execute(&queue)
        .unwrap();
    assert_eq!(
        graph
            .evict_resource_pool(|_| panic!("foreign ownership"))
            .evicted_count,
        0
    );
    graph.clear_resource_pool();
    drop(graph);
    // Native validation checks both objects after all graph-owned resources have been released.
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    encoder.clear_buffer(&buffer, 0, Some(4));
    {
        let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
    }
    queue.submit([encoder.finish()]);
}

#[test]
fn external_error_and_callback_unwind_return_scoped_instances_with_current_age() {
    for panic_callback in [false, true] {
        let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
        let mut graph = FrameGraph::with_device(&device);
        let a = graph.create_resource_pool_scope();
        let b = graph.create_resource_pool_scope();
        run_buffers(&mut graph, &queue, &[Some(a)], false);
        let mut frame = graph.begin_frame();
        let target = frame
            .create_buffer_in(b, BufferDesc::new("partial", 33))
            .unwrap();
        frame
            .clear_buffer("submitted first", target, BufferRange::new(0, 32))
            .unwrap();
        let mut pass = frame.external_submission("external failure");
        let token = pass
            .storage_buffer_read(target, BufferRange::new(0, 32))
            .unwrap();
        pass.finish_external(move |ctx| {
            let _ = ctx.resources.buffer(token)?;
            assert!(!panic_callback, "execution panic");
            Err(FrameGraphError::CallbackFailed {
                pass: token.pass_id(),
                message: "external".into(),
            })
        })
        .unwrap();
        let compiled = frame.compile(CompileOptions::default()).unwrap();
        let outcome =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| compiled.execute(&queue)));
        if panic_callback {
            assert!(outcome.is_err());
        } else {
            assert!(outcome.unwrap().is_err());
        }
        assert_eq!(ages(&mut graph), [0, 1]);
        graph.clear_resource_pool_scope(b).unwrap();
        assert_eq!(graph.resource_pool_stats().retained_count, 1);
    }
}

#[test]
fn texture_scopes_partition_aliasing_reuse_and_resize_clearing() {
    use zenfg::ColorAttachmentOps;
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    let a = graph.create_resource_pool_scope();
    let b = graph.create_resource_pool_scope();
    for execution in 0..2 {
        let mut frame = graph.begin_frame();
        for scope in [Some(a), Some(a), Some(b), None] {
            let desc = TextureDesc::new_2d("texture", 4, 2, wgpu::TextureFormat::Rgba8Unorm);
            let texture = match scope {
                Some(scope) => frame.create_texture_in(scope, desc).unwrap(),
                None => frame.create_texture(desc).unwrap(),
            };
            let mut pass = frame.render_pass("clear");
            pass.set_side_effect(true);
            let _ = pass
                .color_attachment(texture, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
                .unwrap();
            pass.finish_render(|_| Ok(())).unwrap();
        }
        let compiled = frame.compile(CompileOptions::default()).unwrap();
        assert_eq!(compiled.allocations().len(), 3);
        compiled.execute(&queue).unwrap();
        if execution == 0 {
            graph.clear_resource_pool_scope(a).unwrap();
            assert_eq!(graph.resource_pool_stats().retained_count, 2);
        }
    }
    assert_eq!(graph.resource_pool_stats().created_count, 4);
    assert_eq!(graph.resource_pool_stats().reuse_count, 2);
}
