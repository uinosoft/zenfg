use zenfg::FrameGraph;

fn main() {
    let mut escaped = None;
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    frame
        .compute_pass("escape")
        .finish_compute(|ctx| {
            escaped = Some(ctx.pass);
            Ok(())
        })
        .unwrap();
}
