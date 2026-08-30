use std::{env, hint::black_box, time::Instant};

use zenfg::{
    BufferDesc, BufferRange, CompileOptions, FrameGraph, RootReason, TextureDesc, TextureViewDesc,
    WriteContents,
};

fn main() {
    let scenario = env::args().nth(1).unwrap_or_else(|| "linear-chain".into());
    let node_count = env::args()
        .nth(2)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(64)
        .max(2);
    let iterations = env::args()
        .nth(3)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1_000);

    let start = Instant::now();
    for _ in 0..iterations {
        black_box(run(&scenario, node_count));
    }
    let elapsed = start.elapsed();
    println!(
        "scenario={scenario} nodes={node_count} iterations={iterations} total_ms={:.3} mean_us={:.3}",
        elapsed.as_secs_f64() * 1_000.0,
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}

fn run(scenario: &str, node_count: usize) -> usize {
    match scenario {
        "linear-chain" => linear_chain(node_count),
        "buffer-ranges" => buffer_ranges(node_count),
        "texture-subresources" => texture_subresources(node_count),
        "allocation-aliasing" => allocation_aliasing(node_count),
        _ => panic!(
            "unknown scenario {scenario}; expected linear-chain, buffer-ranges, texture-subresources, or allocation-aliasing"
        ),
    }
}

fn linear_chain(node_count: usize) -> usize {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffers: Vec<_> = (0..node_count)
        .map(|index| {
            frame
                .create_buffer(BufferDesc::new(format!("b{index}"), 64))
                .unwrap()
        })
        .collect();
    for index in 0..node_count {
        let mut pass = frame.compute_pass(format!("p{index}"));
        if index > 0 {
            let _ = pass
                .storage_buffer_read(buffers[index - 1], BufferRange::whole())
                .unwrap();
        }
        let _ = pass
            .storage_buffer_write(
                buffers[index],
                BufferRange::whole(),
                WriteContents::Overwrite,
            )
            .unwrap();
        pass.finish().unwrap();
    }
    frame
        .mark_buffer_root(
            *buffers.last().unwrap(),
            BufferRange::whole(),
            RootReason::Output,
        )
        .unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .retained_node_count()
}

fn buffer_ranges(node_count: usize) -> usize {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let buffer = frame
        .create_buffer(BufferDesc::new("ranges", (node_count * 4) as u64))
        .unwrap();
    for index in 0..node_count {
        let mut pass = frame.compute_pass(format!("write-{index}"));
        let _ = pass
            .storage_buffer_write(
                buffer,
                BufferRange::new((index * 4) as u64, 4),
                WriteContents::Overwrite,
            )
            .unwrap();
        pass.finish().unwrap();
    }
    let mut read = frame.command_pass("read-all");
    let _ = read
        .storage_buffer_read(buffer, BufferRange::whole())
        .unwrap();
    read.finish().unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .retained_node_count()
}

fn texture_subresources(node_count: usize) -> usize {
    let layers = node_count.min(1_024) as u32;
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    let mut desc = TextureDesc::new_2d("layers", 16, 16, wgpu::TextureFormat::Rgba8Unorm);
    desc.size.depth_or_array_layers = layers;
    let texture = frame.create_texture(desc).unwrap();
    for layer in 0..layers {
        let view = frame
            .create_texture_view(
                texture,
                TextureViewDesc {
                    label: format!("layer-{layer}"),
                    base_array_layer: layer,
                    array_layer_count: Some(1),
                    ..Default::default()
                },
            )
            .unwrap();
        let mut pass = frame.compute_pass(format!("write-{layer}"));
        let _ = pass
            .storage_texture_write(view, WriteContents::Overwrite)
            .unwrap();
        pass.finish().unwrap();
    }
    let mut read = frame.command_pass("read-all");
    let _ = read.sampled_texture(texture).unwrap();
    read.finish().unwrap();
    frame
        .compile(CompileOptions::default())
        .unwrap()
        .retained_node_count()
}

fn allocation_aliasing(node_count: usize) -> usize {
    let mut graph = FrameGraph::new();
    let mut frame = graph.begin_frame();
    for index in 0..node_count {
        let buffer = frame
            .create_buffer(BufferDesc::new(format!("scratch-{index}"), 1_024))
            .unwrap();
        let mut pass = frame.compute_pass(format!("write-{index}"));
        let _ = pass
            .storage_buffer_write(buffer, BufferRange::whole(), WriteContents::Overwrite)
            .unwrap();
        pass.finish().unwrap();
        frame
            .mark_buffer_root(buffer, BufferRange::whole(), RootReason::Output)
            .unwrap();
    }
    frame
        .compile(CompileOptions::full_report())
        .unwrap()
        .allocations()
        .len()
}
