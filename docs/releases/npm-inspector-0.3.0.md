# @zenfg/inspector 0.3.0

Date: 2026-11-27

### Added and fixed

- Share CPU/GPU timing selection across Overview and Passes. Compare pass
  durations and shares on a capture-wide scale, with execution Order and
  group navigation.
- Clarify resource identities and access relations, and make logical resource
  sizes easier to compare.
- Sort physical allocations globally in Memory and expand rows to inspect
  logical members. Show known lifetime coverage, report alias savings
  estimates consistently and restore focus across detail updates.
- Isolate graph theme measurement from host-page CSS. Ship English and Chinese
  workbench guidance and the `zenfg-inspector` Agent Skill.

### Compatibility

The workbench changes affect how the Inspector presents capture data. Existing
construction and capture APIs remain available. This release depends on exactly
`@zenfg/snapshot` 0.1.2 and continues to read Snapshot 1.2 captures. See the
[workbench guide](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.3.0/packages/inspector/GUIDE.md)
for timing and memory interpretation, and the
[theme guide](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.3.0/packages/inspector/THEMING.md) for
embedding and customization.

### References

[PR #31](https://github.com/uinosoft/zenfg/pull/31),
[PR #32](https://github.com/uinosoft/zenfg/pull/32),
[PR #33](https://github.com/uinosoft/zenfg/pull/33),
and [PR #35](https://github.com/uinosoft/zenfg/pull/35).
