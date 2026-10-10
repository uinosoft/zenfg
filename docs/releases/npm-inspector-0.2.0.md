# @zenfg/inspector 0.2.0

Date: 2026-10-10

### Changes

- Add an Overview panel with capture, timing, resource and memory metrics and
  direct navigation to related workbench views.
- Improve graph search, keyboard navigation, zoom controls, graph legends and
  relation focus. Make graph labels and details easier to scan.
- Refine pass, resource, memory and diagnostic panels, including responsive
  details, relationships, raw data and list controls.
- Preserve asynchronous capture/import/copy state and selection feedback, and
  correct keyboard interactions across panel updates.

### Compatibility and migration

Resource declaration nodes are now hidden initially in the Graph view.
Pass `showResourceDeclarations: true` when creating the Inspector to restore
0.1.0's initial visibility. The Declarations control and resource reveal actions
can enable them later. This changes presentation only; resource tables and
Snapshot data retain the declarations.

Existing supported construction and capture APIs remain available. Depend
exactly on `@zenfg/snapshot` 0.1.1 for the ancestry validator fix. The portable
Snapshot wire format remains 1.2. See [the migration guide](../migration-0.2.0.md).

### References

[PR #26](https://github.com/uinosoft/zenfg/pull/26), including the final
[async and keyboard fixes](https://github.com/uinosoft/zenfg/commit/5cc2e3b),
and [PR #25](https://github.com/uinosoft/zenfg/pull/25) for the Snapshot dependency
fix.
