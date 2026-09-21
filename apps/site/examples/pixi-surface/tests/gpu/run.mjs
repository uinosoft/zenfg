// Standalone hardware checks; does not rebuild the workspace or clean other test artifacts.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../../../../../../');
const output = resolve(root, '.test-dist/pixi-surface-gpu');
await mkdir(output, { recursive: true });
const bundle = await build({
    absWorkingDir: root, entryPoints: ['apps/site/examples/pixi-surface/tests/gpu/browser.ts'],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, sourcemap: 'inline',
    plugins: [{ name: 'local-map', setup(builder) {
        builder.onResolve({ filter: /\.png\?url$/ }, args => ({
            path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'map',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'map' }, async args => ({
            contents: 'export default ' + JSON.stringify('data:image/png;base64,' + (await readFile(args.path)).toString('base64')),
        }));
    } }],
});
const server = createServer((request, response) => {
    if (request.url === '/suite.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(bundle.outputFiles[0].text);
    } else if (request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><title>Tinted Screen WebGPU tests</title><style>body{margin:0;background:#07131d}pre{display:none}</style><pre id="result"></pre><script type="module" src="/suite.js"></script>');
    } else { response.writeHead(204); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const errors = [];
const warnings = [];
try {
    browser = await chromium.launch({
        ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER }
            : process.platform === 'win32' ? { channel: 'msedge' } : {}),
        headless: true, args: ['--enable-unsafe-webgpu'],
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on('pageerror', error => errors.push(error.stack ?? String(error)));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
        if (message.type() === 'warning') warnings.push(message.text());
        console.log('[browser:' + message.type() + '] ' + message.text());
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => globalThis.__surfaceTest || globalThis.__pixiSurfaceGpuResult, undefined, { timeout: 90_000 });
    if (await page.evaluate(() => !!globalThis.__surfaceTest)) {
        const state = () => page.evaluate(() => globalThis.__surfaceTest.state());
        const frame = () => page.evaluate(() => globalThis.__surfaceTest.frame());
        async function drag(x, y, dx, dy) {
            await page.mouse.move(x, y); await page.mouse.down();
            await page.mouse.move(x + dx, y + dy, { steps: 5 }); await page.mouse.up();
            await frame();
        }
        const before = await state();
        await drag(450,270,40,12);
        const after = await state();
        assert.notEqual(after.camera.azimuth,before.camera.azimuth);
        await page.mouse.wheel(0,100);
        await page.waitForFunction(d => globalThis.__surfaceTest.state().camera.distance>d,after.camera.distance);
        await page.getByRole('button',{name:'Pause',exact:true}).click();
        assert.equal((await state()).paused,true);
        await drag(450,270,20,0);
        assert.equal((await state()).paused,true);
        await page.getByRole('button',{name:'Reset',exact:true}).click();
        assert.equal((await state()).paused,false);
        assert.equal((await state()).camera.azimuth,0.32);
        await page.mouse.move(450,270);await page.mouse.down();
        await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
        await page.mouse.move(500,300);await page.mouse.up();
        assert.equal((await state()).camera.azimuth,0.32);
        await page.mouse.move(450,270);await page.mouse.down();
        await page.evaluate(()=>document.querySelector('canvas').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})));
        await page.mouse.move(500,300);await page.mouse.up();
        assert.equal((await state()).camera.azimuth,0.32);
        await page.evaluate(() => globalThis.__surfaceTest.finish());
    }
    const { images = {}, snapshots = {}, ...result } = await page.evaluate(() => globalThis.__pixiSurfaceGpuResult);
    await mkdir(output, { recursive: true });
    for (const [name, data] of Object.entries(images)) await writeFile(resolve(output, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    for (const [name, snapshot] of Object.entries(snapshots)) await writeFile(resolve(output, name + '.snapshot.json'), JSON.stringify(snapshot, null, 2));
    result.browser = browser.version();
    result.warnings = warnings;
    result.errors.push(...errors);
    result.ok &&= errors.length === 0;
    await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
} catch (error) {
    await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: false, error: error.stack, errors }, null, 2));
    console.error(error); process.exitCode = 1;
} finally {
    await browser?.close();
    await new Promise(done => server.close(done));
}