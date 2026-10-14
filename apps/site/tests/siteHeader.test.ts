import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLAnchorElement, type HTMLButtonElement, type HTMLElement } from 'happy-dom';
import { renderSiteFooter, renderSiteHeader, type SitePage } from '../shared/shell/template.ts';
import { installSiteHeader } from '../shared/shell/header.ts';
import { createSiteTheme } from '../shared/theme/controller.ts';

test('every static header has all destinations and resolves under a deployment prefix', () => {
	for (const page of ['home', 'inspector', 'examples'] as SitePage[]) {
		const window = new Window({ url: `https://example.org/zenfg/${page === 'home' ? '' : page === 'examples' ? 'playground/' : page + '/'}` });
		window.document.body.innerHTML = renderSiteHeader(page);
		const links = [...window.document.querySelectorAll('.site-page-links a')];
        assert.deepEqual([...window.document.querySelectorAll('.site-navigation a')].map(link => link.textContent), ['Home', 'Inspector', 'Examples', 'Docs']);
        const brand = window.document.querySelector<HTMLAnchorElement>('.site-brand')!;
        assert.equal(new URL(brand.getAttribute('href')!, window.location.href).pathname, '/zenfg/');
        assert.ok([...window.document.querySelectorAll('.site-header a:not(.site-github)')].every(link => !link.hasAttribute('target')));
		assert.deepEqual(links.map(link => link.getAttribute('href')).map(href => new URL(href!, window.location.href).pathname), ['/zenfg/', '/zenfg/inspector/', '/zenfg/playground/', '/zenfg/docs/']);
		assert.equal(window.document.querySelectorAll('[aria-current=page]').length, 1);
		const docs = window.document.querySelector<HTMLAnchorElement>('.site-page-links a[href$="docs/"]')!;
		assert.equal(new URL(docs.getAttribute('href')!, window.location.href).pathname, '/zenfg/docs/');
		assert.equal(docs.hasAttribute('target'), false);
		assert.equal(window.document.querySelector('[aria-current=page]')?.textContent, { home: 'Home', inspector: 'Inspector', examples: 'Examples' }[page]);
		assert.equal(!!window.document.querySelector('[data-language-toggle]'), page === 'home');
		window.happyDOM.abort();
	}
});

test('mobile menu exposes real navigation, supports Escape, breakpoint changes and disposal', t => {
	const window = new Window();
	window.document.body.innerHTML = renderSiteHeader('home');
	const media = new EventTarget() as EventTarget & { matches: boolean };
	media.matches = true;
	window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
	const theme = createSiteTheme(window as unknown as globalThis.Window);
	const dispose = installSiteHeader(window as unknown as globalThis.Window, theme);
	t.after(() => { dispose(); theme.destroy(); window.happyDOM.abort(); });
	const menu = window.document.querySelector<HTMLButtonElement>('[data-site-menu]')!;
	const nav = window.document.querySelector<HTMLElement>('#site-navigation')!;
	assert.equal(nav.inert, true);
	menu.click();
	assert.equal(menu.getAttribute('aria-expanded'), 'true');
	assert.equal(nav.inert, false);
	const home = nav.querySelector<HTMLAnchorElement>('a')!;
	assert.equal(window.document.activeElement, home);
	home.focus();
	home.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	assert.equal(nav.inert, true);
	assert.equal(window.document.activeElement, menu);
	media.matches = false;
	media.dispatchEvent(new Event('change'));
	assert.equal(nav.inert, false);
	window.document.querySelector<HTMLButtonElement>('[data-theme-toggle]')!.click();
	assert.equal(theme.get(), 'light');
	dispose();
	window.document.querySelector<HTMLButtonElement>('[data-theme-toggle]')!.click();
	assert.equal(theme.get(), 'light');
});

test('single theme button follows external theme and language changes and unsubscribes', async t => {
	const window = new Window();
	window.document.body.innerHTML = renderSiteHeader('home');
	const theme = createSiteTheme(window as unknown as globalThis.Window);
	const dispose = installSiteHeader(window as unknown as globalThis.Window, theme);
	t.after(() => { dispose(); theme.destroy(); window.happyDOM.abort(); });
	const button = window.document.querySelector<HTMLButtonElement>('[data-theme-toggle]')!;
	assert.equal(window.document.querySelectorAll('[data-theme-toggle]').length, 1);
	assert.equal(window.document.querySelector('.site-brand')?.textContent, 'ZenFG');
	assert.equal(window.document.querySelector('.brand-accent')?.textContent, 'FG');
	assert.equal(button.querySelector('svg')?.dataset.icon, 'moon');
	assert.equal(button.title, 'Switch to light theme');
	theme.set('light');
	assert.equal(button.querySelector('svg')?.dataset.icon, 'sun');
	assert.equal(button.getAttribute('aria-label'), 'Switch to dark theme');
	window.document.documentElement.lang = 'zh-CN';
	await window.happyDOM.whenAsyncComplete();
	assert.equal(button.title, '切换到暗色主题');
	button.click();
	assert.equal(theme.get(), 'dark');
	assert.equal(button.title, '切换到亮色主题');
	dispose();
	theme.set('light');
	window.document.documentElement.lang = 'en';
	await window.happyDOM.whenAsyncComplete();
	assert.equal(button.title, '切换到亮色主题');
});

test('shared footers retain home destinations and accessible icon-only GitHub links', () => {
	for (const page of ['home', 'examples'] as const) {
		const window = new Window();
		window.document.body.innerHTML = renderSiteHeader(page) + renderSiteFooter(page);
		assert.equal(window.document.querySelector('.site-footer .site-brand')?.getAttribute('href'), page === 'home' ? './' : '../');
		assert.equal(window.document.querySelector('.site-footer .note')?.textContent, 'Open source / MIT licensed');
		for (const link of window.document.querySelectorAll('.site-github')) {
			assert.equal(link.getAttribute('aria-label'), 'GitHub');
			assert.equal(link.getAttribute('title'), 'GitHub');
			assert.equal(link.textContent, '');
			assert.ok(link.querySelector('[data-site-icon=github]'));
		}
		window.happyDOM.abort();
	}
});

test('Inspector and examples preserve the document language in header/footer and restored pages', t => {
    for (const page of ['inspector', 'examples'] as const) {
        const window = new Window({ url: 'https://example.org/zenfg/' + (page === 'examples' ? 'playground/' : 'inspector/') });
        window.document.documentElement.lang = 'en';
        window.document.body.innerHTML = renderSiteHeader(page) + (page === 'examples' ? renderSiteFooter(page) : '');
        window.localStorage.setItem('zenfg-language', 'zh-CN');
        const theme = createSiteTheme(window as unknown as globalThis.Window);
        const dispose = installSiteHeader(window as unknown as globalThis.Window, theme);
        t.after(() => { dispose(); theme.destroy(); window.happyDOM.abort(); });
        const docs = [...window.document.querySelectorAll<HTMLAnchorElement>('a[href*="docs/"]')];
        const paths = () => docs.map(link => new URL(link.href).pathname);
        const restore = () => {
            const event = new window.Event('pageshow');
            Object.defineProperty(event, 'persisted', { value: true });
            window.dispatchEvent(event);
        };
        assert.ok(docs.length > 0);
        assert.deepEqual(paths(), docs.map(() => '/zenfg/docs/zh-CN/'));
        assert.equal(window.document.documentElement.lang, 'en', 'Document navigation does not translate the application UI');
        window.localStorage.setItem('zenfg-language', 'en');
        restore();
        assert.deepEqual(paths(), docs.map(() => '/zenfg/docs/'));
        window.localStorage.setItem('zenfg-language', 'zh-CN');
        window.dispatchEvent(new window.StorageEvent('storage', { key: 'zenfg-language', newValue: 'zh-CN' }));
        assert.deepEqual(paths(), docs.map(() => '/zenfg/docs/zh-CN/'));
        dispose();
        window.localStorage.setItem('zenfg-language', 'en');
        restore();
        window.dispatchEvent(new window.StorageEvent('storage', { key: 'zenfg-language', newValue: 'en' }));
        assert.deepEqual(paths(), docs.map(() => '/zenfg/docs/zh-CN/'));
    }
});
