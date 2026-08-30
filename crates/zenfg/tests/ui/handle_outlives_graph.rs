use zenfg::{BufferDesc, FrameGraph};

fn main() {
    let handle = {
        let mut graph = FrameGraph::new();
        let mut frame = graph.begin_frame();
        frame.create_buffer(BufferDesc::new("buffer", 4)).unwrap()
    };
    let _ = handle;
}
