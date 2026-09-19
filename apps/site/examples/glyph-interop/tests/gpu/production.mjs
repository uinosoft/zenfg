import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { preview } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../../../../../../');
const output = resolve(root, '.test-dist/glyph-interop-gpu');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: resolve(root, 'apps/site/vite.config.ts'),
    root: resolve(root, 'apps/site'), base: '/zenfg/', preview: { port: 0, host: '127.0.0.1', open: false } });
const base = 'http://127.0.0.1:' + server.httpServer.address().port + '/zenfg/';
const browser = await chromium.launch({ ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER }
    : process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--enable-unsafe-webgpu'] });
const errors = [], assets = [], cases = [], fixtures = [];
const skipped = process.argv.includes('--local-only') ? ['Monocular remote-assets browser regression; run without --local-only to include it.'] : [];
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (/text-shaper.*wasm|inter-latin.*glb/.test(response.url())) assets.push({ url: response.url(), status: response.status() }); });
    const fixtureDirectory = process.env.GPU_TEST_MONOCULAR_ASSETS;
    const fixtureSources = [
        ['https://huggingface.co/reczkok/depthart-typegpu/resolve/913a7c13ddfbd48549279555d1db98172e8e5e0d/depthart-relative-s-448-balanced.depthart', 'model.depthart', 'application/octet-stream'],
        ['https://raw.githubusercontent.com/software-mansion/TypeGPU/2adbc1b3636f2c7c1be00d242171e23c85c73898/apps/typegpu-docs/public/assets/depthart/demo.jpg', 'demo.jpg', 'image/jpeg'],
    ];
    if (fixtureDirectory) for (const [url, name, contentType] of fixtureSources) {
        const path = resolve(fixtureDirectory, name);
        const bytes = await readFile(path);
        fixtures.push({ url, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
        // Only the test transport is replaced; production model parsing, inference and shaders are real.
        await page.route(url, route => route.fulfill({ path, contentType, headers: { 'access-control-allow-origin': '*' } }));
    }

    async function open(id) {
        console.log('Checking production example: ' + id);
        await page.goto(base + 'playground/?example=' + id);
        await page.waitForFunction(() => document.querySelector('[data-examples]')?.dataset.effectState === 'ready'
            || document.querySelector('[data-effect-status]')?.dataset.state === 'error', undefined, { timeout: 120_000 });
        assert.equal(await page.locator('[data-effect-status]').getAttribute('data-state'), 'ready',
            await page.locator('[data-example-feedback]').textContent());
        await page.waitForFunction(() => Number(document.querySelector('[data-frame-rate]')?.value) > 0);
    }
    await open('glyph-interop');
    await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor({ timeout: 30_000 });
    const mode = page.locator('[data-controls-host] select').first();
    for (const value of ['Bitmap', 'Slug', 'MSDF']) {
        await mode.selectOption({ label: value });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.waitForFunction(() => document.querySelector('[data-effect-status]')?.dataset.state === 'ready');
        assert.equal(await mode.evaluate(select => select.selectedOptions[0].textContent), value);
    }
    assert.ok(assets.length >= 2 && assets.every(asset => asset.status === 200 && asset.url.includes('/zenfg/assets/')));
    const license = await page.request.get(base + 'glyph-font-license.txt');
    assert.match(await license.text(), /SIL OPEN FONT LICENSE/);
    await page.screenshot({ path: resolve(output, 'production.png'), fullPage: true });
    cases.push('Glyph: production /zenfg/ assets, raster controls, real Inspector, font license');
    await page.locator('[data-panel-button=code]').click();
    await page.waitForFunction(() => document.querySelector('[data-source-content]')?.textContent.includes('startGlyphInterop'));
    cases.push('Glyph: actual executed source is displayed');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
    assert.equal(await page.locator('[data-effect-status]').getAttribute('data-state'), 'ready');
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const id of ['three-interop', 'typegpu-slime-mold', ...(process.argv.includes('--local-only') ? [] : ['typegpu-monocular-light-injection'])]) {
        await open(id);
        cases.push(id + ': production first frame and live FPS');
    }
    const retina = await browser.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 2 });
    retina.on('pageerror', error => errors.push(error.message));
    await retina.goto(base + 'playground/?example=glyph-interop&panel=code');
    await retina.waitForFunction(() => document.querySelector('[data-effect-status]')?.dataset.state === 'ready', undefined, { timeout: 60_000 });
    const sizes = await retina.locator('[data-effect-canvas]').evaluate(canvas => ({ pixels: canvas.width, css: canvas.getBoundingClientRect().width }));
    assert.ok(Math.abs(sizes.pixels - sizes.css * 2) < 2);
    cases.push('Glyph: DPR 2 canvas');
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'production-result.json'), JSON.stringify({ ok: true, cases, assets, errors, fixtures, skipped }, null, 2));
    console.log(JSON.stringify({ ok: true, cases, assets, errors, fixtures, skipped }, null, 2));
} catch (error) {
    await writeFile(resolve(output, 'production-result.json'), JSON.stringify({ ok: false, error: error.stack, cases, assets, errors, fixtures, skipped }, null, 2));
    console.error(error); process.exitCode = 1;
} finally { await browser.close(); await new Promise(resolveDone => server.httpServer.close(resolveDone)); }
