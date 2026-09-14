import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { root, siteBase } from './catalog.mjs';
const port = Number(process.env.DOCS_PREVIEW_PORT ?? 4182);
const base = siteBase();
const origin = process.env.DOCS_TEST_ORIGIN ?? `http://127.0.0.1:${port}`;
const server = process.env.DOCS_TEST_ORIGIN ? undefined : spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--base', base], { cwd: resolve(root, 'apps/site'), stdio: 'pipe' });
let serverError = '';
server?.stderr.on('data', data => { serverError += data; });
let browser;
try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
        try { if ((await fetch(origin + base + 'docs/')).ok) { ready = true; break; } } catch {}
        if (server && server.exitCode !== null) throw new Error(serverError || 'Preview exited.');
        await setTimeout(100);
    }
    assert.ok(ready, 'Preview did not become ready.');
    browser = await chromium.launch({ headless: true, channel: process.env.DOCS_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const artifactDir = resolve(root, '.test-dist/docs-browser');
    mkdirSync(artifactDir, { recursive: true });
    await page.goto(origin + base + 'docs/', { waitUntil: 'networkidle' });
    await page.locator('.vp-doc h1').waitFor();
    assert.ok((await page.locator('.vp-doc h1').innerText()).startsWith('ZenFG'));
    assert.equal(await page.getByRole('button', { name: 'Choose language' }).count(), 0);
    const destinations = ['Home', 'Inspector', 'Examples', 'Docs'];
    assert.deepEqual(await page.locator('.docs-project-nav a').allTextContents(), destinations);
    assert.equal(await page.locator('.docs-project-nav [aria-current=page]').innerText(), 'Docs');
    assert.equal(await page.locator('.VPNavBarTitle a').getAttribute('href'), base);
    assert.equal(await page.locator('.VPNavBarTitle a').getAttribute('target'), '_self');
    assert.equal(await page.locator('.project-theme-control svg').getAttribute('data-icon'), 'moon');
    const navBox = await page.locator('.docs-project-nav').boundingBox();
    const searchBox = await page.getByRole('button', { name: /Search/ }).first().boundingBox();
    assert.ok(navBox.x + navBox.width <= searchBox.x + 1, 'Project navigation must precede search');
    await page.screenshot({ animations: 'disabled', path: resolve(artifactDir, 'desktop-dark.png') });
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && !document.documentElement.classList.contains('dark'));
    await page.screenshot({ animations: 'disabled', path: resolve(artifactDir, 'desktop-light.png') });
    await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('link', { name: 'Home', exact: true }).first().click();
    await page.waitForURL(origin + base);
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.locator('.site-page-links a[href$="docs/"]').click();
    await page.waitForURL(origin + base + 'docs/');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.getByRole('button', { name: /Search/ }).first().click();
    await page.locator('#localsearch-input').fill('FrameGraph');
    await page.locator('.results .result').first().waitFor();
    assert.ok(await page.locator('.results .result').count() > 0);
    await page.keyboard.press('Escape');
    const api = origin + base + 'docs/api/webgpu/root/classes/FrameGraph.html';
    assert.equal((await page.goto(api))?.status(), 200);
    await page.reload({ waitUntil: 'networkidle' });
    assert.ok((await page.locator('h1').innerText()).includes('FrameGraph'));
    const markdown = await page.locator('.docs-context a', { hasText: 'Read Markdown' }).getAttribute('href');
    const md = await (await fetch(origin + markdown)).text();
    assert.ok(md.includes('Development branch documentation'));
    assert.ok(md.includes('FrameGraph'));
    assert.ok(!md.includes('<!DOCTYPE html>'));
    const rustLink = page.locator('a[href^="https://docs.rs/zenfg/"]').first();
    assert.equal(await rustLink.getAttribute('target'), '_blank');
    await page.screenshot({ animations: 'disabled', path: resolve(artifactDir, 'api-desktop.png') });
    for (const route of ['docs/', 'docs/packages/webgpu.html', 'docs/api/webgpu/root/classes/FrameGraph.html']) {
        await page.goto(origin + base + route, { waitUntil: 'networkidle' });
        await page.locator('.VPNavBarTitle a').click();
        await page.waitForURL(origin + base);
        assert.equal(await page.locator('.site-header').count(), 1, 'Brand must leave the documentation application');
        await page.goBack({ waitUntil: 'networkidle' });
        assert.equal(page.url(), origin + base + route);
        await page.goForward({ waitUntil: 'networkidle' });
        assert.equal(page.url(), origin + base);
    }
    for (const [name, path] of [['Inspector', 'inspector/'], ['Examples', 'playground/']]) {
        await page.goto(origin + base + 'docs/', { waitUntil: 'networkidle' });
        await page.locator('.docs-project-nav').getByRole('link', { name, exact: true }).click();
        await page.waitForURL(url => url.pathname === base + path);
        await page.locator('.site-header').waitFor();
        assert.equal(await page.locator('.site-header [aria-current=page]').innerText(), name);
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        await page.locator('.site-page-links a[href$="docs/"]').click();
        await page.waitForURL(origin + base + 'docs/');
        await page.locator('.vp-doc h1').waitFor();
    }
    const blocked = await browser.newContext();
    await blocked.addInitScript(({ themeOnly }) => {
        // The Vite development client uses its own storage for HMR. Production
        // blocks all storage; development isolates the application's preference.
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
            if (!themeOnly || key === 'zenfg-theme') throw new DOMException('Blocked', 'SecurityError');
            return get.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
            if (!themeOnly || key === 'zenfg-theme') throw new DOMException('Blocked', 'SecurityError');
            return set.call(this, key, value);
        };
    }, { themeOnly: Boolean(process.env.DOCS_TEST_ORIGIN) });
    const blockedPage = await blocked.newPage();
    blockedPage.on('pageerror', error => errors.push(error.message));
    await blockedPage.goto(origin + base + 'docs/', { waitUntil: 'networkidle' });
    await blockedPage.getByRole('button', { name: 'Switch to light theme' }).click();
    await blockedPage.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await blockedPage.getByRole('button', { name: 'Switch to dark theme' }).click();
    await blockedPage.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await blocked.close();

    for (const width of [800, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(origin + base + 'docs/packages/webgpu.html', { waitUntil: 'networkidle' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`);
        if (width < 768) {
            await page.getByRole('button', { name: 'mobile navigation', exact: true }).click();
            await page.locator('.docs-mobile-nav a', { hasText: 'Home' }).waitFor({ state: 'visible' });
            assert.deepEqual(await page.locator('.docs-mobile-nav a').allTextContents(), destinations);
            assert.equal(await page.locator('.docs-mobile-nav [aria-current=page]').innerText(), 'Docs');
            // Wait for the opening transition before closing the menu.
            await page.waitForFunction(() => !document.querySelector('.VPNavScreen')?.className.includes('enter-active'));
            await page.getByRole('button', { name: 'mobile navigation', exact: true }).click();
            await page.locator('.docs-mobile-nav').waitFor({ state: 'hidden' });
            assert.equal(await page.getByRole('button', { name: 'mobile navigation', exact: true }).evaluate(button => button === document.activeElement), true);
            await page.getByRole('button', { name: 'mobile navigation', exact: true }).click();
            await page.locator('.docs-mobile-nav').getByRole('link', { name: 'Home', exact: true }).click();
            await page.waitForURL(origin + base);
            await page.locator('.site-header').waitFor();
            await page.goBack({ waitUntil: 'networkidle' });
            await page.locator('.vp-doc h1').waitFor();

        }
        if (width < 960) {
            await page.getByRole('button', { name: 'Menu', exact: true }).click();
            await page.locator('.VPSidebar.open').waitFor({ state: 'visible' });
            await page.keyboard.press('Escape');
            await page.locator('.VPSidebar.open').waitFor({ state: 'hidden' });
        }
        await page.keyboard.press('Tab');
        assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'BODY');
        await page.screenshot({ animations: 'disabled', path: resolve(artifactDir, `mobile-${width}.png`) });
    }
    assert.deepEqual(errors, [], 'Browser JavaScript errors');
    console.log('Browser checks passed: search, deep reload, main-site navigation, shared theme, Rust external links, Markdown and 1440/800/390/320px layouts.');
} finally { await browser?.close(); server?.kill(); }
