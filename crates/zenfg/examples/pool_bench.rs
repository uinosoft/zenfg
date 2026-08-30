use std::time::{Duration, Instant};

use zenfg::{BufferDesc, BufferRange, CompileOptions, FrameGraph, FrameGraphError, WriteContents};

const BUFFER_SIZE: u64 = 4096;

fn execute_aliasing_frame(
    graph: &mut FrameGraph,
    queue: &wgpu::Queue,
    logical_resources: usize,
) -> Result<(), FrameGraphError> {
    let mut frame = graph.begin_frame();
    for index in 0..logical_resources {
        let buffer = frame.create_buffer(BufferDesc::new(
            format!("alias-buffer-{index}"),
            BUFFER_SIZE,
        ))?;
        let mut pass = frame.command_pass(format!("alias-write-{index}"));
        let token =
            pass.storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)?;
        pass.finish_command(move |ctx| {
            let _ = ctx.resources.buffer(token)?;
            Ok(())
        })?;
    }
    frame.compile(CompileOptions::default())?.execute(queue)
}

fn execute_overlapping_frame(
    graph: &mut FrameGraph,
    queue: &wgpu::Queue,
    logical_resources: usize,
) -> Result<(), FrameGraphError> {
    let mut frame = graph.begin_frame();
    let mut buffers = Vec::with_capacity(logical_resources);
    for index in 0..logical_resources {
        let buffer = frame.create_buffer(BufferDesc::new(
            format!("overlap-buffer-{index}"),
            BUFFER_SIZE,
        ))?;
        let mut write = frame.compute_pass(format!("overlap-write-{index}"));
        let token =
            write.storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)?;
        write.finish_compute(move |ctx| {
            let _ = ctx.resources.buffer(token)?;
            Ok(())
        })?;
        buffers.push(buffer);
    }

    let mut consume = frame.command_pass("consume-overlapping-buffers");
    let mut tokens = Vec::with_capacity(buffers.len());
    for buffer in buffers {
        tokens.push(consume.storage_buffer_read(buffer, BufferRange::whole())?);
    }
    consume.finish_command(move |ctx| {
        for token in tokens {
            let _ = ctx.resources.buffer(token)?;
        }
        Ok(())
    })?;
    frame.compile(CompileOptions::default())?.execute(queue)
}

fn elapsed_per_frame(elapsed: Duration, frames: usize) -> Duration {
    elapsed / u32::try_from(frames).expect("frame count fits u32")
}

fn main() -> Result<(), FrameGraphError> {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());

    let mut alias_graph = FrameGraph::with_device(&device);
    let cold_start = Instant::now();
    execute_aliasing_frame(&mut alias_graph, &queue, 256)?;
    let cold_elapsed = cold_start.elapsed();

    const WARM_FRAMES: usize = 200;
    let warm_start = Instant::now();
    for _ in 0..WARM_FRAMES {
        execute_aliasing_frame(&mut alias_graph, &queue, 64)?;
    }
    let warm_elapsed = warm_start.elapsed();
    let alias_stats = alias_graph.resource_pool_stats();

    let mut overlap_graph = FrameGraph::with_device(&device);
    let overlap_start = Instant::now();
    execute_overlapping_frame(&mut overlap_graph, &queue, 128)?;
    let overlap_elapsed = overlap_start.elapsed();
    let overlap_stats = overlap_graph.resource_pool_stats();

    println!("cold aliasing frame: {cold_elapsed:?} (256 logical / 1 physical)");
    println!(
        "warm aliasing frames: {:?} total, {:?} per frame",
        warm_elapsed,
        elapsed_per_frame(warm_elapsed, WARM_FRAMES)
    );
    println!("warm pool stats: {alias_stats:?}");
    println!("overlapping frame: {overlap_elapsed:?} (128 physical)");
    println!("overlapping pool stats: {overlap_stats:?}");
    Ok(())
}
