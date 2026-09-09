// Run against build:pages + preview with an existing Playwright installation.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../../../..');
const output = resolve(root, '.test-dist/playground-source');
await mkdir(output, { recursive: true });
const base = new URL(process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:4175/playground/');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({
    ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER }
        : process.platform === 'win32' ? { channel: 'msedge' } : {}),
    headless: true, args: ['--enable-unsafe-webgpu'],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write']
});
const ids = [
    'interactive-background', 'reference-renderer', 'three-interop', 'babylon-interop', 'babylon-lite-interop',
    'typegpu-slime-mold', 'typegpu-monocular-light-injection', 'particles4all-framegraph',
    'minimal-frame', 'transient-to-present', 'imported-resource', 'persistent-state',
    'external-submission', 'snapshot-export', 'gpu-timing', 'compute-output',
];
const results = [];
try {
    for (const [index, id] of ids.entries()) {
        if (process.env.PLAYGROUND_EXAMPLES && !process.env.PLAYGROUND_EXAMPLES.split(',').includes(id)) continue;
        console.log(`Checking ${id}`);
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        let sourceVerified = false;
        page.on('pageerror', error => errors.push(String(error)));
        page.on('requestfailed', request => {
            const failure = { url: request.url(), error: request.failure()?.errorText };
            requests.push(failure);
            console.log(`${id} request failed: ${JSON.stringify(failure)}`);
        });
        try {
            await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
            const url = new URL(base);
            url.search = new URLSearchParams({ example: id, panel: 'code' }).toString();
            await page.goto(url.href);
            const content = page.locator('[data-source-content]');
            const buttons = page.locator('[data-source-files] button');
            await content.locator('.shiki').waitFor();
            const entryPath = await page.locator('[data-source-path]').textContent();
            assert.equal(entryPath.endsWith('/main.ts'), index < 8, id);
            assert.equal(await buttons.first().getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('.source-files__entry').count(), 1);
            const actual = await readFile(resolve(root, entryPath), 'utf8');
            assert.equal((await content.textContent()).trimEnd(), actual.trimEnd());
            await page.locator('[data-copy-source]').click();
            await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
            // Windows clipboard text uses CRLF even when the repository file uses LF.
            assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), actual.replaceAll('\r\n', '\n'));
            assert.equal(await content.locator('.shiki').evaluate(el => getComputedStyle(el).fontSize), '14px');
            assert.equal(await content.locator('.shiki').evaluate(el => getComputedStyle(el).lineHeight), '23.8px');
            assert.equal(await buttons.first().evaluate(el => getComputedStyle(el).fontSize), '12px');
            assert.equal(await page.locator('[data-source-path]').evaluate(el => getComputedStyle(el).fontSize), '12px');
            assert.ok(await buttons.last().getAttribute('title'));

            if (['three-interop', 'typegpu-monocular-light-injection', 'particles4all-framegraph'].includes(id)) {
                await page.screenshot({ path: resolve(output, `${id}-desktop.png`) });
            }
            await content.evaluate(el => { el.scrollTop = 300; el.scrollLeft = 200; });
            await buttons.nth(1).click();
            await page.waitForFunction(() => !document.querySelector('[data-copy-source]').disabled);
            assert.deepEqual(await content.evaluate(el => [el.scrollTop, el.scrollLeft]), [0, 0]);
            const selected = await page.locator('[data-source-files] [aria-pressed=true]').getAttribute('data-source-id');
            await page.locator('[data-overlay-close]').click();
            await page.locator('[data-panel-button=code]').click();
            assert.equal(await page.locator('[data-source-files] [aria-pressed=true]').getAttribute('data-source-id'), selected);
            await buttons.first().click();
            await page.waitForFunction(() => !document.querySelector('[data-copy-source]').disabled);
            await page.setViewportSize({ width: 390, height: 844 });
            assert.equal(await content.locator('.shiki').evaluate(el => getComputedStyle(el).fontSize), '13px');
            assert.equal(await page.locator('[data-source-files]').evaluate(el => getComputedStyle(el).flexDirection), 'row');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
            if (['three-interop', 'typegpu-monocular-light-injection', 'particles4all-framegraph'].includes(id)) {
                await page.screenshot({ path: resolve(output, `${id}-mobile.png`) });
            }
            await page.setViewportSize({ width: 1440, height: 900 });
            sourceVerified = true;
            await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('[data-playground]').dataset.effectState),
                undefined, { timeout: Number(process.env.PLAYGROUND_RUNTIME_TIMEOUT_MS ?? (id.includes('monocular') ? 240_000 : 120_000)) });
            assert.equal(await page.locator('[data-playground]').getAttribute('data-effect-state'), 'ready',
                await page.locator('[data-effect-status-text]').textContent());
            await page.locator('[data-panel-button=inspector]').click();
            await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor();
            await page.locator('.zenfg-inspector-graph-status').waitFor({ state: 'hidden', timeout: 120_000 });
            await page.getByRole('button', { name: 'Export', exact: true }).click();
            const [download] = await Promise.all([
                page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download JSON', exact: true }).click(),
            ]);
            const snapshotPath = resolve(output, `${id}.snapshot.json`);
            await download.saveAs(snapshotPath);
            const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
            assert.ok(snapshot.graph.nodes.length > 0, `${id}: real captured nodes`);
            assert.deepEqual(errors, [], `${id}: browser errors`);
            results.push({ id, entryPath, files: await buttons.count(), capturedNodes: snapshot.graph.nodes.length, ok: true });
            console.log(`Passed ${id}: ${snapshot.graph.nodes.length} nodes`);
        } catch (error) {
            const status = await page.locator('[data-effect-status-text]').textContent().catch(() => undefined);
            await page.screenshot({ path: resolve(output, `${id}-failure.png`) }).catch(() => { });
            results.push({ id, ok: false, sourceVerified, error: String(error), status, errors, requests });
            console.error(`Failed ${id}: ${String(error)}; status=${status}`);
        } finally {
            await page.close();
        }
    }
    const ok = results.every(result => result.ok);
    const report = process.env.PLAYGROUND_EXAMPLES ? 'targeted-result.json' : 'result.json';
    await writeFile(resolve(output, report), JSON.stringify({ ok, browser: browser.version(), results }, null, 2));
    if (!ok) process.exitCode = 1;
} catch (error) {
    await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: false, results, error: String(error) }, null, 2));
    throw error;
} finally {
    await browser.close();
}
