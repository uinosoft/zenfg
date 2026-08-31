use zenfg::{CompileOptions, FrameGraph};

fn main() -> Result<(), zenfg::FrameGraphError> {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();

    frame
        .command_pass("before external work")
        .finish_command(|_context| Ok(()))?;

    frame
        .external_submission("caller submission")
        .finish_external(|context| {
            let encoder = context
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("caller-owned encoder"),
                });
            context.queue.submit([encoder.finish()]);
            Ok(())
        })?;

    frame
        .command_pass("after external work")
        .finish_command(|_context| Ok(()))?;

    let compiled = frame.compile(CompileOptions::full_report())?;
    assert_eq!(compiled.execution_segments().len(), 3);
    compiled.execute(&queue)?;
    Ok(())
}
