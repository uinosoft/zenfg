use zenfg::{CompileOptions, FrameGraph};
fn main() {
    let mut graph = FrameGraph::new();
    let compiled = graph.begin_frame().compile(CompileOptions::default()).unwrap();
    graph.clear_resource_pool();
    let _ = compiled.retained_node_count();
}
