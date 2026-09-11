# ZenFG visual foundations — Storm & Light

This local visual lab establishes the first shared visual vocabulary. It does
not itself migrate production pages, and it adds no
published API or Snapshot fields.

## Preview and build

From the repository root, with the existing dependencies installed:

```sh
npm run dev:visual-lab
# http://127.0.0.1:5176/visual-lab/

npm run build:visual-lab
# .test-dist/visual-lab/visual-lab/index.html
```

To preview the standalone build, serve the **output root**, not just its HTML
subdirectory, so relative assets resolve:

```sh
node node_modules/vite/bin/vite.js preview --outDir .test-dist/visual-lab --host 127.0.0.1 --port 5178 --strictPort
# http://127.0.0.1:5178/visual-lab/
```

The visual-lab Vite mode uses a separate HTML input and output directory. The
normal `npm run build` and Pages assembly do not include the lab. Build artifacts
and QA images are disposable; the repository test runner clears `.test-dist`,
so rebuild the lab after running that runner.

## Direction

The dark theme follows the blue-gray surfaces of **Tokyo Night Storm**; the
light theme keeps Tokyo Night Light's blue/purple language while making large
surfaces closer to white. Both themes share layout, spacing, typography,
interaction states, and graph meanings.

| Role | Storm | Light |
| --- | --- | --- |
| Workspace / code / graph | `#24283b` | `#f5f6fa` |
| Navigation | `#1f2335` | `#eceef5` |
| Raised panel | `#292e42` | `#ffffff` |
| Main text | `#c0caf5` | `#343b58` |
| Secondary text | `#a9b1d6` | `#59627d` |
| Primary accent | `#7aa2f7` | `#2959aa` |
| Hover surface | `#30374e` | `#e2e6f1` |
| Selected surface | `#2c3855` | `#e1e9f8` |

Hover and selected backgrounds were adjusted to keep foregrounds readable.
Muted UI text and code comments deliberately have more contrast than the
original editor theme. Render stays green, Compute lavender, resources use
distinct colors, and selection uses the primary blue. Node shapes and labels
also convey meaning; color is not the only identifier.

UI fonts use a system stack including Segoe UI and Microsoft YaHei, with no
font downloads. Code uses the platform monospace stack. Body text is 14px,
parameter controls 13px, and the page title 28px. Code is 14px on desktop and
13px at widths up to 800px, always at 1.7 line height. The spacing scale is
4/8/12/16/24/32px; control and panel radii are 6px and 10px.

References:
[Tokyo Night palette](https://github.com/tokyo-night/tokyo-night-vscode-theme#color-palette),
[WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
This is an original application layout and semantic mapping; no theme source,
screenshots, or fonts are redistributed from the reference repository.

## Production adoption

The formal Examples page now consumes these definitions for its shell, Code,
and Tweakpane controls, with explicit Dark / Light selection. The scoped
`apps/site/playground/src/tweakpane.css` adapter inherits palette changes without
remounting controls. The embedded Inspector and standalone Inspector now share these palettes through
CSS variables and the pure `@zenfg/inspector/theme` entry. Site theme adoption
remains separate work. The lab stays independently buildable and excluded
from Pages output. See the [Examples README](../apps/site/playground/README.md).

## Shared definitions and future integration

`@zenfg/inspector/theme` owns the pure `visualThemes` and `visualMetrics` data.
`apps/shared/theme/index.ts` re-exports them and owns
`themeProperties(mode)`, `ThemeMode = 'dark' | 'light'`, and
`applyVisualTheme(container, mode)`. The helper sets `data-theme`, `color-scheme`,
and `--zenfg-*` properties on the supplied container only. It does not touch
the document root, sibling instances, system preferences, or browser storage.

```ts
import { applyVisualTheme } from '../shared/theme/index.ts';

applyVisualTheme(ownedContainer, 'dark');
```

The lab's CSS, Tweakpane custom properties, SVG graph, color swatches, and
custom Shiki theme registrations consume these definitions. Shiki generates
both themes once; changing the container's theme changes colors without
recreating source markup or losing its scroll position. Parameters and graph
selection similarly remain mounted during theme changes.

The published Inspector remains independent of `apps/`. Its pure theme entry
exports official preset objects, and its optional `themes.css` is generated from
the same definitions. The public `--zfgi-*` variables customize both DOM and
graph styles; dynamic external CSS changes use `refreshTheme()`. Host preference
selection and storage remain app-owned. See [Inspector theming](../packages/inspector/THEMING.md).

## What the sample does

- The example-page layout has a collapsible directory, fixed geometric
  illustration, real Tweakpane controls, Inspector/Code tabs with a short graph note,
  and a component gallery. Mobile navigation starts collapsed, and parameters
  move below the illustration. The graph and code scroll inside their regions.
- The illustration and SVG graph are labeled samples, not live GPU results.
  Parameters change local sample values only; reset restores their defaults.
  Other catalog titles are static directory references, not links to missing
  pages in the standalone build; the active sample and foundations anchors work.
- The Code tab displays the exact `minimal-frame.ts` recipe, including its
  introduction. It is explicitly a separate code sample, not the implementation
  of the illustrative Reference Renderer scene. Copy uses the original source.
- The lab starts in Dark (Storm-inspired), with an explicit Light switch. It does not follow
  system appearance or store preferences. Theme changes retain selected graph
  nodes, parameter values, tabs, inputs, and scroll positions.
- The example heading is compact, and the scene directly precedes the tools.
  Desktop scene height adapts to the viewport (340–440px, about 423px at 920px
  tall). Mobile uses 260–340px. The 1277×920 review viewport shows actual graph
  nodes in its first screen. The longer explanation follows the graph.
- Thin scrollbars follow the palette in the directory, code, graph, and page
  viewport. The standalone entry explicitly owns the document's scrollbar
  colors and color scheme; the shared container helper remains isolated.
- The component gallery exercises focus, hover, selection, disabled controls,
  feedback, input, status, and graph colors. Its controls are sample interactions.

## Validation

```sh
npm run typecheck --workspace @zenfg/site-app
npm run build
npm run build:visual-lab
node apps/site/playground/tests/browser/visualLab.mjs
```

The browser script uses an existing Playwright installation. Set
`PLAYWRIGHT_MODULE` to its absolute `index.mjs` path when it is not installed in
this workspace. It uses Edge on Windows and bundled Chromium elsewhere.
`VISUAL_LAB_URL` can point to the standalone build's URL for production QA.

The script checks both themes at 1440, 1277, 1024, and 390px, page overflow, code
typography and actual code colors, semantic token contrast, exact clipboard
content, keyboard tabs and graph selection, real parameter controls/reset,
theme state and scroll preservation, and mobile directory behavior. It writes
full-page and code screenshots plus `report.json` to `.test-dist/visual-lab-qa`.
It needs no WebGPU adapter, model downloads, or external image assets.
