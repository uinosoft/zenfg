// Runtime status and actual render-rate acceptance; hardware WebGPU required.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({ ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER } : process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--enable-unsafe-webgpu'] });
const context = await browser.newContext({ viewport: { width: 1277, height: 920 } });
const out = resolve('.test-dist/examples-status');
await mkdir(out, { recursive: true });
const results = [];
try {
 for (const id of (process.env.PLAYGROUND_EXAMPLES ?? 'interactive-background,typegpu-slime-mold,particles4all-framegraph,typegpu-monocular-light-injection').split(',')) {
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  console.log('Checking status ' + id);
  await page.goto((process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:4175/playground/') + '?example=' + id);
  await page.waitForFunction(() => document.querySelector('[data-effect-status-text]').textContent === 'Live', { }, { timeout: 180000 });
  await page.waitForFunction(() => !document.querySelector('[data-frame-rate]').hidden, {}, { timeout: 30000 });
  const fps = await page.locator('[data-frame-rate]').textContent();
  assert.match(fps, /^[1-9]\d* FPS$/);
  await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor();
  if (id === 'particles4all-framegraph') {
   assert.equal(await page.locator('[data-controls-host] > pre, [data-controls-host] > p').count(), 0);
   const statistics = page.getByRole('button', { name: 'Statistics', exact: true });
   const folder = statistics.locator('..');
   assert.equal(await folder.locator('input').first().isVisible(), false, 'statistics starts collapsed');
   await statistics.click();
   await page.waitForFunction(() => {
    const folder = [...document.querySelectorAll('.tp-fldv')].find(el => el.querySelector('.tp-fldv_t')?.textContent === 'Statistics');
    return Number(folder?.querySelector('input')?.value.replaceAll(',', '')) > 0;
   });
   assert.equal(await folder.locator('input').count(), 11);
   assert.ok(await folder.locator('input').evaluateAll(inputs => inputs.every(input => input.readOnly)));

   await page.waitForFunction(() => [...document.querySelectorAll('.tp-fldv')].find(el => el.querySelector('.tp-fldv_t')?.textContent === 'Statistics')?.classList.contains('tp-fldv-cpl'));
   const waitForCanvasLimit = () => page.waitForFunction(() => {
    const stage = document.querySelector('.demo-stage').getBoundingClientRect();
    const controls = document.querySelector('[data-controls-host]');
    return Math.abs(parseFloat(getComputedStyle(controls).maxHeight) - stage.height) < .1;
   });
   for (const width of [1265, 1053, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    await waitForCanvasLimit();
    const canvasSize = await page.locator('.demo-stage').boundingBox();
    const panelSize = await page.locator('[data-controls-host]').boundingBox();
    assert.ok(Math.abs(canvasSize.height - panelSize.height) < 1, 'expanded panel follows canvas height: ' + JSON.stringify({ width, canvasSize, panelSize }));
   }
   await page.setViewportSize({ width: 1053, height: 920 });
   for (let toggle = 0; toggle < 2; toggle++) {
    await page.locator('[data-directory-toggle]').click();
    await waitForCanvasLimit();
   }
   const rootToggle = page.getByRole('button', { name: 'Particles4All', exact: true });
   await rootToggle.click();
   await page.waitForFunction(() => document.querySelector('[data-controls-host]').getBoundingClientRect().height < 40);
   await rootToggle.click();
   await page.waitForFunction(() => document.querySelector('[data-controls-host]').getBoundingClientRect().height > 400);
   await page.setViewportSize({ width: 1277, height: 920 });
   await waitForCanvasLimit();

   const statusBefore = await page.locator('.runtime-status').boundingBox();
   await page.locator('[data-controls-host]').evaluate(el => el.scrollTop = el.scrollHeight);
   assert.deepEqual(await page.locator('.runtime-status').boundingBox(), statusBefore);
   assert.ok(await page.locator('[data-controls-host]').evaluate(el => el.scrollTop > 0));
   assert.equal(await page.locator('[data-controls-host] > .tp-rotv > .tp-rotv_c').evaluate(el => el.scrollTop), 0);
   await statistics.click();

   await page.locator('[data-example-title]').click(); // Leave the folder button before using the example keyboard shortcut.
   await page.keyboard.press('Space');
   await page.waitForFunction(() => document.querySelector('[data-effect-status-text]').textContent === 'Paused');
   assert.equal(await page.locator('[data-frame-rate]').isVisible(), false);
   await page.keyboard.press('Space');
   await page.waitForFunction(() => !document.querySelector('[data-frame-rate]').hidden);
   await page.locator('[data-controls-host]').evaluate(el => el.scrollTop = 0);
  }
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await page.locator('[data-frame-rate]').isVisible(), false);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  assert.equal(await page.locator('[data-frame-rate]').isVisible(), false, 'wait for fresh samples on return');
  await page.waitForFunction(() => !document.querySelector('[data-frame-rate]').hidden);
  for (const width of [1277, 390]) {
   await page.setViewportSize({ width, height: 920 });
   for (const mode of ['dark','light']) {
    await page.locator('[data-theme-mode=' + mode + ']').click();
    await page.evaluate(async () => { window.scrollTo({top:0,behavior:'instant'}); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const stage = await page.locator('.demo-stage').boundingBox();
    if (await page.locator('[data-controls-host]').isVisible()) {
     const host = await page.locator('[data-controls-host]').boundingBox();
     const pane = await page.locator('[data-controls-host] > .tp-rotv').boundingBox();
     assert.ok(pane.height >= host.height - 2, 'host clips only overflowing pane content');
    }
    const status = await page.locator('.runtime-status').boundingBox();
    assert.ok(status.x > stage.x && status.y > stage.y && status.y + status.height < stage.y + stage.height, 'status overlays canvas corner');
    if (await page.locator('[data-controls-host]').isVisible()) {
     const paneSize = await page.locator('[data-controls-host]').boundingBox();
     assert.ok(paneSize.height <= (width === 390 ? 340 : stage.height) + 1, 'pane maximum height');
    }
    await page.screenshot({ path: resolve(out, id + '-' + width + '-' + mode + '.png'), fullPage: false });
   }
  }
  assert.deepEqual(errors, []);
  results.push({ id, fps, ok:true });
  await page.close();
 }
} catch (error) { results.push({ error: String(error.stack ?? error), ok:false }); process.exitCode=1; }
finally { await writeFile(resolve(out,'report.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2)); await browser.close(); }
