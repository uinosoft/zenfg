import { mountFrameGraphInspector } from '@zenfg/inspector';
import { installAppPageLifecycle } from '../../shared/pageLifecycle.ts';
import { setIconButton } from '../../shared/icons.ts';
import './styles.css';
import { tokyoNightStorm, tokyoNightLight } from '@zenfg/inspector/theme';
import { applyVisualTheme, type ThemeMode } from '../../shared/theme/index.ts';

const host = document.querySelector<HTMLElement>('#inspector-host');
if (!host) throw new Error('Inspector application host is missing.');

const preferenceKey = 'zenfg-inspector-theme';
let mode: ThemeMode = 'dark';
try { if (localStorage.getItem(preferenceKey) === 'light') mode = 'light'; } catch { /* Local appearance still works. */ }
const themes = { dark: tokyoNightStorm, light: tokyoNightLight };
applyVisualTheme(document.documentElement, mode);
const inspector = mountFrameGraphInspector(host, { branding: false, theme: themes[mode] });
const buttons = document.querySelectorAll<HTMLButtonElement>('[data-theme-mode]');
for (const button of buttons) setIconButton(button, button.dataset.themeMode === 'light' ? 'sun' : 'moon', button.dataset.themeMode === 'light' ? 'Light' : 'Dark');
function updateButtons(): void {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.themeMode === mode));
}
for (const button of buttons) button.addEventListener('click', () => {
    mode = button.dataset.themeMode === 'light' ? 'light' : 'dark';
    applyVisualTheme(document.documentElement, mode);
    inspector.setTheme(themes[mode]);
    updateButtons();
    try { localStorage.setItem(preferenceKey, mode); } catch { /* Appearance works without storage. */ }
});
updateButtons();

installAppPageLifecycle(window, {
	onDiscard: () => {
		inspector.destroy();
	},
	reloadOnRestore: import.meta.hot ? () => {
		window.location.reload();
	} : undefined,
});
