// Optional hardware acceptance, using the same browser setup as the example GPU suites.
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../../..');
const output = resolve(root, '.test-dist/webgpu-runtime-gpu');
await mkdir(output, { recursive: true });
const bundle = await build({
    absWorkingDir: root,
    entryPoints: ['packages/webgpu/tests/gpu/browser.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    sourcemap: 'inline',
});
const server = createServer((request, response) => {
    if (request.url === '/suite.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(bundle.outputFiles[0].text);
        return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>ZenFG runtime GPU acceptance</title><pre id="result">Running…</pre><script type="module" src="/suite.js"></script>');
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
let browser;
try {
    const modulePath = process.env.PLAYWRIGHT_MODULE;
    const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
    browser = await chromium.launch({
        ...(process.env.GPU_TEST_BROWSER
            ? { executablePath: process.env.GPU_TEST_BROWSER }
            : process.platform === 'win32' ? { channel: 'msedge' } : {}),
        headless: true,
        args: ['--enable-unsafe-webgpu'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(error));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => globalThis.__zenfgRuntimeGpuResult !== undefined, undefined, { timeout: 120_000 });
    const result = await page.evaluate(() => globalThis.__zenfgRuntimeGpuResult);
    await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
}
finally {
    await browser?.close();
    await new Promise((closed) => server.close(closed));
}
