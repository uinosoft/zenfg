use zenfg::FrameGraph;

fn main() {
    let mut escaped = None;
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    frame
        .command_pass("escape")
        .finish_command(|ctx| {
            escaped = Some(ctx.encoder);
            Ok(())
        })
        .unwrap();
}
