use zenfg::{
    AccessToken, FrameGraph, SampledTexture, StorageBufferRead, TextureDesc,
};

fn needs_buffer(_: AccessToken<'_, StorageBufferRead>) {}

fn main() {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let texture = frame
        .create_texture(TextureDesc::new_2d(
            "texture",
            4,
            4,
            wgpu::TextureFormat::Rgba8Unorm,
        ))
        .unwrap();
    let mut pass = frame.compute_pass("read");
    let token: AccessToken<'_, SampledTexture> = pass.sampled_texture(texture).unwrap();
    needs_buffer(token);
}
