import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../../../../../../');
const output = resolve(root, '.test-dist/glyph-interop-gpu');
await mkdir(output, { recursive: true });
const server = await createServer({
    // Keep test optimization from replacing chunks used by a running Site dev server.
    cacheDir: resolve(output, 'vite-cache'),
    configFile: resolve(root, 'apps/site/vite.config.ts'), root: resolve(root, 'apps/site'),
    server: { port: 0, host: '127.0.0.1', open: false },
    plugins: [{ name: 'glyph-test-page', configureServer(vite) {
        vite.middlewares.use('/__glyph_test', (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><title>Glyph hardware tests</title><script type="module" src="/examples/glyph-interop/tests/gpu/browser.ts"></script>');
        });
    } }],
});
let browser;
const errors = [];
try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({
        ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
        headless: true, args: ['--enable-unsafe-webgpu'],
    });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => { errors.push(error.message); console.error(error); });
    page.on('console', message => {
        if (message.type() === 'error' || message.text().includes('Found duplicate TypeGPU version')) { errors.push(message.text()); console.error(message.text()); }
    });
    await page.goto('http://127.0.0.1:' + port + '/__glyph_test');
    await page.waitForFunction(() => globalThis.__glyphResult !== undefined, undefined, { timeout: 180_000 });
    const { images, snapshots, ...result } = await page.evaluate(() => globalThis.__glyphResult);
    for (const [name, data] of Object.entries(images)) await writeFile(resolve(output, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    for (const [name, data] of Object.entries(snapshots)) await writeFile(resolve(output, name + '.snapshot.json'), JSON.stringify(data, null, 2));
    result.browser = browser.version(); result.pageErrors = errors;
    result.ok &&= errors.length === 0;
    await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    // Exercise the actual catalog controls and capture the default composition.
    await page.goto('http://127.0.0.1:' + port + '/playground/?example=glyph-interop');
    await page.waitForFunction(() => document.querySelector('canvas[data-frame-graph]') !== null, undefined, { timeout: 90_000 });
    await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: resolve(output, 'showcase.png'), fullPage: true });
    // Dev dependency optimization is a separate path from the production bundle.
    // In particular, @typegpu/noise and the example must share TypeGPU's runtime.
    for (const id of ['typegpu-slime-mold', 'glyph-interop', 'typegpu-slime-mold']) {
        await page.locator('a[href*="example=' + id + '"]').first().click();
        await page.waitForFunction(() => ['ready', 'error'].includes(
            document.querySelector('[data-effect-status]')?.dataset.state), undefined, { timeout: 30_000 });
        const status = await page.locator('[data-effect-status]').getAttribute('data-state');
        if (status !== 'ready') throw new Error(id + ': ' + await page.locator('[data-example-feedback]').textContent());
        await page.waitForFunction(() => Number(document.querySelector('[data-frame-rate]')?.value) > 0);
    }
    result.cases.push('development: Glyph / Slime Mold navigation, noise shader compilation and live FPS');
    result.ok &&= errors.length === 0;
    await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
} catch (error) {
    console.error(error); process.exitCode = 1;
    await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, errors }, null, 2));
} finally { await browser?.close(); await server.close(); }
