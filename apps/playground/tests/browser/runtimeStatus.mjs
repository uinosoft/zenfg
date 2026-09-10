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
  const waitForFps = async () => {
   if (id === 'babylon-lite-interop') {
    // This example renders on demand: orbit it to measure actual submitted frames.
    const box = await page.locator('[data-effect-canvas]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 0; step < 45; step++) {
     await page.mouse.move(box.x + box.width / 2 + Math.sin(step / 10) * 50, box.y + box.height / 2);
     await page.waitForTimeout(20);
    }
    await page.mouse.up();
   }
   await page.waitForFunction(() => Number(document.querySelector('[data-frame-rate]')?.value) > 0, {}, { timeout: 30000 });
  };
  await waitForFps();
  const history = page.locator('[data-frame-rate-history] polyline');
  await page.waitForFunction(() => (document.querySelector('[data-frame-rate-history] polyline')?.getAttribute('points')?.trim().split(' ').length ?? 0) >= 2);
  assert.doesNotMatch(await history.getAttribute('points'), /NaN|Infinity/);
  if (id === 'particles4all-framegraph') {
   const updates = await history.evaluate(line => new Promise(resolve => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(line, { attributes: true, attributeFilter: ['points'] });
    setTimeout(() => { observer.disconnect(); resolve(count); }, 1000);
   }));
   assert.ok(updates > 10, 'graph advances at render cadence, not the old 2 Hz timer: ' + updates);
  }
  const fps = await page.locator('[data-frame-rate]').inputValue();
  assert.match(fps, /^[1-9]\d*$/);
  await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor();
  assert.equal(await page.locator('[data-frame-rate]').getAttribute('readonly'), '');
  assert.equal(await page.locator('[data-metrics-host] .tp-rotv_b').isVisible(), false);
  if (id === 'babylon-lite-interop' || id === 'interactive-background') {
   assert.equal(await page.locator('[data-controls-host]').isVisible(), false);
   assert.ok((await page.locator('[data-controls-panel]').boundingBox()).height <= 72, 'monitor-only pane stays compact');
  }
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
    const controls = document.querySelector('[data-controls-panel]');
    return Math.abs(parseFloat(getComputedStyle(controls).maxHeight) - stage.height) < .1;
   });
   for (const width of [1265, 1053, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    await waitForCanvasLimit();
    const canvasSize = await page.locator('.demo-stage').boundingBox();
    const panelSize = await page.locator('[data-controls-panel]').boundingBox();
    assert.ok(Math.abs(canvasSize.height - panelSize.height) < 1, 'expanded panel follows canvas height: ' + JSON.stringify({ width, canvasSize, panelSize }));
   }
   await page.setViewportSize({ width: 1053, height: 920 });
   for (let toggle = 0; toggle < 2; toggle++) {
    await page.locator('[data-directory-toggle]').click();
    await waitForCanvasLimit();
   }
   assert.equal(await page.locator('[data-controls-host] .tp-rotv_b').isVisible(), false, 'no root fold button');
   const scene = page.getByRole('button', { name: 'Scene', exact: true });
   await scene.click();
   await page.waitForFunction(() => [...document.querySelectorAll('.tp-fldv')].find(el => el.querySelector('.tp-fldv_t')?.textContent === 'Scene')?.classList.contains('tp-fldv-cpl'));
   assert.equal(await page.locator('[data-frame-rate]').isVisible(), true, 'folder folding never hides FPS');
   await scene.click();
   await page.setViewportSize({ width: 1277, height: 920 });
   await waitForCanvasLimit();

   const statusBefore = await page.locator('[data-metrics-host]').boundingBox();
   await page.locator('[data-controls-host]').evaluate(el => el.scrollTop = el.scrollHeight);
   assert.deepEqual(await page.locator('[data-metrics-host]').boundingBox(), statusBefore, 'FPS stays fixed while parameters scroll');
   assert.ok(await page.locator('[data-controls-host]').evaluate(el => el.scrollTop > 0));
   assert.equal(await page.locator('[data-controls-host] > .tp-rotv > .tp-rotv_c').evaluate(el => el.scrollTop), 0);
   const paneState = () => page.locator('[data-controls-host]').evaluate(el => ({
    scroll: el.scrollTop,
    folders: [...el.querySelectorAll('.tp-fldv')].map(folder => folder.classList.contains('tp-fldv-expanded')),
    values: [...el.querySelectorAll('input:not([readonly]), select')].map(input => [input.value, input.checked]),
   }));
   const beforeTheme = await paneState();
   for (const mode of ['light', 'dark']) {
    await page.locator('[data-theme-mode=' + mode + ']').click();
    assert.deepEqual(await paneState(), beforeTheme, 'theme preserves values, folds and host scroll');
    const monitor = await folder.locator('input').first().evaluate(el => {
     const s = getComputedStyle(el); return [s.color, s.backgroundColor];
    });
    assert.deepEqual(monitor, mode === 'dark'
     ? ['rgb(169, 177, 214)', 'rgb(32, 36, 55)']
     : ['rgb(89, 98, 125)', 'rgb(238, 240, 247)']);
   }
   await statistics.click();

   await page.locator('[data-example-title]').click(); // Leave the folder button before using the example keyboard shortcut.
   await page.keyboard.press('Space');
   await page.waitForFunction(() => document.querySelector('[data-effect-status-text]').textContent === 'Paused');
   assert.equal(await page.locator('[data-frame-rate]').inputValue(), '—');
   assert.equal(await page.locator('.runtime-status').isVisible(), true, 'paused feedback stays visible');
   const pausedHistory = await history.getAttribute('points');
   await page.waitForTimeout(650);
   assert.equal(await history.getAttribute('points'), pausedHistory, 'pause freezes history without recording zero');
   const graphGeometry = () => history.evaluate(line => {
    const svg = line.ownerSVGElement;
    const points = line.getAttribute('points').trim().split(' ').map(pair => pair.split(',').map(Number));
    return { count: points.length, right: points.at(-1)[0] / svg.clientWidth };
   });
   const beforeResize = await graphGeometry();
   await page.setViewportSize({ width: 390, height: 920 });
   await page.waitForTimeout(100);
   const afterResize = await graphGeometry();
   assert.equal(afterResize.count, beforeResize.count, 'paused resize never appends a sample');
   assert.ok(Math.abs(afterResize.right - beforeResize.right) < .01, 'frozen history redraws to the resized graph width');
   await page.setViewportSize({ width: 1277, height: 920 });
   await page.keyboard.press('Space');
   await waitForFps();
   await page.locator('[data-controls-host]').evaluate(el => el.scrollTop = 0);
  }
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await page.locator('[data-frame-rate]').inputValue(), '—');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  assert.equal(await page.locator('[data-frame-rate]').inputValue(), '—', 'wait for fresh samples on return');
  await waitForFps();
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
    assert.equal(await page.locator('[data-frame-rate]').isVisible(), true);
    const panelSize = await page.locator('[data-controls-panel]').boundingBox();
    assert.ok(panelSize.height <= (width === 390 ? 340 : stage.height) + 1, 'combined panes stay within height limit');
    const metricsSize = await page.locator('[data-metrics-host]').boundingBox();
    assert.ok(metricsSize.height >= 70 && metricsSize.height <= 71, 'history pane keeps its compact fixed height');
    const graphSize = await page.locator('[data-frame-rate-history]').boundingBox();
    assert.ok(graphSize.width >= metricsSize.width - 20, 'history spans the full pane width without a duplicate label');
    assert.equal(await history.evaluate(el => getComputedStyle(el).stroke), mode === 'dark' ? 'rgb(122, 162, 247)' : 'rgb(41, 89, 170)');
    assert.doesNotMatch(await history.getAttribute('points'), /NaN|Infinity/);
    const metricsBefore = await page.locator('[data-metrics-host]').boundingBox();
    await page.locator('[data-controls-host]').evaluate(el => el.scrollTop = el.scrollHeight);
    assert.deepEqual(await page.locator('[data-metrics-host]').boundingBox(), metricsBefore, 'FPS is fixed at every viewport');
    await page.locator('[data-controls-host]').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: resolve(out, id + '-' + width + '-' + mode + '.png'), fullPage: false });
   }
  }
  if (id === 'babylon-lite-interop') {
   await page.waitForFunction(() => document.querySelector('[data-frame-rate]').value === '—');
   assert.equal(await page.locator('[data-frame-rate]').isVisible(), true, 'idle on-demand renderer keeps the monitor with an empty sample');
  }
  assert.deepEqual(errors, []);
  results.push({ id, fps, ok:true });
  await page.close();
 }
} catch (error) { results.push({ error: String(error.stack ?? error), ok:false }); process.exitCode=1; }
finally { await writeFile(resolve(out,'report.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2)); await browser.close(); }
