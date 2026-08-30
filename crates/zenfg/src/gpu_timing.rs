use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use crate::{DebugGroupId, DebugGroupReport, NodeKind, PassId, model::NodeRecord};

/// The executable node kinds that can be measured with pass timestamp writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum GpuTimingNodeKind {
    Render,
    Compute,
}

/// GPU duration for one retained render or compute pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GpuTimingNodeReport {
    pub pass: PassId,
    pub kind: GpuTimingNodeKind,
    pub label: String,
    pub debug_group: Option<DebugGroupId>,
    pub duration: Duration,
}

/// Why a timed execution completed without timestamp values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum GpuTimingUnavailableReason {
    Unsupported,
    Busy,
    ReadbackFailed,
    TooManyTimedNodes,
}

/// The result of one requested GPU timing sample.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum GpuTimingReport {
    Available {
        frame_index: u64,
        frame_duration: Duration,
        nodes: Vec<GpuTimingNodeReport>,
        debug_groups: Vec<DebugGroupReport>,
    },
    Unavailable {
        frame_index: u64,
        reason: GpuTimingUnavailableReason,
    },
}

#[derive(Debug)]
enum CompletionState {
    Pending,
    Ready(Option<GpuTimingReport>),
}

#[derive(Debug)]
struct TimingCompletion {
    frame_index: u64,
    state: Mutex<CompletionState>,
}

impl TimingCompletion {
    fn pending(frame_index: u64) -> Arc<Self> {
        Arc::new(Self {
            frame_index,
            state: Mutex::new(CompletionState::Pending),
        })
    }

    fn ready(frame_index: u64, report: GpuTimingReport) -> Arc<Self> {
        Arc::new(Self {
            frame_index,
            state: Mutex::new(CompletionState::Ready(Some(report))),
        })
    }

    fn state(&self) -> MutexGuard<'_, CompletionState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn is_pending(&self) -> bool {
        matches!(*self.state(), CompletionState::Pending)
    }

    fn finish(&self, report: GpuTimingReport) {
        let mut state = self.state();
        if matches!(*state, CompletionState::Pending) {
            *state = CompletionState::Ready(Some(report));
        }
    }

    fn take(&self) -> Option<GpuTimingReport> {
        let mut state = self.state();
        match &mut *state {
            CompletionState::Pending => None,
            CompletionState::Ready(report) => report.take(),
        }
    }

    fn fail(&self) {
        self.finish(unavailable(
            self.frame_index,
            GpuTimingUnavailableReason::ReadbackFailed,
        ));
    }
}

/// A one-shot, non-blocking handle for one GPU timing result.
#[must_use = "GPU timing results are only observable through the readback handle"]
#[derive(Debug)]
pub struct GpuTimingReadback {
    device: wgpu::Device,
    frame_index: u64,
    completion: Arc<TimingCompletion>,
}

impl GpuTimingReadback {
    pub fn frame_index(&self) -> u64 {
        self.frame_index
    }

    /// Polls the owning device without blocking and takes the result once it is ready.
    pub fn try_take(&mut self) -> Option<GpuTimingReport> {
        if self.completion.is_pending() && self.device.poll(wgpu::PollType::Poll).is_err() {
            self.completion.finish(unavailable(
                self.frame_index,
                GpuTimingUnavailableReason::ReadbackFailed,
            ));
        }
        self.completion.take()
    }

    fn immediate(device: &wgpu::Device, frame_index: u64, report: GpuTimingReport) -> Self {
        Self {
            device: device.clone(),
            frame_index,
            completion: TimingCompletion::ready(frame_index, report),
        }
    }
}

#[derive(Clone, Debug)]
struct TimedNode {
    pass: PassId,
    kind: GpuTimingNodeKind,
    label: String,
    debug_group: Option<DebugGroupId>,
    begin_query: u32,
    end_query: u32,
}

#[derive(Debug, Default)]
pub(crate) struct GpuProfiler {
    query_set: Option<wgpu::QuerySet>,
    resolve_buffer: Option<wgpu::Buffer>,
    readback_buffer: Option<wgpu::Buffer>,
    capacity: u32,
    pending: Option<Arc<TimingCompletion>>,
}

pub(crate) enum TimingSetup {
    Immediate(GpuTimingReadback),
    Active(Box<ActiveGpuTiming>),
}

pub(crate) struct ActiveGpuTiming {
    query_set: wgpu::QuerySet,
    resolve_buffer: wgpu::Buffer,
    readback_buffer: wgpu::Buffer,
    used_queries: u32,
    timestamp_period_ns: f32,
    frame_index: u64,
    timed_nodes: Vec<TimedNode>,
    query_by_pass: HashMap<PassId, (u32, u32)>,
    debug_groups: Vec<DebugGroupReport>,
    completion: Arc<TimingCompletion>,
    readback: Option<GpuTimingReadback>,
    mapping_started: bool,
}

impl GpuProfiler {
    pub(crate) fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        frame_index: u64,
        nodes: &[NodeRecord],
        groups: &[crate::model::DebugGroupRecord],
    ) -> TimingSetup {
        let timed_nodes = build_timed_nodes(nodes);
        if timed_nodes.is_empty() {
            return TimingSetup::Immediate(GpuTimingReadback::immediate(
                device,
                frame_index,
                GpuTimingReport::Available {
                    frame_index,
                    frame_duration: Duration::ZERO,
                    nodes: Vec::new(),
                    debug_groups: Vec::new(),
                },
            ));
        }

        let used_queries = match u32::try_from(timed_nodes.len())
            .ok()
            .and_then(|count| count.checked_mul(2))
        {
            Some(count) if count <= wgpu::QUERY_SET_MAX_QUERIES => count,
            _ => {
                return TimingSetup::Immediate(GpuTimingReadback::immediate(
                    device,
                    frame_index,
                    unavailable(frame_index, GpuTimingUnavailableReason::TooManyTimedNodes),
                ));
            }
        };

        if !device.features().contains(wgpu::Features::TIMESTAMP_QUERY) {
            return TimingSetup::Immediate(GpuTimingReadback::immediate(
                device,
                frame_index,
                unavailable(frame_index, GpuTimingUnavailableReason::Unsupported),
            ));
        }

        if self
            .pending
            .as_ref()
            .is_some_and(|completion| !completion.is_pending())
        {
            self.pending = None;
        }
        if self.pending.is_some() {
            return TimingSetup::Immediate(GpuTimingReadback::immediate(
                device,
                frame_index,
                unavailable(frame_index, GpuTimingUnavailableReason::Busy),
            ));
        }

        self.ensure_capacity(device, used_queries);
        let completion = TimingCompletion::pending(frame_index);
        self.pending = Some(completion.clone());
        let debug_groups = filter_debug_groups(&timed_nodes, groups);
        let query_by_pass = timed_nodes
            .iter()
            .map(|node| (node.pass, (node.begin_query, node.end_query)))
            .collect();
        let readback = GpuTimingReadback {
            device: device.clone(),
            frame_index,
            completion: completion.clone(),
        };

        TimingSetup::Active(Box::new(ActiveGpuTiming {
            query_set: self.query_set.as_ref().unwrap().clone(),
            resolve_buffer: self.resolve_buffer.as_ref().unwrap().clone(),
            readback_buffer: self.readback_buffer.as_ref().unwrap().clone(),
            used_queries,
            timestamp_period_ns: queue.get_timestamp_period(),
            frame_index,
            timed_nodes,
            query_by_pass,
            debug_groups,
            completion,
            readback: Some(readback),
            mapping_started: false,
        }))
    }

    fn ensure_capacity(&mut self, device: &wgpu::Device, needed: u32) {
        if self.capacity >= needed {
            return;
        }
        let capacity = needed
            .max(2)
            .next_power_of_two()
            .min(wgpu::QUERY_SET_MAX_QUERIES);
        if let Some(query_set) = self.query_set.take() {
            query_set.destroy();
        }
        if let Some(buffer) = self.resolve_buffer.take() {
            buffer.destroy();
        }
        if let Some(buffer) = self.readback_buffer.take() {
            buffer.destroy();
        }
        let byte_size = align_up(
            u64::from(capacity) * u64::from(wgpu::QUERY_SIZE),
            wgpu::QUERY_RESOLVE_BUFFER_ALIGNMENT,
        );
        self.query_set = Some(device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("frame-graph.gpu-timing.queries"),
            ty: wgpu::QueryType::Timestamp,
            count: capacity,
        }));
        self.resolve_buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("frame-graph.gpu-timing.resolve"),
            size: byte_size,
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        }));
        self.readback_buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("frame-graph.gpu-timing.readback"),
            size: byte_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        }));
        self.capacity = capacity;
    }
}

impl Drop for GpuProfiler {
    fn drop(&mut self) {
        if let Some(completion) = self.pending.take() {
            completion.fail();
        }
        if let Some(query_set) = self.query_set.take() {
            query_set.destroy();
        }
        if let Some(buffer) = self.resolve_buffer.take() {
            buffer.destroy();
        }
        if let Some(buffer) = self.readback_buffer.take() {
            buffer.destroy();
        }
    }
}

impl ActiveGpuTiming {
    pub(crate) fn query_set(&self) -> &wgpu::QuerySet {
        &self.query_set
    }

    pub(crate) fn query_indices(&self, pass: PassId) -> Option<(u32, u32)> {
        self.query_by_pass.get(&pass).copied()
    }

    pub(crate) fn encode_resolve(&self, encoder: &mut wgpu::CommandEncoder) {
        let byte_size = u64::from(self.used_queries) * u64::from(wgpu::QUERY_SIZE);
        encoder.resolve_query_set(
            &self.query_set,
            0..self.used_queries,
            &self.resolve_buffer,
            0,
        );
        encoder.copy_buffer_to_buffer(&self.resolve_buffer, 0, &self.readback_buffer, 0, byte_size);
    }

    pub(crate) fn begin_readback(&mut self) {
        let byte_size = u64::from(self.used_queries) * u64::from(wgpu::QUERY_SIZE);
        let buffer = self.readback_buffer.clone();
        let completion = self.completion.clone();
        let frame_index = self.frame_index;
        let timestamp_period_ns = self.timestamp_period_ns;
        let timed_nodes = self.timed_nodes.clone();
        let debug_groups = self.debug_groups.clone();
        buffer
            .clone()
            .slice(0..byte_size)
            .map_async(wgpu::MapMode::Read, move |result| {
                let report = if result.is_err() {
                    unavailable(frame_index, GpuTimingUnavailableReason::ReadbackFailed)
                } else {
                    let mapped = buffer.slice(0..byte_size).get_mapped_range();
                    match mapped {
                        Ok(data) => {
                            let ticks = decode_ticks(&data);
                            drop(data);
                            buffer.unmap();
                            build_report(
                                frame_index,
                                timestamp_period_ns,
                                &timed_nodes,
                                debug_groups,
                                &ticks,
                            )
                        }
                        Err(_) => {
                            buffer.unmap();
                            unavailable(frame_index, GpuTimingUnavailableReason::ReadbackFailed)
                        }
                    }
                };
                completion.finish(report);
            });
        self.mapping_started = true;
    }

    pub(crate) fn take_readback(&mut self) -> GpuTimingReadback {
        self.readback
            .take()
            .expect("active GPU timing readback was already taken")
    }
}

impl Drop for ActiveGpuTiming {
    fn drop(&mut self) {
        if !self.mapping_started {
            self.completion.fail();
        }
    }
}

fn build_timed_nodes(nodes: &[NodeRecord]) -> Vec<TimedNode> {
    let mut next_query = 0u32;
    nodes
        .iter()
        .filter_map(|node| {
            let kind = match node.kind {
                NodeKind::Render => GpuTimingNodeKind::Render,
                NodeKind::Compute => GpuTimingNodeKind::Compute,
                _ => return None,
            };
            let begin_query = next_query;
            next_query = next_query.saturating_add(2);
            Some(TimedNode {
                pass: node.id,
                kind,
                label: node.label.clone(),
                debug_group: node.debug_group,
                begin_query,
                end_query: begin_query.saturating_add(1),
            })
        })
        .collect()
}

fn filter_debug_groups(
    nodes: &[TimedNode],
    groups: &[crate::model::DebugGroupRecord],
) -> Vec<DebugGroupReport> {
    let mut included = HashSet::new();
    for node in nodes {
        let mut group = node.debug_group;
        while let Some(id) = group {
            if !included.insert(id) {
                break;
            }
            group = groups
                .get(id.get() as usize)
                .and_then(|record| record.parent);
        }
    }
    groups
        .iter()
        .filter(|group| included.contains(&group.id))
        .map(|group| DebugGroupReport {
            id: group.id,
            parent: group.parent,
            label: group.label.clone(),
        })
        .collect()
}

fn build_report(
    frame_index: u64,
    timestamp_period_ns: f32,
    nodes: &[TimedNode],
    debug_groups: Vec<DebugGroupReport>,
    ticks: &[u64],
) -> GpuTimingReport {
    let Some(first) = nodes.first() else {
        return GpuTimingReport::Available {
            frame_index,
            frame_duration: Duration::ZERO,
            nodes: Vec::new(),
            debug_groups,
        };
    };
    let Some(last) = nodes.last() else {
        unreachable!();
    };
    let read_tick = |index: u32| ticks.get(index as usize).copied().unwrap_or(0);
    let reports = nodes
        .iter()
        .map(|node| GpuTimingNodeReport {
            pass: node.pass,
            kind: node.kind,
            label: node.label.clone(),
            debug_group: node.debug_group,
            duration: ticks_to_duration(
                read_tick(node.end_query).saturating_sub(read_tick(node.begin_query)),
                timestamp_period_ns,
            ),
        })
        .collect();
    let frame_ticks = read_tick(last.end_query).saturating_sub(read_tick(first.begin_query));
    GpuTimingReport::Available {
        frame_index,
        frame_duration: ticks_to_duration(frame_ticks, timestamp_period_ns),
        nodes: reports,
        debug_groups,
    }
}

fn decode_ticks(bytes: &[u8]) -> Vec<u64> {
    bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|chunk| u64::from_ne_bytes(*chunk))
        .collect()
}

pub(crate) fn ticks_to_duration(ticks: u64, timestamp_period_ns: f32) -> Duration {
    if !timestamp_period_ns.is_finite() || timestamp_period_ns <= 0.0 {
        return Duration::ZERO;
    }
    let nanoseconds = (ticks as f64) * f64::from(timestamp_period_ns);
    Duration::from_nanos(nanoseconds.clamp(0.0, u64::MAX as f64).round() as u64)
}

fn unavailable(frame_index: u64, reason: GpuTimingUnavailableReason) -> GpuTimingReport {
    GpuTimingReport::Unavailable {
        frame_index,
        reason,
    }
}

fn align_up(value: u64, alignment: u64) -> u64 {
    value.div_ceil(alignment) * alignment
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_conversion_uses_nanoseconds_and_saturates_bad_periods() {
        assert_eq!(ticks_to_duration(4, 2.5), Duration::from_nanos(10));
        assert_eq!(ticks_to_duration(4, f32::NAN), Duration::ZERO);
        assert_eq!(ticks_to_duration(4, -1.0), Duration::ZERO);
    }

    #[test]
    fn reversed_timestamps_saturate_to_zero() {
        let nodes = vec![TimedNode {
            pass: PassId::new(0),
            kind: GpuTimingNodeKind::Compute,
            label: "compute".into(),
            debug_group: None,
            begin_query: 0,
            end_query: 1,
        }];
        let GpuTimingReport::Available {
            frame_duration,
            nodes,
            ..
        } = build_report(7, 1.0, &nodes, Vec::new(), &[9, 3])
        else {
            panic!("expected available timing")
        };
        assert_eq!(frame_duration, Duration::ZERO);
        assert_eq!(nodes[0].duration, Duration::ZERO);
    }

    #[test]
    fn frame_duration_spans_the_first_begin_to_the_last_end() {
        let nodes = vec![
            TimedNode {
                pass: PassId::new(0),
                kind: GpuTimingNodeKind::Compute,
                label: "first".into(),
                debug_group: None,
                begin_query: 0,
                end_query: 1,
            },
            TimedNode {
                pass: PassId::new(1),
                kind: GpuTimingNodeKind::Render,
                label: "second".into(),
                debug_group: None,
                begin_query: 2,
                end_query: 3,
            },
        ];
        let GpuTimingReport::Available {
            frame_duration,
            nodes,
            ..
        } = build_report(1, 2.0, &nodes, Vec::new(), &[10, 20, 30, 50])
        else {
            panic!("expected available timing")
        };
        assert_eq!(frame_duration, Duration::from_nanos(80));
        assert_eq!(nodes[0].duration, Duration::from_nanos(20));
        assert_eq!(nodes[1].duration, Duration::from_nanos(40));
    }

    #[test]
    fn timing_groups_include_referenced_groups_and_ancestors_in_recording_order() {
        let root = DebugGroupId::new(0);
        let child = DebugGroupId::new(1);
        let unused = DebugGroupId::new(2);
        let groups = vec![
            crate::model::DebugGroupRecord {
                id: root,
                parent: None,
                label: "root".into(),
            },
            crate::model::DebugGroupRecord {
                id: child,
                parent: Some(root),
                label: "child".into(),
            },
            crate::model::DebugGroupRecord {
                id: unused,
                parent: None,
                label: "unused".into(),
            },
        ];
        let timed = vec![TimedNode {
            pass: PassId::new(0),
            kind: GpuTimingNodeKind::Compute,
            label: "node".into(),
            debug_group: Some(child),
            begin_query: 0,
            end_query: 1,
        }];
        assert_eq!(
            filter_debug_groups(&timed, &groups)
                .into_iter()
                .map(|group| group.label)
                .collect::<Vec<_>>(),
            ["root", "child"]
        );
    }
}
