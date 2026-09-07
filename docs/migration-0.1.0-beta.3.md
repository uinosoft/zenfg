# Migrating from 0.1.0-beta.2 to 0.1.0-beta.3

Upgrade the three npm packages (`@zenfg/snapshot`, `@zenfg/webgpu`, and
`@zenfg/inspector`) and the two Rust crates (`zenfg-snapshot` and `zenfg`)
used by your integration to exact version `0.1.0-beta.3` together.
Package versions and Snapshot wire versions are separate contracts.

## Snapshot readers and producers

Beta.2 produces and reads canonical Snapshot 1.0. Beta.3 produces and reads
canonical Snapshot 1.1. Neither reader accepts the other canonical version.
The existing Legacy V0 and Legacy Candidate V1 migrations do not migrate
canonical 1.0 captures. Keep a beta.2 reader for archived 1.0 files, or regenerate
captures with beta.3. Do not simply replace the version number in old files:
the required root facts cannot generally be reconstructed from graph reachability.

Native resource roots must include `resourceId`, a non-empty normalized `range`,
and `resolution: { producerNodeIds, usesInitialContents }`. A `side-effect` root
instead includes `nodeId` and has no resource, range, or resolution. Update
custom producers, test fixtures, and report adapters to this discriminated model.
Only explicit legacy migration provenance permits missing resource-root facts;
missing facts mean unknown, not empty producers or `false`.

## Runtime integrations

In Rust, replace `root.producers` with `root.resolution.producer_node_ids`.
`root.resolution.uses_initial_contents` indicates whether defined initial
contents contribute. `SnapshotRoot` is now a reason-tagged enum; use its variants
for construction and matching, or `resource()`, `node_id()`, and `reason()`
for inspection instead of accessing the former struct fields.

Existing single-argument WebGPU root calls remain available. Buffer roots can
now select a range, and texture roots can select a texture view. Compilation
rejects undefined or discarded contents anywhere in the selected range with
FG1004, even without diagnostic reports. For example, if only the first eight
bytes of a new sixteen-byte buffer are initialized, replace `markOutput(buffer)`
with `markOutput(buffer, { offset: 0, size: 8 })`, or initialize all sixteen bytes.
Empty root ranges are invalid; ordinary empty buffer accesses are unchanged.

Consumers should identify resource roots by resource, reason, and normalized
range, not by array index or resource ID alone. Inspector now uses a unified
Frame Flow view, including output endpoints and their final-content sources.
