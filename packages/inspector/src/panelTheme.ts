import type { InspectorTheme, InspectorThemeVariables } from './theme.ts';
import { internalThemeProperty, stormVariables } from './themeDefinitions.ts';
import { createGraphVisualTheme, defaultThemeValue, type GraphVisualTheme } from './panelVisualTheme.ts';

/** Own only declarations written by this API, restoring pre-existing inline styles on reset. */
export class InspectorThemeController {
    private readonly owned = new Map<string, { previous: string; priority: string; applied: string }>();
    constructor(private readonly root: HTMLElement) {}

    apply(theme: InspectorTheme | null): void {
        const style = this.root.style;
        for (const [key, entry] of this.owned) {
            if (style.getPropertyValue(key) !== entry.applied || style.getPropertyPriority(key)) continue;
            if (entry.previous) style.setProperty(key, entry.previous, entry.priority);
            else style.removeProperty(key);
        }
        this.owned.clear();
        const entries = Object.entries(theme?.variables ?? {}).filter(([key]) => Object.hasOwn(stormVariables, key));
        if (theme?.colorScheme) entries.push(['--zfgi-color-scheme', theme.colorScheme]);
        for (const [key, value] of entries) {
            if (typeof value !== 'string') continue;
            const previous = style.getPropertyValue(key);
            const priority = style.getPropertyPriority(key);
            style.setProperty(key, value);
            this.owned.set(key, { previous, priority, applied: style.getPropertyValue(key) });
        }
    }

    destroy(): void { this.owned.clear(); }
}

/** Resolve through the DOM once per refresh, including var(), color-mix(), and CSS lengths. */
export function resolveGraphTheme(root: HTMLElement): GraphVisualTheme {
    const document = root.ownerDocument;
    const view = document?.defaultView;
    if (!view || !root.isConnected) return createGraphVisualTheme();
    const styles = view.getComputedStyle(root);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;';
    probe.setAttribute('aria-hidden', 'true');
    root.appendChild(probe);
    const cache = new Map<string, string>();
    let context: CanvasRenderingContext2D | null | undefined;
    const color = (value: string): string | undefined => {
        probe.style.color = '';
        probe.style.color = value;
        if (!probe.style.color) return undefined;
        const resolved = view.getComputedStyle(probe).color;
        if (/^(#[\da-f]{3,8}|rgba?\([\d.,\s]+\))$/i.test(resolved)) return resolved;
        // Normalize newer CSS color spaces into sRGB supported by Cytoscape.
        if (context === undefined) {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            context = canvas.getContext('2d', { willReadFrequently: true });
        }
        if (!context) return undefined;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = resolved;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return `rgba(${r}, ${g}, ${b}, ${a! / 255})`;
    };
    const read = (key: keyof InspectorThemeVariables): string => {
        const cached = cache.get(key);
        if (cached !== undefined) return cached;
        const value = styles.getPropertyValue(internalThemeProperty(key)).trim() || defaultThemeValue(key);
        let result = value;
        if (key.endsWith('font-family')) {
            probe.style.fontFamily = value;
            result = view.getComputedStyle(probe).fontFamily;
        } else if (key.endsWith('size') || key.endsWith('width')) {
            probe.style.fontSize = ''; probe.style.fontSize = value;
            result = probe.style.fontSize ? view.getComputedStyle(probe).fontSize : defaultThemeValue(key);
            if (!(parseFloat(result) > 0)) result = defaultThemeValue(key);
        } else if (key.endsWith('opacity') || key.endsWith('scale')) {
            const n = Number(value);
            result = Number.isFinite(n) && n >= 0 && (!key.endsWith('opacity') || n <= 1) ? value : defaultThemeValue(key);
        } else {
            result = color(value) ?? defaultThemeValue(key);
        }
        cache.set(key, result);
        return result;
    };
    try { return createGraphVisualTheme(read); }
    finally { probe.remove(); }
}
