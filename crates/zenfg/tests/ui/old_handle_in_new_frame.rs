use zenfg::{BufferDesc, BufferRange, FrameGraph};

fn main() {
    let mut graph = FrameGraph::new();
    let old = {
        let mut frame = graph.begin_frame();
        frame.create_buffer(BufferDesc::new("old", 4)).unwrap()
    };
    let mut next = graph.begin_frame();
    let mut pass = next.compute_pass("bad");
    let _ = pass.storage_buffer_read(old, BufferRange::whole());
}
