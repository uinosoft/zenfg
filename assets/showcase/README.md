# Real ZenFG showcase captures

The source images are captured from the running Three.js Co-rendering example
using Playwright and hardware WebGPU. The scene and graph are not generated art.

- `three-page.png`: full unmodified example page capture.
- `three-scene.png`: unmodified live canvas element capture.
- `three-graph.png`: unmodified Inspector graph element capture, with Groups
  disabled to show the five individual passes and their declared resources.
- `capture.json`: URL, date, browser version, viewport, actual node IDs, and errors.
- `../../apps/site/public/media/three-co-rendering.png`: 1440 × 720 presentation
  of the two element captures in a labeled layout. The pixels are only scaled
  to fit; no graph nodes, measurements, or rendered objects are invented.

Run `npm run dev`, then `npm run showcase:capture` in a separate terminal.
Set `SHOWCASE_URL` to an alternate Examples URL if needed. Windows uses installed
Edge; other platforms use Playwright Chromium. The capture task requires working
WebGPU. Normal builds consume the checked-in image without launching a browser.

The scene has no remote assets. Cyan geometry belongs to Three.js; orange geometry
and the neutral platform belong to the Reference Renderer. Versions and integration
contracts are documented in the example README.
