# @zenfg/inspector

[![npm](https://img.shields.io/npm/v/%40zenfg%2Finspector?include_prereleases&label=npm)](https://www.npmjs.com/package/@zenfg/inspector)
[![status: beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/uinosoft/zenfg/blob/main/CHANGELOG.md)
[![CI](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml/badge.svg)](https://github.com/uinosoft/zenfg/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/main/LICENSE)

`@zenfg/inspector` is an embeddable, renderer-independent DOM workbench for
ZenFG Snapshot data. It depends on `@zenfg/snapshot`, Cytoscape, and ELK; it has
no WebGPU, wgpu, engine, or host-UI dependency.

This is a public beta package. Public APIs may change before 1.0; integration
projects should pin the exact beta version.

For package selection, the capture data flow, version boundaries, and links to
complete producer recipes, see the
[ZenFG quick reference](https://github.com/uinosoft/zenfg/blob/main/docs/quick-reference.md).

## Installation

```sh
npm install @zenfg/inspector@0.1.0-beta.1
```

## Usage

```ts
import { mountFrameGraphInspector } from '@zenfg/inspector';

const inspector = mountFrameGraphInspector(document.querySelector('#tools')!, {
  captureSnapshot: () => renderer.requestFrameGraphSnapshot(),
  branding: 'ZenFG Inspector', // Pass false to hide visible branding.
});

inspector.setSnapshot(existingSnapshot);
await inspector.importSnapshot(file);
inspector.downloadSnapshot();
await inspector.copySnapshotJson();
inspector.destroy();
```

`FrameGraphInspector` fills any `HTMLElement` with a non-zero width and height,
so the same workbench can be a full page or an embedded tool. Product branding,
file selection, and file drag-and-drop are built in; an optional dock or overlay
adapter remains the host application's responsibility. File import defaults to
64 MiB and may be adjusted with
`maxImportBytes`. `maxGraphElements` defaults to 5,000; captures above that
layout budget retain Passes, Resources, Memory, Diagnostics, Inspector, and raw
views while automatic Cytoscape/ELK layout is disabled with an explanation.

## Workbench

The persistent workbench provides Overview, Graph, Passes, Resources, Memory,
and Diagnostics views plus a selection Inspector with Summary, Relations, and
Raw panes. It supports live capture providers, direct Snapshot set/get, file
import, Legacy V0 and Legacy Candidate V1 migration, canonical download,
clipboard copy, and cleanup through `destroy()`.

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

The backend-free application in `apps/inspector` mounts the same workbench into
a full-viewport host without adding duplicate controls. It is built as static
files and includes third-party notices; hosting and deployment are deliberately
separate.
