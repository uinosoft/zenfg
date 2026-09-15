# @zenfg/inspector 0.1.0-beta.4

Date: 2026-09-15

### Changes

- Display CPU measurements, sorting, group coverage and unavailable timing states from Snapshot 1.2 captures.
- Add customizable Tokyo Night themes, searchable workbench lists, responsive detail layouts and clearer graph/resource navigation.
- Defer inactive views and cache details; invalidate derived state when captures are replaced.
- Improve diagnostic preservation, graph readability and capture feedback.

### Breaking integration changes

- Capture providers receive a CPU/GPU/both timing request; the Capture action requests both. Forward the request through host adapters.
- Depend exactly on @zenfg/snapshot 0.1.0-beta.4.

[Migration guide](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.1.0-beta.4/docs/migration-timing-snapshot-1.2.md).
