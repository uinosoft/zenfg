import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { installHomeLanguage } from '../src/language.ts';
import { renderSiteHeader } from '../shared/shell/template.ts';

test('Home language updates content, shared navigation, metadata and accessible labels', t => {
	const window = new Window();
	const originals = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
	Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true });
	window.document.write(readFileSync('apps/site/index.html', 'utf8').replace('<!-- site-header:home -->', renderSiteHeader('home')));
	window.document.documentElement.lang = 'en';
	const language = installHomeLanguage();
	t.after(() => {
		language.destroy();
		window.happyDOM.abort();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	});
	const toggle = window.document.querySelector<HTMLButtonElement>('[data-language-toggle]')!;
	toggle.click();
	assert.equal(window.document.documentElement.lang, 'zh-CN');
	assert.equal(window.document.querySelector('[aria-current=page]')?.textContent, '首页');
	assert.equal(toggle.getAttribute('aria-label'), '切换到英文');
	assert.match(window.document.title, /面向/);
	assert.match(window.document.querySelector('meta[name=description]')!.getAttribute('content')!, /面向/);
	assert.equal(window.document.querySelector('[data-i18n=value]')?.textContent, '组织渲染，洞察每一帧。');
	assert.equal(window.document.querySelector('[data-i18n=validationTitle]')?.textContent, '资源管理');
	assert.match(window.document.querySelector('[data-i18n=inspectionDescription]')!.textContent, /看清每一帧/);
	assert.equal(window.document.querySelector('.cover-story-marker')?.getAttribute('href'), './playground/?example=refractive-flow&panel=inspector');
	assert.equal(window.document.querySelector('.cover-story-marker')?.getAttribute('aria-label'), '探索封面故事');
	assert.equal(window.document.querySelector('[data-i18n=explore]')?.textContent, '探索');
	assert.equal(window.localStorage.getItem('zenfg-language'), 'zh-CN');
	language.restore();
	assert.equal(window.document.documentElement.lang, 'zh-CN');
	toggle.click();
	assert.equal(window.document.documentElement.lang, 'en');
	assert.equal(window.document.querySelector('[aria-current=page]')?.textContent, 'Home');
	assert.match(window.document.querySelector('[data-i18n=summary]')!.textContent, /independent/);
	assert.equal(window.document.querySelector('[data-i18n=explore]')?.textContent, 'Explore');
	assert.equal(window.document.querySelector('[data-i18n=validationTitle]')?.textContent, 'Resource management');
	language.destroy();
	toggle.click();
	assert.equal(window.document.documentElement.lang, 'en');
});
