use zenfg::{
    ColorAttachmentOps, CompileOptions, Frame, FrameGraph, ResourcePoolScope, TextureDesc,
};

fn record_scoped_target(
    frame: &mut Frame<'_>,
    scope: ResourcePoolScope,
    width: u32,
) -> Result<(), zenfg::FrameGraphError> {
    let target = frame.create_texture_in(
        scope,
        TextureDesc::new_2d("viewport", width, 4, wgpu::TextureFormat::Rgba8Unorm),
    )?;
    let mut pass = frame.render_pass("clear viewport");
    pass.set_side_effect(true);
    let _ = pass.color_attachment(target, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))?;
    pass.finish_render(|_| Ok(())).map(|_| ())
}

fn main() -> Result<(), zenfg::FrameGraphError> {
    // noop exercises the ownership/submission API without a physical GPU.
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    let scope = graph.create_resource_pool_scope();
    for width in [4, 8] {
        graph.clear_resource_pool_scope(scope)?;
        let mut frame = graph.begin_frame();
        record_scoped_target(&mut frame, scope, width)?;
        frame.compile(CompileOptions::default())?.execute(&queue)?;
    }
    graph.evict_resource_pool(|info| info.scope == Some(scope) && info.unused_executions > 60);
    graph.clear_resource_pool();
    Ok(())
}
