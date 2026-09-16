// Homepage content and crawler metadata against the complete production tree.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const base = process.env.CONTENT_URL ?? 'http://127.0.0.1:4183/zenfg/';
const out = resolve('.test-dist/home-content');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--enable-unsafe-webgpu'] });
const report = [];
try {
  const crawler = await browser.newContext({ javaScriptEnabled: false });
  const page = await crawler.newPage();
  for (const path of ['', 'playground/', 'inspector/', 'docs/', 'docs/concepts.html', 'docs/guides/inspector.html']) {
    await page.goto(base + path);
    assert.equal(await page.locator('link[rel=canonical]').count(), 1);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://uinosoft.github.io/zenfg/' + path);
    assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), 'https://uinosoft.github.io/zenfg/' + path);
    assert.equal(await page.locator('meta[property="og:title"]').count(), 1);
    assert.ok(await page.locator('meta[property="og:description"]').getAttribute('content'));
    assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'), 'https://uinosoft.github.io/zenfg/brand/zenfg-social.png');
    assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
    if (path === 'docs/') assert.equal(await page.locator('img[src*=three-co-rendering]').count(), 0);
    report.push({ crawler: path || 'home', ok: true });
  }
  await crawler.close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const view = await context.newPage();
  const errors = [];
  view.on('pageerror', error => errors.push(String(error)));
  await view.goto(base);
  const catalog = (await Promise.all((await readdir('apps/site/playground/src/catalog')).filter(file => file.endsWith('.ts')).map(file => readFile('apps/site/playground/src/catalog/' + file, 'utf8')))).join('\n');
  const featured = await view.locator('.featured-card').evaluateAll(links => links.map(link => new URL(link.href).searchParams.get('example')));
  assert.deepEqual(featured, ['reference-renderer', 'three-interop', 'playcanvas-gsplat-streaming-interop', 'typegpu-slime-mold']);
  for (const id of featured) assert.ok(catalog.includes("id: '" + id + "'"), 'featured example exists in actual catalog');
  const links = await view.locator('main a').evaluateAll(elements => [...new Set(elements.map(a => a.href))]);
  for (const href of links) {
    const response = await context.request.get(href);
    assert.ok(response.ok(), href);
    const target = new URL(href);
    if (target.hash) {
      const document = await response.text();
      assert.ok(document.includes('id="' + decodeURIComponent(target.hash.slice(1)) + '"'), href + ' anchor');
    }
  }
  for (const width of [1440, 1024, 800, 390, 320]) {
    await view.setViewportSize({ width, height: 1000 });
    for (const theme of ['dark', 'light']) {
      if (await view.locator('html').getAttribute('data-theme') !== theme) await view.locator('[data-theme-toggle]').click();
      for (const language of ['en', 'zh-CN']) {
        if (await view.locator('html').getAttribute('lang') !== language) {
          await view.locator('[data-language-toggle]').click();
          await view.locator('[data-language-choice="' + language + '"]').click();
        }
        await view.locator('.inspection-figure img').scrollIntoViewIfNeeded();
        await view.waitForFunction(() => document.querySelector('.inspection-figure img').naturalWidth === 1440);
        assert.equal(await view.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await view.locator('.home-section h2').count(), 4);
        assert.equal(await view.locator('.featured-card').count(), 4);
        assert.ok(await view.locator('.inspection-figure img').getAttribute('alt'));
        await view.evaluate(() => scrollTo(0,0));
        await view.screenshot({ path: resolve(out, width + '-' + theme + '-' + language + '.png'), fullPage: true });
        report.push({ width, theme, language, height: await view.evaluate(() => document.body.scrollHeight) });
      }
    }
  }
  await context.close();
  const fallback = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await fallback.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  const offline = await fallback.newPage();
  await offline.goto(base);
  await offline.locator('.vision').scrollIntoViewIfNeeded();
  assert.equal(await offline.locator('.featured-card').count(), 4);
  assert.equal(await offline.locator('.start-links a').count(), 2);
  await offline.locator('.inspection-figure img').scrollIntoViewIfNeeded();
  await offline.locator('.inspection-figure img').evaluate(image => image.decode());
  assert.ok(await offline.locator('.inspection-figure img').evaluate(image => image.complete && image.naturalWidth > 0));
  assert.equal(errors.length, 0, errors.join('\n'));
  report.push({ fallback: 'All content remains available without WebGPU', errors });
  await fallback.close();
} catch (error) { report.push({ error: String(error.stack ?? error) }); process.exitCode = 1; }
finally { await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); await browser.close(); }
