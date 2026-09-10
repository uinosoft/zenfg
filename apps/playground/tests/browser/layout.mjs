// Production Examples layout/theme acceptance; requires hardware WebGPU.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '../../../..');
const output = resolve(root, '.test-dist/examples-layout');
await mkdir(output, { recursive: true });
const base = process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:4175/playground/';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({
    ...(process.env.GPU_TEST_BROWSER ? { executablePath: process.env.GPU_TEST_BROWSER } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
    headless: true, args: ['--enable-unsafe-webgpu'],
});
const context = await browser.newContext({ viewport: { width: 1277, height: 920 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const report = { layouts: [], interactions: [], errors };
try {
    await page.goto(base + '?example=reference-renderer&panel=none');
    await page.waitForFunction(() => document.querySelector('[data-playground]').dataset.effectState === 'ready');
    await page.locator('.zenfg-inspector-graph-canvas canvas').first().waitFor();
    await page.locator('.zenfg-inspector-graph-status').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-panel-button=inspector]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('[data-example-directory] a').count(), 16);
    assert.equal(await page.locator('[data-effect-status-text]').textContent(), 'Live');
    assert.equal(await page.locator('[data-example-feedback]').isVisible(), false);
    assert.deepEqual(await page.locator('[data-example-tags] li').allTextContents(), ['WebGPU', 'GPU Culling', 'Indirect Draw']);
    const stageSize = await page.locator('.demo-stage').boundingBox();
    assert.ok(Math.abs(stageSize.width / stageSize.height - 4 / 3) < .01, 'stable canvas aspect ratio');
    assert.equal(await page.locator('.breadcrumb').count(), 0);
    assert.ok(await page.evaluate(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes().length > 0), 'real captured graph nodes available');
    await page.locator('[data-controls-host] .tp-ckbv').first().click();
    await page.evaluate(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes().filter(n => !n.isParent()).first().emit('tap'));
    await page.waitForFunction(() => document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy.nodes('.semantic-selected').length > 0);
    const original = await page.evaluate(() => {
        const cy = document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy;
        cy.zoom(cy.zoom() * 1.1); cy.panBy({ x: 17, y: 9 });
        window.__examplesQA = {
            cy, canvas: document.querySelector('[data-effect-canvas]'),
            inspector: document.querySelector('.zenfg-inspector'),
            controls: document.querySelector('[data-controls-host]').firstElementChild,
        };
        return { zoom: cy.zoom(), pan: cy.pan(), selection: cy.nodes('.semantic-selected').map(n => n.id()) };
    });
    const embeddedStyles = () => page.evaluate(() => ['.zenfg-inspector', '[data-controls-host]', '[data-controls-host] input'].map(selector => {
        const s = getComputedStyle(document.querySelector(selector));
        return [s.color, s.backgroundColor, s.colorScheme];
    }));
    const darkStyles = await embeddedStyles();
    await page.locator('[data-theme-mode=light]').click();
    const lightStyles = await embeddedStyles();
    assert.deepEqual(lightStyles[0], darkStyles[0], 'Inspector dark styles unchanged');
    assert.notDeepEqual(lightStyles[1], darkStyles[1], 'parameter host follows theme');
    assert.notDeepEqual(lightStyles[2], darkStyles[2], 'parameter inputs follow theme');
    for (const width of [1440, 1277, 1024, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 920 });
        for (const mode of ['dark', 'light']) {
            await page.locator('[data-theme-mode=' + mode + ']').click();
            const paneStyles = await page.locator('[data-controls-host] .tp-rotv').evaluate(el => {
                const style = getComputedStyle(el);
                const input = getComputedStyle(el.querySelector('.tp-txtv_i'));
                return { background: style.backgroundColor, scheme: style.colorScheme, fontSize: style.fontSize,
                    inputBackground: input.backgroundColor, inputColor: input.color };
            });
            assert.deepEqual(paneStyles, {
                background: mode === 'dark' ? 'rgb(41, 46, 66)' : 'rgb(255, 255, 255)',
                scheme: mode, fontSize: '13px',
                inputBackground: mode === 'dark' ? 'rgb(32, 36, 55)' : 'rgb(238, 240, 247)',
                inputColor: mode === 'dark' ? 'rgb(192, 202, 245)' : 'rgb(52, 59, 88)',
            });
            await page.evaluate(async () => { window.scrollTo({ top: 0, behavior: 'instant' }); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow at ' + width);
            const controls = await page.locator('[data-controls-panel]').boundingBox();
            const canvas = await page.locator('.demo-stage').boundingBox();
            const hint = await page.locator('[data-example-description]').boundingBox();
            const intro = await page.locator('.example-intro').boundingBox();
            const demo = await page.locator('.demo-card').boundingBox();
            assert.ok(intro.y >= demo.y + demo.height && intro.y - demo.y - demo.height <= 24, 'introduction follows the demo');
            assert.ok(Math.abs(canvas.width / canvas.height - 4 / 3) < .01, 'stable ratio at every viewport');
            const title = await page.locator('[data-example-title]').boundingBox();
            const tags = await page.locator('[data-example-tags]').boundingBox();
            assert.ok(title.y < hint.y && hint.y < tags.y, 'title, description, tags reading order');
            assert.equal(await page.locator('.runtime-status').isVisible(), false, 'healthy runtime leaves the canvas clear');
            assert.equal(await page.locator('[data-metrics-host] .tp-rotv_b').isVisible(), false);
            assert.equal(await page.locator('[data-controls-host] .tp-rotv_b').isVisible(), false);
            assert.equal(await page.locator('[data-frame-rate]').isVisible(), true);
            if (width === 390) assert.ok(controls.y >= canvas.y + canvas.height + 12);
            else assert.ok(controls.x >= canvas.x + canvas.width + 15, 'separate panel gap');
            assert.ok(controls.height < canvas.height, 'short pane retains natural height');
            assert.equal(await page.locator('.demo-caption').count(), 0);
            assert.equal(await page.locator('.demo-stage [data-effect-status]').count(), 1);
            assert.ok(width === 390 ? controls.y >= canvas.y + canvas.height : controls.x >= canvas.x + canvas.width);
            await page.screenshot({ path: resolve(output, width + '-' + mode + '.png'), fullPage: true });
            report.layouts.push({ width, mode, canvas });
        }
    }
    for (const viewport of [{ width: 1920, height: 540 }, { width: 820, height: 1200 }, { width: 320, height: 600 }]) {
        await page.setViewportSize(viewport);
        const bounds = await page.locator('.demo-stage').boundingBox();
        assert.ok(Math.abs(bounds.width / bounds.height - 4 / 3) < .01, 'aspect ratio independent of viewport height');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow at extreme viewport');
    }
    await page.setViewportSize({ width: 1277, height: 920 });
    await page.locator('[data-panel-button=code]').click();
    await page.locator('.shiki').waitFor();
    await page.locator('[data-source-files] button').nth(1).click();
    await page.waitForFunction(() => !!document.querySelector('[data-source-content] .shiki'));
    await page.locator('[data-source-content]').evaluate(el => { el.scrollTop = 180; el.scrollLeft = 80; window.__examplesQA.source = el.firstElementChild; });
    const scroll = await page.locator('[data-source-content]').evaluate(el => [el.scrollTop, el.scrollLeft]);
    const selected = await page.locator('[data-source-files] .active').getAttribute('data-source-id');
    const darkCode = await page.locator('.shiki .line span').first().evaluate(el => getComputedStyle(el).color);
    await page.locator('[data-theme-mode=dark]').click();
    const newCode = await page.locator('.shiki .line span').first().evaluate(el => getComputedStyle(el).color);
    assert.notEqual(darkCode, newCode, 'actual code colors change with theme');
    assert.deepEqual(await page.locator('[data-source-content]').evaluate(el => [el.scrollTop, el.scrollLeft]), scroll);
    await page.locator('[data-panel-button=code]').click();
    assert.equal(await page.locator('[data-panel-button=code]').getAttribute('aria-selected'), 'true');
    await page.locator('[data-panel-button=inspector]').click();
    await page.locator('[data-panel-button=code]').click();
    assert.equal(await page.locator('[data-source-files] .active').getAttribute('data-source-id'), selected);
    assert.deepEqual(await page.locator('[data-source-content]').evaluate(el => [el.scrollTop, el.scrollLeft]), scroll);
    assert.ok(await page.evaluate(() => window.__examplesQA.source === document.querySelector('[data-source-content]').firstElementChild));
    await page.locator('[data-panel-button=inspector]').click();
    await page.locator('[data-maximize]').scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.locator('[data-maximize]').click();
    assert.equal(await page.locator('[data-workbench]').getAttribute('role'), 'dialog');
    await page.locator('[data-panel-button=inspector]').focus();
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(() => document.querySelector('[data-workbench]').contains(document.activeElement)), 'focus stays in expanded tools');
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('[data-panel-button=inspector]').evaluate(el => el === document.activeElement));
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => scrollY), scrollBefore);
    assert.ok(await page.locator('[data-maximize]').evaluate(el => el === document.activeElement));
    const after = await page.evaluate(() => {
        const qa = window.__examplesQA, cy = document.querySelector('.zenfg-inspector-graph-canvas')._cyreg.cy;
        return { same: qa.cy === cy && qa.canvas === document.querySelector('[data-effect-canvas]') && qa.inspector === document.querySelector('.zenfg-inspector') && qa.controls === document.querySelector('[data-controls-host]').firstElementChild,
            zoom: cy.zoom(), pan: cy.pan(), selection: cy.nodes('.semantic-selected').map(n => n.id()) };
    });
    assert.equal(after.same, true);
    assert.equal(after.zoom, original.zoom);
    assert.deepEqual(after.pan, original.pan);
    assert.deepEqual(after.selection, original.selection);
    assert.equal(await page.locator('[data-controls-host] input[type=checkbox]').first().isChecked(), false);
    const checkbox = page.locator('[data-controls-host] input[type=checkbox]').first();
    await checkbox.focus();
    assert.equal(await checkbox.evaluate(el => getComputedStyle(el.nextElementSibling).outlineStyle), 'solid');
    await page.keyboard.press('Space');
    assert.equal(await checkbox.isChecked(), true, 'checkbox supports keyboard input');
    await page.locator('[data-panel-button=inspector]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-panel-button=code]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('[data-overlay-close]').count(), 0);
    assert.equal(await page.locator('[data-playground]').getAttribute('data-panel'), 'code');
    await page.locator('[data-panel-button=inspector]').click();
    await page.locator('[data-theme-mode=light]').click();
    await page.reload();
    await page.locator('[data-controls-host] .tp-rotv').waitFor();
    assert.equal(await page.locator('[data-controls-host] .tp-rotv').evaluate(el => getComputedStyle(el).backgroundColor),
        'rgb(255, 255, 255)', 'new pane inherits persisted Light theme');
    await page.locator('[data-example-directory] details').nth(1).locator('summary').click();
    await page.locator('[data-example-id=minimal-frame]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('[data-controls-host]').isVisible(), false);
    const noControlsStage = await page.locator('.demo-stage').boundingBox();
    assert.ok(Math.abs(noControlsStage.width / noControlsStage.height - 4 / 3) < .01, 'no-parameter examples retain the same ratio');
    assert.equal(await page.locator('[data-example-description]').isVisible(), false);
    await page.waitForFunction(() => document.querySelector('[data-effect-status-text]').textContent === 'Ready');
    assert.equal(await page.locator('[data-graph-hint]').isVisible(), true);
    assert.equal(await page.locator('[data-example-id=minimal-frame]').getAttribute('aria-current'), 'page');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#example-directory').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#example-directory').isVisible(), false);
    await page.locator('[data-directory-toggle]').click();
    assert.equal(await page.locator('#example-directory').isVisible(), true);
    await page.goto(base + '?example=missing');
    await page.locator('[data-example-error]').waitFor();
    assert.equal(await page.locator('[data-demo-card]').isVisible(), false);
    report.interactions.push('real captured nodes', 'parameter retention', 'graph viewport and selection retention', 'source retention and dual colors', 'expand/Escape/focus', 'keyboard tabs', 'directory navigation and mobile collapse', 'theme persistence', 'unknown example');

    const noGpu = await context.newPage();
    await noGpu.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await noGpu.goto(base + '?example=minimal-frame');
    await noGpu.waitForFunction(() => document.querySelector('[data-playground]').dataset.effectState === 'error');
    assert.equal(await noGpu.locator('[data-effect-status-text]').textContent(), 'Error');
    assert.equal(await noGpu.locator('[data-example-feedback]').isVisible(), true);
    const failedStage = await noGpu.locator('.demo-stage').boundingBox();
    const failureDetail = await noGpu.locator('[data-example-feedback]').boundingBox();
    assert.ok(failureDetail.y >= failedStage.y + failedStage.height, 'error detail outside the canvas');
    await noGpu.locator('[data-panel-button=code]').click();
    await noGpu.locator('.shiki').waitFor();
    assert.equal(await noGpu.locator('[data-copy-source]').isEnabled(), true);
    await noGpu.goto(base + '?example=babylon-lite-interop&panel=code');
    await noGpu.locator('[data-frame-rate-history]').waitFor();
    assert.equal(await noGpu.locator('[data-frame-rate]').inputValue(), '—');
    assert.equal(await noGpu.locator('[data-frame-rate-history] polyline').getAttribute('points'), '');
    assert.equal(await noGpu.locator('[data-metrics-host]').isVisible(), true, 'complete monitor exists before any valid frames');
    assert.ok((await noGpu.locator('[data-metrics-host]').boundingBox()).height >= 70);
    await noGpu.close();
    report.interactions.push('Code available without WebGPU');

    const noStorage = await browser.newPage();
    await noStorage.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked storage'); } }));
    await noStorage.goto(base + '?example=minimal-frame&panel=code');
    await noStorage.locator('[data-theme-mode=light]').click();
    assert.equal(await noStorage.locator('html').getAttribute('data-theme'), 'light');
    await noStorage.close();
    report.interactions.push('theme works without storage');
    const noHighlight = await context.newPage();
    const highlightErrors = [];
    noHighlight.on('pageerror', error => highlightErrors.push(String(error)));
    await noHighlight.route('**/engine-oniguruma-*.js', route => route.abort());
    await noHighlight.goto(base + '?example=minimal-frame&panel=code');
    await noHighlight.locator('[data-source-content] pre').waitFor();
    await noHighlight.waitForFunction(() => !document.querySelector('[data-copy-source]').disabled);
    assert.equal(await noHighlight.locator('.shiki').count(), 0);
    assert.ok((await noHighlight.locator('[data-source-content]').textContent()).includes('Source:'));
    await noHighlight.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    assert.deepEqual(highlightErrors, []);
    await noHighlight.close();
    report.interactions.push('highlighter failure preserves source and safe disposal');
    assert.deepEqual(errors, []);
    report.ok = true;
} catch (error) {
    report.ok = false; report.error = error.stack ?? String(error);
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
} finally {
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
}
