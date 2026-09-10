import { visualThemes, visualMetrics, type ThemeMode } from './themePalette.ts';

export const graphCategories = ['render', 'compute', 'copy', 'clear', 'command', 'external', 'declaration', 'output', 'texture', 'buffer'] as const;

export function createThemeVariables(mode: ThemeMode) {
    const p = visualThemes[mode];
    const dark = mode === 'dark';
    const tint = dark ? '18%' : '8%';
    const categoryVariables = Object.fromEntries(graphCategories.flatMap(kind => [
        [`--zfgi-graph-${kind}-stroke`, p[kind]],
        [`--zfgi-graph-${kind}-fill`, `color-mix(in srgb, var(--zfgi-graph-${kind}-stroke, ${p[kind]}) var(--zfgi-graph-tint, ${tint}), var(--zfgi-canvas, ${p.canvas}))`],
    ])) as Record<`--zfgi-graph-${typeof graphCategories[number]}-${'stroke' | 'fill'}`, string>;
    return {
        '--zfgi-canvas': p.canvas,
        '--zfgi-background': p.panel,
        '--zfgi-surface': p.inset,
        '--zfgi-surface-raised': p.panel,
        '--zfgi-surface-hover': p.hover,
        '--zfgi-border': p.border,
        '--zfgi-border-subtle': p.divider,
        '--zfgi-border-strong': p.border,
        '--zfgi-text': p.text,
        '--zfgi-text-secondary': p.secondary,
        '--zfgi-muted': p.muted,
        '--zfgi-accent': p.accent,
        '--zfgi-accent-soft': p.accentSoft,
        '--zfgi-accent-hover': p.hover,
        '--zfgi-success': p.success,
        '--zfgi-warning': p.warning,
        '--zfgi-danger': p.danger,
        '--zfgi-shadow': dark ? '0 8px 24px #0006' : '0 8px 24px #343b5826',
        '--zfgi-backdrop': dark ? '#13172899' : '#343b5840',
        '--zfgi-font-ui': visualMetrics.fontUi,
        '--zfgi-font-mono': visualMetrics.fontMono,
        '--zfgi-font-size': '13px',
        '--zfgi-font-size-small': '12px',
        '--zfgi-control-height': '32px',
        '--zfgi-row-height': '36px',
        '--zfgi-radius-sm': '6px',
        '--zfgi-radius-md': '10px',
        '--zfgi-space-1': '4px',
        '--zfgi-space-2': '8px',
        '--zfgi-space-3': '12px',
        '--zfgi-space-4': '16px',
        '--zfgi-graph-tint': tint,
        '--zfgi-graph-text': dark ? '#d5ddff' : p.text,
        '--zfgi-graph-muted': p.muted,
        '--zfgi-graph-font-family': `var(--zfgi-font-mono, ${visualMetrics.fontMono})`,
        '--zfgi-graph-font-size': '13px',
        '--zfgi-graph-node-border-width': '1.25px',
        '--zfgi-graph-group-border-width': '1.5px',
        '--zfgi-graph-edge-width': '1.5px',
        '--zfgi-graph-edge-opacity': '1',
        '--zfgi-graph-ordering-opacity': '1',
        '--zfgi-graph-group-opacity': '1',
        '--zfgi-graph-arrow-scale': '0.8',
        '--zfgi-graph-hover-width': '2.5px',
        '--zfgi-graph-selected-width': '3px',
        '--zfgi-graph-selected': `var(--zfgi-accent, ${p.accent})`,
        '--zfgi-graph-hover': dark ? '#d5ddff' : '#343b58',
        '--zfgi-graph-active-bg': `var(--zfgi-graph-text, ${dark ? '#d5ddff' : p.text})`,
        '--zfgi-graph-active-bg-opacity': '0.08',
        '--zfgi-graph-active-bg-size': '12px',
        '--zfgi-graph-group-stroke': p.group,
        '--zfgi-graph-group-fill': dark ? '#292e42' : '#eceef5',
        '--zfgi-graph-group-alternate-fill': dark ? '#30364b' : '#e5e9f3',
        '--zfgi-graph-value': p.edge,
        '--zfgi-graph-ordering': p.edge,
        '--zfgi-graph-read': p.buffer,
        '--zfgi-graph-write': p.warning,
        '--zfgi-graph-culled-stroke': p.muted,
        '--zfgi-graph-culled-fill': p.inset,
        ...categoryVariables,
    };
}

export const stormVariables = createThemeVariables('dark');
export const lightVariables = createThemeVariables('light');

// Existing public aliases only. Internal layout variables are deliberately excluded.
export const legacyThemeAliases: Record<string, string> = Object.fromEntries([
    'background', 'surface', 'surface-raised', 'surface-hover', 'border', 'border-subtle',
    'border-strong', 'text', 'text-secondary', 'muted', 'accent', 'accent-soft', 'accent-hover',
    'success', 'warning', 'danger', 'font-ui', 'font-mono', 'radius-sm', 'radius-md',
].map(name => [`--zfgi-${name}`, `--zenfg-inspector-${name}`]));

export function internalThemeProperty(property: string): string {
    return property === '--zfgi-background' ? '--fgd-panel' : property.replace('--zfgi-', '--fgd-');
}

export function themeFallback(property: string, value: string): string {
    const legacy = legacyThemeAliases[property];
    return `var(${property}, ${legacy ? `var(${legacy}, ${value})` : value})`;
}

export const themeDefaultsCss = Object.entries(stormVariables)
    .map(([property, value]) => `${internalThemeProperty(property)}: ${themeFallback(property, value)};`).join('\n');

export function themePresetCss(): string {
    return '/* Generated from Inspector theme definitions. */\n' + ([
        ['tokyo-night-storm', 'dark', stormVariables], ['tokyo-night-light', 'light', lightVariables],
    ] as const).map(([name, scheme, variables]) => `[data-zfgi-theme="${name}"] {\n  --zfgi-color-scheme: ${scheme};\n${Object.entries(variables).map(([key, value]) => `  ${key}: ${value};`).join('\n')}\n}`).join('\n');
}
