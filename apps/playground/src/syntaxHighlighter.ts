type BrowserHighlighter = {
	codeToHtml: (code: string, options: { readonly lang: 'typescript' | 'javascript'; readonly theme: 'poimandres' }) => string;
	dispose: () => void;
};

let highlighterPromise: Promise<BrowserHighlighter> | undefined;

export function highlightSource(source: string, language: 'typescript' | 'javascript'): Promise<string> {
	return getHighlighter().then((highlighter) => highlighter.codeToHtml(source, {
		lang: language,
		theme: 'poimandres',
	}));
}

export async function disposeHighlighter(): Promise<void> {
	if (!highlighterPromise) return;
	(await highlighterPromise).dispose();
	highlighterPromise = undefined;
}

function getHighlighter(): Promise<BrowserHighlighter> {
	highlighterPromise ??= Promise.all([
		import('shiki/core'),
		import('shiki/engine/oniguruma'),
		import('@shikijs/langs/typescript'),
		import('@shikijs/langs/javascript'),
		import('@shikijs/themes/poimandres'),
	]).then(async ([{ createHighlighterCore }, { createOnigurumaEngine }, { default: typescript }, { default: javascript }, { default: poimandres }]) => createHighlighterCore({
		engine: createOnigurumaEngine(import('shiki/wasm')),
		langs: [typescript, javascript],
		themes: [poimandres],
	}));
	return highlighterPromise;
}
