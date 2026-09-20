# Portal Lens hardware checks

Run from the repository root:

```sh
node apps/site/examples/pixi-interop/tests/gpu/run.mjs
npm run build:pages
node apps/site/examples/pixi-interop/tests/gpu/production.mjs
```

The first runner bundles a separate browser entry with esbuild, serves the local
map and launches headless Edge on Windows (Chromium elsewhere). Set
`GPU_TEST_BROWSER` to use another browser executable. Unavailable hardware
fails rather than silently passing.

Checks include real color bytes, displaced pixels on both sides of the portal,
texture replacement, DPR, borrowed ownership and the public host's Snapshot,
visibility, cancellation, repeated disposal and device-loss behavior.
Playwright supplies trusted mouse input. Validation scopes cover every requested
device; uncaptured, page and console errors are reported, with warnings retained.

The production runner checks the built Examples page, source reader, Inspector,
packaged local map, narrow layout and repeated navigation. Results and PNGs
are written under `.test-dist/pixi-interop-gpu/`. Runtime code has no readback,
test globals, special rendering path or hidden controls.