# Validation

Verified on 2026-09-20 with Node 24.19.0, npm 11.17.0, Edge 153.0.4234.32
and an NVIDIA Turing WebGPU adapter.

| Check | Result |
| --- | --- |
| `npm test` | 729 passed |
| `npm run typecheck` | Passed |
| `npm run build:pages` | Passed; 190 built HTML pages verified |
| `npm run docs:check` | Passed |
| Hardware runner | 10 scenarios passed |
| Production browser runner | 5 scenarios passed |

The viewport ownership and image-quality adjustments were checked with the site
typecheck, site build, hardware suite and production browser suite.

Hardware scopes covered every requested device, including initialization and
teardown. There were no GPU validation errors, uncaptured errors, page errors
or console errors. The scene's known clear color was exactly RGB [24, 40, 53],
matching one sRGB conversion. The lens changed 790 pixels inside the 3D region
and 972 pixels outside it in the measured interior of the lens, with an
8-channel-value difference threshold.

Other checks cover current-frame texture replacement, wide resize at DPR 1.25, DPR 2, shared-device and
texture survival after Pixi disposal, Snapshot capture, page suspension/resume,
cancellation during async startup, repeated disposal, and device loss.
Trusted Playwright input verifies lens/camera arbitration, wheel zoom, buttons,
blur and releasing a drag outside the canvas.

Production checks exercise the actual catalog, displayed entry source, Inspector,
local displacement asset under the deployment prefix, narrow layout and
navigation away from and back to the example. Desktop and mobile canvas
screenshots were visually inspected. The quality update enables Pixi MSAA on both
the canvas and filter input, renders the 3D image at 2x scale, and uses 1.5x
filter resolution. Before/after hardware screenshots showed smoother portal,
orbit and lens edges; the graph still contained exactly four nodes.

## Known upstream diagnostics

Pixi 8.21.0 emits BindGroup warnings during resource teardown:
textureSource, textureSampler and bufferResource were destroyed while bound.
They are retained in test output, not suppressed. The version's
[getTextureBatchBindGroup cache](https://github.com/pixijs/pixijs/blob/v8.21.0/src/rendering/batcher/gpu/getTextureBatchBindGroup.ts)
holds module-level groups, and its
[FilterSystem](https://github.com/pixijs/pixijs/blob/v8.21.0/src/filters/FilterSystem.ts)
retains a global filter group referencing the uniform batch resources.
The public disposal path does not clear all of these references before the
resources announce destruction. The example uses normal public destruction
APIs and does not patch private Pixi caches. Borrowed-resource survival and
GPU validation were checked independently.

The production page also reports the Inspector's existing custom wheel
sensitivity warning. Build output includes the repository's large-chunk
advisory. Neither is hidden or treated as a GPU success signal.

Runners write measurements, warning lists, screenshots and snapshots to
`.test-dist/pixi-interop-gpu/`. This is ignored test output and can be regenerated
using the commands in the [GPU test README](tests/gpu/README.md).