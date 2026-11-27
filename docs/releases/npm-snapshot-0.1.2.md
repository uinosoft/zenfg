# @zenfg/snapshot 0.1.2

Date: 2026-11-27

### Added

- Ship English and Chinese package guides and the Snapshot specification,
  upgrade notes and the `zenfg-snapshot` Agent Skill. The Skill links to
  references included in the package.
- Add a scoped-aliasing producer fixture to the shipped conformance corpus. It
  captures allocation behavior exercised by both the WebGPU and Rust runtimes.

### Compatibility

The codec, validator and Snapshot 1.2 wire format remain unchanged. Existing
captures can be read without a rewrite. This update is the exact dependency of
`@zenfg/webgpu` 0.3.0 and `@zenfg/inspector` 0.3.0. See the
[Snapshot specification](https://github.com/uinosoft/zenfg/blob/npm/snapshot/v0.1.2/packages/snapshot/SPEC.md)
for the wire contract.

### References

[PR #30](https://github.com/uinosoft/zenfg/pull/30),
[PR #31](https://github.com/uinosoft/zenfg/pull/31),
and [PR #33](https://github.com/uinosoft/zenfg/pull/33).
