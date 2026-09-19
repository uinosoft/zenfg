import type { TextStyle, ParagraphLayout } from '@pmndrs/glyph';

export interface GlyphSettings {
    mode: 'bitmap' | 'msdf' | 'slug';
    text: string;
    fontSize: number;
    color: string;
    opacity: number;
    width: number;
    wrap: 'none' | 'word' | 'character';
    align: 'start' | 'center' | 'end';
    lineHeight: number;
    letterSpacing: number;
    strike: 'auto' | '32' | '64' | '128';
    outline: number;
    outlineColor: string;
    shadow: boolean;
    shadowColor: string;
    shadowX: number;
    shadowY: number;
    scale: number;
    tilt: number;
}
export const defaults: GlyphSettings = {
    mode: 'msdf', text: 'Hello Glyph!\nCurves, pixels & shared depth.',
    fontSize: 64, color: '#e8edff', opacity: 1,
    width: 560, wrap: 'word', align: 'center', lineHeight: 1.25, letterSpacing: 0,
    strike: 'auto', outline: 0, outlineColor: '#527cff',
    shadow: false, shadowColor: '#141827', shadowX: 0.025, shadowY: 0.025,
    scale: 1, tilt: -20,
};

/** Effect controls use em units; the baked 64/8 field has a 0.0625 em half-range. */
export function textOptions(settings: GlyphSettings, pixelRatio: number) {
    const style: Omit<TextStyle, 'decoration'> = {
        fontSize: settings.fontSize, color: settings.color, opacity: settings.opacity,
        lineHeight: settings.lineHeight, letterSpacing: settings.letterSpacing,
        ...(settings.mode === 'msdf' ? {
            outline: { color: settings.outlineColor, width: settings.outline * settings.fontSize },
            ...(settings.shadow ? { shadow: { color: settings.shadowColor,
                offset: [settings.shadowX * settings.fontSize, settings.shadowY * settings.fontSize] as const } } : {}),
        } : {}),
    };
    const layout: ParagraphLayout = { wrap: settings.wrap, align: settings.align };
    return {
        text: settings.text, style, layout,
        constraints: { width: { mode: 'exact' as const, size: settings.width } },
        rasterPixelRatio: settings.strike === 'auto' ? pixelRatio : Number(settings.strike) / settings.fontSize,
    };
}
export function updateSettings(current: GlyphSettings, patch: Partial<GlyphSettings>): GlyphSettings {
    const next = { ...current, ...patch };
    const choices = { mode: ['bitmap', 'msdf', 'slug'], wrap: ['none', 'word', 'character'],
        align: ['start', 'center', 'end'], strike: ['auto', '32', '64', '128'] };
    for (const [key, values] of Object.entries(choices)) {
        if (!values.includes(String(next[key as keyof GlyphSettings]))) throw new RangeError('Invalid ' + key);
    }
    const ranges = { fontSize: [12, 160], width: [160, 960], opacity: [0, 1], lineHeight: [0.8, 2],
        letterSpacing: [-2, 12], outline: [0, 0.03], shadowX: [-0.03, 0.03], shadowY: [-0.03, 0.03],
        scale: [0.25, 4], tilt: [-75, 75] };
    for (const [key, [min, max]] of Object.entries(ranges)) {
        const value = next[key as keyof GlyphSettings];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RangeError('Invalid ' + key);
    }
    for (const key of ['color', 'outlineColor', 'shadowColor'] as const) {
        if (!/^#[0-9a-f]{6}$/i.test(next[key])) throw new TypeError('Invalid ' + key);
    }
    if (typeof next.text !== 'string' || typeof next.shadow !== 'boolean') throw new TypeError('Invalid text settings.');
    return next;
}
/** Spatial changes never invalidate retained shaping/layout. */
export function textChanged(before: GlyphSettings, after: GlyphSettings): boolean {
    return (Object.keys(before) as (keyof GlyphSettings)[])
        .some(key => key !== 'scale' && key !== 'tilt' && before[key] !== after[key]);
}
