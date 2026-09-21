import assert from 'node:assert/strict';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../../../../../../');
const output = resolve(root, '.test-dist/pixi-surface-gpu');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: resolve(root, 'apps/site/vite.config.ts'),
    root: resolve(root, 'apps/site'), base: '/zenfg/', preview: { port: 0, host: '127.0.0.1', open: false } });
const url = 'http://127.0.0.1:' + server.httpServer.address().port + '/zenfg/playground/?example=pixi-surface';
const browser = await chromium.launch({
    ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER }
        : process.platform === 'win32' ? { channel: 'msedge' } : {}),
    headless: true, args: ['--enable-unsafe-webgpu'],
});
const errors = [], warnings = [], cases = [], assets = [];
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.stack ?? String(error)));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
        if (message.type() === 'warning') warnings.push(message.text());
    });
    page.on('response', response => {
        if (/eggHead.*\.png/.test(response.url())) assets.push({ url: response.url(), status: response.status() });
    });
    async function ready() {
        await page.waitForFunction(() => document.querySelector('[data-effect-status]')?.dataset.state === 'ready'
            || document.querySelector('[data-effect-status]')?.dataset.state === 'error', undefined, { timeout: 60_000 });
        assert.equal(await page.locator('[data-effect-status]').getAttribute('data-state'), 'ready',
            await page.locator('[data-example-feedback]').textContent());
    }
    await page.goto(url);
    await ready();
    assert.equal(await page.locator('[data-example-title]').textContent(), 'PixiJS · Tinted Screen');
    assert.ok(await page.locator('.example-tags').getByText('PixiJS', { exact: true }).isVisible());
    assert.ok(await page.locator('[data-controls-host] .tp-rotv').isVisible());
    await ready();
    await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-frame-rate]')?.value) > 0);
    assert.match(await page.locator('[data-effect-canvas]').getAttribute('data-frame-graph'), /surface.pixi-animation/);
    await page.locator('[data-effect-canvas]').screenshot({ path: resolve(output, 'production-canvas.png') });
    await page.screenshot({ path: resolve(output, 'production-page.png'), fullPage: true });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const paused = await page.locator('[data-effect-canvas]').screenshot();
    await page.waitForTimeout(120);
    assert.deepEqual(await page.locator('[data-effect-canvas]').screenshot(), paused, 'Pause stops all animation.');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    assert.ok(await page.getByRole('button', { name: 'Pause', exact: true }).isVisible());
    cases.push('built /zenfg/ example, Inspector, visible external controls and paused pixels');
    await page.locator('[data-panel-button=code]').click();
    await page.waitForFunction(() => document.querySelector('[data-source-content]')?.textContent.includes('startPixiSurface'));
    cases.push('source reader shows the executed entry and graph helpers');
    await page.setViewportSize({ width: 390, height: 844 });
    await ready();
    await page.locator('[data-effect-canvas]').screenshot({ path: resolve(output, 'production-mobile.png') });
    cases.push('narrow Examples layout retains the complete canvas scene');
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const id of ['reference-renderer', 'pixi-surface', 'reference-renderer', 'pixi-surface']) {
        await page.evaluate(example => {
            const anchor = [...document.querySelectorAll('a')].find(a => new URL(a.href).searchParams.get('example') === example);
            if (!anchor) throw new Error('Missing catalog link: ' + example);
            anchor.click();
        }, id);
        await page.waitForFunction(expected => new URL(location.href).searchParams.get('example') === expected, id);
        await ready();
    }
    cases.push('SPA navigation releases and remounts the actual Pixi example');
    const retina = await browser.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 2 });
    retina.on('pageerror', error => errors.push(error.message));
    retina.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await retina.goto(url + '&panel=code');
    await retina.waitForFunction(() => document.querySelector('[data-effect-status]')?.dataset.state === 'ready', undefined, { timeout: 60_000 });
    const size = await retina.locator('[data-effect-canvas]').evaluate(canvas => ({
        width: canvas.width, css: canvas.getBoundingClientRect().width,
    }));
    assert.ok(Math.abs(size.width - size.css * 2) < 2, 'Production canvas respects DPR 2.');
    cases.push('production DPR 2');
    assert.ok(assets.length > 0 && assets.every(asset => asset.status === 200 && asset.url.includes('/zenfg/assets/')),
        'The static eggHead map is bundled locally under the deployment base.');
    assert.deepEqual(errors, []);
    const result = { ok: true, browser: browser.version(), cases, assets, errors, warnings };
    await writeFile(resolve(output, 'production-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    await writeFile(resolve(output, 'production-result.json'), JSON.stringify({ ok: false, error: error.stack, cases, errors, warnings, assets }, null, 2));
    console.error(error); process.exitCode = 1;
} finally { await browser.close(); await new Promise(done => server.httpServer.close(done)); }