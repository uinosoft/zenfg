# @zenfg/webgpu 0.3.0

Date: 2026-11-27

### Added

- Create runtime-owned resource-pool scopes with `createResourcePoolScope()`
  and pass `{ scope }` when declaring a transient texture or buffer. Each
  scope isolates within-frame aliasing and reuse between executions.
- Clear one scope with `clearResourcePool(scope)` or evict retained resources
  with `evictResourcePool(predicate)`. The synchronous predicate receives
  readonly physical allocation details and the number of accepted executions
  since the allocation was last acquired.
- Ship English and Chinese guides, the
  [resource-pool control recipe](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.3.0/packages/webgpu/examples/resource-pool-control.ts),
  and the `zenfg-webgpu` Agent Skill. The guides cover diagnostic grouping,
  repeated Bloom stages and how to expose resource accesses to the graph.

### Compatibility and migration

Transient declarations without a scope use the default shared domain.
`clearResourcePool()` clears all domains. A cleared scope can be reused, and
executing an older compiled plan can repopulate its cache. Imported resources
remain caller-owned. See the
[runtime guide](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.3.0/packages/webgpu/docs/README.md).

This release depends on exactly `@zenfg/snapshot` 0.1.2 and continues to produce
Snapshot 1.2 captures.

### References

[PR #30](https://github.com/uinosoft/zenfg/pull/30),
[PR #31](https://github.com/uinosoft/zenfg/pull/31),
[PR #33](https://github.com/uinosoft/zenfg/pull/33),
and [PR #36](https://github.com/uinosoft/zenfg/pull/36).
