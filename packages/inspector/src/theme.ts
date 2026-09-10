/** Pure theme data for CSS and JavaScript hosts; safe to import without a DOM.
 * @packageDocumentation
 */
import { stormVariables, lightVariables } from './themeDefinitions.ts';

export { visualThemes, visualMetrics } from './themePalette.ts';
export type { ThemeMode, VisualPalette } from './themePalette.ts';

/** Public CSS custom properties. Missing values inherit from the host or use Storm defaults. */
export type InspectorThemeVariables = { readonly [Key in keyof typeof stormVariables]: string };

/** A partial or complete theme; no name, registration, or base preset is required. */
export interface InspectorTheme {
    /** Browser appearance for native controls; mapped to `--zfgi-color-scheme`. Does not select a palette. */
    readonly colorScheme?: 'dark' | 'light';
    /** CSS values keyed by the documented `--zfgi-*` custom property names. */
    readonly variables?: Readonly<Partial<InspectorThemeVariables>>;
}

/** Complete Tokyo Night Storm preset; also the component's CSS fallback appearance. */
export const tokyoNightStorm: InspectorTheme = Object.freeze({ colorScheme: 'dark', variables: Object.freeze(stormVariables) });

/** Complete Tokyo Night Light preset, including the graph and native control appearance. */
export const tokyoNightLight: InspectorTheme = Object.freeze({ colorScheme: 'light', variables: Object.freeze(lightVariables) });
