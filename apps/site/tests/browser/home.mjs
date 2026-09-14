// Hardware WebGPU visual + lifecycle acceptance. Set PLAYWRIGHT_MODULE and HOME_URL as needed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const base = process.env.HOME_URL ?? 'http://127.0.0.1:5174/';
const out = resolve('.test-dist/home-visual');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER } : process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--enable-unsafe-webgpu'] });
const report = [];
async function paintedContrast(page) {
	const text = await page.evaluate(() => [...document.querySelectorAll('.summary,.value')].map(el => {
		const range = document.createRange(); range.selectNodeContents(el);
		return { color: getComputedStyle(el).color, rects: [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })) };
	}));
	const hidden = await page.addStyleTag({ content: '.intro { visibility: hidden !important; }' });
	const png = (await page.screenshot()).toString('base64');
	await hidden.evaluate(el => el.remove());
	return page.evaluate(async ({ png, text }) => {
		const blob = await (await fetch('data:image/png;base64,' + png)).blob();
		const bitmap = await createImageBitmap(blob);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
		const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		const lum = rgb => rgb.map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
		return text.map(({ color, rects }) => {
			const fg = lum(color.match(/[\d.]+/g).slice(0, 3).map(Number)); let minimum = Infinity;
			for (const r of rects) for (let y = Math.ceil(r.y); y < r.y + r.height; y += 2) for (let x = Math.ceil(r.x); x < r.x + r.width; x += 2) {
				const i = (y * canvas.width + x) * 4; const bg = lum([pixels[i], pixels[i + 1], pixels[i + 2]]);
				minimum = Math.min(minimum, (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05));
			}
			return minimum;
		});
	}, { png, text });
}
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
	const errors = [];
	page.on('pageerror', error => errors.push(String(error)));
	page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
	await page.addInitScript(() => {
		localStorage.setItem('zenfg-language', 'en');
		localStorage.setItem('zenfg-theme', 'dark');
		window.gpuAudit = { devices: [], submits: 0 };
		if (typeof GPUAdapter !== 'undefined') {
			const request = GPUAdapter.prototype.requestDevice;
			GPUAdapter.prototype.requestDevice = async function(...args) {
				const device = await request.apply(this, args); window.gpuAudit.devices.push(device); return device;
			};
			const submit = GPUQueue.prototype.submit;
			GPUQueue.prototype.submit = function(...args) { window.gpuAudit.submits++; return submit.apply(this, args); };
		}
	});
	await page.goto(base);
	await page.waitForFunction(() => document.documentElement.dataset.webgpuBackground === 'ready');
	assert.equal(await page.locator('[data-zenfg-background]').getAttribute('data-frame-graph-passes'), '8');
	const wideComposition = new Map();
	for (const width of [2560, 1920, 1440, 1024, 768, 390, 360, 320]) {
		await page.setViewportSize({ width, height: 1000 });
		for (const mode of ['dark', 'light']) {
			if (await page.locator('html').getAttribute('data-theme') !== mode) await page.locator('[data-theme-toggle]').click();
			for (const language of ['en', 'zh-CN']) {
				if (await page.locator('html').getAttribute('lang') !== language) {
					await page.locator('[data-language-toggle]').click();
					await page.locator(`[data-language-choice="${language}"]`).click();
				}
				await page.evaluate(() => scrollTo(0, 0));
				assert.deepEqual(await page.locator('h1,.site-brand').allTextContents(), ['ZenFG', 'ZenFG', 'ZenFG']);
				assert.ok(await page.locator('.brand-accent').evaluateAll(elements => { const probe = document.createElement('span'); probe.style.color = 'var(--zenfg-accent)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return elements.every(el => getComputedStyle(el).color === color); }));
				assert.equal(await page.locator('[data-theme-toggle] svg').getAttribute('data-icon'), mode === 'dark' ? 'moon' : 'sun');
				assert.equal(await page.locator('[data-theme-toggle]').getAttribute('title'), language === 'zh-CN' ? (mode === 'dark' ? '切换到亮色主题' : '切换到暗色主题') : (mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'));
				assert.equal(await page.locator('.footer-links a').count(), 2);
				await page.waitForTimeout(150);
				const layout = await page.evaluate(() => {
					const intro = document.querySelector('.intro').getBoundingClientRect();
					const art = document.querySelector('.cover-art').getBoundingClientRect();
					const hero = document.querySelector('.hero').getBoundingClientRect();
					const content = document.querySelector('main').getBoundingClientRect();
					const canvas = document.querySelector('[data-zenfg-background]');
					const marker = document.querySelector('.cover-story-marker').getBoundingClientRect();
					const copyRects = [...document.querySelectorAll('h1,.summary,.value')].flatMap(el => { const range = document.createRange(); range.selectNodeContents(el); return [...range.getClientRects()]; });
					const markerClearsCopy = copyRects.every(rect => marker.right <= rect.left || marker.left >= rect.right || marker.bottom <= rect.top || marker.top >= rect.bottom);
					const toRgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
					const luminance = rgb => rgb.map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
					const bg = luminance(toRgb(getComputedStyle(document.body).backgroundColor));
					const contrast = [...document.querySelectorAll('.summary,.value,.capabilities p,.note,.cover-story-marker')].map(el => {
						const fg = luminance(toRgb(getComputedStyle(el).color)); return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
					});
					return {
						overflow: document.documentElement.scrollWidth > innerWidth,
						bounded: art.top >= hero.top - 1 && art.bottom <= hero.bottom + 1,
						contentBounded: innerWidth <= 900
                            ? Math.abs(art.left) < 1 && Math.abs(art.right - document.documentElement.clientWidth) < 1
                            : art.left >= content.left && Math.abs(art.right - content.right) < 1 && content.width <= 1200,
						overlaps: art.left < intro.right && art.top < intro.bottom,
						markerFits: marker.left >= art.left + 6 && marker.right <= art.right - 6 && marker.top >= art.top + 6 && marker.bottom <= art.bottom - 6, markerClearsCopy,
						composition: { width: canvas.width, height: canvas.height, anchorX: marker.right - content.left, anchorY: marker.top - content.top },
						pixels: canvas.width * canvas.height, contrast
					};
				});
				assert.equal(layout.overflow, false); assert.equal(layout.bounded, true); assert.equal(layout.overlaps, true);
				assert.equal(layout.contentBounded, true, 'canvas fills narrow screens and stays content-bounded on wide screens');
				if (width >= 1440) {
					const key = mode + language;
					if (wideComposition.has(key)) assert.deepEqual(layout.composition, wideComposition.get(key), 'page margins do not change render size or the local anchor');
					else wideComposition.set(key, layout.composition);
				}
				assert.equal(layout.markerFits, true); assert.ok(layout.pixels <= (width < 600 ? 300000 : 1000000));
				assert.equal(layout.markerClearsCopy, true, JSON.stringify({ width, mode, language, markerClearsCopy: layout.markerClearsCopy }));
				assert.ok(layout.contrast.every(value => value >= 4.5), JSON.stringify(layout.contrast));
				await page.screenshot({ path: resolve(out, `${width}-${mode}-${language}.png`), fullPage: true });
				const actualContrast = await paintedContrast(page);
				assert.ok(actualContrast.every(value => value >= 4.5), JSON.stringify({ width, mode, language, actualContrast }));
				report.push({ width, mode, language, ...layout, actualContrast });
			}
		}
	}
	assert.equal(await page.evaluate(() => window.gpuAudit.devices.length), 1, 'theme changes reuse the device');
	await page.setViewportSize({ width: 390, height: 1000 });
	// A fully offscreen artwork must not keep submitting frames.
	await page.evaluate(() => { const spacer = document.createElement('div'); spacer.id = 'qa-spacer'; spacer.style.height = '2000px'; document.body.append(spacer); scrollTo(0, document.body.scrollHeight); });
	await page.waitForTimeout(250);
	const paused = await page.evaluate(() => window.gpuAudit.submits);
	await page.waitForTimeout(200);
	assert.equal(await page.evaluate(() => window.gpuAudit.submits), paused);
	await page.evaluate(() => { document.querySelector('#qa-spacer').remove(); document.querySelector('.cover-art').scrollIntoView(); });
	await page.waitForFunction(count => window.gpuAudit.submits > count, paused);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.waitForTimeout(150);
	const reduced = await page.evaluate(() => window.gpuAudit.submits);
	await page.waitForTimeout(150);
	assert.equal(await page.evaluate(() => window.gpuAudit.submits), reduced);
	assert.equal(await page.locator('.cover-story-marker__orb').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.waitForFunction(count => window.gpuAudit.submits > count, reduced);
	// Only a confirmed failure shows the static artwork.
	await page.evaluate(() => window.gpuAudit.devices[0].destroy());
	await page.waitForFunction(() => document.documentElement.dataset.webgpuBackground === 'failed');
	assert.equal(await page.locator('.cover-fallback').evaluate(el => getComputedStyle(el).visibility), 'visible');
	if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.locator('[data-theme-toggle]').click();
	assert.equal(await page.evaluate(() => window.gpuAudit.devices.length), 1);
	await page.locator('.hero-actions a').last().focus();
	await page.keyboard.press('Tab');
	assert.equal(await page.locator('.cover-story-marker').evaluate(el => document.activeElement === el), true);
	assert.equal(await page.locator('.cover-story-marker').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
	await page.keyboard.press('Enter');
	await page.waitForURL(url => url.searchParams.get('example') === 'refractive-flow' && url.searchParams.get('panel') === 'inspector');
	assert.ok(page.url().includes('example=refractive-flow&panel=inspector'));
	await page.waitForFunction(() => document.querySelector('[data-effect-canvas]')?.dataset.frameGraphPasses === '8');
	await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor();
	await page.screenshot({ path: resolve(out, 'examples-refractive-flow.png'), fullPage: true });
	await page.goto(new URL('playground/?example=interactive-background&panel=inspector', base).href);
	await page.waitForFunction(() => document.querySelector('[data-effect-canvas]')?.dataset.frameGraphPasses === '5');
	await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor();
	assert.deepEqual(errors, []);
	await page.close();
	for (const theme of ['dark', 'light']) {
		const fallback = await browser.newPage({ viewport: { width: 390, height: 1000 } });
		await fallback.addInitScript(theme => { Object.defineProperty(navigator, 'gpu', { value: undefined }); localStorage.setItem('zenfg-theme', theme); }, theme);
		await fallback.goto(base);
		await fallback.locator('.cover-fallback svg').waitFor();
		await fallback.waitForFunction(() => document.documentElement.dataset.webgpuBackground === 'failed');
		await fallback.screenshot({ path: resolve(out, `fallback-${theme}.png`), fullPage: true });
		await fallback.close();
	}
	// Slow GPU initialization must stay on the page background, without a placeholder flash.
	for (const theme of ['dark', 'light']) {
		const startup = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		await startup.addInitScript(theme => {
			localStorage.setItem('zenfg-theme', theme);
			const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
			navigator.gpu.requestAdapter = async (...args) => {
				await new Promise(resolve => { window.releaseCoverStartup = resolve; });
				return request(...args);
			};
		}, theme);
		await startup.goto(base);
		await startup.waitForFunction(() => typeof window.releaseCoverStartup === 'function');
		assert.equal(await startup.locator('.cover-fallback').evaluate(el => getComputedStyle(el).visibility), 'hidden');
		assert.equal(await startup.locator('[data-zenfg-background]').evaluate(el => getComputedStyle(el).opacity), '0');
		await startup.screenshot({ path: resolve(out, `initializing-${theme}.png`) });
		await startup.evaluate(() => window.releaseCoverStartup());
		await startup.waitForFunction(() => document.documentElement.dataset.webgpuBackground === 'ready');
		await startup.waitForFunction(() => getComputedStyle(document.querySelector('[data-zenfg-background]')).opacity === '1');
		assert.equal(await startup.locator('.cover-fallback').evaluate(el => getComputedStyle(el).visibility), 'hidden');
		await startup.close();
	}
	const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
	await touch.goto(base);
	await touch.waitForFunction(() => document.documentElement.dataset.webgpuBackground === 'ready');
	assert.ok(await touch.locator('[data-zenfg-background]').evaluate(el => el.width * el.height <= 300000));
	assert.equal(await touch.locator('[data-zenfg-background]').evaluate(el => getComputedStyle(el).touchAction), 'pan-y');
	assert.ok(await touch.locator('.site-header .site-control').evaluateAll(elements => elements.every(el => { const rect = el.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44; })));
	const cdp = await touch.context().newCDPSession(touch);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 370, y: 420 }] });
	for (const y of [390, 350, 310, 270, 230, 190]) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 370, y }] });
		await touch.waitForTimeout(20);
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await touch.waitForFunction(() => scrollY > 100);
	await touch.close();
	report.push({ lifecycle: 'theme reuse, offscreen pause, reduced motion, device loss, failure-only fallback, blank initialization, keyboard exploration, native touch scrolling and old example passed' });
} catch (error) { report.push({ error: String(error.stack ?? error) }); process.exitCode = 1; }
finally { await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close(); }
