import { installAppPageLifecycle } from '../shared/pageLifecycle.ts';
import { createSiteTheme } from '../shared/theme/controller.ts';
import { installSiteHeader } from '../shared/shell/header.ts';
import { installHomeLanguage } from './language.ts';
import { createHomeBackground } from './background.ts';

const theme = createSiteTheme(window);
const disposeHeader = installSiteHeader(window, theme);
const language = installHomeLanguage();
const canvas = document.querySelector<HTMLCanvasElement>('[data-zenfg-background]');
const background = canvas ? createHomeBackground({
	start: async callbacks => {
		const { startZenBackground } = await import('../examples/interactive-background/src/main.ts');
		return startZenBackground(canvas, { interactionTarget: window, ...callbacks });
	},
	onReady: ready => {
		if (ready) document.documentElement.dataset.webgpuBackground = 'ready';
		else document.documentElement.removeAttribute('data-webgpu-background');
	},
	onError: error => console.warn('ZenFG background fell back to CSS.', error),
}) : undefined;
background?.setTheme(theme.get());
const unsubscribe = theme.subscribe(mode => background?.setTheme(mode));

installAppPageLifecycle(window, {
	onDiscard: () => {
		unsubscribe();
		background?.destroy();
		language.destroy();
		disposeHeader();
		theme.destroy();
	},
	onRestore: () => language.restore(),
	reloadOnRestore: import.meta.hot ? () => window.location.reload() : undefined,
});
