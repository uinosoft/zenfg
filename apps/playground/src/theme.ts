import { applyVisualTheme, visualThemes, type ThemeMode } from '../../shared/theme/index.ts';

const preferenceKey = 'zenfg-playground-theme';
let currentTheme: ThemeMode = 'dark';
const listeners = new Set<(mode: ThemeMode) => void>();
export function getTheme(): ThemeMode { return currentTheme; }
export function subscribeTheme(listener: (mode: ThemeMode) => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
export function readTheme(): ThemeMode {
	try { return localStorage.getItem(preferenceKey) === 'light' ? 'light' : 'dark'; }
	catch { return 'dark'; }
}
export function setTheme(mode: ThemeMode): void {
	currentTheme = mode;
	applyVisualTheme(document.documentElement, mode);
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', visualThemes[mode].canvas);
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-mode]')) {
		button.setAttribute('aria-pressed', String(button.dataset.themeMode === mode));
	}
	for (const listener of listeners) listener(mode);
	try { localStorage.setItem(preferenceKey, mode); } catch { /* Appearance works without storage. */ }
}
setTheme(readTheme());
