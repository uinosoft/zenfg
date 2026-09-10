import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { tokyoNightStorm, tokyoNightLight } from '../src/theme.ts';
import { stormVariables, lightVariables, themePresetCss, graphCategories } from '../src/themeDefinitions.ts';
import { defaultThemeValue } from '../src/panelVisualTheme.ts';
import { mountFrameGraphInspector } from '../src/FrameGraphInspector.ts';

test('public theme API restores owned declarations, inherits host CSS, and isolates instances', async () => {
    const dom = new Window();
    Reflect.set(globalThis, 'window', dom);
    Reflect.set(globalThis, 'document', dom.document);
    Reflect.set(globalThis, 'navigator', dom.navigator);
    const host = document.createElement('div');
    host.style.setProperty('--zfgi-text', '#112233');
    host.style.setProperty('--zenfg-inspector-accent', '#456789');
    document.body.append(host);
    const first = mountFrameGraphInspector(host);
    const second = mountFrameGraphInspector(document.body, { theme: tokyoNightLight });
    try {
        assert.equal(first.dom.style.length, 0, 'default mount must not shadow inherited variables');
        assert.equal(window.getComputedStyle(first.dom).color, '#112233');
        first.dom.style.setProperty('--zfgi-accent', '#223344');
        first.dom.style.setProperty('outline-width', '5px');
        first.setTheme(tokyoNightLight);
        assert.equal(first.dom.style.getPropertyValue('--zfgi-color-scheme'), 'light');
        first.setTheme({ variables: { '--zfgi-text': '#334455' } });
        assert.equal(first.dom.style.getPropertyValue('--zfgi-accent'), '#223344', 'restore pre-API inline declaration');
        assert.equal(first.dom.style.getPropertyValue('--zfgi-canvas'), '');
        assert.equal(first.dom.style.getPropertyValue('--zfgi-color-scheme'), '');
        first.setTheme(null);
        assert.equal(first.dom.style.getPropertyValue('--zfgi-text'), '');
        assert.equal(window.getComputedStyle(first.dom).color, '#112233');
        assert.equal(first.dom.style.outlineWidth, '5px');
        assert.equal(second.dom.style.getPropertyValue('--zfgi-color-scheme'), 'light');
        assert.equal(host.style.getPropertyValue('--zfgi-text'), '#112233');
        assert.equal(document.documentElement.getAttribute('style'), null);
        first.setTheme(tokyoNightStorm);
        first.dom.style.setProperty('--zfgi-accent', '#abcdef');
        first.refreshTheme();
        assert.equal(first.dom.style.getPropertyValue('--zfgi-accent'), '#abcdef', 'refresh never reapplies API variables');
        first.setTheme(null);
        assert.equal(first.dom.style.getPropertyValue('--zfgi-accent'), '#abcdef', 'do not erase later externally owned edits');
    } finally { first.destroy(); second.destroy(); await dom.happyDOM.close(); }
});

test('generated CSS and JS presets expose the same values with explicit scope', () => {
    const css = themePresetCss();
    for (const [name, theme] of [['tokyo-night-storm', tokyoNightStorm], ['tokyo-night-light', tokyoNightLight]] as const) {
        const block = css.split(`[data-zfgi-theme="${name}"] {`)[1]!.split('}')[0]!;
        assert.ok(block.includes(`--zfgi-color-scheme: ${theme.colorScheme};`));
        for (const [key, value] of Object.entries(theme.variables!)) assert.ok(block.includes(`${key}: ${value};`), key);
    }
    assert.equal(css.includes(':root'), false);
});

test('both official palettes meet text and semantic graph contrast requirements', () => {
    const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
    const luminance = (hex: string) => rgb(hex).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i]!, 0);
    const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    for (const variables of [stormVariables, lightVariables]) {
        const value = (key: keyof typeof variables) => defaultThemeValue(key, variables);
        for (const category of graphCategories) {
            const fill = value(`--zfgi-graph-${category}-fill`);
            assert.ok(contrast(value('--zfgi-graph-text'), fill) >= 7, `${category} text`);
            for (const background of [fill, value('--zfgi-canvas'), value('--zfgi-graph-group-fill'), value('--zfgi-graph-group-alternate-fill')]) {
                for (const stroke of [value(`--zfgi-graph-${category}-stroke`), value('--zfgi-graph-hover'), value('--zfgi-graph-selected')]) {
                    assert.ok(contrast(stroke, background) >= 3, `${category} border ${stroke} on ${background}`);
                }
            }
        }
        for (const background of ['--zfgi-background', '--zfgi-surface', '--zfgi-surface-raised', '--zfgi-surface-hover'] as const) {
            for (const text of ['--zfgi-text', '--zfgi-text-secondary', '--zfgi-muted'] as const) assert.ok(contrast(value(text), value(background)) >= 4.5, `${text} on ${background}`);
        }
        for (const background of ['--zfgi-canvas', '--zfgi-graph-group-fill', '--zfgi-graph-group-alternate-fill'] as const) {
            for (const line of ['--zfgi-graph-value', '--zfgi-graph-ordering', '--zfgi-graph-group-stroke'] as const) assert.ok(contrast(value(line), value(background)) >= 3, `${line} on ${background}`);
        }
    }
});

test('published theme entry bundles without a DOM, graph runtime, or layout engine', async () => {
    const { build } = createRequire(resolve('package.json'))('esbuild') as typeof import('esbuild');
    const result = await build({ entryPoints: [resolve('packages/inspector/src/theme.ts')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'node' });
    const inputs = Object.keys(result.metafile!.inputs);
    assert.ok(inputs.every(path => !/cytoscape|elkjs|FrameGraphInspector|panelTheme/.test(path)), inputs.join('\n'));
});
