use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, RootReason, WriteContents,
    snapshot::{CreateFrameGraphSnapshotOptions, create_frame_graph_snapshot, to_json_pretty},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let output = frame.create_buffer(BufferDesc::new("captured output", 256))?;

    let mut produce = frame.compute_pass("produce captured output");
    let _output =
        produce.storage_buffer_write(output, BufferRange::whole(), WriteContents::Overwrite)?;
    produce.finish()?;
    frame.mark_buffer_root(output, BufferRange::whole(), RootReason::Output)?;

    let compiled = frame.compile(CompileOptions::full_report())?;
    let snapshot = create_frame_graph_snapshot(
        compiled.report().expect("full report requested"),
        CreateFrameGraphSnapshotOptions::new(42),
    )?;
    let json = to_json_pretty(&snapshot)?;
    println!("{json}");
    Ok(())
}
