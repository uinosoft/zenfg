use zenfg::{
    ColorAttachmentOps, CompileOptions, ExecutionOptions, FrameGraph, GpuTimingReport, RootReason,
    TextureDesc,
};

fn main() -> Result<(), zenfg::FrameGraphError> {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let output = frame.create_texture(TextureDesc::new_2d(
        "timed output",
        4,
        4,
        wgpu::TextureFormat::Rgba8Unorm,
    ))?;

    let mut render = frame.render_pass("timed render clear");
    let _output =
        render.color_attachment(output, ColorAttachmentOps::clear_store(wgpu::Color::GREEN))?;
    render.finish_render(|_context| Ok(()))?;
    frame.mark_texture_root(output, RootReason::Output)?;

    let compiled = frame.compile(CompileOptions::default())?;
    let timing = compiled.execute_with_timing(
        &queue,
        ExecutionOptions::default().with_frame_index(7),
        zenfg::TimingMode::Both,
    )?;
    println!(
        "CPU execution: {:?}",
        timing.cpu.as_ref().unwrap().execution_duration
    );
    let mut readback = timing.gpu.expect("GPU timing requested");

    // Call `try_take` from later frames too: it polls but never waits for the GPU.
    match readback.try_take() {
        Some(GpuTimingReport::Available { nodes, .. }) => {
            println!("timed {} retained nodes", nodes.len());
        }
        Some(GpuTimingReport::Unavailable { reason, .. }) => {
            println!("GPU timing unavailable: {reason:?}");
        }
        Some(_) => println!("GPU timing returned a newer report variant"),
        None => println!("GPU timing readback is still pending"),
    }
    Ok(())
}
