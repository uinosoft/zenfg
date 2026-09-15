// Production fullscreen acceptance; uses the same hardware WebGPU setup as runtimeStatus.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({
	...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
	headless: true, args: ['--enable-unsafe-webgpu'],
});
const base = process.env.EXAMPLES_URL ?? 'http://127.0.0.1:4173/playground/';
const output = resolve('.test-dist/examples-fullscreen');
await mkdir(output, { recursive: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1277, height: 920 } });
page.on('pageerror', error => errors.push(String(error)));
const ready = () => page.waitForFunction(() => document.querySelector('[data-examples]').dataset.effectState === 'ready');
const full = () => page.locator('[data-examples]').getAttribute('data-full');
const button = page.locator('[data-canvas-expand]');
const canvasSized = () => page.waitForFunction(() => {
	const canvas = document.querySelector('[data-effect-canvas]');
	const box = canvas.getBoundingClientRect();
	return canvas.width > 0 && Math.abs(canvas.width / canvas.height - box.width / box.height) < .015;
});
const nextLayout = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
	await page.goto(base + '?example=reference-renderer&panel=code&quality=high&tag=a&tag=b#main-content');
	await ready();
	await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
	await page.locator('[data-controls-host] .tp-ckbv').first().click();
	await page.evaluate(() => {
		window.__fullscreenQA = {
			canvas: document.querySelector('[data-effect-canvas]'),
			pane: document.querySelector('[data-controls-host]').firstElementChild,
			checked: document.querySelector('[data-controls-host] input[type=checkbox]').checked,
			history: history.length,
		};
		history.replaceState({ unrelated: 'keep' }, '', location.href);
	});
	await page.evaluate(() => window.scrollTo({ top: 40, behavior: 'instant' }));
	await button.focus();
	const scroll = await page.evaluate(() => scrollY);
	await button.click();
	assert.equal(await full(), 'true');
	assert.equal(await button.getAttribute('aria-label'), 'Exit fullscreen');
	assert.equal(new URL(page.url()).searchParams.get('full'), 'true');
	assert.equal(await page.locator('.site-header').isVisible(), false);
	assert.equal(await page.locator('[data-workbench]').isVisible(), false);
	assert.equal(await page.locator('[data-metrics-host]').isVisible(), false);
	await page.waitForFunction(() => /^[1-9]\d*$/.test(document.querySelector('[data-canvas-fps]').textContent));
	assert.equal(await page.locator('[data-canvas-fps]').isVisible(), true);
	await page.keyboard.press('Shift+Tab');
	assert.ok(await page.evaluate(() => document.querySelector('[data-demo-card]').contains(document.activeElement)));
	await page.keyboard.press('Tab');
	assert.equal(await button.evaluate(el => el === document.activeElement), true);

	for (const viewport of [{ width: 1277, height: 920 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
		await page.setViewportSize(viewport);
		await nextLayout();
		await canvasSized();
		const stage = await page.locator('.demo-stage').boundingBox();
		assert.deepEqual(stage, { x: 0, y: 0, ...viewport });
		const controls = await page.locator('[data-controls-panel]').boundingBox();
		const exit = await button.boundingBox();
		assert.ok(controls.x + controls.width <= viewport.width);
		assert.ok(Math.abs(exit.x + exit.width - (viewport.width - 12)) < 1);
		assert.ok(Math.abs(exit.y + exit.height - (viewport.height - 12)) < 1);
		assert.ok(controls.y + controls.height + 12 <= exit.y);
		assert.ok(controls.y >= 0 && controls.y + controls.height <= viewport.height);
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await page.screenshot({ path: resolve(output, 'full-' + viewport.width + '.png') });
	}
	await page.setViewportSize({ width: 1277, height: 920 });
	await button.click();
	assert.equal(await full(), 'false');
	const normalStage = await page.locator('.demo-stage').boundingBox();
	const normalButton = await button.boundingBox();
	assert.ok(Math.abs(normalStage.x + normalStage.width - normalButton.x - normalButton.width - 13) < 1);
	assert.ok(Math.abs(normalStage.y + normalStage.height - normalButton.y - normalButton.height - 13) < 1);
	assert.equal(await page.evaluate(() => scrollY), scroll);
	assert.equal(await button.evaluate(el => el === document.activeElement), true);
	assert.equal(await page.locator('[data-panel-button=code]').getAttribute('aria-selected'), 'true');
	assert.ok(await page.evaluate(() => {
		const original = window.__fullscreenQA;
		return original.canvas === document.querySelector('[data-effect-canvas]')
			&& original.pane === document.querySelector('[data-controls-host]').firstElementChild
			&& original.checked === document.querySelector('[data-controls-host] input[type=checkbox]').checked;
	}));
	for (let count = 0; count < 3; count++) {
		await button.click();
		await page.keyboard.press('Escape');
	}
	assert.ok(await page.evaluate(() => history.length === window.__fullscreenQA.history));
	assert.deepEqual(await page.evaluate(() => history.state), { unrelated: 'keep' });
	assert.equal(new URL(page.url()).searchParams.has('full'), false);
	assert.deepEqual(new URL(page.url()).searchParams.getAll('tag'), ['a', 'b']);
	assert.equal(new URL(page.url()).searchParams.get('quality'), 'high');
	assert.equal(new URL(page.url()).hash, '#main-content');
	await page.locator('[data-panel-button=inspector]').click();
	assert.equal(new URL(page.url()).searchParams.get('quality'), 'high');
	await page.locator('[data-maximize]').click();
	assert.equal(await page.locator('[data-workbench]').getAttribute('data-maximized'), 'true');
	await page.keyboard.press('Escape');
	await button.click();
	assert.equal(await page.locator('[data-workbench]').getAttribute('data-maximized'), 'false');

	await page.reload();
	await ready();
	assert.equal(await full(), 'true');
	await page.keyboard.press('Escape');
	assert.equal(await full(), 'false');
	assert.equal(await page.locator('.site-header').isVisible(), true);

	// Native same-document history navigation must also restore the URL's layout.
	await page.evaluate(() => { location.hash = 'workbench'; });
	await button.click();
	await page.goBack();
	assert.equal(await full(), 'false');
	await page.goForward();
	assert.equal(await full(), 'true');

	// Fresh full links, static redraws and control-free live examples.
	for (const id of ['minimal-frame', 'compute-output', 'interactive-background', 'three-interop', 'particles4all-framegraph']) {
		console.log('Fullscreen resize: ' + id);
		await page.goto(base + '?example=' + id + '&panel=code&full=true');
		await ready();
		await canvasSized();
		assert.equal(await full(), 'true');
		if (['minimal-frame', 'compute-output', 'interactive-background'].includes(id)) {
			assert.equal(await page.locator('[data-controls-panel]').isVisible(), false);
		}
		if (['minimal-frame', 'compute-output'].includes(id)) {
			assert.equal(await page.locator('[data-canvas-fps]').isVisible(), false);
		}
		if (id === 'particles4all-framegraph') {
			await page.locator('[data-effect-canvas]').click({ position: { x: 300, y: 300 } });
			await page.keyboard.press('Space');
			await page.waitForFunction(() => document.querySelector('[data-effect-status]').dataset.paused === 'true');
			assert.equal(await page.locator('[data-canvas-fps]').isVisible(), false);
			await page.keyboard.press('Space');
			await page.keyboard.press('Escape');
			const statistics = page.getByRole('button', { name: 'Statistics', exact: true });
			await statistics.click();
			await nextLayout();
			await page.locator('[data-controls-host]').evaluate(el => { el.scrollTop = el.scrollHeight; });
			const parameterScroll = await page.locator('[data-controls-host]').evaluate(el => el.scrollTop);
			assert.ok(parameterScroll > 0);
			const folds = () => page.locator('[data-controls-host] .tp-fldv').evaluateAll(items => items.map(item => item.className));
			const originalFolds = await folds();
			await button.click();
			await page.keyboard.press('Escape');
			assert.equal(await page.locator('[data-controls-host]').evaluate(el => el.scrollTop), parameterScroll);
			assert.deepEqual(await folds(), originalFolds);
			await button.click();
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await canvasSized();
		await page.screenshot({ path: resolve(output, id + '.png') });
		await page.keyboard.press('Escape');
		await canvasSized();
		assert.equal(new URL(page.url()).searchParams.has('full'), false);
		await page.setViewportSize({ width: 1277, height: 920 });
	}

	// Loading and errors remain reachable even when opening a full link directly.
	const failure = await browser.newPage({ viewport: { width: 390, height: 844 } });
	await failure.addInitScript(() => {
		navigator.gpu.requestAdapter = () => new Promise((_, reject) => {
			window.failFullscreenAdapter = () => reject(new Error('Unable to initialize. '.repeat(30)));
		});
	});
	await failure.goto(base + '?example=reference-renderer&panel=code&full=true');
	await failure.locator('[data-effect-status]').waitFor();
	assert.equal(await failure.locator('[data-canvas-fps]').isVisible(), false);
	await failure.waitForFunction(() => typeof window.failFullscreenAdapter === 'function');
	await failure.evaluate(() => window.failFullscreenAdapter());
	await failure.waitForFunction(() => document.querySelector('[data-examples]').dataset.effectState === 'error');
	await failure.locator('.runtime-status summary').click();
	const status = await failure.locator('.runtime-status').boundingBox();
	assert.equal(await failure.locator('[data-controls-panel]').isVisible(), false, 'failed mounting leaves no empty floating pane');
	const errorExit = await failure.locator('[data-canvas-expand]').boundingBox();
	assert.ok(status.x + status.width + 12 <= errorExit.x);
	assert.ok(status.y > 40);
	assert.ok(status.y + status.height <= 844);
	await failure.screenshot({ path: resolve(output, 'mobile-error.png') });
	// Escape works inside the status details, whose own handler stops bubbling.
	await failure.keyboard.press('Escape');
	assert.equal(await failure.locator('[data-examples]').getAttribute('data-full'), 'false');
	await failure.close();
	assert.deepEqual(errors, []);
	console.log('Fullscreen: URLs, history, focus, state, GPU resize, FPS, mobile and errors passed.');
} catch (error) {
	await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
	throw error;
} finally {
	await browser.close();
}
