# Migrating from 0.1.0 to runtime 0.2.0 and Snapshot packages 0.1.1

Package versions are independent. Upgrade the components used by your integration
to the versions below; installing all five is unnecessary.

| Component | Version | Exact internal dependency |
| --- | --- | --- |
| `@zenfg/webgpu` | 0.2.0 | `@zenfg/snapshot` 0.1.1 |
| `@zenfg/inspector` | 0.2.0 | `@zenfg/snapshot` 0.1.1 |
| `@zenfg/snapshot` | 0.1.1 | None |
| `zenfg` | 0.2.0 | `zenfg-snapshot` 0.1.1 with the `snapshot` feature |
| `zenfg-snapshot` | 0.1.1 | None |

The portable Snapshot wire format remains **1.2**. The Snapshot package patch
releases fix ancestry validation without changing codec APIs or valid capture
structure. Existing canonical 1.2 captures need no rewrite. Earlier 1.1 migration
and 1.0 rejection rules remain unchanged; see [the timing and Snapshot guide](migration-timing-snapshot-1.2.md)
when upgrading from older versions.

## WebGPU errors and logical handles

`FrameGraphError` existed in 0.1.0. Version 0.2.0 extends its coverage to more
ZenFG-detected recording, compilation and execution failures that previously
threw plain `Error` or `TypeError`. Replace constructor-name or exact built-in
error-type checks for those failures with `FrameGraphError.code` checks and use
available phase/location metadata. Error messages remain human-readable text.
Callback exceptions and native WebGPU exceptions pass through unchanged.
Snapshot validation uses `FrameGraphSnapshotValidationError`, now also exported
by `@zenfg/webgpu/snapshot`; do not treat every failure as a `FrameGraphError`.

Logical texture, view and buffer handles now use a private unique-symbol brand
in their TypeScript declarations. The old runtime `__brand` property is removed.
Use the recording's creation/import/view factories and pass those handles through
your integration. Stop constructing structural lookalikes or reading `__brand`;
the public `kind`, `id` and optional `label` remain available for diagnostics.
Ownership validation still requires the correct recording's actual handle.

## Native validation and copy content

Both runtimes validate graph ownership, ranges, content flow, usage contracts,
format categories and bounded planning inputs. Device capabilities, native
resource/texture-view descriptors, render-pass compatibility and native copy
alignment, format, aspect and overlap rules remain browser WebGPU or wgpu
responsibilities. Some inputs previously rejected during recording now reach
native allocation or encoding. Retain the host's native error handling and
device-loss policy. Browser errors can arrive asynchronously through error scopes
or `uncapturederror`; synchronous graph execution does not await or convert them.

Device-independent texture shape and retained transient allocation usage are
checked before native allocation. Browser sample counts remain 1 or 4; Rust
preserves wgpu's format/backend-dependent sample counts. `TRANSIENT_ATTACHMENT`
is rejected because Snapshot 1.2 cannot encode that usage. This native usage flag
is separate from ZenFG's transient resource lifetime policy.

Zero-sized copies have no graph read/write effect and cannot define output
contents. A retained zero-sized operation is still encoded as a native no-op for
native parameter validation. Non-empty buffer-texture copies need a known format
footprint for dependency tracking. Texture-to-buffer copies with row or layer
padding preserve existing bytes in the footprint; unused single-row or
single-layer stride values do not make a contiguous write preserving. Initialize
the destination's required previous contents before a preserving write.

WebGPU `clearBuffer()` with omitted size now clears only the remainder of the
logical buffer range, including when a larger native buffer is imported. Specify
a size when only part of that logical remainder should be cleared.

## Timing and Snapshot export

Treat GPU timing `no-timed-nodes` as unavailable rather than an available
zero-duration measurement. WebGPU also returns `too-many-timed-nodes` above 2048
retained render/compute nodes instead of allocating more than 4096 timestamp
queries. Execution still submits, and `both` mode keeps its CPU report. The Rust
timed-node limit already existed in 0.1.0. Consumers should handle unavailable
reasons without assuming that execution failed.

Snapshot exporters reject timing node IDs, duplicates, ordering or kinds that
do not match the retained compilation sequence. Ordered partial coverage remains
valid under Snapshot 1.2. Pass compilation and timing reports from the same
compiled frame; do not combine frames merely because their numeric frame indices
match. Rust reports these failures with `SnapshotExportError::InvalidTimingReport`;
TypeScript uses `FrameGraphSnapshotValidationError`.

The WebGPU Snapshot entrypoint now re-exports the portable Snapshot type and
canonical serializer. `resourcePool` is optional in `createFrameGraphSnapshot()`;
omission records pool availability as `not-requested` without changing the wire
format. Capture optional CPU results and pool counters before awaiting GPU
readback to retain same-frame facts.

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

## Inspector initial graph visibility

Resource declaration nodes are hidden initially in the Graph view. To retain
0.1.0's initial display, pass `showResourceDeclarations: true` to
`FrameGraphInspector` or `mountFrameGraphInspector`. Users can also enable the
Declarations control or reveal a resource in the graph. Resource tables and
Snapshot data retain the declarations regardless of this display setting.

The redesigned Overview, search, keyboard navigation, relation focus and zoom
controls do not require a capture-provider API migration. Existing supported
construction and CPU/GPU/both capture requests remain available.

## Optional WebGPU render-pass descriptor extras

Existing `render()` calls continue to work without changes. Use the additive
`webgpuDescriptor` option only when the host needs extra native descriptor fields.
ZenFG continues to own `label`, `colorAttachments`, `depthStencilAttachment` and
`timestampWrites`; attempts to override these fields are rejected with `FG2013`.
Only own enumerable string data properties are accepted, captured shallowly at
recording. Referenced native objects retain their identity and stay caller-owned.

Standard fields retain their WebGPU types. Applications must supply their own
types for experimental fields and own feature detection, enabled features,
pipeline compatibility, native validation and native object lifetimes. Resources
accessed through an extension still need explicit graph `uses`; passthrough does
not infer dependencies. Descriptor extras are execution-only, omitted from
portable Snapshots, and specific to the TypeScript WebGPU runtime.

This provides general descriptor passthrough rather than a complete bindless API.
Real GPU acceptance of the new extras has not been verified. The existing mock/CPU
checks do not prove experimental browser or driver support. See [the WebGPU
README](../packages/webgpu/README.md#native-render-pass-descriptor-extras) for the
application-owned integration boundary and a typed example.

## Per-package release notes

- [@zenfg/webgpu 0.2.0](releases/npm-webgpu-0.2.0.md)
- [@zenfg/inspector 0.2.0](releases/npm-inspector-0.2.0.md)
- [@zenfg/snapshot 0.1.1](releases/npm-snapshot-0.1.1.md)
- [zenfg 0.2.0](releases/cargo-zenfg-0.2.0.md)
- [zenfg-snapshot 0.1.1](releases/cargo-zenfg-snapshot-0.1.1.md)
