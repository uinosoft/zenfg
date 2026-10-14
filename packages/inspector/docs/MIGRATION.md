# @zenfg/inspector upgrade notes

<!-- generated:language:start -->
**English** | [简体中文][documentation-zh]

[documentation-en]: ./MIGRATION.md
[documentation-zh]: ./MIGRATION.zh-CN.md
<!-- generated:language:end -->

Package API versions and Snapshot wire versions are independent. The historical
changes below apply to the named releases, not to every current integration.

## Inspector initial graph visibility

Resource declaration nodes are hidden initially in the Graph view. To retain
0.1.0's initial display, pass `showResourceDeclarations: true` to
`FrameGraphInspector` or `mountFrameGraphInspector`. Users can also enable the
Declarations control or reveal a resource in the graph. Resource tables and
Snapshot data retain the declarations regardless of this display setting.

The redesigned Overview, search, keyboard navigation, relation focus and zoom
controls do not require a capture-provider API migration. Existing supported
construction and CPU/GPU/both capture requests remain available.

## Capture providers in beta.4

Forward the requested CPU, GPU or both timing mode to the runtime. The Capture
action requests both; imported files retain their captured data. CPU-only
programmatic captures must work without timestamp-query support.

## Release history

See [component release notes](https://github.com/uinosoft/zenfg/tree/npm/inspector/v0.2.0/docs/releases)
for package versions and historical acceptance evidence.
