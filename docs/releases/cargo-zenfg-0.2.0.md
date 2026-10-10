# zenfg 0.2.0

Date: 2026-10-10

### Fixed

- Make pass completion and compound access recording atomic so failed operations
  do not leave partial graph state. Resolve texture-view layer ranges consistently.
- Preserve recording order, debug groups and culled-node reasons in Serde
  compilation reports instead of discarding these producer facts.
- Return `NoTimedNodes` for GPU timing with no retained render/compute samples.
  Reject mismatched, duplicated or out-of-order timing nodes during Snapshot
  export while retaining Snapshot 1.2 ordered partial-coverage support.
- Reject access tokens from another graph or recording with `ForeignHandle`
  before resolving colliding local resource IDs.
- Preserve initialized buffer contents across padded texture readbacks and
  exclude zero-sized copies from content dependencies and output production
  while retaining native no-op commands.
- Validate device-independent texture shape and retained transient allocation
  usage before allocation. Preserve native wgpu multisample capabilities.
  `TRANSIENT_ATTACHMENT` remains unsupported by Snapshot 1.2.

### Compatibility and migration

The Serde form of compilation reports now includes previously skipped producer
fields. Old report JSON that lacks newly required fields such as
`recording_order`, culled `reason` or `debug_groups` may fail to deserialize.
Regenerate persisted reports or use an application adapter that supplies the
actual missing facts. This is separate from portable Snapshot compatibility;
Snapshot remains 1.2.

Native device capabilities, descriptor/render-pass compatibility and copy-command
validity are validated by wgpu rather than duplicated during graph recording.
Some failures therefore occur during allocation or encoding. Keep application
native error handling and device-loss policy active. ZenFG continues to validate
graph ownership, content, ranges, usage contracts and known copy footprints.
See [the migration guide](../migration-0.2.0.md).

With the `snapshot` feature enabled, depend exactly on `zenfg-snapshot` 0.1.1.
The TypeScript `webgpuDescriptor` passthrough is not a Rust API change. The Rust
2048 timed-node limit already existed in 0.1.0 and is not a new feature here.

### References

[PR #14](https://github.com/uinosoft/zenfg/pull/14),
[PR #15](https://github.com/uinosoft/zenfg/pull/15),
[PR #16](https://github.com/uinosoft/zenfg/pull/16),
[PR #17](https://github.com/uinosoft/zenfg/pull/17),
[PR #19](https://github.com/uinosoft/zenfg/pull/19),
[PR #21](https://github.com/uinosoft/zenfg/pull/21),
[PR #22](https://github.com/uinosoft/zenfg/pull/22),
[PR #23](https://github.com/uinosoft/zenfg/pull/23),
[PR #24](https://github.com/uinosoft/zenfg/pull/24),
and [PR #25](https://github.com/uinosoft/zenfg/pull/25).
