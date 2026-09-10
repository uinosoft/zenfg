# ZenFG Examples (Playground workspace)

The Examples page is a private static application deployed at `/playground/`.
A collapsible grouped directory sits beside a naturally scrolling page:
canvas and parameters with runtime status first, then the title, optional brief
description and topic tags, followed by the Inspector / Code workbench.
The public route and example IDs retain their existing names.

The local Storm / Light visual prototype is available with
`npm run dev:visual-lab` at `http://127.0.0.1:5176/visual-lab/`. It is excluded
from normal production builds. See [visual foundations](../../docs/visual-foundations.md)
for the independent build, shared tokens, and browser acceptance workflow.

```sh
npm install
npm run dev:playground
npm run build --workspace @zenfg/playground-app
```

Run these commands from the repository root. Repeat `npm install` after pulling
or rebasing changes that add example workspaces, so npm creates their local
package links before Vite scans the catalog imports.

For the integrated Site, Inspector, and Playground development workflow, see
the website development section in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

Production examples are explicitly registered in `src/catalog/catalog.ts` and
grouped as repository showcases or `@zenfg/webgpu` basics. Catalog adapters own
Playground metadata, source display, WebGPU hosting, and Inspector wiring;
example implementations must not import Playground code.

## Layout and appearance

Dark (Storm-inspired) and Light use the shared visual foundations. The page
remembers the explicit choice in `zenfg-playground-theme` local storage, defaults
to Dark, and still switches when storage is unavailable. This preference is
specific to Examples; system appearance and cross-app synchronization are deferred.

The page shell, Code, and Tweakpane controls switch themes together. The scoped
`src/tweakpane.css` adapter maps Tweakpane 4 properties to shared palette tokens,
including folders, inputs, buttons, sliders, checkboxes, and read-only monitors.
Controls use 13px UI text, 28px rows, and visible keyboard focus. Changing theme
preserves mounted controls, values, folder state, and parameter scroll position;
newly loaded panes inherit the saved choice. The embedded Inspector retains its
existing dark appearance. Canvas output does not change with the page theme.

Inspector opens by default and captures a real frame. Explicit `panel=code`
and `panel=inspector` URLs select the active tool; legacy `panel=none`, missing
or invalid panel values open Inspector. The workbench always has an open tab;
re-selecting it keeps it open. Expand reuses the same tools;
Escape restores the page, focus and scroll position. Theme changes, tabs and
expansion preserve the source selection, parameters, snapshot and graph viewport.
Example links continue to navigate to a new page and preserve the active panel.

Showcases starts expanded; basics starts collapsed unless it contains the current
example. The directory starts collapsed at 800px or below. The canvas uses a stable
4:3 aspect ratio at every viewport, sized from available width within the bounded
content column. A 16px gap separates the canvas from the parameter panel.
Live examples use two titleless Tweakpane instances inside one shared border:
a page-owned FPS monitor with a native history graph at the top and
example-owned parameters below it. Only the parameter host scrolls, so FPS stays visible while adjusting
long panes. The entire region follows normal page scrolling. Internal folders
retain native folding animations; there is no root collapse button.
A ResizeObserver limits the combined region to the canvas border-box height on
desktop, including after directory and viewport changes. Mobile retains a 340px
combined limit. Short panes use natural height. The observer and monitor are
disposed with the page.
Static explanations and renderer color legends belong in the example description. Particles4All statistics
are read-only monitors in a collapsed Statistics folder. Hidden file inputs are
implementation details, not visible content alongside the pane. Babylon Lite has
no adjustable parameters and shows only the compact FPS pane. Static recipes
without parameters or continuous rendering have no right-hand column.

A compact, non-interactive badge overlays the canvas's bottom-left corner only
for loading, pause, warnings and errors. Healthy Live and Ready states hide it.
It retains readable dark styling in both shell themes and lets pointer input
pass through. Longer loading, warning and error details appear
below the canvas. The introduction follows the demo: title, description and tags.
On mobile, parameters move below the canvas and any runtime details.

Live examples calculate FPS from the interval between successive successful render
submissions. The curve updates on every submitted frame; the number uses a
500ms rolling average, refreshed every 250ms. The average divides the number
of intervals by their total duration, including the interval crossing the window
boundary. Pause and resume reset the averaging window. This is render frequency,
not GPU timing or model inference frequency.
Loading, errors, pause and background suspension reset its sample and display
`—` in the monitor; on-demand examples clear stale readings after 1.5 seconds
without a frame. Static Ready recipes do not create a monitor.
Returning or resuming waits for a fresh sample. Private example hosts expose
optional observational frame notifications; published package APIs and snapshots
remain unchanged.

The fixed FPS region is 70px tall: current value above the latest 120 rendered
frame intervals (roughly two seconds at 60 FPS). The full empty graph and `—`
appear before the first valid sample. It freezes during pauses or missing
readings, without inserting zeroes. Resizing redraws frozen history without
adding samples. Its vertical range starts at 0–120 FPS and grows for higher
frame rates.
Frame callbacks feed both calculations. A shared 250ms timer publishes the average
and clears stale readings; it never appends graph history.

Code uses the same Shiki theme definitions as the visual lab, registering both
TypeScript and JavaScript. Dual-theme markup changes colors without remounting;
failed highlighting leaves the exact source readable and copyable.

Run `node apps/playground/tests/browser/layout.mjs` against the same Pages preview
and Playwright configuration described below. It checks both themes at 1440,
1277, 1024 and 390px, real captured graph nodes,
Tweakpane colors and Inspector style isolation, graph/parameter/source retention,
keyboard controls,
theme persistence and storage failure, unknown examples, and Code without WebGPU.
Reports and screenshots go to `.test-dist/examples-layout`.
`node apps/playground/tests/browser/runtimeStatus.mjs` additionally checks live FPS,
pause/resume, BFCache suspension, fixed FPS during parameter scrolling, native
folder folding, and combined height limits across viewport and directory changes.
It uses the same preview and Playwright settings; its
Monocular checks need network access to the public model and demo photo. Reports
and screenshots go to `.test-dist/examples-status`.

## Example information

Catalog definitions use stable `tags` IDs from `exampleTags.ts`; labels share a
single vocabulary for future search and filtering. Tags are currently descriptive,
not buttons. Keep implementation counts out of tags. The page shows tags after
the optional description; the former summary field has been removed.

The canvas badge shows Loading, Live (running showcases), Paused, Ready
(one-shot recipes), or Error. Loading stages and optional `loadingNote` appear
below the canvas while preparation is underway. Errors show their full message
there and preserve any last rendered frame. `onWarning` reports a nonfatal
limitation, including during initial loading, and preserves rendering; undefined
clears it. Warnings survive the first ready notification.
GPU Timing uses this for unavailable timestamps, while preserving rendering and
capture. Numeric timing results appear next to the Inspector.

Use optional `description` for a brief introduction below the demo, and optional
`graphHint` for an observation beside the Inspector. Empty hints occupy no space.
Model sizes and download requirements belong to loading feedback, not controls.
Published Inspector APIs and Snapshot data remain unchanged.

## Code reading entries

Every catalog definition must set `entrySourceId` to exactly one of its source
file IDs. Code puts that file first, marks it **Entry**, and opens it initially;
the default does not depend on array order. Duplicate IDs and missing entries
are catalog errors. All buttons are available while source highlighting loads.
Switching away from Code and back keeps the selection; changing files resets
scrolling. Delayed highlighting preserves the position already reached in raw source.

Repository showcases use their actual `src/main.ts` as the reading entry.
Reference Renderer uses the demo package's entry, not the reusable renderer.
Package basics keep their topic-named recipe files. Source lists explicitly
follow this reading order: entry, core implementation, supporting modules,
shaders, browser host, and Playground adapter. Compatibility forwarding files
are not useful reading tabs; display the implementation they forward to.

Entries begin with a short English block comment containing `Source:`,
`Demonstrates:`, `Flow:`, and `Read next:`. Attribution must match the example's
README and third-party notices. Raw imports display and copy these exact source
files, including their introductions; do not inject a separate tutorial snippet.

When registering an example, add its entry and real supporting files, and run
the catalog/source-view tests. Code uses 14px text on desktop and 13px on mobile,
with 1.7 line height, horizontal code scrolling and a scrollable file list.

For browser acceptance, build with `npm run build:pages`, serve `.pages` using
Vite preview on port 4175, then run
`node apps/playground/tests/browser/sourceView.mjs` from the repository root.
`PLAYWRIGHT_MODULE` can point to an existing Playwright installation;
`PLAYGROUND_URL` and `GPU_TEST_BROWSER` override the preview and browser.
The suite checks all 16 entries, desktop/mobile typography, exact source copying
(allowing platform clipboard line endings), selection, scrolling and real
Inspector exports. It requires hardware WebGPU and network access for Monocular's
model and demo image. Results and screenshots go to `.test-dist/playground-source`.

The Particles4All showcase lives in `examples/particles4all-framegraph` and is
available at `?example=particles4all-framegraph`. It retains upstream fluid and
rigid-body simulation, Particles / Surface mesh / Ray march / SSFR rendering,
presets, INI import, and panorama upload. Its host submits native ZenFG work
directly to the canvas with the upstream depth convention. Scene controls are
expanded, advanced simulation and rendering controls are folded, and live
statistics appear in its collapsed Statistics folder. The bundled HDR loads in
the background; panorama or configuration failures are recoverable and appear
in runtime feedback below the canvas.
JavaScript shader source tabs display the vendored files actually used at runtime.

The Monocular Light Injection showcase lives in
`examples/typegpu-monocular-light-injection`. It lazy-loads TypeGPU inference,
offers optional camera/image input and model controls, and reports download and
compilation progress through the mount context's optional `onLoading` callback.
The optional mount `signal` cancels initialization and releases browser resources
when the page is discarded. Existing examples may omit both fields.
Once an example has rendered, later loading or error messages keep its last
frame visible so recoverable model/source failures do not blank the stage.

`captureSnapshot()` requests the next real rendered frame. A runtime that is
still preparing its model or input retains the request through those stages,
so the Inspector's initial capture can complete without a manual retry.
Failures, page suspension, and disposal settle pending requests with no snapshot;
callers can request another capture after recovery. Capturing does not force
extra inference or synthesize a frame graph for display.

Package recipes are executed from `packages/webgpu/examples` and displayed from
the same files through Vite raw imports. Their `record*` functions let the
Playground request compilation reports without changing the normal recipe
execution path. Adapter, host, and shader files appear as secondary source tabs
so the boundary remains visible.
