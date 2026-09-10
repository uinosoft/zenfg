import { applyVisualTheme, visualThemes, type ThemeMode } from '../../shared/theme/index.ts';

const preferenceKey = 'zenfg-playground-theme';
export function readTheme(): ThemeMode {
	try { return localStorage.getItem(preferenceKey) === 'light' ? 'light' : 'dark'; }
	catch { return 'dark'; }
}
export function setTheme(mode: ThemeMode): void {
	applyVisualTheme(document.documentElement, mode);
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', visualThemes[mode].canvas);
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-mode]')) {
		button.setAttribute('aria-pressed', String(button.dataset.themeMode === mode));
	}
	try { localStorage.setItem(preferenceKey, mode); } catch { /* Appearance works without storage. */ }
}
setTheme(readTheme());
