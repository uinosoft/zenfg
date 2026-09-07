# @zenfg/inspector

[![npm](https://img.shields.io/npm/v/%40zenfg%2Finspector?include_prereleases&label=npm)](https://www.npmjs.com/package/@zenfg/inspector)
[![status: beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/uinosoft/zenfg/blob/main/CHANGELOG.md)
[![CI](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml/badge.svg)](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/main/LICENSE)

`@zenfg/inspector` is an embeddable, renderer-independent DOM workbench for
ZenFG Snapshot data. It depends on `@zenfg/snapshot`, Cytoscape, and ELK, but has
no WebGPU, wgpu, engine, or host-UI dependency.

The package owns Snapshot validation, migration, visualization, and workbench
state. The host owns layout around the workbench, live-capture policy, file
retention, and the renderer that produces Snapshot data.

## Installation

```sh
npm install @zenfg/inspector@0.1.0-beta.2
```

## Quick start

Mount one Inspector into a host element and provide an optional live-capture
callback:

```ts
import { mountFrameGraphInspector } from '@zenfg/inspector';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';

export function mountInspector(
	host: HTMLElement,
	capture: () => FrameGraphSnapshot | Promise<FrameGraphSnapshot>,
): () => void {
	const inspector = mountFrameGraphInspector(host, {
		captureSnapshot: capture,
		branding: 'ZenFG Inspector',
	});

	return () => inspector.destroy();
}
```

The host must have non-zero width and height. `FrameGraphInspector` fills that
host, so the same workbench can be embedded in a tool panel or mounted as a
full-page application.

## Common tasks

| Task | Public API |
| --- | --- |
| Mount into an existing element | `mountFrameGraphInspector()` |
| Construct without appending | `new FrameGraphInspector()` and its `dom` property |
| Request live data from the host | `captureSnapshot` option |
| Replace the current capture | `setSnapshot()` |
| Read the current canonical capture | `getSnapshot()` |
| Import and migrate a file | `importSnapshot()` |
| Download canonical Snapshot JSON | `downloadSnapshot()` |
| Copy canonical Snapshot JSON | `copySnapshotJson()` |
| Set visible product branding | `branding` option |
| Limit imported file size | `maxImportBytes` option |
| Limit automatic graph layout | `maxGraphElements` option |
| Release DOM, workers, and listeners | `destroy()` |

Exact options, defaults, return types, and lifecycle behavior are documented by
the TSDoc preserved in the packaged source and declarations.

## Workbench behavior

The workbench provides Overview, Graph, Passes, Resources, Memory, and
Diagnostics views plus a selection Inspector. It supports live capture, direct
Snapshot replacement, file import, supported legacy migration, canonical
download, clipboard copy, filtering, sorting, group expansion, and graph
navigation.

Graph is a single **Frame Flow** view: resource declarations → retained pass
dependencies → explicit resource outputs. Resource entrances belong to their
declaration groups; output roots remain top-level and use compiler-supplied final
producers and initial-content contributions. Culled passes remain in lists and
details, not in the graph. Collapsed groups aggregate relationships without
discarding their underlying semantics.
All nodes use single-line borders. Ordinary passes are rounded rectangles,
external submissions are cut-corner rectangles, resource entrances are ellipses,
and output roots are right-pointing tags. Output colours retain the resource type;
hover and selection change the border emphasis, not the shape.

Solid edges represent declarations, values, and output sources; dashed edges
represent ordering-only relationships. Edges never carry labels. Hover provides
temporary hints: resource entrances and edges link only to visible entrances and
edges with the same logical resource ID, regardless of range. Passes, groups, and
output nodes only highlight themselves. These associations do not imply matching
ranges or a continuous dataflow path, and never substitute a collapsed group for
a hidden resource entrance.
Direct and linked hover use the same strong visual style. Selection uses a blue
outline without a glow. Hovering a Summary or Relations link previews its target
in the graph using the same rules, without changing selection or moving the view;
leaving the link or changing/closing the detail pane clears the preview.

Resource **Pass accesses** entries link only the pass name; access mode, write
contents, producesValue, and available ranges remain descriptive text. Pass details
use the same access facts. An access is not a graph
relationship and is not mapped to an arbitrary dependency edge.
Resource Relations also link to individual output roots by reason and range.

Clicking an entrance, edge, or Resources row selects the same logical resource,
including all its visible entrances and edges, but no passes, groups, or outputs.
An output still selects its Root. Its **View resource** action and other resource
links use the same resource selection. Changing to a different resource opens
Summary; selecting the current resource again preserves the active detail tab.
Selection does not switch workbench views, change filters, expand groups, or move
the viewport. A hidden entrance becomes selected when manually expanded; its
visible cross-group edges remain selected while it is hidden. Hover previews are
independent, with selection styling taking precedence, and never pin a tooltip.
Edge hints show only the resource and distinct relationship types, including
mixed types in aggregates. There is no independent edge detail or relationship list.
Double-clicking a group expands or collapses it without replacing selection;
single-click group selection waits briefly to distinguish that gesture.
Legacy outputs with unavailable
resolution remain visible but have no inferred source edges.

Capture, import, and direct replacement share a revision counter so stale async
results cannot replace newer data. Failed or oversized imports leave the
current valid capture and UI state intact. Graph layout is lazy and is disabled
with an explanation when a capture exceeds `maxGraphElements`; the tabular and
raw views remain available.

Snapshot labels, URLs, extensions, and diagnostics are assigned through text
DOM APIs and are never executed as markup or code. The standalone application
in `apps/inspector` mounts this same package without adding duplicate controls.

## Common mistakes

| Symptom | Fix |
| --- | --- |
| The Inspector is mounted but invisible | Give the host element a non-zero width and height. |
| Live capture never becomes available | Provide `captureSnapshot`, or call `setSnapshot()` with canonical data. |
| A large capture has no graph layout | Raise `maxGraphElements` deliberately or use the tabular/raw views. |
| A failed import appears to do nothing | Inspect the visible validation feedback; the previous valid capture is intentionally preserved. |
| Old capture results replace new ones in host code | Let the Inspector own capture sequencing instead of applying asynchronous results separately. |
| DOM or worker resources remain after unmount | Call `destroy()` when the host tool is released. |

## Further reading

- [Hosted Inspector](https://uinosoft.github.io/zenfg/inspector/)
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/main/packages/snapshot/README.md)
- [ZenFG Core concepts](https://github.com/uinosoft/zenfg/blob/main/docs/core-concepts.md)
- [ZenFG documentation index](https://github.com/uinosoft/zenfg/blob/main/docs/README.md)
