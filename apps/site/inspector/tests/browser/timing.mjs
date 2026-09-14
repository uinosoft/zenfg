// Development preview acceptance: EXAMPLES_URL=http://127.0.0.1:5174/playground/ node this-file.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '../../../../../');
const output = resolve(root, '.test-dist/timing-browser');
await mkdir(output, { recursive: true });
const base = process.env.EXAMPLES_URL ?? 'http://127.0.0.1:5174/playground/';
const browser = await chromium.launch({ channel: process.env.GPU_TEST_CHANNEL ?? 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
const errors = [];
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
 page.on('pageerror', error => errors.push(String(error)));
 await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { globalThis.__timingCopied = text; } } }));
 for (const example of ['minimal-frame', 'three-interop']) {
  await page.goto(base + '?example=' + example + '&panel=inspector');
  await page.waitForFunction(() => document.querySelector('[data-examples]')?.dataset.effectState === 'ready', undefined, { timeout: 90000 });
  assert.equal(await page.getByRole('combobox', { name: 'Capture timing', exact: true }).count(),0);
  const capture=page.locator('.zenfg-inspector-capture-action');
  await capture.waitFor();
   await page.locator('.zenfg-inspector-capture-action').click();
   await page.waitForFunction(() => !document.querySelector('.zenfg-inspector-capture-action')?.disabled);
   await page.evaluate(() => { globalThis.__timingCopied=undefined; });
   await page.getByRole('button', {name:'Export',exact:true}).click();
   await page.getByRole('menuitem',{name:'Copy JSON',exact:true}).click();
   await page.waitForFunction(() => typeof globalThis.__timingCopied === 'string');
   const snapshot=JSON.parse(await page.evaluate(() => globalThis.__timingCopied));
   assert.equal(snapshot.version.minor,2);
   assert.equal(snapshot.timings.cpu.status,'available');
   assert.equal(snapshot.timings.cpu.nodes.length,snapshot.graph.nodes.filter(n=>n.compileState.status==='retained').length);
   assert.notEqual(snapshot.timings.gpu.reason,'not-requested');
   await writeFile(resolve(output,example+'-both.json'),JSON.stringify(snapshot,null,2));
  await page.getByRole('tab',{name:'Passes',exact:true}).click();
  await page.screenshot({path:resolve(output,example+'-wide.png')});
  await page.setViewportSize({width:390,height:844});
  await capture.evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:resolve(output,example+'-narrow.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),'page must not overflow horizontally');
  await capture.focus();
  assert.equal(await capture.evaluate(el=>el===document.activeElement),true);
  await page.setViewportSize({width:1440,height:1000});
 }
 assert.deepEqual(errors,[]);
 console.log('CPU/GPU capture, same-frame exports, keyboard controls and narrow layout passed.');
} finally { await browser.close(); }
