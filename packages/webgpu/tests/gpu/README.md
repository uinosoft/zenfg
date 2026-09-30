# Runtime GPU acceptance

Optional manual checks through the public package entry point:

- Clear an imported buffer's logical 64-byte range while preserving the rest of its native 128-byte allocation.
- Retain initialization for a texture-to-buffer copy and verify row padding is zero on readback.
- Submit 2049 timed nodes in `both` mode, report `too-many-timed-nodes`, preserve CPU timing, and successfully time a subsequent small graph.

From the repository root, run `npm run build:packages`, then `node packages/webgpu/tests/gpu/run.mjs`.
The script uses the workspace's Playwright installation and Microsoft Edge on Windows, matching the existing example GPU suites. Set `GPU_TEST_BROWSER` to another Chromium executable or `PLAYWRIGHT_MODULE` to an external Playwright module if needed. A real WebGPU adapter with `timestamp-query` is required; the suite fails clearly when it is unavailable. Results are saved under `.test-dist/webgpu-runtime-gpu/result.json`.

This is a local hardware acceptance script, not part of the Node unit suite or a new CI platform.
