# Hardware WebGPU integration suite

After building the existing workspace packages, run from the repository root:

```powershell
node apps/site/examples/babylon-interop/tests/gpu/run.mjs
```

The runner uses installed Edge on Windows and the standard `playwright`
package. Set `PLAYWRIGHT_MODULE` to an existing Playwright module when using
a bundled runtime outside the workspace, or `GPU_TEST_BROWSER` to select an
existing browser executable. It does not download browsers or accept software
GPU fallback. Do not run concurrently with `npm test`, which clears `.test-dist`.

Results, logs, PNG readbacks and real host snapshots are written to
`.test-dist/babylon-interop-gpu`. The process fails on assertions, validation or
uncaptured GPU errors, page/console errors, missing hardware or timeout.

The suite uses the real Babylon scene, bridge, graph, resolver, Reference
Renderer and host. It checks first forward/reverse frames, repeated frames,
landscape/portrait resize, a vertically asymmetric fixture, both directions of
occlusion with front/back placement swapped, and exactly one sRGB encoding of
known linear Babylon colors. Stable comparisons allow at most one byte per
channel. Only original-scene cross-convention comparisons allow intersection
edges: at most 0.01% of pixels, with each differing color supported by both
images' immediate neighbors within four bytes. Difference images and counts
are saved whenever that allowance is used.

Host coverage includes actual camera wheel input, idle scheduling, resize,
four depth changes retaining the same engine and pose, coalesced snapshots,
pending-capture disposal, startup/active cancellation and actual device loss
triggered through `GPUDevice.destroy()`. Physical adapter removal is not tested.
Instrumentation verifies one Babylon scene render per graph external submission,
zero scene renders during allocation/resize/record/compile and eventual bridge
disposal. Borrowers are destroyed before checking the still-live device; bridge
disposal then destroys that owned device.

Pointer regression coverage checks per-frame camera response, one versus twenty
mouse-move events for the same displacement, batched vertical events, viewport
resize, no inertia after release and pointer/keyboard focus style restoration.
Set `GPU_TEST_DPR=2` to repeat the suite at DPR 2; input sensitivity remains based
on CSS pixels. Mouse move fixtures use `button: -1`, matching real PointerEvents
that do not change button state.

## Built Playground acceptance

After `npm run build:pages`, run `npm run preview:pages` and use:

```powershell
$env:PLAYGROUND_URL = 'http://127.0.0.1:4173/playground/'
node apps/site/examples/babylon-interop/tests/gpu/playground.mjs
```

This uses the same Playwright/browser environment variables. It exercises the
visible Reverse Z checkbox, source files, Inspector, desktop/mobile layouts
and repeated example selection, saving screenshots and `playground-result.json`.
It rejects runtime errors and remote requests. The preview's implicit root
favicon request is answered with 204 by the test because it is not an example
resource. The hardware suite separately checks the actual first presented
canvas pixels after depth changes, before their WebGPU frame texture expires.
