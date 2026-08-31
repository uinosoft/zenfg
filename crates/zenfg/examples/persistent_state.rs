use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, ImportBufferOptions, InitialContents,
    RootReason,
};

fn main() -> Result<(), zenfg::FrameGraphError> {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let native_state = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("caller-owned persistent state"),
        size: 64,
        usage: wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let mut graph = FrameGraph::with_device(&device);

    // Persistent state is re-imported in every frame; the native resource stays
    // caller-owned. The first clear defines it, so later imports may promise
    // `Defined` initial contents.
    for frame_index in 0..2 {
        let mut frame = graph.begin_frame();
        let state = frame.import_buffer(
            BufferDesc::new("state", 64),
            ImportBufferOptions {
                initial_contents: if frame_index == 0 {
                    InitialContents::Undefined
                } else {
                    InitialContents::Defined
                },
                exposed_usage: Some(wgpu::BufferUsages::COPY_DST),
            },
        )?;
        frame.bind_imported_buffer(state, &native_state)?;

        frame.clear_buffer(
            format!("write persistent state {frame_index}"),
            state,
            BufferRange::whole(),
        )?;
        frame.mark_buffer_root(state, BufferRange::whole(), RootReason::PersistentState)?;
        frame.compile(CompileOptions::default())?.execute(&queue)?;
    }
    Ok(())
}
