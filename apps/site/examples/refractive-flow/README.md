# Refractive Flow

Four authored Catmull–Rom surfaces use parallel-transport frames and twelve
peeled films. A tilted front loop folds through depth, with a quieter rear loop,
a rolling plume and a crossing veil. Cross-width corrugation and normals derived
from the actual surface produce changing reflections as the films turn.
The right-hand crossing has a smooth, localized waist: curve centers, film widths
and layer separation converge together without shrinking the open loop.

A compute pass applies analytic curl noise and damped springs. Pointer movement
locally bends the films. Fresnel reflection, a procedural strip-light environment,
approximate RGB dispersion and weighted blended transparency create the optics.
Near surfaces have clear silver-blue reflections; distant ones use broader,
fainter highlights. This is stylized refraction, not ray-traced page content.
Grazing reflections and narrow edge glints strengthen the silhouette. A soft-knee
bloom threshold isolates HDR peaks; selective highlight exposure and a partially
chromatic tone-mapping shoulder keep bright dispersion from washing out to white.

The homepage and `refractive-flow` Examples entry share this native WebGPU
renderer. The homepage uses a bounded hero canvas and luminance limits fitted to
actual text bounds, with soft transitions that preserve the surface's color;
the Examples presents the full composition. The original `interactive-background`
example, its links and the Examples default remain unchanged.

The homepage canvas ends at the responsive content column's right edge (1200px
maximum column width). Its right edge clips directly; its bottom fades into the
page. Extra viewport width adds margins without moving the composition or growing
the render targets.

Mouse position adds a gently damped, depth-dependent viewpoint offset inside those
fixed bounds (about 15px maximum on the foreground). The homepage tracks the hero,
while local surface deformation still tracks the canvas. Leaving returns the view
to center; touch, reduced motion and suspended rendering reset the viewpoint.

The eight actual FrameGraph passes are:

1. Curl and damped spring update.
2. Ribbons and filaments into weighted color, transmittance and HDR highlights.
3. Highlight extraction at half resolution.
4. Bloom downsample to quarter resolution.
5. Bloom downsample to eighth resolution.
6. Bloom reconstruction at quarter resolution.
7. Bloom reconstruction at half resolution.
8. Theme-aware tone mapping and bounded composition.

`captureSnapshot()` captures that graph, including persistent spring state,
transient curve frames and textures. The frame uniform is directly bound.
GPU timestamps are requested only for captures when the adapter supports them.

`setTheme()` updates parameters without rebuilding the device. `setActive()` and
page visibility pause scheduling and settle pending captures. Reduced motion
renders the resting composition only when a frame is needed. Leaving the canvas
or cancelling a touch resets pointer sampling; touch scrolling stays native.

Render targets are capped at 1,000,000 pixels on desktop and 300,000 pixels on
narrow or coarse-pointer hosts, independently of page length. Bloom uses three
smaller levels. During initialization the homepage shows only its background;
the canvas fades in after its first submitted frame. The static SVG is shown only
after initialization failure or device loss, projects the same authored curves and
inherits theme colors. Failures do not auto-retry.

Run the example/lifecycle tests with `npm test -- apps/site/examples/refractive-flow/tests`.
The browser acceptance script is `apps/site/tests/browser/home.mjs`; set
`PLAYWRIGHT_MODULE` to an installed Playwright module and `HOME_URL` to the site.
