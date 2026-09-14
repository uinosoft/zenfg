import type { Plugin } from 'vite';
// Build-time configuration must also work before any publishable package has a dist directory.
import { visualThemes, visualMetrics } from '../../../../packages/inspector/src/themePalette.ts';
import { cssThemeProperties } from '../theme/properties.ts';
import { readThemePreference, themePreferenceKey } from '../theme/preference.ts';
import { renderSiteFooter, renderSiteHeader, type SitePage } from './template.ts';

/** Generate both palettes and bootstrap from the same data/functions used at runtime. */
export function renderThemeBootstrap(): string {
	const css = (['dark', 'light'] as const).map(mode => {
		const declarations = Object.entries(cssThemeProperties({ ...visualThemes[mode], ...visualMetrics })).map(([key, value]) => `${key}:${value}`).join(';');
		return `${mode === 'dark' ? ':root,' : ''}:root[data-theme="${mode}"]{${declarations};color-scheme:${mode}}`;
	}).join('');
	return `<style>${css}</style><script>(()=>{const themePreferenceKey=${JSON.stringify(themePreferenceKey)};const readThemePreference=${readThemePreference.toString()};let storage;try{storage=localStorage}catch{}const mode=readThemePreference(storage);document.documentElement.dataset.theme=mode;document.querySelector('meta[name="theme-color"]').content=${JSON.stringify({ dark: visualThemes.dark.canvas, light: visualThemes.light.canvas })}[mode]})()</script>`;
}

export function siteShellPlugin(): Plugin {
	return {
		name: 'zenfg-site-shell',
		transformIndexHtml: {
			order: 'pre',
			handler(html) {
				const match = html.match(/<!-- site-header:(home|inspector|examples) -->/);
				if (!match) return html;
				return html.replace(match[0], renderSiteHeader(match[1] as SitePage))
					.replace('<!-- site-theme -->', renderThemeBootstrap())
					.replace(/<!-- site-footer:(home|examples) -->/, (_, page: 'home' | 'examples') => renderSiteFooter(page));
			},
		},
	};
}
