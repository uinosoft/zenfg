# @zenfg/inspector

`@zenfg/inspector` is an embeddable, renderer-independent DOM workbench for
ZenFG Snapshot data. It depends on `@zenfg/snapshot`, Cytoscape, and ELK; it has
no WebGPU, wgpu, engine, or host-UI dependency.

## Installation

```sh
npm install @zenfg/inspector
```

## Usage

```ts
import { mountFrameGraphInspector } from '@zenfg/inspector';

const inspector = mountFrameGraphInspector(document.querySelector('#tools')!, {
  captureSnapshot: () => renderer.requestFrameGraphSnapshot(),
});

inspector.setExpanded(true);
inspector.setSnapshot(existingSnapshot);
await inspector.importSnapshot(file);
inspector.downloadSnapshot();
await inspector.copySnapshotJson();
inspector.destroy();
```

`FrameGraphInspector` mounts into any `HTMLElement`. A host engine may wrap it
in its own dock or shell, but that adapter is intentionally outside this
package. File import defaults to 64 MiB and may be adjusted with
`maxImportBytes`. `maxGraphElements` defaults to 5,000; captures above that
layout budget retain Passes, Resources, Memory, Diagnostics, Inspector, and raw
views while automatic Cytoscape/ELK layout is disabled with an explanation.

## Workbench

The persistent workbench provides Graph, Passes, Resources, Memory, and
Diagnostics views plus a selection Inspector with Summary, Relations, and Raw
panes. It supports live capture providers, direct Snapshot set/get, file import,
Legacy V0 and t3d V1 candidate migration, canonical download, clipboard copy,
and cleanup through `destroy()`.

Capture, import, and direct replacement share a revision counter: stale async
results and results arriving after destruction are ignored. A failed or
oversized import leaves the current capture and UI state intact. The latest
valid capture preserves tab, filter, sorting, group-expansion, graph mode,
selection, Inspector, scrolling, and viewport state where possible.

Graph layout is lazy and read-only. ELK computes layered compound geometry and
Cytoscape renders it with pan, zoom, selection, hover, tooltips, group
expansion, relayout, and fit controls. Input labels and raw fields are assigned
with text DOM APIs; Snapshot extensions, URLs, labels, and messages are never
executed as markup or code.

The backend-free application in `apps/inspector` adds page-level file selection
and drag-and-drop. It is built as static files and includes third-party notices;
hosting and deployment are deliberately separate.
