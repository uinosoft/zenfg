# @zenfg/webgpu 0.2.0

Date: 2026-10-10

### Added

- Add optional `render({ webgpuDescriptor })` and the public
  `WebGpuRenderPassDescriptorExtras` type for caller-owned native render-pass
  fields. Recording captures own enumerable string data properties shallowly;
  graph-owned labels, attachments and timestamp writes cannot be overridden.
- Export `FrameGraphSnapshot`, `stringifyFrameGraphSnapshot` and
  `FrameGraphSnapshotValidationError` from `@zenfg/webgpu/snapshot`. Snapshot
  export can omit pool statistics and records `not-requested` instead.
- Add timing-mode-specific result types and overloads. GPU timing reports
  `no-timed-nodes` for unsampled frames and `too-many-timed-nodes` above 2048
  retained render/compute nodes; execution and requested CPU timing continue.

### Fixed

- Align omitted clear ranges with logical buffer bounds, preserve initialized
  bytes across padded texture readbacks, and exclude zero-sized copies from
  content dependencies and output production while retaining native commands.
- Require a known copy footprint for non-empty buffer-texture copies; keep
  memory-size estimates separate from byte-range planning.
- Roll back failed resource-pool acquisitions and use iterative retention for
  long dependency chains.
- Validate texture shape and retained transient usage before native allocation.
  Native capabilities, command alignment and descriptor compatibility remain
  WebGPU responsibilities; `TRANSIENT_ATTACHMENT` remains unsupported.
- Reject mismatched, duplicated or out-of-order timing nodes during Snapshot
  export while allowing ordered partial coverage under Snapshot 1.2.

### Compatibility and migration

The existing `FrameGraphError` now covers more ZenFG-detected failures that
previously threw plain `Error` or `TypeError`; inspect its `code` and available
phase/location fields. Callback and native exceptions still pass through, and
Snapshot validation keeps its own error type. Logical handles now use a private
unique-symbol type brand and no longer expose the runtime `__brand` property.
Obtain handles through recording factories rather than constructing or inspecting
brands. See [the migration guide](../migration-0.2.0.md).

The new descriptor option is additive: omission preserves the previous render
pass behavior. Experimental fields require application-owned feature detection,
enabled device features, compatible pipelines, native object lifetimes and
explicit graph `uses`. This is general descriptor passthrough, not a complete
bindless integration. Real GPU acceptance of these extras has not been verified;
mock/CPU checks do not establish browser or driver support. There is no matching
Rust descriptor extension API in this release.

Depend exactly on `@zenfg/snapshot` 0.1.1. The portable Snapshot wire format
remains 1.2; native descriptor extras are omitted from portable captures.

### References

[PR #11](https://github.com/uinosoft/zenfg/pull/11),
[PR #13](https://github.com/uinosoft/zenfg/pull/13),
[PR #16](https://github.com/uinosoft/zenfg/pull/16),
[PR #17](https://github.com/uinosoft/zenfg/pull/17),
[PR #18](https://github.com/uinosoft/zenfg/pull/18),
[PR #19](https://github.com/uinosoft/zenfg/pull/19),
[PR #20](https://github.com/uinosoft/zenfg/pull/20),
[PR #21](https://github.com/uinosoft/zenfg/pull/21),
[PR #22](https://github.com/uinosoft/zenfg/pull/22),
[PR #23](https://github.com/uinosoft/zenfg/pull/23),
[PR #24](https://github.com/uinosoft/zenfg/pull/24),
[PR #25](https://github.com/uinosoft/zenfg/pull/25),
and [PR #27](https://github.com/uinosoft/zenfg/pull/27).
