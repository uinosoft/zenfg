# zenfg 0.3.0

Date: 2026-11-27

### Added

- Create runtime-owned resource-pool scopes with `create_resource_pool_scope()`.
  Use `create_texture_in()` and `create_buffer_in()` to isolate transient
  aliasing and reuse between executions.
- Clear one scope with `clear_resource_pool_scope()` or evict retained resources
  with `evict_resource_pool()`. The predicate receives a borrowed view of the
  physical allocation details and the number of accepted executions since the
  allocation was last acquired.
- Ship English and Chinese runtime guides and a
  [`resource-pool-control` example](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.3.0/crates/zenfg/examples/resource_pool_control.rs)
  that demonstrates scoped resize cleanup and idle eviction with a no-op wgpu
  device.

### Compatibility and migration

The existing transient builders use the default shared domain.
`clear_resource_pool()` clears all domains. Imported resources remain
caller-owned. The API rejects scopes from other runtimes with
`FrameGraphError::ForeignResourcePoolScope`. See the
[runtime guide](https://github.com/uinosoft/zenfg/blob/cargo/zenfg/v0.3.0/crates/zenfg/docs/README.md).

The `snapshot` feature continues to depend on exactly `zenfg-snapshot` 0.1.1.
The runtime continues to produce Snapshot 1.2 captures.

### References

[PR #30](https://github.com/uinosoft/zenfg/pull/30),
[PR #31](https://github.com/uinosoft/zenfg/pull/31),
[PR #33](https://github.com/uinosoft/zenfg/pull/33),
and [PR #36](https://github.com/uinosoft/zenfg/pull/36).
