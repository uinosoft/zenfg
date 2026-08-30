use zenfg::{
    ColorAttachmentOps, FrameGraph, TextureDesc,
};

fn main() {
    let mut escaped = None;
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let texture = frame.create_texture(TextureDesc::new_2d(
        "color",
        4,
        4,
        wgpu::TextureFormat::Rgba8Unorm,
    )).unwrap();
    let mut pass = frame.render_pass("escape");
    pass.color_attachment(
        texture,
        ColorAttachmentOps::clear_store(wgpu::Color::BLACK),
    ).unwrap();
    pass.finish_render(|ctx| {
        escaped = Some(ctx.pass);
        Ok(())
    }).unwrap();
}
