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

Resource and access statistics describe the declarations captured in the graph.
They do not automatically scan all shader bindings or measure total GPU memory;
workload-private buffers can be absent. More explicit declarations can be useful
for diagnosis. See [Choosing resource declaration granularity](../../docs/core-concepts.md#choosing-resource-declaration-granularity).

## Installation

```sh
npm install @zenfg/inspector@0.1.0-beta.3
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

The first capture opens Graph with no selection and the detail pane closed.
Subsequent captures preserve the current view, filters, and selection when the
same object still exists. Pass selection follows the node ID across retained and
culled states; removing the selected object clears selection and closes details.
These preferences, group expansion, and detail width belong to the current
Inspector instance and are not saved across sessions.

| View | Purpose |
| --- | --- |
| Overview | Full-width diagnostic counts, timing coverage, slowest pass, work counts, and memory estimates, with links to the relevant views. Capture metadata is expandable. |
| Graph | Frame Flow structure, searchable by pass, resource, group, or output, with explicit target location and a collapsible legend. |
| Passes | All, Retained, or Culled passes, filtered by kind and name/ID/group, with order and GPU sorting. The separate Group Hierarchy has its own expansion and path search. |
| Resources | Name/ID/group, type, and Transient/Imported/Surface filters, plus name, estimated size, and first-use sorting. Full descriptors and allocations remain in details. |
| Memory | Physical allocations and their logical resources, inclusive execution-slot lifetimes, search, allocation/size sorting, and All/Aliased/Single/Unallocated filters. |
| Diagnostics | Every captured error, warning, and informational message, including repeated codes. Severity and code/message filters precede expandable retention roots, culling reasons, and execution segments. |

Lists show the matching and total counts, retain continuous scrolling, and offer
**Clear filters**. Passes order retained work by execution order, then culled work
by recording order when available, falling back to capture order. Retained means
the compiler kept a pass; it does not itself prove GPU execution. Culled work has
no execution order, segment, or GPU timing. The Group Hierarchy arrows only change
that tree; **Show in Graph** is a separate action.

Diagnostics preserve capture order within each severity and offer separate
node and resource links when a message references both. Culled-node links work
the same way as retained-node links. The Diagnostics tab and capture context show
error/warning counts; the context also keeps source, frame, and capture time
visible. An absent capture timestamp is shown as unknown.

The selection pane has **Summary**, **Relations**, and **Raw** tabs. Summary
explains compilation status, timing coverage, accesses, allocation relationships,
and attached diagnostics. Relations distinguish access facts, dependencies,
output sources, and allocation membership. Raw shows the selected original
object and its JSON path in the canonical Snapshot, with field/value search,
folding, and copy of the complete object regardless of the current search. Legacy
imports explicitly identify their migrated canonical data. IDs can be copied
without their presentation labels.

Selecting an object opens its details on object views. Overview uses the full
width while retaining selection. The pane defaults to 340px and can be resized
from 300px to 480px while leaving at least 640px for the main view. Smaller hosts
use a modal drawer with a backdrop, keyboard focus containment, and focus
restoration when closed. The main content width determines table and information
layout; auxiliary table columns move into details when space is limited.
Arrow keys and Home/End switch tabs. Escape first dismisses the innermost active
menu or detail pane; the Playground host respects handled key events.

### Timing and memory interpretation

Timing labels distinguish not collected, partial coverage, complete coverage,
not applicable, and a measured zero. **Measured pass sum** is the sum of available
pass timings with its timed/eligible count; **GPU span** is displayed separately.
Opaque external work has no inferred duration. Passes is the comparison table
for individual timings; Diagnostics does not repeat it.

Memory numbers are estimates with different scopes:

| Metric | Meaning |
| --- | --- |
| Transient estimate | Declared estimated sizes of transient logical resources. |
| Logical capacity | Allocation capacity counted for each assigned logical transient resource. |
| Physical estimate | Estimated sizes of physical allocations in the allocation report. |
| Alias reuse | Logical capacity minus physical estimate, where both are known. |
| Pool retained | Producer-reported retained pool allocations, which may outlive this graph. |

An unavailable report is not zero. Unknown resource/allocation sizes remain
unknown, and partial summaries show the known-size coverage. A valid empty report
can contain real zero totals. None of these metrics is total GPU memory or a
measured peak. Memory summaries always cover the entire Snapshot; filters change
the visible rows and matching count only. A lifetime includes both first and last
execution slots. Tick positions, grid lines, and resource bars share one stable
Snapshot coordinate range; missing lifetimes have no bar.

### Frame Flow interaction

Graph is a single **Frame Flow** view: resource declarations → retained pass
dependencies → explicit resource outputs. Resource entrances belong to their
declaration groups; output roots remain top-level and use compiler-supplied final
producers and initial-content contributions. Culled passes remain in lists and
details, not in the graph. Collapsed groups aggregate relationships without
discarding their underlying semantics.
All nodes use single-line borders. Ordinary passes are rounded rectangles,
external submissions are cut-corner rectangles, resource entrances are ellipses,
and output roots are right-pointing tags. Declarations and outputs each have a
role colour independent of Buffer/Texture; pass categories have distinct colours.
Resources and Memory retain their resource-type colours. Hover and selection
change border emphasis, not shape, text colour, or fill.

Entrances show source/type first and the resource name second; outputs show their
purpose first and name second. Names are truncated to one line, with full names
available on hover and in details. Output ranges appear only to distinguish
different ranges of the same resource and purpose. Exact ranges and final sources
remain in hover/details. Semantic zoom hides auxiliary types and range summaries.
The grouped legend describes the whole snapshot's Frame Flow, including collapsed
objects, and remains stable while groups expand/collapse. Culled-only categories
and unused resources do not add legend entries.

Category fills are opaque 18% sRGB tints over the canvas; node text stays light
and targets at least 7:1 contrast. Supporting text targets 4.5:1, and identifying
borders/symbols target 3:1 against their adjacent backgrounds. Automated checks
cover the default theme and interaction states; custom CSS colour overrides must
preserve these contrast relationships.

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

Explicit **Show in …** actions perform navigation: they switch views, clear
blocking filters, expand necessary ancestors, and scroll or center the target.
They close a narrow-host drawer so the target is visible. Graph search uses the
same explicit location behavior. Objects absent from Frame Flow show an
explanation and a list-view action; locating an object does not bypass the graph
element budget. Ordinary selection and hover retain the behavior above.

Capture, import, and direct replacement share a revision counter so stale async
results cannot replace newer data. Failed or oversized imports leave the
current valid capture and UI state intact, and operation feedback can be expanded
to inspect the full failure reason. Views render their new capture on first
activation, and selection updates refresh only the active view and details.
Memory grouping and lifetime coordinates are cached per Snapshot; Raw is created
only when opened. Graph layout is lazy and is disabled
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

- [Debug panel optimization validation](./VALIDATION.md)
- [Hosted Inspector](https://uinosoft.github.io/zenfg/inspector/)
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/main/packages/snapshot/README.md)
- [ZenFG Core concepts](https://github.com/uinosoft/zenfg/blob/main/docs/core-concepts.md)
- [ZenFG documentation index](https://github.com/uinosoft/zenfg/blob/main/docs/README.md)
