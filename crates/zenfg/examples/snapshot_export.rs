use zenfg::{
    BufferDesc, BufferRange, CompileOptions, ExecutionOptions, FrameGraph, RootReason, TimingMode,
    WriteContents,
    snapshot::{CreateFrameGraphSnapshotOptions, create_frame_graph_snapshot, to_json_pretty},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let output = frame.create_buffer(BufferDesc::new("captured output", 256))?;

    let mut produce = frame.compute_pass("produce captured output");
    let _output =
        produce.storage_buffer_write(output, BufferRange::whole(), WriteContents::Overwrite)?;
    produce.finish_compute(|_| Ok(()))?;
    frame.mark_buffer_root(output, BufferRange::whole(), RootReason::Output)?;

    let compiled = frame.compile(CompileOptions::full_report())?;
    // Execution consumes the compiled frame; keep its full report first.
    let report = compiled.report().expect("full report requested").clone();
    let timing = compiled.execute_with_timing(
        &queue,
        ExecutionOptions::default().with_frame_index(42),
        TimingMode::Cpu,
    )?;
    let mut options = CreateFrameGraphSnapshotOptions::new(timing.frame_index);
    options.cpu_timing = timing.cpu.as_ref();
    options.pool_stats = Some(graph.resource_pool_stats());
    let snapshot = create_frame_graph_snapshot(&report, options)?;
    let json = to_json_pretty(&snapshot)?;
    println!("{json}");
    Ok(())
}
