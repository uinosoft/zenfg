/** Internal visual foundations. No storage, global selectors, or host preferences. */
export type ThemeMode = 'dark' | 'light';

const dark = {
	canvas: '#24283b', sidebar: '#1f2335', panel: '#292e42', inset: '#202437',
	hover: '#30374e', border: '#454d6c', divider: '#353c55',
	text: '#c0caf5', secondary: '#a9b1d6', muted: '#9aa5ce',
	accent: '#7aa2f7', accentSoft: '#2c3855', onAccent: '#1f2335',
	purple: '#bb9af7', cyan: '#7dcfff', success: '#9ece6a', warning: '#e0af68', danger: '#f7768e',
	render: '#9ece6a', compute: '#a6afff', copy: '#e0af68', clear: '#c4cf89',
	command: '#bb9af7', external: '#ff9e64', declaration: '#cfc9c2', output: '#f5a2c0',
	texture: '#f5a2c0', buffer: '#73daca', edge: '#9aa5ce', group: '#8592bd',
	comment: '#9aa5ce', keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64',
	function: '#7aa2f7', type: '#7dcfff', property: '#73daca',
} as const;

export type VisualPalette = { readonly [Key in keyof typeof dark]: string };

export const visualThemes: Readonly<Record<ThemeMode, VisualPalette>> = {
	dark,
	light: {
		canvas: '#f5f6fa', sidebar: '#eceef5', panel: '#ffffff', inset: '#eef0f7',
		hover: '#e2e6f1', border: '#909ab0', divider: '#d8ddea',
		text: '#343b58', secondary: '#59627d', muted: '#5e667e',
		accent: '#2959aa', accentSoft: '#e1e9f8', onAccent: '#ffffff',
		purple: '#5a3e8e', cyan: '#006c86', success: '#385f0d', warning: '#8f5e15', danger: '#a03b50',
		render: '#385f0d', compute: '#5155a6', copy: '#8f5e15', clear: '#566423',
		command: '#5a3e8e', external: '#965027', declaration: '#65553e', output: '#963c67',
		texture: '#963c67', buffer: '#236b62', edge: '#606982', group: '#606982',
		comment: '#606982', keyword: '#5a3e8e', string: '#385f0d', number: '#965027',
		function: '#2959aa', type: '#006c86', property: '#236b62',
	},
};

export const visualMetrics = {
	fontUi: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
	fontMono: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", "Microsoft YaHei", monospace',
	fontBody: '14px', fontControl: '13px', fontTitle: '28px', fontCode: '14px',
	space1: '4px', space2: '8px', space3: '12px', space4: '16px', space6: '24px', space8: '32px',
	radiusSmall: '6px', radiusPanel: '10px',
} as const;

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
