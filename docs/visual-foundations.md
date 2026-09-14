# ZenFG visual foundations — Storm & Light


These shared design foundations define the production Home, Inspector, and
Examples appearance. Validate visual changes on those pages.

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

UI fonts use the shared system stack including Segoe UI and Microsoft YaHei,
with no font downloads. Code and source filenames use the platform monospace
stack. Typography is role-based; the home hero is a display exception, while
Inspector preserves its compact component scale.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Site body | 14px / 1.5 | 400 |
| Header navigation and shell controls | 13px / 1.4 | 600 navigation; 400 tools |
| Captions, directory entries and metadata | 12px / 1.5 (compact controls 1.4) | 400; 600 section labels |
| Examples page title | 28px / 1.3 at all widths; wraps when needed | 600 |
| Inspector / parameter controls | 13px; Inspector secondary text 12px | Component-owned |
| Code | 14px desktop, 13px up to 800px / 1.7 | Syntax-owned |
| Home display title | Continuous `clamp(66px, 32px + 8.2vw, 150px)` / 1 | 700 |
| Home lead paragraph | 18-25px / 1.55 | 400 |

Site styles consume the canonical body, control, title and code size tokens.
Site-only caption and line-height roles live in the shared shell stylesheet;
these do not extend the published Inspector API. Shell emphasis uses 400/600/700.
Home eyebrow and footer text use 12px even on mobile; Chinese eyebrows have
normal letter spacing, while English keeps its uppercase tracking. The header
brand remains 20px (18px up to 800px), weight 700. Graph labels retain their
independent zoom-aware sizing. Dark and Light use identical typography.

The spacing scale is 4/8/12/16/24/32px; control and panel radii are 6px and 10px.

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
CSS variables and the pure `@zenfg/inspector/theme` entry. Home now shares the
same palettes, a common site header, and the site-wide Dark / Light preference.
Its Dark background retains the interactive showcase behind a Storm-colored
contrast layer; Light uses static grids and gradients without initializing GPU
resources. See the [Site shell documentation](../apps/site/README.md#shared-site-shell)
for component ownership, migration and lifecycle behavior.

## Shared definitions and site integration

`@zenfg/inspector/theme` owns the pure `visualThemes` and `visualMetrics` data.
`apps/site/shared/theme/index.ts` re-exports them and owns
`themeProperties(mode)`, `ThemeMode = 'dark' | 'light'`, and
`applyVisualTheme(container, mode)`. The helper sets `data-theme`, `color-scheme`,
and `--zenfg-*` properties on the supplied container only. It does not touch
the document root, sibling instances, system preferences, or browser storage.

```ts
import { applyVisualTheme } from '../shared/theme/index.ts';

applyVisualTheme(ownedContainer, 'dark');
```

The Examples CSS, Tweakpane adapter, and Shiki theme registrations consume
these definitions. Both code themes are generated together, so switching the
container theme preserves source markup and scroll position.

The published Inspector remains independent of `apps/`. Its pure theme entry
exports official preset objects, and its optional `themes.css` is generated from
the same definitions. The public `--zfgi-*` variables customize both DOM and
graph styles; dynamic external CSS changes use `refreshTheme()`. Host preference
selection and storage remain app-owned. See [Inspector theming](../packages/inspector/THEMING.md).

## Validation

```sh
npm run typecheck
npm test
npm run build:site
```

Node tests cover shared theme isolation, palette contrast, preference handling,
and page lifecycle behavior. Review the production Home, Inspector, and
Examples in both themes for layout, focus, code readability, and responsive
behavior using the [Site validation guidance](../apps/site/README.md#shared-site-shell).
