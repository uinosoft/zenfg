// Real DOM + Canvas acceptance, independent of a hardware WebGPU adapter.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkGraphPointer } from './graphPointer.mjs';
import { checkDrawerBackdrop } from './drawerBackdrop.mjs';

const root = resolve(import.meta.dirname, '../../../../../');
const output = resolve(root, '.test-dist/inspector-theme-qa');
await mkdir(output, { recursive: true });
await build({ stdin: { contents: "import { createFrameFlowVisualFixture } from './packages/webgpu/tests/frameFlowVisualFixture.ts'; export const snapshot = createFrameFlowVisualFixture();", resolveDir: root }, bundle: true, outfile: resolve(output, 'fixture.mjs'), format: 'esm', platform: 'node' });
const { snapshot } = await import(pathToFileURL(resolve(output, 'fixture.mjs')).href);
const { outputFiles } = await build({ entryPoints: [resolve(import.meta.dirname, 'themeHarness.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 1277, height: 920 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const report = { views: [], errors };
await page.route('http://inspector.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.json') ? 'application/json' : route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('.json') ? JSON.stringify(snapshot) : route.request().url().endsWith('.js') ? outputFiles[0].text : '<!doctype html><html><head></head><body><script type="module" src="/harness.js"></script></body></html>' }));
try {
    await page.goto('http://inspector.test/');
    await page.waitForFunction(() => document.querySelector('.zenfg-inspector-graph-canvas')?._cyreg?.cy?.nodes().length > 0 && document.querySelector('.zenfg-inspector-graph-status').hidden);
    assert.equal(await page.locator('.zenfg-inspector').evaluate(el => el.style.length), 0);
    await checkDrawerBackdrop(page, output);
    await checkGraphPointer(page, output);
    await page.evaluate(() => {
        const core = document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy;
        const node = core.nodes().filter(n => n.data('kind') !== 'group').first(); node.emit('tap');
        core.zoom(1.1); core.pan({ x: 33, y: 27 });
        window.originalThemeCore = core;
    });
    const state = () => page.evaluate(() => {
        const core = document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy;
        return { sameCore: core === window.originalThemeCore, zoom: core.zoom(), pan: core.pan(), positions: core.nodes().map(n => [n.id(), n.position()]), selected: core.elements('.semantic-selected').map(n => n.id()) };
    });
    const original = await state();
    assert.ok(original.selected.length > 0);
    await page.evaluate(() => themeQA.inspector.setTheme(themeQA.tokyoNightLight));
    assert.deepEqual(await state(), original, 'API palette change preserves geometry and interaction');
    assert.equal(await page.locator('.zenfg-inspector').evaluate(el => getComputedStyle(el).colorScheme), 'light');
    assert.equal(await page.evaluate(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes()[0].style('color')), 'rgb(52,59,88)');
    // CSS-only theme, inherited from an owned host, follows the same graph path.
    await page.evaluate(() => { themeQA.inspector.setTheme(null); themeQA.host.dataset.zfgiTheme = 'tokyo-night-light'; themeQA.inspector.refreshTheme(); });
    assert.equal(await page.evaluate(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes()[0].style('color')), 'rgb(52,59,88)');
    assert.deepEqual(await state(), original);
    await page.evaluate(() => { themeQA.host.style.setProperty('--zfgi-graph-text', '#234567'); themeQA.inspector.refreshTheme(); });
    assert.equal(await page.evaluate(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes()[0].style('color')), 'rgb(35,69,103)');
    // Verify CSS color-mix resolved all the way into Canvas fills, not a dark fallback.
    const fill = await page.evaluate(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes('[passKind="command"]').first().style('background-color'));
    assert.equal(fill, 'rgb(233,231,241)');
    await page.evaluate(() => { themeQA.host.style.removeProperty('--zfgi-graph-text'); delete themeQA.host.dataset.zfgiTheme; });
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    for (const width of [1277, 1024, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 920 });
        for (const mode of ['dark', 'light']) {
            await page.evaluate(mode => { themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight); }, mode);
            for (const view of ['Overview', 'Graph', 'Passes', 'Resources', 'Memory', 'Diagnostics']) {
                await page.getByRole('tab', { name: view, exact: true }).first().click();
                if (view === 'Graph') {
                    await page.getByRole('button', { name: 'Fit graph to view', exact: true }).click();
                    const canvas = page.locator('.zenfg-inspector-graph-canvas');
                    const before = { bounds: await canvas.boundingBox(), state: await state() };
                    const search = page.getByRole('button', { name: 'Search', exact: true });
                    const input = page.getByRole('searchbox', { name: 'Find in graph', exact: true });
                    assert.equal(await input.isHidden(), true);
                    await search.click();
                    assert.equal(await input.evaluate(el => el === document.activeElement), true);
                    await input.fill('history');
                    assert.ok(await page.locator('.zenfg-inspector-graph-search-results button').count() > 0);
                    const popover = await page.locator('.zenfg-inspector-graph-search-popover').boundingBox();
                    assert.ok(popover.x >= before.bounds.x && popover.x + popover.width <= before.bounds.x + before.bounds.width);
                    await page.screenshot({ path: resolve(output, `${mode}-${width}-graph-search.png`), animations: 'disabled' });
                    await input.press('Escape');
                    assert.equal(await input.isHidden(), true);
                    assert.equal(await search.evaluate(el => el === document.activeElement), true);
                    assert.deepEqual({ bounds: await canvas.boundingBox(), state: await state() }, before, 'search overlay preserves canvas and graph viewport');
                    await page.locator('.zenfg-inspector-legend-details > summary').click();
                    assert.deepEqual({ bounds: await canvas.boundingBox(), state: await state() }, before, 'legend expansion preserves canvas and graph viewport');
                    const legend = await page.locator('.zenfg-inspector-legend-details').boundingBox();
                    assert.ok(legend.x >= before.bounds.x && legend.y >= before.bounds.y);
                    assert.ok(legend.x + legend.width <= before.bounds.x + before.bounds.width);
                    assert.ok(legend.y + legend.height <= before.bounds.y + before.bounds.height);
                    await page.locator('.zenfg-inspector-legend-details > summary').click();
                    const alignment = await page.locator('.zenfg-inspector-workbench-actions').evaluate(el => {
                        const visible = [...el.querySelectorAll('button')].filter(button => !button.hidden).map(button => button.getBoundingClientRect());
                        const bar = el.getBoundingClientRect();
                        return visible.every(rect => rect.y === visible[0].y && rect.height === visible[0].height && Math.abs(rect.y - bar.y - (bar.bottom - rect.bottom)) < 1);
                    });
                    assert.ok(alignment, 'command buttons align with symmetric vertical spacing');
                    assert.equal(await page.locator('.zenfg-inspector-capture-context').count(), 0);
                }
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${mode}/${view} horizontal overflow`);
                await page.screenshot({ path: resolve(output, `${mode}-${width}-${view.toLowerCase()}.png`), animations: 'disabled' });
                report.views.push({ mode, width, view });
            }
        }
    }
    // Detail tabs, graph legend, export menu, and empty/error states in both themes.
    await page.setViewportSize({ width: 1277, height: 920 });
    for (const mode of ['dark', 'light']) {
        await page.evaluate(mode => themeQA.inspector.setTheme(mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight), mode);
        await page.getByRole('tab', { name: 'Graph', exact: true }).click();
        await page.evaluate(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes().filter(n => n.data('kind') !== 'group').first().emit('tap'));
        for (const detail of ['Summary', 'Relations', 'Raw']) {
            await page.getByRole('tab', { name: detail, exact: true }).click();
            await page.screenshot({ path: resolve(output, mode + '-detail-' + detail.toLowerCase() + '.png'), animations: 'disabled' });
        }
        await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
        await page.locator('.zenfg-inspector-legend-details > summary').click();
        await page.screenshot({ path: resolve(output, mode + '-legend.png'), animations: 'disabled' });
        await page.locator('.zenfg-inspector-legend-details > summary').click();
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        await page.screenshot({ path: resolve(output, mode + '-export.png'), animations: 'disabled' });
        await page.getByRole('button', { name: 'Export', exact: true }).click();
    }
    // Two simultaneous independently styled components, including static CSS at mount.
    await page.evaluate(() => {
        const host = document.createElement('div'); host.style.cssText = 'height:600px;--zfgi-graph-text:#abcdef';
        document.body.append(host);
        const second = themeQA.mountFrameGraphInspector(host); second.setSnapshot(themeQA.snapshot); window.secondThemeInspector = second;
    });
    await page.waitForFunction(() => document.querySelectorAll('.zenfg-inspector-graph-canvas')[1]?._cyreg?.cy?.nodes().length > 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.zenfg-inspector-graph-canvas')[1]._cyreg.cy.nodes()[0].style('color')), 'rgb(171,205,239)');
    await page.evaluate(() => themeQA.inspector.setTheme(themeQA.tokyoNightStorm));
    assert.equal(await page.evaluate(() => document.querySelectorAll('.zenfg-inspector-graph-canvas')[1]._cyreg.cy.nodes()[0].style('color')), 'rgb(171,205,239)');
    await page.evaluate(() => { secondThemeInspector.destroy(); themeQA.inspector.destroy(); });
    for (const mode of ['dark', 'light']) {
        await page.evaluate(mode => { themeQA.inspector = themeQA.mountFrameGraphInspector(themeQA.host, { theme: mode === 'dark' ? themeQA.tokyoNightStorm : themeQA.tokyoNightLight }); }, mode);
        await page.screenshot({ path: resolve(output, mode + '-empty.png'), animations: 'disabled' });
        await page.evaluate(async () => { await themeQA.inspector.importSnapshot(new File(['not JSON'], 'invalid.json')); });
        await page.screenshot({ path: resolve(output, mode + '-error.png'), animations: 'disabled' });
        await page.evaluate(() => themeQA.inspector.destroy());
    }
    if (process.env.INSPECTOR_URL) {
        await page.goto(process.env.INSPECTOR_URL);
        assert.equal(await page.locator('.app-toolbar').evaluate(el => el.getBoundingClientRect().height), 60);
        assert.equal(await page.locator('.app-brand a').innerText(), 'ZenFG');
        assert.equal(await page.locator('.app-brand').getByText('Inspector', { exact: true }).evaluate(el => el.closest('a') === null), true);
        assert.equal(await page.locator('.theme-switch svg').count(), 2);
        await page.getByRole('button', { name: 'Light', exact: true }).click();
        await page.reload();
        assert.equal(await page.locator('.zenfg-inspector').evaluate(el => getComputedStyle(el).colorScheme), 'light');
        await page.locator('input[type=file]').setInputFiles({ name: 'theme-fixture.fgsnapshot.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) });
        await page.waitForFunction(() => document.querySelector('.zenfg-inspector-graph-canvas')?._cyreg?.cy?.nodes().length > 0);
        for (const mode of ['Dark', 'Light']) {
            await page.getByRole('button', { name: mode, exact: true }).click();
            await page.screenshot({ path: resolve(output, 'standalone-' + mode.toLowerCase() + '.png'), animations: 'disabled' });
        }
        assert.equal(await page.locator('.zenfg-inspector').count(), 1);
    }
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Inspector theme browser acceptance: ${report.views.length} view screenshots, CSS/API synchronization and instance isolation passed.`);
} finally { await browser.close(); }
