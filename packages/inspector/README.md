# @zenfg/inspector

<!-- generated:badges:start -->
[![@zenfg/inspector published next version](https://img.shields.io/npm/v/%40zenfg%2Finspector/next?label=npm)](https://www.npmjs.com/package/@zenfg/inspector)
[![API Docs (development)](https://img.shields.io/badge/API_docs-development-blue)](https://uinosoft.github.io/zenfg/docs/api/inspector/)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.1.0-beta.3/LICENSE)
<!-- generated:badges:end -->

`@zenfg/inspector` is an embeddable, renderer-independent DOM workbench for
ZenFG Snapshot data. It depends on `@zenfg/snapshot`, Cytoscape, and ELK, but has
no WebGPU, wgpu, engine, or host-UI dependency.

The package owns Snapshot validation, migration, visualization, and workbench
state. The host owns layout around the workbench, live-capture policy, file
retention, and the renderer that produces Snapshot data.

Resource and access statistics describe the declarations captured in the graph.
They do not automatically scan all shader bindings or measure total GPU memory;
workload-private buffers can be absent. More explicit declarations can be useful
for diagnosis. See [Choosing resource declaration granularity](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.1.0-beta.3/docs/core-concepts.md#choosing-resource-declaration-granularity).

## Installation

<!-- generated:installation:start -->
```sh
npm install @zenfg/inspector@0.1.0-beta.3
```
<!-- generated:installation:end -->

## Quick start

Run in a modern browser from your existing TypeScript app. Give the host element
an explicit size (for example, `height: 600px`) and supply a valid Snapshot capture.
Call `mountInspector(host, capture)` below; the returned function removes the workbench.

Mount one Inspector into a host element and provide an optional live-capture
callback:

```ts
import { mountFrameGraphInspector, type FrameGraphCaptureRequest } from '@zenfg/inspector';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';

export function mountInspector(
	host: HTMLElement,
	capture: (request: FrameGraphCaptureRequest) => FrameGraphSnapshot | Promise<FrameGraphSnapshot>,
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

## Themes and style customization

Inspector uses Tokyo Night Storm by default and includes a complete Light preset.
Use public `--zfgi-*` variables on an owned host, or pass a theme object and call
`setTheme()` to update one instance without losing graph interaction state.
After changing external CSS dynamically, call `refreshTheme()` to synchronize
the Canvas graph. Static CSS is read automatically at mount.

See [Theming](./THEMING.md) for JS presets, the optional CSS preset stylesheet,
variable reference, compatibility aliases, and multi-instance behavior.

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
| Apply a preset or custom theme | `theme` option and `setTheme()` |
| Synchronize graph after external CSS changes | `refreshTheme()` |
| Set visible product branding | `branding` option |
| Limit imported file size | `maxImportBytes` option |
| Limit automatic graph layout | `maxGraphElements` option |
| Release DOM, workers, and listeners | `destroy()` |

Exact options, defaults, return types, and lifecycle behavior are documented by
the TSDoc preserved in the packaged source and declarations.

## Workbench guide

See the [workbench guide](./GUIDE.md) for views, graph interaction, timing, and memory interpretation.

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
- [`@zenfg/snapshot`](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.1.0-beta.3/packages/snapshot/README.md)
- [ZenFG Core concepts](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.1.0-beta.3/docs/core-concepts.md)
- [ZenFG documentation index](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.1.0-beta.3/docs/README.md)

## Documentation and versions

<!-- generated:documentation:start -->
This README describes **@zenfg/inspector 0.1.0-beta.3**. Registry badges show the current published channel, not your installed version.

- Exact installed APIs: follow `package.json` → `exports` → `dist/*.d.ts`; declaration maps point to the included `src/`. Only declared export paths are public.
- [Online guide (development branch)](https://uinosoft.github.io/zenfg/docs/packages/inspector.html). The site may describe changes newer than this package.
- [TypeScript API (development branch)](https://uinosoft.github.io/zenfg/docs/api/inspector/).
- [Source and documentation for this release](https://github.com/uinosoft/zenfg/tree/npm/inspector/v0.1.0-beta.3/packages/inspector).
- [Shared concepts for this release](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.1.0-beta.3/docs/core-concepts.md) and [compatibility](https://github.com/uinosoft/zenfg/blob/npm/inspector/v0.1.0-beta.3/docs/compatibility.md).
- [Plain Markdown documentation index (development branch)](https://uinosoft.github.io/zenfg/docs/llms.txt).
- Local guides: [workbench](./GUIDE.md) and [themes](./THEMING.md).
<!-- generated:documentation:end -->

## CPU and GPU capture

The live capture selector requests CPU, GPU or both (default). Providers receive
a `FrameGraphCaptureRequest` and must forward its timing mode to the runtime.
The selection affects only the next capture, not imported data or normal frames.
CPU columns, sorting, group sums and coverage include all retained node kinds.
CPU execute total and GPU span remain separate. Missing, culled and real zero
readings are distinct; zero does not guarantee zero CPU cost.
