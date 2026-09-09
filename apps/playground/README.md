# ZenFG Playground

The Playground is a private static application deployed at `/playground/`. It
keeps a live example as the stage and opens source code or the embedded
FrameGraph Inspector in an overlay above it.

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

## Code reading entries

Every catalog definition must set `entrySourceId` to exactly one of its source
file IDs. Code puts that file first, marks it **Entry**, and opens it initially;
the default does not depend on array order. Duplicate IDs and missing entries
are catalog errors. All buttons are available while source highlighting loads.
Closing and reopening Code keeps the selection; changing files resets scrolling.

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
statistics appear below the pane. The bundled HDR loads in the background;
panorama or configuration failures are recoverable and appear in the controls.
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
