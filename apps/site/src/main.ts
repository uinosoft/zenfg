import { installAppPageLifecycle } from '../shared/pageLifecycle.ts';
import { createSiteTheme } from '../shared/theme/controller.ts';
import { installSiteHeader } from '../shared/shell/header.ts';
import { installHomeLanguage } from './language.ts';
import { createHomeBackground } from './background.ts';
import { surfaceFallbackSvg } from '../examples/refractive-flow/src/fallback.ts';
import { projectPoint, coverFocus } from '../examples/refractive-flow/src/curves.ts';
import type { CoverReadingRegions, ReadingRegion } from '../examples/refractive-flow/src/host.ts';

const theme = createSiteTheme(window);
const disposeHeader = installSiteHeader(window, theme);
const language = installHomeLanguage();
const canvas = document.querySelector<HTMLCanvasElement>('[data-zenfg-background]');
const marker = document.querySelector<HTMLElement>('.cover-story-marker');
const fallback = document.querySelector('[data-cover-fallback]');
const intro = document.querySelector('.intro');
let readingRegions: CoverReadingRegions = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const readingListeners = new Set<() => void>();
const positionMarker = ([x, y]: readonly [number, number]) => {
	marker?.style.setProperty('--anchor-x', (Math.max(.6, Math.min(.90, x)) * 100) + '%');
	marker?.style.setProperty('--anchor-y', (y * 100) + '%');
};
const updateCoverLayout = () => {
	if (!fallback || !canvas) return;
	const { width, height, left, top } = canvas.getBoundingClientRect();
	if (width <= 0 || height <= 0) return;
	const region = (selector: string): ReadingRegion => {
		const rects = [...document.querySelectorAll(selector)].map(element => {
			const range = document.createRange();
			range.selectNodeContents(element);
			return range.getBoundingClientRect();
		});
		return [0, (Math.min(...rects.map(r => r.top)) - top - 4) / height,
			(Math.max(...rects.map(r => r.right)) - left + 4) / width,
			(Math.max(...rects.map(r => r.bottom)) - top + 4) / height];
	};
	readingRegions = [region('h1'), region('.summary'), region('.value')];
	for (const listener of readingListeners) listener();
	fallback.innerHTML = surfaceFallbackSvg(width, height, readingRegions);
	positionMarker(projectPoint(coverFocus, width / height, width < 600));
};
const layoutObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateCoverLayout);
if (canvas) layoutObserver?.observe(canvas);
if (intro) layoutObserver?.observe(intro);
const textObserver = new MutationObserver(updateCoverLayout);
if (intro) textObserver.observe(intro, { subtree: true, childList: true, characterData: true });
updateCoverLayout();
const background = canvas ? createHomeBackground({
	start: async (mode, callbacks) => {
		const { startRefractiveFlow } = await import('../examples/refractive-flow/src/main.ts');
		return startRefractiveFlow(canvas, {
			theme: mode, presentation: 'cover', ...callbacks,
			parallaxTarget: canvas.closest<HTMLElement>('.hero') ?? canvas,
			onAnchor: positionMarker,
			readingRegions: {
				get: () => readingRegions,
				subscribe(listener) {
					readingListeners.add(listener);
					return () => readingListeners.delete(listener);
				},
			},
		});
	},
	onReady: ready => {
		if (ready) document.documentElement.dataset.webgpuBackground = 'ready';
		else document.documentElement.removeAttribute('data-webgpu-background');
	},
	onError: error => {
		document.documentElement.dataset.webgpuBackground = 'failed';
		console.warn('ZenFG cover fell back to the static artwork.', error);
	},
}) : undefined;
background?.setTheme(theme.get());
const unsubscribe = theme.subscribe(mode => background?.setTheme(mode));
const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
	background?.setActive(entries.some(entry => entry.isIntersecting));
});
if (canvas) observer?.observe(canvas);

installAppPageLifecycle(window, {
	onDiscard: () => {
		unsubscribe();
		observer?.disconnect();
		layoutObserver?.disconnect();
		textObserver.disconnect();
		background?.destroy();
		language.destroy();
		disposeHeader();
		theme.destroy();
	},
	onRestore: () => language.restore(),
	reloadOnRestore: import.meta.hot ? () => window.location.reload() : undefined,
});
