import { visualThemes, visualMetrics, type ThemeMode } from '@zenfg/inspector/theme';
export { visualThemes, visualMetrics, type ThemeMode, type VisualPalette } from '@zenfg/inspector/theme';

export function themeProperties(mode: ThemeMode): Record<string, string> {
	return Object.fromEntries(Object.entries({ ...visualThemes[mode], ...visualMetrics })
		.map(([key, value]) => [`--zenfg-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value]));
}

/** Apply to an owned container; sibling containers can use different themes. */
export function applyVisualTheme(container: HTMLElement, mode: ThemeMode): void {
	for (const [property, value] of Object.entries(themeProperties(mode))) container.style.setProperty(property, value);
	container.dataset.theme = mode;
	container.style.colorScheme = mode;
}
