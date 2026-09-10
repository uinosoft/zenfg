# Inspector themes

The public styling contract is the `--zfgi-*` CSS custom properties. Inspector
ships complete Tokyo Night Storm defaults, supports partial host overrides, and
does not require a base theme, theme name, registration, or browser storage.
Theme changes are scoped to one Inspector. Snapshot data never contains themes.

## Official presets and custom themes

```ts
import { mountFrameGraphInspector } from '@zenfg/inspector';
import { tokyoNightStorm, tokyoNightLight, type InspectorTheme } from '@zenfg/inspector/theme';

const inspector = mountFrameGraphInspector(host, { theme: tokyoNightLight });
inspector.setTheme(tokyoNightStorm);

const brandTheme: InspectorTheme = {
  ...tokyoNightLight,
  variables: { ...tokyoNightLight.variables, '--zfgi-accent': '#2959aa' },
};
inspector.setTheme(brandTheme);
inspector.setTheme(null); // Restore host CSS and component defaults.
```

Both presets are ordinary immutable `InspectorTheme` objects. The pure `/theme`
entry can be imported without a DOM and does not load Cytoscape or ELK. Hosts
can also use its shared `visualThemes` and `visualMetrics` foundations.

`setTheme()` replaces the API's current variable set on `inspector.dom.style`
and automatically synchronizes the graph. Omitted entries do not retain the
previous preset's colors. Reset restores pre-existing inline declarations and
leaves unrelated styles and subsequently edited declarations alone. Root inline
variables take precedence over inherited host variables, following normal CSS.

`colorScheme: 'dark' | 'light'` maps to `--zfgi-color-scheme`; do not repeat it
inside `variables`. It controls native browser appearance, not palette choice.
The component does not infer light colors from a light background or this hint.

## CSS-only use

Static variables on the host are picked up at mount and graph initialization:

```css
.inspector-host {
  --zfgi-accent: var(--app-accent, #7aa2f7);
  --zfgi-font-ui: system-ui, sans-serif;
  --zfgi-graph-render-stroke: #9ece6a;
}
```

No JS theme call is required. Unspecified variables use CSS fallbacks. The
component does not write a full inline theme during default mounting, so parent
variables inherit normally. Configure dependent overrides on the same container:
CSS custom-property references are resolved where they are declared.

For complete CSS presets, explicitly import the optional stylesheet:

```css
@import '@zenfg/inspector/themes.css';
```

```html
<div class="inspector-host" data-zfgi-theme="tokyo-night-light"></div>
```

The other preset selector is `data-zfgi-theme="tokyo-night-storm"`. The stylesheet
does not select a global theme; declarations only apply to matching containers.
Its values are generated from the same definitions as the JavaScript presets.

## Dynamic CSS and graph synchronization

```ts
host.dataset.zfgiTheme = 'tokyo-night-light';
inspector.refreshTheme();
```

DOM styling updates through CSS. Cytoscape consumes resolved values rather than
browser CSS, so call `refreshTheme()` after changing host variables, classes,
theme attributes, or media-query-dependent values. JS `setTheme()` already does
this. Refresh reads CSS without rewriting variables. No global observers or
polling are installed; hidden graphs also refresh when shown again.

Palette changes keep the graph instance, positions, pan/zoom, selection, group
expansion, current views, filters, detail state, and scroll positions. Graph font
changes update label measurement and layout while preserving zoom and an anchor.

## Supported variables

All names below have the `--zfgi-` prefix. `InspectorThemeVariables` provides
the exhaustive TypeScript key list. Values use CSS syntax: lengths such as
`13px`, font-family stacks, colors including `var()` and `color-mix()`, and
unitless opacity or scale values. Use positive font sizes and widths, opacity
in the range 0–1, and non-negative arrow scale.

| Group | Names after the prefix |
| --- | --- |
| Surfaces | `canvas`, `background`, `surface`, `surface-raised`, `surface-hover` |
| Text and emphasis | `text`, `text-secondary`, `muted`, `accent`, `accent-soft`, `accent-hover` |
| Boundaries and feedback | `border`, `border-subtle`, `border-strong`, `success`, `warning`, `danger`, `shadow`, `backdrop` |
| Typography | `font-ui`, `font-mono`, `font-size`, `font-size-small` |
| Dimensions | `control-height`, `row-height`, `radius-sm`, `radius-md`, `space-1`, `space-2`, `space-3`, `space-4` |
| Native appearance | `color-scheme` (JS uses the separate `colorScheme` field) |
| Graph labels | `graph-text`, `graph-muted`, `graph-font-family`, `graph-font-size` |
| Graph categories | `graph-{category}-stroke`, `graph-{category}-fill` |
| Graph groups | `graph-group-stroke`, `graph-group-fill`, `graph-group-alternate-fill`, `graph-group-opacity`, `graph-group-border-width` |
| Graph relationships | `graph-value`, `graph-ordering`, `graph-read`, `graph-write`, `graph-edge-width`, `graph-edge-opacity`, `graph-ordering-opacity`, `graph-arrow-scale` |
| Graph states | `graph-hover`, `graph-selected`, `graph-hover-width`, `graph-selected-width`, `graph-node-border-width`, `graph-culled-stroke`, `graph-culled-fill` |
| Graph press indicator | `graph-active-bg`, `graph-active-bg-opacity`, `graph-active-bg-size` (radius in CSS pixels, default `12px`; opacity defaults to `0.08`) |
| Derived category fills | `graph-tint` (18% in Storm, 8% in Light) |

Categories are `render`, `compute`, `copy`, `clear`, `command`, `external`,
`declaration`, `output`, `texture`, and `buffer`. Category colors also drive
legends, type labels, and resource bars. Semantic shapes and layout algorithms
are not theme parameters. Hover/selection emphasize outlines without replacing
node shapes or category fills.

The existing `--zenfg-inspector-*` names for background, surfaces, borders,
text, accent, status colors, font families, and radii remain fallback aliases.
When both are supplied, the corresponding new `--zfgi-*` value wins. Internal
`--fgd-*` properties and presentation classes are not the public theme contract.

Official presets target at least 7:1 node-text contrast, 4.5:1 UI text contrast,
and 3:1 identifying borders and edges. Custom colors should preserve these
relationships; theme application does not automatically correct a custom palette.
