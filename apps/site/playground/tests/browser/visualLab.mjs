// Run with an existing Playwright installation; see docs/visual-foundations.md.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { visualThemes, applyVisualTheme } from '../../../shared/theme/index.ts';

const root = resolve(import.meta.dirname, '../../../../../');
const output = resolve(root, '.test-dist/visual-lab-qa');
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
	? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const luminance = (hex) => {
	const channels = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
		.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
	return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const report = { tokenContrast: [], viewports: [], interactions: [], consoleErrors: [] };
// A host can theme one owned container without changing siblings or the page.
const dom = new Window();
const first = dom.document.createElement('section');
const second = dom.document.createElement('section');
dom.document.body.append(first, second);
applyVisualTheme(first, 'dark');
applyVisualTheme(second, 'light');
applyVisualTheme(first, 'light');
assert.equal(second.style.getPropertyValue('--zenfg-canvas'), '#f5f6fa');
assert.equal(first.style.getPropertyValue('--zenfg-canvas'), '#f5f6fa');
assert.equal(dom.document.documentElement.getAttribute('style'), null);
assert.equal(dom.document.body.getAttribute('data-theme'), null);
await dom.happyDOM.close();
for (const [mode, palette] of Object.entries(visualThemes)) {
	for (const token of ['text', 'secondary', 'muted', 'accent', 'purple', 'cyan', 'success', 'warning', 'danger', 'comment', 'keyword', 'string', 'number', 'function', 'type', 'property', 'render', 'compute', 'copy', 'clear', 'command', 'external', 'declaration', 'output', 'texture', 'buffer']) {
		for (const surface of ['canvas', 'sidebar', 'panel', 'inset', 'hover', 'accentSoft']) {
			const ratio = contrast(palette[token], palette[surface]);
			// Semantic code colors are used on the canvas, not interaction backgrounds.
			const required = ['text', 'secondary', 'muted', 'accent'].includes(token) || surface === 'canvas' || surface === 'panel';
			if (required) {
				report.tokenContrast.push({ mode, token, surface, ratio: Number(ratio.toFixed(3)) });
				assert.ok(ratio >= 4.5, `${mode} ${token}/${surface}: ${ratio}`);
			}
		}
	}
	assert.ok(contrast(palette.onAccent, palette.accent) >= 4.5, `${mode} primary button contrast`);
}
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
	const page = await context.newPage();
	page.on('pageerror', error => report.consoleErrors.push(String(error)));
  await page.goto(process.env.VISUAL_LAB_URL ?? 'http://127.0.0.1:5173/visual-lab/');
	await page.locator('.shiki').waitFor({ state: 'attached' });
	await page.getByRole('button', { name: 'Reset parameters', exact: true }).waitFor();
	assert.equal(await page.locator('#visual-lab').getAttribute('data-theme'), 'dark');
	assert.equal(await page.locator('#inspector-tab').getAttribute('aria-selected'), 'true');
	assert.equal(await page.getByRole('button', { name: 'Dark', exact: true }).count(), 1);
	for (const width of [1440, 1277, 1024, 390]) {
		await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1277 ? 920 : 1000 });
		const numberFits = await page.getByRole('textbox', { name: 'Instances', exact: true }).evaluate(input => {
			const style = getComputedStyle(input);
			const measure = document.createElement('canvas').getContext('2d');
			measure.font = style.font;
			return measure.measureText('10000').width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) <= input.clientWidth;
		});
		assert.ok(numberFits, `${width}: five-digit instance values must fit`);
		for (const mode of ['dark', 'light']) {
			await page.locator(`[data-theme-choice="${mode}"]`).click();
			await page.evaluate(() => window.scrollTo(0, 0));
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}/${mode} horizontal page overflow`);
			assert.equal(await page.locator('#visual-lab').evaluate(el => getComputedStyle(el).colorScheme), mode);
			assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme), mode);
			assert.equal(await page.locator('#directory').evaluate(el => getComputedStyle(el).scrollbarWidth), 'thin');
			if (width === 1277) {
				const layout = await page.evaluate(() => ({
					stage: document.querySelector('.demo-stage').getBoundingClientRect().toJSON(),
					nodes: [...document.querySelectorAll('[data-node]')].map(el => el.getBoundingClientRect().toJSON()),
				}));
				assert.ok(layout.stage.top < 200, 'Scene starts in the first 200px');
				assert.ok(layout.stage.height >= 400 && layout.stage.height <= 440, 'Larger scene at the review viewport');
				assert.ok(layout.nodes.every(node => node.bottom < 920), 'Actual graph nodes fit in the first viewport');
				await page.locator('summary').filter({ hasText: 'WebGPU basics' }).click();
				await page.mouse.move(220, 250);
				await page.screenshot({ path: resolve(output, `review-${mode}-1277.png`) });
				await page.locator('summary').filter({ hasText: 'WebGPU basics' }).click();
				console.log(JSON.stringify({ reviewViewport: mode, stageTop: layout.stage.top, stageHeight: layout.stage.height, nodeBottom: Math.max(...layout.nodes.map(node => node.bottom)) }));
			}
			await page.screenshot({ path: resolve(output, `${mode}-${width}.png`), fullPage: true });
			await page.getByRole('tab', { name: 'Code', exact: true }).click();
			const typography = await page.locator('.shiki').evaluate(el => ({ size: getComputedStyle(el).fontSize, line: getComputedStyle(el).lineHeight }));
			assert.equal(typography.size, width === 390 ? '13px' : '14px');
			assert.equal(typography.line, width === 390 ? '22.1px' : '23.8px');
			// Check every rendered code color, including comments and punctuation.
			const codeColors = await page.locator('.shiki').evaluate(el => [...new Set([el, ...el.querySelectorAll('span')].map(node => getComputedStyle(node).color))]);
			for (const color of codeColors) {
				const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number);
				const hex = '#' + rgb.map(channel => channel.toString(16).padStart(2, '0')).join('');
				assert.ok(contrast(hex, visualThemes[mode].canvas) >= 4.5, `${mode} code ${hex}`);
			}
			await page.locator('#code-panel').screenshot({ path: resolve(output, `code-${mode}-${width}.png`) });
			await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
			report.viewports.push({ width, mode, typography, codeColors: codeColors.length });
		}
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.locator('[data-node="cull"]').focus();
	await page.keyboard.press('Enter');
	assert.equal(await page.locator('#selected-name').textContent(), 'Frustum cull');
	await page.locator('#parameter-pane input[type="checkbox"]').uncheck();
	await page.locator('#parameter-pane select').selectOption({ label: 'Forward Z' });
	const parameters = await page.locator('#parameter-summary').textContent();
	assert.match(parameters, /Culling off/);
	assert.match(parameters, /Forward Z/);
	await page.locator('#inspector-tab').focus();
	await page.keyboard.press('ArrowRight');
	assert.equal(await page.locator('#code-tab').getAttribute('aria-selected'), 'true');
	assert.equal(await page.locator('#code-tab').evaluate(el => document.activeElement === el), true);
	await page.locator('#source-code').evaluate(el => { el.scrollTop = 210; el.scrollLeft = 80; });
	const sourceScroll = await page.locator('#source-code').evaluate(el => [el.scrollTop, el.scrollLeft]);
	await page.evaluate(() => window.scrollTo(0, 520));
	const scroll = await page.evaluate(() => window.scrollY);
	for (const mode of ['dark', 'light', 'dark', 'light']) {
		// Click the visible sticky control without Playwright's scrollIntoView,
		// which itself scrolls the document to the header's normal-flow position.
		const bounds = await page.locator(`[data-theme-choice="${mode}"]`).boundingBox();
		await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		assert.equal(await page.evaluate(() => window.scrollY), scroll);
		assert.equal(await page.locator('#parameter-summary').textContent(), parameters);
		assert.equal(await page.locator('#code-tab').getAttribute('aria-selected'), 'true');
		assert.equal(await page.locator('#selected-name').textContent(), 'Frustum cull');
		assert.deepEqual(await page.locator('#source-code').evaluate(el => [el.scrollTop, el.scrollLeft]), sourceScroll);
	}
	await page.getByRole('button', { name: 'Copy source', exact: true }).click();
	await page.getByText('Source copied.', { exact: true }).waitFor();
	const source = await readFile(resolve(root, 'packages/webgpu/examples/minimal-frame.ts'), 'utf8');
	assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), source.replaceAll('\r\n', '\n'));
	await page.getByRole('button', { name: 'Reset parameters', exact: true }).click();
	assert.match(await page.locator('#parameter-summary').textContent(), /2,048 instances · Culling on · Reverse Z/);
	await page.getByRole('checkbox', { name: 'Culling', exact: true }).focus();
	await page.keyboard.press('Space');
	assert.match(await page.locator('#parameter-summary').textContent(), /Culling off/);
	await page.getByRole('slider', { name: 'Instances', exact: true }).focus();
	await page.keyboard.press('ArrowRight');
	assert.notEqual(await page.getByRole('slider', { name: 'Instances', exact: true }).getAttribute('aria-valuenow'), '2048');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.evaluate(() => window.scrollTo(0, 0));
	assert.equal(await page.locator('#directory').isVisible(), false);
	await page.getByRole('button', { name: 'Browse examples' }).click();
	assert.equal(await page.locator('#directory').isVisible(), true);
	await page.locator('summary').filter({ hasText: 'WebGPU basics' }).click();
	await page.locator('#directory a[href="#components"]').click();
	assert.equal(await page.locator('#directory').isVisible(), false);
	await page.getByRole('button', { name: 'Primary action' }).focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	assert.equal(await page.getByRole('button', { name: 'Primary action' }).evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
	report.interactions.push('node keyboard selection', 'Tweakpane values and reset', 'keyboard tabs', 'theme state and scroll preservation', 'exact source clipboard', 'mobile directory and groups', 'keyboard focus');
	assert.deepEqual(report.consoleErrors, []);
	await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ tokenChecks: report.tokenContrast.length, viewports: report.viewports, interactions: report.interactions, consoleErrors: report.consoleErrors }, null, 2));
} finally { await browser.close(); }
