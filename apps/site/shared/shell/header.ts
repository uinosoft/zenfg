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
	for (const button of header.querySelectorAll<HTMLButtonElement>('[data-theme-mode]')) {
		const mode = button.dataset.themeMode === 'light' ? 'light' : 'dark';
		setIconButton(button, mode === 'light' ? 'sun' : 'moon', mode === 'light' ? 'Light' : 'Dark');
		const select = () => theme.set(mode);
		button.addEventListener('click', select);
		cleanup.push(() => button.removeEventListener('click', select));
	}
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
