use crate::{GpuTimingReadback, NodeKind, PassId};
use std::time::Duration;

/// Timing families requested for one synchronous execution.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimingMode {
    /// Collect CPU-side elapsed time only.
    Cpu,
    /// Collect asynchronous GPU timestamps only.
    Gpu,
    /// Collect CPU and GPU timings independently.
    Both,
}

/// CPU-side elapsed time for one executed node, including local setup and cleanup.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CpuTimingNodeReport {
    /// Recording-local node identity.
    pub pass: PassId,
    /// Executed node kind; all six kinds are supported.
    pub kind: NodeKind,
    /// Caller-provided node label.
    pub label: String,
    /// Synchronous elapsed time, not thread CPU usage.
    pub duration: Duration,
}

/// Detached CPU report from one successful execution.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CpuTimingReport {
    /// Caller-defined identity of the measured frame.
    pub frame_index: u64,
    /// Includes preparation, submission and transient resource release, not GPU waiting.
    pub execution_duration: Duration,
    /// All executed nodes in execution order; culled nodes are absent.
    pub nodes: Vec<CpuTimingNodeReport>,
}

/// Immediate CPU results and an independently asynchronous GPU readback.
#[derive(Debug)]
#[must_use = "timing results are observable through this returned object"]
pub struct ExecutionTiming {
    /// Caller-defined identity of the execution.
    pub frame_index: u64,
    /// Present exactly when CPU timing was requested and execution succeeded.
    pub cpu: Option<CpuTimingReport>,
    /// Present exactly when GPU timing was requested; poll without blocking.
    pub gpu: Option<GpuTimingReadback>,
}

#[cfg(test)]
thread_local! {
    static CLOCK: std::cell::RefCell<Option<(std::time::Instant, u64)>> = const { std::cell::RefCell::new(None) };
}

pub(crate) fn now() -> std::time::Instant {
    #[cfg(test)]
    if let Some(value) = CLOCK.with(|clock| {
        let mut clock = clock.borrow_mut();
        clock.as_mut().map(|(base, ticks)| {
            let value = *base + Duration::from_millis(*ticks);
            *ticks += 1;
            value
        })
    }) {
        return value;
    }
    std::time::Instant::now()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        BufferDesc, BufferRange, ColorAttachmentOps, CompileOptions, ExecutionOptions, FrameGraph,
        TextureDesc,
    };
    struct ClockGuard;
    impl Drop for ClockGuard {
        fn drop(&mut self) {
            CLOCK.with(|clock| *clock.borrow_mut() = None);
        }
    }
    fn clock() -> ClockGuard {
        CLOCK.with(|clock| *clock.borrow_mut() = Some((std::time::Instant::now(), 0)));
        ClockGuard
    }
    fn ticks() -> u64 {
        CLOCK.with(|clock| clock.borrow().as_ref().unwrap().1)
    }

    #[test]
    fn all_kinds_and_culling_have_exact_clock_boundaries() {
        let _clock = clock();
        let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
        let mut graph = FrameGraph::with_device(&device);
        let mut frame = graph.begin_frame();
        let source = frame.create_buffer(BufferDesc::new("source", 16)).unwrap();
        let target = frame.create_buffer(BufferDesc::new("target", 16)).unwrap();
        let color = frame
            .create_texture(TextureDesc::new_2d(
                "color",
                4,
                4,
                wgpu::TextureFormat::Rgba8Unorm,
            ))
            .unwrap();
        let mut render = frame.render_pass("render");
        render.set_side_effect(true);
        let _ = render
            .color_attachment(color, ColorAttachmentOps::clear_store(wgpu::Color::BLACK))
            .unwrap();
        render.finish_render(|_| Ok(())).unwrap();
        let mut compute = frame.compute_pass("compute");
        compute.set_side_effect(true);
        compute.finish_compute(|_| Ok(())).unwrap();
        frame
            .clear_buffer("clear", source, BufferRange::new(0, 16))
            .unwrap();
        let mut copy = frame.copy_pass("copy");
        copy.set_side_effect(true);
        copy.copy_buffer_to_buffer(source, 0, target, 0, 16)
            .unwrap();
        copy.finish().unwrap();
        frame
            .external_submission("external")
            .finish_external(|_| Ok(()))
            .unwrap();
        frame
            .command_pass("command")
            .finish_command(|_| Ok(()))
            .unwrap();
        let mut culled = frame.command_pass("culled");
        culled.set_side_effect(false);
        culled.finish_command(|_| panic!("culled")).unwrap();
        let result = frame
            .compile(CompileOptions::default())
            .unwrap()
            .execute_with_timing(&queue, ExecutionOptions::default(), TimingMode::Cpu)
            .unwrap();
        assert!(result.gpu.is_none());
        let cpu = result.cpu.unwrap();
        assert_eq!(ticks(), 14);
        assert_eq!(cpu.nodes.len(), 6);
        assert!(
            cpu.nodes
                .iter()
                .all(|node| node.duration == Duration::from_millis(1))
        );
        assert_eq!(cpu.execution_duration, Duration::from_millis(13));
    }

    #[test]
    fn disabled_clock_and_empty_execution() {
        let _clock = clock();
        let (device, queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
        let mut graph = FrameGraph::with_device(&device);
        graph
            .begin_frame()
            .compile(CompileOptions::default())
            .unwrap()
            .execute(&queue)
            .unwrap();
        assert_eq!(ticks(), 0);
        let gpu = graph
            .begin_frame()
            .compile(CompileOptions::default())
            .unwrap()
            .execute_with_timing(&queue, ExecutionOptions::default(), TimingMode::Gpu)
            .unwrap();
        assert!(gpu.cpu.is_none());
        assert!(gpu.gpu.is_some());
        assert_eq!(ticks(), 0);
        let cpu = graph
            .begin_frame()
            .compile(CompileOptions::default())
            .unwrap()
            .execute_with_timing(&queue, ExecutionOptions::default(), TimingMode::Cpu)
            .unwrap()
            .cpu
            .unwrap();
        assert!(cpu.nodes.is_empty());
        assert_eq!(ticks(), 2);
        assert_eq!(cpu.execution_duration, Duration::from_millis(1));
    }
}
