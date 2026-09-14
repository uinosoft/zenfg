use std::{hint::black_box, time::Instant};
use zenfg::{CompileOptions, ExecutionOptions, FrameGraph, TimingMode};

fn main() {
    let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    let mut graph = FrameGraph::with_device(&device);
    for count in [12, 64, 256, 1024] {
        for round in 0..5 {
            for enabled in if round % 2 == 0 {
                [false, true]
            } else {
                [true, false]
            } {
                let mut samples = Vec::new();
                for iteration in 0..400 {
                    let mut frame = graph.begin_frame();
                    for index in 0..count {
                        frame
                            .command_pass(format!("node-{index}"))
                            .finish_command(|_| Ok(()))
                            .unwrap();
                    }
                    let compiled = frame.compile(CompileOptions::default()).unwrap();
                    let start = Instant::now();
                    if enabled {
                        let _ = black_box(
                            compiled
                                .execute_with_timing(
                                    &queue,
                                    ExecutionOptions::default(),
                                    TimingMode::Cpu,
                                )
                                .unwrap(),
                        );
                    } else {
                        compiled.execute(&queue).unwrap();
                    }
                    let elapsed = start.elapsed().as_secs_f64() * 1_000_000.0;
                    if iteration >= 100 {
                        samples.push(elapsed);
                    }
                }
                samples.sort_by(f64::total_cmp);
                println!(
                    "{}",
                    serde_json::json!({"nodes":count,"round":round,"cpuTiming":enabled,"samples":samples.len(),"p50Micros":samples[149],"p95Micros":samples[284]})
                );
            }
        }
    }
}
