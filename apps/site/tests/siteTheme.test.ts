import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { readThemePreference, themePreferenceKey } from '../shared/theme/preference.ts';
import { createSiteTheme } from '../shared/theme/controller.ts';
import { renderThemeBootstrap } from '../shared/shell/plugin.ts';
import { renderSiteHeader } from '../shared/shell/template.ts';

function storage(values: Record<string, string> = {}) {
	const data = new Map(Object.entries(values));
	return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

test('site preference migrates once, handles conflicting legacy choices and invalid values', () => {
	for (const [values, expected] of [
		[{}, 'dark'],
		[{ 'zenfg-inspector-theme': 'light' }, 'light'],
		[{ 'zenfg-playground-theme': 'light' }, 'light'],
		[{ 'zenfg-inspector-theme': 'light', 'zenfg-playground-theme': 'light' }, 'light'],
		[{ 'zenfg-inspector-theme': 'dark', 'zenfg-playground-theme': 'light' }, 'dark'],
		[{ 'zenfg-inspector-theme': 'invalid', 'zenfg-playground-theme': 'light' }, 'light'],
		[{ 'zenfg-theme': 'light', 'zenfg-inspector-theme': 'dark' }, 'light'],
	] as Array<[Record<string, string>, string]>) {
		const preferences = storage(values);
		assert.equal(readThemePreference(preferences), expected);
		assert.equal(preferences.getItem(themePreferenceKey), expected);
		preferences.setItem('zenfg-inspector-theme', 'dark');
		preferences.setItem('zenfg-playground-theme', 'dark');
		assert.equal(readThemePreference(preferences), expected);
	}
});

test('blocked reads fall back to dark and blocked writes preserve readable legacy light', () => {
	assert.equal(readThemePreference(), 'dark');
	assert.equal(readThemePreference({ getItem: () => { throw Error('blocked'); }, setItem() {} }), 'dark');
	assert.equal(readThemePreference({ getItem: key => key === 'zenfg-inspector-theme' ? 'light' : null, setItem: () => { throw Error('full'); } }), 'light');
});

test('generated pre-paint script selects theme and browser chrome before page modules', () => {
	const bootstrap = renderThemeBootstrap();
	const script = bootstrap.match(/<script>([\s\S]*)<\/script>/)![1]!;
	for (const expected of ['dark', 'light']) {
		const window = new Window();
		window.document.head.innerHTML = '<meta name="theme-color" content="#24283b">';
		runInNewContext(script, { document: window.document, localStorage: storage({ 'zenfg-theme': expected }) });
		assert.equal(window.document.documentElement.dataset.theme, expected);
		assert.equal(window.document.querySelector('meta')?.content, expected === 'light' ? '#f5f6fa' : '#24283b');
		assert.ok(bootstrap.includes(`:root[data-theme="${expected}"]`));
		window.happyDOM.abort();
	}
});

test('runtime sync preserves mounted content and supports storage events and BFCache restore', t => {
	const window = new Window({ url: 'http://localhost/inspector/' });
	window.document.head.innerHTML = '<meta name="theme-color">';
	window.document.body.innerHTML = renderSiteHeader('inspector') + '<input value="retained"><div data-workspace></div>';
	const input = window.document.querySelector('input');
	const workspace = window.document.querySelector('[data-workspace]');
	const theme = createSiteTheme(window as unknown as globalThis.Window);
	t.after(() => { theme.destroy(); window.happyDOM.abort(); });
	const changes: string[] = [];
	const unsubscribe = theme.subscribe(mode => changes.push(mode));
	theme.set('light');
	theme.set('light');
	assert.deepEqual(changes, ['light']);
	assert.equal(window.localStorage.getItem(themePreferenceKey), 'light');
	assert.equal(window.document.querySelector('[data-theme-mode=light]')?.getAttribute('aria-pressed'), 'true');
	assert.equal(window.document.querySelector('input'), input);
	assert.equal(window.document.querySelector('[data-workspace]'), workspace);
	window.localStorage.setItem(themePreferenceKey, 'dark');
	window.dispatchEvent(new window.StorageEvent('storage', { key: themePreferenceKey, newValue: 'dark' }));
	assert.equal(theme.get(), 'dark');
	window.localStorage.setItem(themePreferenceKey, 'light');
	const show = new window.Event('pageshow');
	Object.defineProperty(show, 'persisted', { value: true });
	window.dispatchEvent(show);
	assert.equal(theme.get(), 'light');
	unsubscribe();
	theme.set('dark');
	assert.deepEqual(changes, ['light', 'dark', 'light']);
	theme.destroy();
	window.localStorage.setItem(themePreferenceKey, 'light');
	window.dispatchEvent(show);
	assert.equal(theme.get(), 'dark');
});

test('runtime remains usable with inaccessible browser storage, including restoration', t => {
	const window = new Window();
	Object.defineProperty(window, 'localStorage', { get: () => { throw Error('blocked'); } });
	const theme = createSiteTheme(window as unknown as globalThis.Window);
	t.after(() => { theme.destroy(); window.happyDOM.abort(); });
	theme.set('light');
	const show = new window.Event('pageshow');
	Object.defineProperty(show, 'persisted', { value: true });
	window.dispatchEvent(show);
	assert.equal(theme.get(), 'light');
});

test('failed persistence does not revert the local selection on BFCache restoration', t => {
	const window = new Window();
	Object.defineProperty(window, 'localStorage', { value: {
		getItem: () => 'dark', setItem: () => { throw Error('quota'); },
	} });
	const theme = createSiteTheme(window as unknown as globalThis.Window);
	t.after(() => { theme.destroy(); window.happyDOM.abort(); });
	theme.set('light');
	const show = new window.Event('pageshow');
	Object.defineProperty(show, 'persisted', { value: true });
	window.dispatchEvent(show);
	assert.equal(theme.get(), 'light');
});
