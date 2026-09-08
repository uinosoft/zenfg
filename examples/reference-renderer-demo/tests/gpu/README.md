# Hardware WebGPU checks

Run `node examples/reference-renderer-demo/tests/gpu/run.mjs` with an existing
Playwright installation and a WebGPU-capable browser. On Windows the runner
uses installed Microsoft Edge; elsewhere it uses Playwright Chromium.

`PLAYWRIGHT_MODULE` can point at an external Playwright `index.mjs`, and
`GPU_TEST_BROWSER` can specify a browser executable. No browser automation
package is a production dependency. Results are saved under
`.test-dist/reference-renderer-gpu/result.json`.

The tests run actual WGSL, read back indirect instance counts and image pixels,
and fail on WebGPU validation errors. The indirect-buffer observation is local
to the test recording wrapper; the renderer has no readback or debug API.
