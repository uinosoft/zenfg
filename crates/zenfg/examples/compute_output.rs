use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, ImportBufferOptions, InitialContents,
    RootReason, WriteContents,
};

fn main() -> Result<(), zenfg::FrameGraphError> {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("compute output shader"),
        source: wgpu::ShaderSource::Wgsl(
            r#"
@group(0) @binding(0) var<storage, read_write> output: array<u32>;

@compute @workgroup_size(16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    output[id.x] = id.x;
}
"#
            .into(),
        ),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("compute output pipeline"),
        layout: None,
        module: &shader,
        entry_point: Some("main"),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });
    let native_output = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("caller-owned compute output"),
        size: 64,
        usage: wgpu::BufferUsages::STORAGE,
        mapped_at_creation: false,
    });

    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let output = frame.import_buffer(
        BufferDesc::new("compute output", 64),
        ImportBufferOptions {
            initial_contents: InitialContents::Undefined,
            exposed_usage: Some(wgpu::BufferUsages::STORAGE),
        },
    )?;
    frame.bind_imported_buffer(output, &native_output)?;

    let mut compute = frame.compute_pass("write output");
    let output_write =
        compute.storage_buffer_write(output, BufferRange::whole(), WriteContents::Overwrite)?;
    compute.finish_compute(move |mut context| {
        let output_buffer = context.resources.buffer(output_write)?;
        let bind_group = context
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("compute output bind group"),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: output_buffer.as_entire_binding(),
                }],
            });
        context.pass.set_pipeline(&pipeline);
        context.pass.set_bind_group(0, &bind_group, &[]);
        context.pass.dispatch_workgroups(1, 1, 1);
        Ok(())
    })?;

    frame.mark_buffer_root(output, BufferRange::whole(), RootReason::Output)?;
    frame.compile(CompileOptions::default())?.execute(&queue)?;
    Ok(())
}
