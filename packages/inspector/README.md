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
