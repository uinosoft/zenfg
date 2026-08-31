use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, ImportBufferOptions, InitialContents,
    RootReason,
};

fn main() -> Result<(), zenfg::FrameGraphError> {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let native_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("caller-owned input"),
        size: 64,
        usage: wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });

    let mut graph = FrameGraph::with_device(&device);
    let mut frame = graph.begin_frame();
    let input = frame.import_buffer(
        BufferDesc::new("input", 64),
        ImportBufferOptions {
            initial_contents: InitialContents::Defined,
            exposed_usage: Some(wgpu::BufferUsages::COPY_SRC),
        },
    )?;
    frame.bind_imported_buffer(input, &native_buffer)?;
    let output = frame.create_buffer(BufferDesc::new("copied output", 64))?;

    let mut copy = frame.copy_pass("copy imported input");
    copy.copy_buffer_to_buffer(input, 0, output, 0, 64)?;
    copy.finish()?;
    frame.mark_buffer_root(output, BufferRange::whole(), RootReason::Output)?;

    frame.compile(CompileOptions::default())?.execute(&queue)?;
    Ok(())
}
