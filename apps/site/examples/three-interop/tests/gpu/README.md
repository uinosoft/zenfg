# Hardware WebGPU integration suite

From the repository root, with workspace dependencies and the existing `@zenfg/webgpu` / `@zenfg/snapshot` package outputs available:

```powershell
node apps/site/examples/three-interop/tests/gpu/run.mjs
```

The runner uses installed Edge on Windows and imports the standard `playwright` package. Set `PLAYWRIGHT_MODULE` to an existing Playwright module file when using an installation outside the workspace, such as a bundled runtime installation. Set `GPU_TEST_BROWSER` to override the browser executable when needed. No browser download, software GPU fallback, workspace build, or output-directory cleanup is performed. Avoid concurrent full tests/builds that clean `.test-dist`.

Results, browser logs, PNG readbacks, and actual host snapshots are written to `.test-dist/three-interop-gpu`. The process fails on failed assertions, GPU validation errors, uncaptured GPU errors, browser errors, missing hardware WebGPU, or timeout. Adapter identity and browser version are recorded.

Coverage uses the real runtime bridge, scene, graph, presenter, host and public reference renderer:

- First forward/reverse frames and first landscape/portrait resize frames, compared with repeated frames and the opposite depth convention (maximum one byte per RGBA channel). Only the original demo's cross-convention comparison allows geometric intersection differences: at most 0.01% of pixels, and both differing colors must match the opposite image's immediate 3×3 neighborhood within four bytes. Pixel counts, maximum difference, coordinates, colors and neighborhood checks are recorded; differences above one byte also generate a magenta diff PNG. Fixtures, repeated frames and host switches retain the strict one-byte bound.
- Test-owned overlapping green Three boxes and red reference cubes prove both front/back occlusion directions in 7×7 pixel patches, with the placement also swapped. The original demo scene is checked separately.
- Actual `WebGPURenderer.render` calls are counted and must occur exactly once inside each real graph external submission, never during bridge allocation, resize, recording, or compilation.
- Destroying a bridge twice leaves its borrowed GPU device able to submit and read back a known buffer value.
- Real host orbit input, resize, four depth switches, preserved camera/viewport, image equivalence, coalesced snapshots, shared imported attachments and actual external/render passes.
- Disposal with pending capture, abort before adapter resolution and after real bridge/GPU initialization, active abort, disposal during an asynchronous depth switch, and real `GPUDevice.destroy()` loss notification. Pending captures settle and terminated hosts stop rendering. Physical adapter removal is not simulated.

GPU validation scopes cover every device requested by the suite, including host startup and teardown; uncaptured errors are observed independently. Runtime failures are reported without modifying runtime code.

Verified on 2026-09-08 with Edge 152.0.4191.66 and NVIDIA Turing hardware: 11/11 cases passed, 50 external submissions, zero graph-external renders, 16/16 bridges disposed, and no GPU validation, uncaptured, page or console errors. All comparisons were byte-exact except the original demo at 192×112: one pixel at (105, 56), where the teal cylinder intersects the orange sphere, changed from RGBA `[19, 99, 116, 255]` to `[239, 173, 100, 255]`. This is 1/21,504 pixels (0.00465%), maximum channel difference 220; both colors matched the opposite image's immediate neighbors. The quantitative record is `result.json` → `comparisons.demo-forward-vs-reverse-1`, with `demo-forward-vs-reverse-1-diff.png` highlighting that pixel.
