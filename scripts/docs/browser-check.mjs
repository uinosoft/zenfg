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
async function chooseDocumentLanguage(page, language) {
    await page.locator('[data-doc-language-toggle]').click();
    await page.locator(`[data-doc-language-choice="${language}"]`).click();
}
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
    assert.equal(await page.locator('[data-doc-language-toggle] svg').getAttribute('data-icon'), 'globe');
    assert.equal(await page.locator('[data-doc-language-choice="zh-CN"]').getAttribute('href'), base + 'docs/zh-CN/');
    await page.locator('[data-doc-language-toggle]').click();
    assert.equal(await page.getByRole('menuitemradio', { name: 'English' }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.getByRole('menuitemradio', { name: '简体中文' }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-doc-language-toggle]').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('[data-doc-language-toggle]').evaluate(element => element === document.activeElement), true);
    await page.locator('[data-doc-language-toggle]').click();
    await page.locator('.vp-doc h1').click();
    assert.equal(await page.locator('[data-doc-language-toggle]').getAttribute('aria-expanded'), 'false');
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
    const homepageLanguage = await page.locator('[data-language-toggle]').evaluate(element => {
        const style = getComputedStyle(element);
        return { width: style.width, height: style.height, radius: style.borderRadius, color: style.color, icon: element.querySelector('svg')?.innerHTML };
    });
    await page.locator('[data-language-toggle]').click();
    const homepageMenu = await page.locator('#site-language-menu').evaluate(element => {
        const style = getComputedStyle(element);
        return { width: style.width, padding: style.padding, radius: style.borderRadius, background: style.backgroundColor, border: style.borderColor, fontSize: style.fontSize };
    });
    await page.keyboard.press('Escape');
    await page.locator('.site-page-links a[href$="docs/"]').click();
    await page.waitForURL(origin + base + 'docs/');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    const docsLanguage = await page.locator('[data-doc-language-toggle]').evaluate(element => {
        const style = getComputedStyle(element);
        return { width: style.width, height: style.height, radius: style.borderRadius, color: style.color, icon: element.querySelector('svg')?.innerHTML };
    });
    assert.deepEqual(docsLanguage, homepageLanguage, 'Homepage and docs must share the language-button appearance');
    await page.locator('[data-doc-language-toggle]').click();
    const docsMenu = await page.locator('#docs-language-menu').evaluate(element => {
        const style = getComputedStyle(element);
        return { width: style.width, padding: style.padding, radius: style.borderRadius, background: style.backgroundColor, border: style.borderColor, fontSize: style.fontSize };
    });
    assert.deepEqual(docsMenu, homepageMenu, 'Homepage and docs must share the language-menu appearance');
    await page.screenshot({ animations: 'disabled', path: resolve(artifactDir, 'language-menu-light.png') });
    await page.keyboard.press('Escape');
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
    // Actual counterpart links keep the current page and its stable anchor.
    await page.goto(origin + base + 'docs/packages/webgpu.html#quick-start', { waitUntil: 'networkidle' });
    await chooseDocumentLanguage(page, 'zh-CN');
    await page.waitForURL(origin + base + 'docs/zh-CN/packages/webgpu.html#quick-start');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    assert.deepEqual(await page.locator('.docs-project-nav a').allTextContents(), ['首页', 'Inspector', '示例', '文档']);
    assert.equal(await page.locator('[data-doc-language-toggle]').getAttribute('aria-label'), '选择语言');
    assert.equal(await page.locator('[data-doc-language-choice="zh-CN"]').getAttribute('aria-checked'), 'true');
    if (await page.locator('[data-translation-pending]').count()) assert.ok((await page.locator('[data-translation-pending]').innerText()).includes('尚未确认'));
    const zhMarkdown = await page.locator('.docs-context a', { hasText: '阅读 Markdown' }).getAttribute('href');
    const zhText = await (await fetch(origin + zhMarkdown)).text();
    assert.ok(zhText.includes('开发分支文档'));
    assert.ok(zhText.includes('/docs/zh-CN/'));
    const zhIndex = await (await fetch(origin + base + 'docs/zh-CN/llms.txt')).text();
    assert.ok(zhIndex.includes('ZenFG 中文文档'));
    assert.ok(zhIndex.includes('/docs/api/'));
    await page.getByRole('button', { name: '搜索文档' }).click();
    await page.locator('#localsearch-input').fill('文档');
    await page.locator('.results .result').first().waitFor();
    assert.ok((await page.locator('.results a[href]').first().getAttribute('href')).includes('/zh-CN/'));
    await page.keyboard.press('Escape');
    await page.screenshot({ animations: 'disabled', path: resolve(artifactDir, 'chinese-desktop.png') });
    await page.locator('.docs-project-nav').getByRole('link', { name: '首页', exact: true }).click();
    await page.waitForURL(origin + base);
    await page.locator('.site-page-links a[href$="docs/zh-CN/"]').waitFor();
    await page.locator('.site-page-links a[href$="docs/zh-CN/"]').click();
    await page.waitForURL(origin + base + 'docs/zh-CN/');
    // Chinese document preference survives a trip through either application.
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [name, path] of [['Inspector', 'inspector/'], ['示例', 'playground/']]) {
            await page.goto(origin + base + 'docs/zh-CN/', { waitUntil: 'networkidle' });
            const docsNav = width < 768 ? '.docs-mobile-nav' : '.docs-project-nav';
            if (width < 768) await page.getByRole('button', { name: 'mobile navigation', exact: true }).click();
            await page.locator(docsNav).getByRole('link', { name, exact: true }).click();
            await page.waitForURL(origin + base + path);
            if (width < 768) await page.locator('[data-site-menu]').click();
            await page.locator('.site-page-links a[href$="docs/zh-CN/"]').click();
            await page.waitForURL(origin + base + 'docs/zh-CN/');
            assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
            if (path === 'playground/') {
                await page.goto(origin + base + path, { waitUntil: 'networkidle' });
                await page.locator('.site-footer a[href$="docs/zh-CN/"]').click();
                await page.waitForURL(origin + base + 'docs/zh-CN/');
            }
        }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await chooseDocumentLanguage(page, 'en');
    await page.waitForURL(origin + base + 'docs/');
    await page.goto(api + '#constructor', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-doc-language-choice="zh-CN"]').getAttribute('href'), base + 'docs/zh-CN/');

    const blocked = await browser.newContext();
    await blocked.addInitScript(({ themeOnly }) => {
        // The Vite development client uses its own storage for HMR. Production
        // blocks all storage; development isolates the application's preference.
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
            if (!themeOnly || key === 'zenfg-theme' || key === 'zenfg-language') throw new DOMException('Blocked', 'SecurityError');
            return get.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
            if (!themeOnly || key === 'zenfg-theme' || key === 'zenfg-language') throw new DOMException('Blocked', 'SecurityError');
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
        await page.goto(origin + base + 'docs/zh-CN/packages/webgpu.html', { waitUntil: 'networkidle' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Chinese horizontal overflow at ${width}`);
        await page.screenshot({ animations: 'disabled', path: resolve(artifactDir, `chinese-mobile-${width}.png`) });
        if (width < 768) {
            await page.locator('[data-doc-language-toggle]').click();
            await page.locator('#docs-language-menu').waitFor({ state: 'visible' });
            const menuBox = await page.locator('#docs-language-menu').boundingBox();
            assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= width, `Language menu stays inside ${width}px viewport`);
            await page.screenshot({ animations: 'disabled', path: resolve(artifactDir, `language-menu-${width}.png`) });
            await page.locator('[data-doc-language-choice="en"]').click();
            await page.waitForURL(origin + base + 'docs/packages/webgpu.html');
        }
    }
    assert.deepEqual(errors, [], 'Browser JavaScript errors');
    console.log('Browser checks passed: bilingual routes/search/Markdown, language preference, stable anchors, English API, main-site navigation, shared theme and 1440/800/390/320px layouts.');
} finally { await browser?.close(); server?.kill(); }
