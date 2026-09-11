import { visualThemes, type ThemeMode } from './index.ts';

export function codeTheme(mode: ThemeMode) {
	const colors = visualThemes[mode];
	return {
		name: `zenfg-${mode}`, type: mode, bg: colors.canvas, fg: colors.text,
		tokenColors: [
			{ scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: colors.comment } },
			{ scope: ['keyword', 'storage'], settings: { foreground: colors.keyword } },
			{ scope: ['string'], settings: { foreground: colors.string } },
			{ scope: ['constant.numeric', 'constant.language'], settings: { foreground: colors.number } },
			{ scope: ['entity.name.function', 'support.function'], settings: { foreground: colors.function } },
			{ scope: ['entity.name.type', 'support.type', 'support.class'], settings: { foreground: colors.type } },
			{ scope: ['variable.other.property', 'variable.object.property', 'meta.object-literal.key'], settings: { foreground: colors.property } },
		],
	};
}

