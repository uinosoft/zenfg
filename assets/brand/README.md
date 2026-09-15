# ZenFG brand assets

The approved identity is **Connected Z**: four corner nodes and one center node
on a Z-shaped connection, with two partial frame edges. The center node is
essential to the identity.

## Sources and provenance

- `design/approved-concept.png`: approved original raster concept, generated
  with the built-in ImageGen tool on 2026-09-15. Retained for design history;
  do not crop it into production icons.
- `zenfg-mark.svg`: editable, manually reconstructed vector master. Geometry
  uses a 128 × 128 grid, 12-unit connections, 22-unit corner nodes and a
  20-unit center node. This is the source of truth for production marks.
- `../../scripts/build-brand.mjs`: generation recipe for
  color variants, wordmarks, PNGs, ICO and the visual proof sheet.
- `preview.html` / `preview.png`: review the actual exported artwork and
  native-size 16–128px icon previews.

The approved concept prompt was to preserve the compact framed Z, add an
axis-aligned square node at the center of its diagonal, keep all four corner
nodes, and apply that five-node design consistently to the wordmark,
monochrome, reversed and app-icon examples. The vector master regularizes
the generated geometry and removes raster texture.

## Files and placement

| Location | Purpose |
| --- | --- |
| `zenfg-mark.svg` | Blue standalone master, transparent background |
| `zenfg-mark-dark.svg`, `zenfg-mark-white.svg` | Single-color variants |
| `zenfg-lockup-light.svg`, `zenfg-lockup-dark.svg` | Horizontal logo with wordmark |
| `zenfg-icon.svg` | Square project/avatar icon with rounded navy background |
| `exports/` | PNG icons at 16, 24, 32, 48, 64, 128, 256, 512 and 1024px, transparent mark and wordmarks |
| `../../apps/site/public/` | Website favicon SVG/ICO/PNG, Apple touch icon, manifest and 192/512px icons |
| `../../apps/docs/public/` | Generated copies for independently served documentation |

The site, Inspector and Playground share the site public assets. Documentation
uses its own generated copies, including in standalone docs development.
The repository READMEs display centered 280 × 73px horizontal wordmarks,
with picture sources for dark and light color schemes. The branded header,
badges, quick links and language links form one presentation block; the docs
projection omits this block and retains the article below it. For an external
repository/social avatar, use `exports/zenfg-icon-512.png`; repository files
do not automatically update account avatars on hosting services.

## Colors and usage

- Primary blue: `#7AA2F7`, preferred on navy.
- Navy: `#24283B`.
- Light-background accent: `#416BC4`.
- Light wordmark on dark: `#C0CAF5`; reversed mark: `#FFFFFF`.
- Keep a clear area of at least one corner-node width around the visible mark.
  Background tiles include their own padding.
- Use the complete mark at 48px and above. At 16–32px, the generated favicon
  removes the two partial side strokes while retaining all five nodes.
- Do not stretch, rotate, add gradients or remove the center node.
- Website navigation keeps accessible live text and a decorative mark with
  empty alt text. Standalone images should have the accessible name ZenFG.
- Exported SVG wordmarks retain editable Arial Bold text, with Helvetica and
  sans-serif fallbacks. PNG wordmarks freeze the rendered appearance. The
  website retains its existing theme font.

## Regeneration

Run `npm run brand:build` from the repository root after modifying the master
or generation recipe. The script uses the existing Playwright dependency:
Windows defaults to installed Microsoft Edge; other platforms use Playwright
Chromium. Set `BRAND_BROWSER_CHANNEL` to override the browser channel.

Commit the master, generator and generated outputs together. Normal site builds
consume the checked-in exports and do not require raster generation. Do not edit
copies in public directories by hand. The PNG-backed ICO contains 16, 32 and
48px frames. Apple touch icons use an opaque square background so the platform
can apply its own corner mask. The manifest declares ordinary browser display;
it does not add offline support.
