import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = '.test-dist/pc-camera';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const frames = n => page.evaluate(n => new Promise(resolve => {
    const tick = () => --n <= 0 ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
}), n);
try {
    for (const id of ['playcanvas-gsplat-interop', 'playcanvas-gsplat-streaming-interop']) {
        await page.goto((process.env.EXAMPLES_URL ?? 'http://127.0.0.1:4175/playground/') + '?example=' + id + '&panel=none');
        await page.waitForFunction(() => Number(document.querySelector('[data-effect-canvas]')?.dataset.renderedSplats) > 0, null, { timeout: 100000 });
        const canvas = page.locator('[data-effect-canvas]'), box = await canvas.boundingBox();
        await frames(30);
        const before = await canvas.screenshot();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 15, { steps: 12 });
        await page.mouse.up(); await frames(30);
        if (before.equals(await canvas.screenshot())) throw Error('Native drag did not move ' + id);
        if (id.includes('streaming')) {
            await canvas.focus();
            await page.keyboard.down('w'); await page.keyboard.down('d'); await frames(45);
            await page.keyboard.up('w'); await page.keyboard.up('d');
            await page.getByRole('button', { name: 'Reset View', exact: true }).click();
        } else {
            await page.mouse.wheel(0, 200);
        }
        await frames(30);
        await page.screenshot({ path: output + '/' + id + '.png' });
    }
    if (errors.length) throw Error(JSON.stringify(errors));
    await writeFile(output + '/result.json', JSON.stringify({ ok: true, errors, browser: browser.version() }, null, 2));
    console.log('PASS native controller mouse, keyboard, reset and GPU frames');
} catch (error) {
    console.error(error); process.exitCode = 1;
} finally {
    await browser.close();
}
