use zenfg::{BufferDesc, BufferRange, CompileOptions, FrameGraph, RootReason, WriteContents};

fn main() -> Result<(), zenfg::FrameGraphError> {
    // CPU-only graphs are useful for validation, planning, and diagnostics.
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let output = frame.create_buffer(BufferDesc::new("output", 1024))?;

    let mut produce = frame.compute_pass("produce output");
    let _output =
        produce.storage_buffer_write(output, BufferRange::whole(), WriteContents::Overwrite)?;
    produce.finish()?;

    frame.mark_buffer_root(output, BufferRange::whole(), RootReason::Output)?;
    let compiled = frame.compile(CompileOptions::full_report())?;
    let summary = &compiled.report().expect("full report requested").summary;
    println!(
        "retained {} of {} recorded nodes",
        summary.retained_node_count, summary.recorded_node_count
    );
    Ok(())
}
