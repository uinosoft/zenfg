# @zenfg/webgpu upgrade notes

<!-- generated:language:start -->
**English** | [简体中文][documentation-zh]

[documentation-en]: ./MIGRATION.md
[documentation-zh]: ./MIGRATION.zh-CN.md
<!-- generated:language:end -->

Package API versions and Snapshot wire versions are independent. The historical
changes below apply to the named releases, not to every current integration.

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
checked before native allocation. Browser sample counts remain 1 or 4; `TRANSIENT_ATTACHMENT`
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
README](./README.md#native-render-pass-descriptor-extras) for the
application-owned integration boundary and a typed example.

## Runtime calls

TypeScript replaces `compiled.execute({ gpuTiming: true })` with
`compiled.executeWithTiming({ timing: 'gpu' }).gpu!`. Choose `'cpu'` or `'both'`
to collect CPU elapsed time. The returned object is synchronous; only its GPU
Promise is asynchronous. Keep existing frameIndex and submission hooks.
Consume the returned GPU Promise with `await` or a rejection handler, including
during application shutdown. An asynchronous lifecycle/readback failure follows
the existing GPU contract even after synchronous execution succeeded.
No compatibility aliases or GPU overloads remain. Plain execution collects no timing.

## Snapshot inputs

TypeScript `createFrameGraphSnapshot` now requires an explicit `frameIndex`.
Both `cpuTiming` and `gpuTiming` are optional. Save CPU, compilation and pool counters right
after execution, before awaiting GPU readback. All provided reports must describe
the same compiled frame and carry the same caller-defined frame index.

## Interpreting CPU values

CPU means synchronous elapsed time, including local setup/cleanup and external
submission callbacks. Shared preparation, submission and resource release appear
in execute total. Recording, compilation, GPU wait and snapshot/UI work are
outside that total. Thread preemption and GC can affect values; a microsecond
unit is not a precision guarantee. No partial report is returned after failure.

## Runtime integrations

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

## Release history

See [component release notes](https://github.com/uinosoft/zenfg/tree/npm/webgpu/v0.2.0/docs/releases)
for package versions and historical acceptance evidence.
