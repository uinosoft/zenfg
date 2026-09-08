// Optional hardware suite: bundle only this entry; never run workspace builds or clean .test-dist.
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../../..');
const output = resolve(root, '.test-dist/babylon-interop-gpu');
await mkdir(output, { recursive: true });
const bundle = await build({
    absWorkingDir: root,
    entryPoints: ['examples/babylon-interop/tests/gpu/browser.ts'],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, sourcemap: 'inline',
});
const server = createServer((request, response) => {
    if (request.url === '/suite.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(bundle.outputFiles[0].text);
    } else if (request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><title>Babylon interop hardware WebGPU suite</title><body><pre id="result">Running hardware WebGPU tests…</pre><script type="module" src="/suite.js"></script>');
    } else { response.writeHead(204); response.end(); }
});
await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveReady); });
let browser;
const consoleMessages = [];
const pageErrors = [];
try {
    const modulePath = process.env.PLAYWRIGHT_MODULE;
    const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
    browser = await chromium.launch({
        ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER }
            : process.platform === 'win32' ? { channel: 'msedge' } : {}),
        headless: true,
        args: ['--enable-unsafe-webgpu'],
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: Number(process.env.GPU_TEST_DPR ?? 1) });
    page.on('console', message => {
        consoleMessages.push({ type: message.type(), text: message.text() });
        console.log(`[browser:${message.type()}] ${message.text()}`);
    });
    page.on('pageerror', error => { pageErrors.push(error.stack ?? String(error)); console.error(error); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => globalThis.__babylonInteropGpuResult !== undefined, undefined, { timeout: 180_000 });
    const { images = {}, snapshots = {}, ...result } = await page.evaluate(() => globalThis.__babylonInteropGpuResult);
    // A concurrent workspace test runner may have removed .test-dist after startup.
    await mkdir(output, { recursive: true });
    for (const [name, data] of Object.entries(images)) await writeFile(resolve(output, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    for (const [name, snapshot] of Object.entries(snapshots)) await writeFile(resolve(output, `${name}.snapshot.json`), JSON.stringify(snapshot, null, 2));
    result.artifacts = { images: Object.keys(images).map(name => `${name}.png`), snapshots: Object.keys(snapshots).map(name => `${name}.snapshot.json`) };
    result.browserVersion = browser.version();
    result.pageErrors = pageErrors;
    result.consoleErrors = consoleMessages.filter(message => message.type === 'error');
    result.ok &&= pageErrors.length === 0 && result.consoleErrors.length === 0;
    await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
} catch (error) {
    const result = { ok: false, error: error.stack ?? String(error), pageErrors, consoleMessages };
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
    console.error(result.error);
    process.exitCode = 1;
} finally {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'browser-log.json'), JSON.stringify(consoleMessages, null, 2));
    await browser?.close();
    await new Promise(resolveClosed => server.close(resolveClosed));
}
