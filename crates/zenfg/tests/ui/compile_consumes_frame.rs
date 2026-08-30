use zenfg::{BufferDesc, CompileOptions, FrameGraph};

fn main() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    frame.compile(CompileOptions::default()).unwrap();
    let _ = frame.create_buffer(BufferDesc::new("late", 4));
}
