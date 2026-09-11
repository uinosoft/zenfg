# Hardware WebGPU acceptance

Run from the repository root with an installed hardware-capable browser:

```sh
node apps/site/examples/babylon-lite-interop/tests/gpu/run.mjs
```

The runner uses Playwright (`PLAYWRIGHT_MODULE` can name its absolute module path),
Edge on Windows, and a real WebGPU adapter. `GPU_TEST_BROWSER` overrides the browser
executable and `GPU_TEST_DPR=2` checks the second backing scale. Software adapters
are rejected. The suite bundles only its entry and does not build the workspace.

It validates gamma decoding, background color, asymmetrical orientation markers,
bidirectional depth occlusion with exchanged front/back fixtures, first/repeated
frames, landscape/portrait resize, snapshots, idle rendering, orbit/zoom inputs,
preparation cancellation, disposal and actual device loss. It instruments native
Lite frame command encoders as well as ZenFG's external callbacks. Synthetic
pointer tests bypass browser pointer-capture eligibility only; rendering is real.

Results, PNGs, pixel comparisons, logs and snapshots are written under
`.test-dist/babylon-lite-interop-gpu/`. Save each DPR's result before the next run.

After `npm run build:pages`, run `npm run preview:pages` and use:

```sh
node apps/site/examples/babylon-lite-interop/tests/gpu/playground.mjs
```

`PLAYGROUND_URL` defaults to `http://127.0.0.1:4173/playground/`. This checks actual
mouse input and pointer capture, depth description without settings, source tabs,
Inspector JSON export, mobile layout and switching between all three interop
examples and the Reference Renderer. It rejects remote asset requests and browser
errors. The runner saves desktop/mobile/Inspector screenshots for visual review.
