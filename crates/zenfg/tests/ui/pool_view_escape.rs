use zenfg::FrameGraph;
fn main() {
    let mut graph = FrameGraph::new();
    let mut saved = None;
    graph.evict_resource_pool(|info| {
        saved = Some(info.descriptor);
        false
    });
    let _ = saved;
}
