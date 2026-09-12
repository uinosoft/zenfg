import { mountFrameGraphInspector } from '@zenfg/inspector';
import { tokyoNightStorm, tokyoNightLight } from '@zenfg/inspector/theme';
import { installAppPageLifecycle } from '../../shared/pageLifecycle.ts';
import { createSiteTheme } from '../../shared/theme/controller.ts';
import { installSiteHeader } from '../../shared/shell/header.ts';

const host = document.querySelector<HTMLElement>('#inspector-host');
if (!host) throw new Error('Inspector application host is missing.');
const theme = createSiteTheme(window);
const disposeHeader = installSiteHeader(window, theme);
const themes = { dark: tokyoNightStorm, light: tokyoNightLight };
const inspector = mountFrameGraphInspector(host, { branding: false, theme: themes[theme.get()] });
const unsubscribe = theme.subscribe(mode => inspector.setTheme(themes[mode]));

installAppPageLifecycle(window, {
	onDiscard: () => { unsubscribe(); disposeHeader(); theme.destroy(); inspector.destroy(); },
	reloadOnRestore: import.meta.hot ? () => window.location.reload() : undefined,
});
