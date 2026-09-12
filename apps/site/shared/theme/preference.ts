import type { ThemeMode } from './index.ts';

export const themePreferenceKey = 'zenfg-theme';
type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Shared by the pre-paint bootstrap and runtime; migration runs only without a valid site preference. */
export function readThemePreference(storage?: ThemeStorage): ThemeMode {
	try {
		const stored = storage?.getItem(themePreferenceKey);
		if (stored === 'dark' || stored === 'light') return stored;
		const legacy = ['zenfg-inspector-theme', 'zenfg-playground-theme']
			.map(key => storage?.getItem(key)).filter(value => value === 'dark' || value === 'light');
		const mode = legacy.length > 0 && legacy.every(value => value === 'light') ? 'light' : 'dark';
		try { storage?.setItem(themePreferenceKey, mode); } catch { /* A readable legacy choice still applies. */ }
		return mode;
	} catch { return 'dark'; }
}
