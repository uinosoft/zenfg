# Glyph · Mesh

A small three-way typography comparison using Glyph 0.1.0, TypeGPU and the
repository Reference Renderer. Open Examples → Glyph · Mesh.

One retained text object switches Bitmap / MSDF / Slug without resetting its
layout or camera. Drag to orbit, scroll to zoom, or adjust the text plane's
scale and tilt. The Text field accepts literal \\n for line breaks.

## Ownership and reading order

Start with src/main.ts. The host creates one GPUDevice, and TypeGPU wraps it.
Glyph owns fonts, shaping, raster resources and text buffers. Reference Renderer
owns the two opaque meshes. ZenFG owns frame attachments, ordering and submission:

Reference Reset → Cull → Mesh Draw → Glyph Text → Present

Both renderers use forward-Z, one sample and the same rgba16float color and
depth32float depth. Text loads scene color and reads depth without writing it.
Straight-alpha blending preserves the background through glyph holes and edges.
Present converts linear RGB to sRGB once. A single text plane avoids introducing
a separate transparent-object sorting system.

src/glyph.ts uses only the public Glyph and TypeGPU integrations. Private Glyph
resources remain owned by Glyph; the Inspector shows the shared attachments,
not an invented resource graph for internal font buffers.

src/settings.ts maps controls to complete Glyph updates. Changes are coalesced
before the next frame. Orbit/scale/tilt only update the projection uniform.
src/host.ts owns scheduling, abort, visibility suspension, snapshots and teardown.
The catalog adapter owns Tweakpane and source display.

## Font and controls

Inter 4.1, printable ASCII U+0020–007E, is baked into one local GLB:
Bitmap 32/64/128 ppem, MSDF 64 texels/em with range 8, and Slug.
The font source and license are committed; the runtime never downloads a font
or baker from a CDN. Unsupported input remains editable and reports missing glyphs.

Bitmap Auto uses font size and effective pixel ratio (capped at 2 for the canvas).
Fixed strikes express their ppem through rasterPixelRatio. Camera zoom does not
change the strike. MSDF controls use em units: outline and each hard-shadow
offset are limited to 0.03 em, within the baked field's effect budget. Their
settings survive raster switches but are omitted from Bitmap/Slug styles.
Slug exposes no fake quality control; use scale and tilt to inspect its curves.

Regenerate or verify the committed artifact from the repository root:

    node apps/site/examples/glyph-interop/scripts/bake-font.mjs
    node apps/site/examples/glyph-interop/scripts/bake-font.mjs --check

## Validation

    node scripts/run-tests.mjs apps/site/examples/glyph-interop/tests apps/site/playground/tests
    npm run typecheck --workspace @zenfg/site-app
    npm run build:pages
    node apps/site/examples/glyph-interop/tests/gpu/run.mjs
    node apps/site/examples/glyph-interop/tests/gpu/production.mjs

The production suite requires a Site build at /zenfg/ and checks existing
Three.js/TypeGPU examples; Monocular additionally needs its remote model and photo.
The hardware suite records browser/adapter identity, validation failures,
screenshots and real frame snapshots under .test-dist/glyph-interop-gpu.
No production text renderer, runtime baking, multilingual fallback, GPU text
culling or stress benchmark is introduced.
