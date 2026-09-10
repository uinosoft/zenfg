import { codeTheme } from '../../shared/theme/codeTheme.ts';

type BrowserHighlighter = {
	codeToHtml: (code: string, options: { readonly lang: 'typescript' | 'javascript'; readonly themes: { dark: string; light: string }; readonly defaultColor: false }) => string;
	dispose: () => void;
};

let highlighterPromise: Promise<BrowserHighlighter> | undefined;

export function highlightSource(source: string, language: 'typescript' | 'javascript'): Promise<string> {
	return getHighlighter().then((highlighter) => highlighter.codeToHtml(source, {
		lang: language,
		themes: { dark: 'zenfg-dark', light: 'zenfg-light' },
		defaultColor: false,
	}));
}

export async function disposeHighlighter(): Promise<void> {
	if (!highlighterPromise) return;
	const pending = highlighterPromise;
	highlighterPromise = undefined;
	try { (await pending).dispose(); } catch { /* Failed initialization owns no highlighter. */ }
}

function getHighlighter(): Promise<BrowserHighlighter> {
	highlighterPromise ??= Promise.all([
		import('shiki/core'),
		import('shiki/engine/oniguruma'),
		import('@shikijs/langs/typescript'),
		import('@shikijs/langs/javascript'),
	]).then(async ([{ createHighlighterCore }, { createOnigurumaEngine }, { default: typescript }, { default: javascript }]) => createHighlighterCore({
		engine: createOnigurumaEngine(import('shiki/wasm')),
		langs: [typescript, javascript],
		themes: [codeTheme('dark'), codeTheme('light')],
	}));
	return highlighterPromise;
}
