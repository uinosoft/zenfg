import { createIcon, setIconButton, type IconName } from '../icons.ts';
import type { SiteThemeController } from '../theme/controller.ts';

/** Binds the build-time header; dispose all listeners with the owning page. */
export function installSiteHeader(window: Window, theme: SiteThemeController): () => void {
	const header = window.document.querySelector<HTMLElement>('[data-site-header]');
	if (!header) throw new Error('Site header is missing.');
	const menu = header.querySelector<HTMLButtonElement>('[data-site-menu]')!;
	const navigation = header.querySelector<HTMLElement>('#site-navigation')!;
	const narrow = window.matchMedia('(max-width: 800px)');
	let open = false;
	for (const placeholder of header.querySelectorAll<HTMLElement>('[data-site-icon]')) {
		placeholder.replaceChildren(createIcon(window.document, placeholder.dataset.siteIcon as IconName));
	}
	const setOpen = (value: boolean, returnFocus = false): void => {
		open = value;
		header.dataset.menuOpen = String(value);
		menu.setAttribute('aria-expanded', String(value));
		setIconButton(menu, value ? 'close' : 'menu', value ? 'Close navigation' : 'Open navigation');
		navigation.inert = narrow.matches && !value;
		if (returnFocus) menu.focus();
	};
	const cleanup: Array<() => void> = [];
	const themeButton = header.querySelector<HTMLButtonElement>('[data-theme-toggle]')!;
	const localized = Boolean(header.querySelector('[data-language-toggle]'));
	const syncTheme = () => {
		const dark = theme.get() === 'dark';
		const chinese = localized && window.document.documentElement.lang.startsWith('zh');
		const label = chinese ? (dark ? '切换到亮色主题' : '切换到暗色主题') : (dark ? 'Switch to light theme' : 'Switch to dark theme');
		setIconButton(themeButton, dark ? 'moon' : 'sun', label);
	};
	const switchTheme = () => theme.set(theme.get() === 'dark' ? 'light' : 'dark');
	themeButton.addEventListener('click', switchTheme);
	const languageObserver = new (window as unknown as typeof globalThis).MutationObserver(syncTheme);
	languageObserver.observe(window.document.documentElement, { attributes: true, attributeFilter: ['lang'] });
	cleanup.push(theme.subscribe(syncTheme), () => languageObserver.disconnect(), () => themeButton.removeEventListener('click', switchTheme));
	syncTheme();
	const toggle = () => {
		setOpen(!open);
		if (open) navigation.querySelector<HTMLAnchorElement>('a')?.focus();
	};
	const escape = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false, true); }
	};
	const outside = (event: PointerEvent) => { if (open && !event.composedPath().includes(header)) setOpen(false); };
	const navigate = (event: MouseEvent) => {
		if ((event.target as Element).closest('a')) setOpen(false, narrow.matches);
	};
	const resize = () => setOpen(false, narrow.matches && navigation.contains(window.document.activeElement));
	menu.addEventListener('click', toggle);
	navigation.addEventListener('click', navigate);
	header.addEventListener('keydown', escape);
	window.addEventListener('pointerdown', outside);
	narrow.addEventListener('change', resize);
	setOpen(false);
	return () => {
		for (const dispose of cleanup) dispose();
		menu.removeEventListener('click', toggle);
		navigation.removeEventListener('click', navigate);
		header.removeEventListener('keydown', escape);
		window.removeEventListener('pointerdown', outside);
		narrow.removeEventListener('change', resize);
	};
}
