import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const sourceDir = resolve(root, 'assets/showcase');
const mediaDir = resolve(root, 'apps/site/public/media');
await mkdir(sourceDir, { recursive: true });
await mkdir(mediaDir, { recursive: true });
const url = (process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5173/playground/') + '?example=three-interop&panel=inspector';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('[data-examples]')?.dataset.effectState === 'ready', undefined, { timeout: 60000 });
  await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor();
  await page.locator('.zenfg-inspector-graph-status').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.zenfg-inspector-graph-canvas')?._cyreg?.cy.nodes().length > 0);
  await page.getByRole('button', { name: 'Toggle diagnostic group projection', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes().filter(node => node.id().startsWith('pass:')).length >= 5);
  await page.locator('.zenfg-inspector-graph-status').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Fit graph to view', exact: true }).click();
  await page.screenshot({ path: resolve(sourceDir, 'three-page.png'), fullPage: true });
  const scene = await page.locator('[data-effect-canvas]').screenshot({ path: resolve(sourceDir, 'three-scene.png') });
  const graph = await page.locator('.zenfg-inspector-graph-canvas').screenshot({ path: resolve(sourceDir, 'three-graph.png') });
  const facts = await page.evaluate(() => ({
      title: document.querySelector('[data-example-title]').textContent,
      graph: document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes().map(node => ({ id: node.id(), label: node.data('label') })),
      gpu: !!navigator.gpu,
  }));
  await writeFile(resolve(sourceDir, 'capture.json'), JSON.stringify({ url, capturedAt: new Date().toISOString(), browser: browser.version(), viewport: { width: 1440, height: 1050 }, facts, errors }, null, 2) + '\n');
  if (errors.length) throw new Error(errors.join('\n'));
  // Lay out two unaltered element captures; labels describe the source regions.
  const proof = await browser.newPage({ viewport: { width: 1440, height: 720 }, deviceScaleFactor: 1 });
  await proof.setContent('<html lang="en"><head><style>*{box-sizing:border-box}body{margin:0;background:#24283b;color:#c0caf5;font:16px Arial,sans-serif;padding:32px}header{height:64px;display:flex;align-items:baseline;gap:20px}h1{font-size:25px;margin:0}header span{color:#a9b1d6}main{display:grid;grid-template-columns:1fr 1.3fr;gap:24px;height:578px}section{border:1px solid #454d6b;border-radius:8px;overflow:hidden;background:#24283b;display:flex;flex-direction:column}h2{font-size:14px;font-weight:400;padding:16px;margin:0;border-bottom:1px solid #454d6b}img{width:100%;height:calc(100% - 49px);object-fit:contain}</style></head><body><header><h1>Three.js + Reference Renderer</h1><span>One scene. Shared color and depth. An explicit frame graph.</span></header><main><section><h2>Rendered output</h2><img alt="Real co-rendered scene" src="data:image/png;base64,' + scene.toString('base64') + '"></section><section><h2>Captured frame graph</h2><img alt="Actual ZenFG Inspector graph" src="data:image/png;base64,' + graph.toString('base64') + '"></section></main></body></html>');
  await proof.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  await proof.screenshot({ path: resolve(mediaDir, 'three-co-rendering.png') });
  console.log(JSON.stringify({ url, facts, errors, image: resolve(mediaDir, 'three-co-rendering.png') }));
} finally { await browser.close(); }
