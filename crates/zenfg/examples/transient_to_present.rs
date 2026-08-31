use zenfg::{ColorAttachmentOps, CompileOptions, FrameGraph, TextureCopyLocation, TextureDesc};

fn main() -> Result<(), zenfg::FrameGraphError> {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let native_surface_texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("caller-acquired surface texture"),
        size: wgpu::Extent3d {
            width: 4,
            height: 4,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });

    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let surface = frame.import_surface_texture(
        TextureDesc::new_2d("surface", 4, 4, wgpu::TextureFormat::Rgba8Unorm),
        Some(wgpu::TextureUsages::COPY_DST),
    )?;
    frame.bind_imported_texture(surface, &native_surface_texture)?;
    let color = frame.create_texture(TextureDesc::new_2d(
        "transient color",
        4,
        4,
        wgpu::TextureFormat::Rgba8Unorm,
    ))?;

    let mut render = frame.render_pass("render transient color");
    let _color =
        render.color_attachment(color, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))?;
    render.finish_render(|_context| Ok(()))?;

    let mut copy = frame.copy_pass("copy color to surface");
    copy.copy_texture_to_texture(
        TextureCopyLocation::new(color),
        TextureCopyLocation::new(surface),
        wgpu::Extent3d {
            width: 4,
            height: 4,
            depth_or_array_layers: 1,
        },
    )?;
    copy.finish()?;
    frame.mark_present(surface)?;

    frame.compile(CompileOptions::default())?.execute(&queue)?;
    // A real application presents the caller-owned SurfaceTexture here.
    Ok(())
}
