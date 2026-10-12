# zenfg upgrade notes

Package API versions and Snapshot wire versions are independent. The historical
changes below apply to the named releases, not to every current integration.

## Rust compilation report JSON

The `serde` representation of Rust compilation reports now preserves producer
facts previously skipped during serialization: node recording order, debug-group
relationships, culled-node reasons and the full report's debug groups. Existing
report JSON missing newly required fields such as `recording_order`, culled
`reason` or `debug_groups` may no longer deserialize.

Regenerate persisted reports from their recording, or adapt them with the actual
missing facts at the application boundary. Do not fill arbitrary defaults and
assume equivalent capture semantics. Rust compilation report JSON is distinct
from the portable Snapshot 1.2 contract; existing valid Snapshot captures remain
compatible.

## Native validation and copies

Graph checks cover ownership, ranges, contents, usage contracts and bounded
planning. Native descriptors, device limits, copy alignment, aspect and overlap
remain wgpu validation. Zero-sized copies have no graph content effect; padded
texture-to-buffer copies preserve required previous contents.

## Unified timing in beta.4

Replace execute_with_gpu_timing with execute_with_timing and TimingMode::Gpu,
Cpu or Both. CPU reports are immediate; GPU readback is separate. Ordinary
execution collects no timing. Export matching compilation, timing and pool facts
with explicit frame identity; retain immediate facts before asynchronous readback.

## Runtime integrations

In Rust, replace `root.producers` with `root.resolution.producer_node_ids`.
`root.resolution.uses_initial_contents` indicates whether defined initial
contents contribute. `SnapshotRoot` is now a reason-tagged enum; use its variants
for construction and matching, or `resource()`, `node_id()`, and `reason()`
for inspection instead of accessing the former struct fields.

Ranged roots normalize texture views and buffer ranges. Undefined or discarded
rooted contents fail with FG1004, even without reports. Empty root ranges are
invalid; ordinary empty buffer accesses remain valid. Root identity includes
resource, reason and normalized range, rather than array index or resource alone.

## Timing and Snapshot export in 0.2.0

GPU timing no-timed-nodes is unavailable, not an available zero-duration reading.
The existing 2048 timed render/compute-node limit keeps execution and CPU reports
available. Snapshot exporters require timing IDs, ordering and node kinds to
match the retained compilation sequence; partial ordered coverage remains valid.
Mismatches return SnapshotExportError::InvalidTimingReport. Keep compilation,
timing and pool facts from one compiled frame, not just matching numeric indices.

## Release history

See [component release notes](https://github.com/uinosoft/zenfg/tree/cargo/zenfg/v0.2.0/docs/releases)
for package versions and historical acceptance evidence.
