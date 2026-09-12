import { applyVisualTheme, visualThemes, type ThemeMode } from './index.ts';
import { readThemePreference, themePreferenceKey } from './preference.ts';

export interface SiteThemeController {
	get(): ThemeMode;
	set(mode: ThemeMode): void;
	subscribe(listener: (mode: ThemeMode) => void): () => void;
	destroy(): void;
}

/** Owns only site preference and document appearance; subscribers own their components. */
export function createSiteTheme(window: Window): SiteThemeController {
	const document = window.document;
	let storage: Storage | undefined;
	try { storage = window.localStorage; } catch { /* Appearance works without storage. */ }
	let mode = readThemePreference(storage);
	let unsaved = false;
	const listeners = new Set<(mode: ThemeMode) => void>();
	function apply(next: ThemeMode): void {
		const changed = mode !== next;
		mode = next;
		applyVisualTheme(document.documentElement, mode);
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', visualThemes[mode].canvas);
		for (const button of document.querySelectorAll('[data-theme-mode]')) {
			button.setAttribute('aria-pressed', String(button.getAttribute('data-theme-mode') === mode));
		}
		if (changed) for (const listener of listeners) listener(mode);
	}
	const sync = () => {
		if (unsaved) return; // A failed write must not undo the user's local choice on restoration.
		try {
			const stored = storage?.getItem(themePreferenceKey);
			if (stored === 'dark' || stored === 'light') apply(stored);
			else if (storage && stored === null) apply(readThemePreference(storage));
		} catch { /* Keep the in-memory selection if reading storage becomes unavailable. */ }
	};
	const onStorage = (event: StorageEvent) => {
		if ((!event.storageArea || event.storageArea === storage) && (event.key === themePreferenceKey || event.key === null)) sync();
	};
	const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) sync(); };
	window.addEventListener('storage', onStorage);
	window.addEventListener('pageshow', onPageShow);
	apply(mode);
	return {
		get: () => mode,
		set(next) {
			apply(next);
			try { storage?.setItem(themePreferenceKey, mode); unsaved = false; }
			catch { unsaved = true; }
		},
		subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		destroy() {
			listeners.clear();
			window.removeEventListener('storage', onStorage);
			window.removeEventListener('pageshow', onPageShow);
		},
	};
}
