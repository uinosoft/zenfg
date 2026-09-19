# Third-party notices

The integration follows the public TypeGPU example in pmndrs/glyph 0.1.0,
commit 2d543ee:
https://github.com/pmndrs/glyph/tree/2d543ee/apps/typegpu-hello-world
Glyph is used as an MIT-licensed npm dependency; its renderer is not vendored.
The original composition, host and controls live in this repository.

Inter 4.1 by Rasmus Andersson is distributed under SIL Open Font License 1.1.
The complete license is in assets/Inter-LICENSE.txt and ships with the Site build.
The input font is from the pinned Glyph fixture:
https://github.com/pmndrs/glyph/blob/2d543ee/benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf
SHA-256: 40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82

assets/inter-latin.font.glb is generated using Glyph 0.1.0 from that input.
The bake script records all subset and raster settings and verifies the input hash.
Camera and presentation helpers are adapted from ZenFG's existing reference
renderer and Three.js interop showcases; no external engine is imported.
