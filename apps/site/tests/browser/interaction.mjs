// Read back real GPU spring state to verify local deformation and release.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('.test-dist', { recursive: true });
const browser = await chromium.launch({ ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER } : process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
	await page.addInitScript(() => {
		window.motionAudit = {};
		const create = GPUDevice.prototype.createBuffer;
		GPUDevice.prototype.createBuffer = function(descriptor) {
			// COPY_SRC only enables test observation; storage/shader behavior stays the same.
			const isMotion = descriptor.label === 'persistent ribbon springs';
			const buffer = create.call(this, isMotion ? { ...descriptor, usage: descriptor.usage | GPUBufferUsage.COPY_SRC } : descriptor);
			if (isMotion) { window.motionAudit.buffer = buffer; window.motionAudit.device = this; }
			return buffer;
		};
		const write = GPUQueue.prototype.writeBuffer;
		GPUQueue.prototype.writeBuffer = function(...args) {
			if (args[0].label === 'refractive frame params') window.motionAudit.frame = Array.from(args[2]);
			return write.apply(this, args);
		};
		window.readMotion = async () => {
			const { device, buffer } = window.motionAudit;
			const read = device.createBuffer({ size: buffer.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, read, 0, buffer.size);
			device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
			const values = Array.from(new Float32Array(read.getMappedRange())); read.unmap(); read.destroy(); return values;
		};
	});
	await page.goto(process.env.HOME_URL ?? 'http://127.0.0.1:5174/'); await page.waitForFunction(() => document.documentElement.dataset.webgpuBackground === 'ready');
	await page.waitForTimeout(1000);
	const rest = await page.evaluate(() => window.readMotion());
	const art = await page.locator('[data-zenfg-background]').boundingBox();
	const hero = await page.locator('.hero').boundingBox();
	await page.mouse.move(hero.x + 8, hero.y + hero.height * .5); await page.waitForTimeout(450);
	const left = await page.evaluate(() => window.motionAudit.frame.slice(2, 4));
	assert.ok(left[0] < 0, 'viewpoint follows the mouse over the introduction, outside the canvas');
	await page.mouse.move(hero.x + hero.width - 8, hero.y + hero.height * .25); await page.waitForTimeout(650);
	const right = await page.evaluate(() => window.motionAudit.frame.slice(2, 4));
	assert.ok(right[0] > 0 && right[1] > 0, 'viewpoint follows cursor position, even after movement stops');
	assert.ok(Math.abs(right[0] * art.width / 2) <= 12 && Math.abs(right[1] * art.height / 2) <= 9, 'base parallax stays within its CSS pixel budget');
	assert.deepEqual(await page.locator('[data-zenfg-background]').boundingBox(), art, 'parallax keeps canvas clipping bounds fixed');
	for (let i = 0; i < 16; i++) {
		await page.mouse.move(art.x + art.width * (i % 2 ? .81 : .66), art.y + art.height * (i % 3 ? .42 : .55));
		await page.waitForTimeout(35);
	}
	const active = await page.evaluate(async () => ({ motion: await window.readMotion(), pressure: window.motionAudit.frame[11] }));
	await page.mouse.move(20, 760); await page.waitForTimeout(5200);
	const settled = await page.evaluate(async () => ({ motion: await window.readMotion(), pressure: window.motionAudit.frame[11], parallax: window.motionAudit.frame.slice(2, 4) }));
	const distance = values => Math.max(...values.map((v, i) => i % 8 < 3 ? Math.abs(v - rest[i]) : 0));
	const report = { activePressure: active.pressure, settledPressure: settled.pressure, maximumGpuDeformation: distance(active.motion), remainingGpuDeformation: distance(settled.motion), parallaxLeft: left, parallaxRight: right, settledParallax: settled.parallax };
	assert.ok(report.maximumGpuDeformation > .005); assert.ok(report.remainingGpuDeformation < report.maximumGpuDeformation);
	assert.equal(report.settledPressure, 0);
	assert.ok(settled.parallax.every(x => Math.abs(x) < .00001), 'leaving the hero smoothly recenters the viewpoint');
	await writeFile('.test-dist/interaction-audit.json', JSON.stringify(report, null, 2)); console.log(report);
} finally { await browser.close(); }
