// Run against the built Playground preview, e.g. PLAYGROUND_URL=http://127.0.0.1:4173/playground/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const output = resolve(import.meta.dirname, '../../../../../../.test-dist/babylon-lite-interop-gpu');
const url = new URL(process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:4173/playground/');
url.search = '?example=babylon-lite-interop&panel=none';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
    ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER }
        : process.platform === 'win32' ? { channel: 'msedge' } : {}),
    headless: true, args: ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
// The preview has no root favicon; browser chrome's implicit icon request is unrelated to the example.
await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
const errors = [], remoteRequests = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => {
    if (!request.url().startsWith(url.origin) && !/^(data|blob):/.test(request.url())) remoteRequests.push(request.url());
});
const ready = async () => {
    await page.waitForFunction(() => document.querySelector('[data-effect-status-text]')?.textContent?.startsWith('Live'));
    await page.waitForFunction(() => {
        const stage = document.querySelector('.effect-stage');
        return stage && getComputedStyle(stage).opacity === '1';
    });
};
try {
    await page.goto(url.href);
    await ready();
    await page.screenshot({ path: resolve(output, 'playground-desktop.png') });
    const canvas = page.locator('[data-effect-canvas]');
    const beforeDrag = await canvas.screenshot();
    const originalOutline = await canvas.evaluate(element => element.style.outline);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(700, 415, { steps: 12 });
    const pointerFocus = await canvas.evaluate(element => ({ active: document.activeElement === element,
        outline: getComputedStyle(element).outlineStyle, tabIndex: element.tabIndex }));
    if (pointerFocus.outline !== 'none') throw new Error(`Pointer focus regression: ${JSON.stringify(pointerFocus)}`);
    await page.screenshot({ path: resolve(output, 'playground-pointer-focus.png') });
    await page.mouse.up();
    const afterDrag = await canvas.screenshot();
    if (beforeDrag.equals(afterDrag)) throw new Error('Real mouse input did not change the rendered image');
    await canvas.focus();
    await page.keyboard.press('Shift');
    if (await canvas.evaluate(element => element.style.outline) !== originalOutline) throw new Error('Keyboard focus style was not restored');
    if (await page.locator('[data-controls-host] input').count() !== 0) throw new Error('Lite has no settings controls');
    if (!(await page.locator('[data-controls-host]').textContent()).includes('Reverse Z · Always enabled')) throw new Error('Missing fixed depth description');
    await page.locator('[data-panel-button=code]').click();
    await page.waitForFunction(() => document.querySelector('[data-source-content]')?.textContent?.includes('startBabylonLiteInterop'));
    if (!(await page.locator('[data-source-path]').textContent()).endsWith('/main.ts')) throw new Error('Expected the main.ts reading entry');
    if (await page.locator('[data-source-files] button').count() !== 8) throw new Error('Expected eight real source files');
    await page.locator('[data-source-files] button').filter({ hasText: 'resolve.ts' }).click();
    await page.waitForFunction(() => document.querySelector('[data-source-content]')?.textContent?.includes('pow(max(encoded.rgb'));
    await page.locator('[data-panel-button=inspector]').click();
    await page.getByRole('button', { name: 'Capture', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const [download] = await Promise.all([
        page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download JSON', exact: true }).click(),
    ]);
    const snapshotPath = resolve(output, 'playground-inspector.snapshot.json');
    await download.saveAs(snapshotPath);
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    if (!snapshot.graph.nodes.some(node => node.label === 'babylon-lite-interop.linearize')) throw new Error('Inspector did not capture the actual resolve node');
    await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor();
    await page.locator('.zenfg-inspector-graph-status').waitFor({ state: 'hidden' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: resolve(output, 'playground-inspector.png') });
    await page.locator('[data-overlay-close]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    // Give ResizeObserver and the demand-driven render their next frame before capturing.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: resolve(output, 'playground-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const title of ['Three.js Co-rendering', 'Babylon.js Co-rendering', 'Reference Renderer', 'Babylon Lite Co-rendering']) {
        await page.getByRole('combobox', { name: 'Select example', exact: true }).click();
        const choices = await page.getByRole('option').allTextContents();
        const choice = choices.find(text => text.startsWith(title));
        if (!choice) throw new Error(`Missing option ${title}: ${choices.join(', ')}`);
        await page.getByRole('option', { name: choice, exact: true }).click();
        await ready();
    }
    if (errors.length || remoteRequests.length) throw new Error(JSON.stringify({ errors, remoteRequests }));
    const result = { ok: true, browser: browser.version(), errors, remoteRequests, sourceFiles: 8,
        checks: ['desktop', 'real mouse drag', 'pointer/keyboard focus', 'fixed Reverse Z', 'code', 'Inspector', 'mobile', 'four example switches'] };
    await writeFile(resolve(output, 'playground-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
} catch (error) {
    await writeFile(resolve(output, 'playground-result.json'), JSON.stringify({ ok: false, error: String(error), errors, remoteRequests }, null, 2));
    throw error;
} finally { await browser.close(); }
