import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import typescript from '@shikijs/langs/typescript';
import source from '../../../../packages/webgpu/examples/minimal-frame.ts?raw';
import { visualThemes, type ThemeMode } from '../../../shared/theme/index.ts';

function codeTheme(mode: ThemeMode) {
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

export async function mountSource(root: HTMLElement): Promise<void> {
	const host = root.querySelector<HTMLElement>('#source-code')!;
	const copy = root.querySelector<HTMLButtonElement>('#copy-code')!;
	const status = root.querySelector<HTMLElement>('#code-status')!;
	host.textContent = source;
	copy.disabled = false;
	copy.addEventListener('click', () => {
		if (!navigator.clipboard?.writeText) {
			status.textContent = 'Clipboard unavailable. Select the source and copy it manually.';
			return;
		}
		void navigator.clipboard.writeText(source).then(() => { status.textContent = 'Source copied.'; })
			.catch(() => { status.textContent = 'Clipboard unavailable. Select the source and copy it manually.'; });
	});
	status.textContent = 'packages/webgpu/examples/minimal-frame.ts · Exact source, including comments';
	try {
		const highlighter = await createHighlighterCore({
			engine: createOnigurumaEngine(import('shiki/wasm')),
			langs: [typescript], themes: [codeTheme('dark'), codeTheme('light')],
		});
		try {
			host.innerHTML = highlighter.codeToHtml(source, { lang: 'typescript', themes: { dark: 'zenfg-dark', light: 'zenfg-light' }, defaultColor: false });
		} finally { highlighter.dispose(); }
	} catch {
		const pre = document.createElement('pre');
		pre.textContent = source;
		host.replaceChildren(pre);
		status.textContent = 'Highlighting unavailable. Exact source is still readable and copyable.';
	}
}
