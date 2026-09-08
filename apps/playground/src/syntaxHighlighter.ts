type BrowserHighlighter = {
	codeToHtml: (code: string, options: { readonly lang: 'typescript' | 'javascript'; readonly theme: 'github-dark-default' }) => string;
	dispose: () => void;
};

let highlighterPromise: Promise<BrowserHighlighter> | undefined;

export function highlightSource(source: string, language: 'typescript' | 'javascript'): Promise<string> {
	return getHighlighter().then((highlighter) => highlighter.codeToHtml(source, {
		lang: language,
		theme: 'github-dark-default',
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
		import('@shikijs/themes/github-dark-default'),
	]).then(async ([{ createHighlighterCore }, { createOnigurumaEngine }, { default: typescript }, { default: javascript }, { default: githubDarkDefault }]) => createHighlighterCore({
		engine: createOnigurumaEngine(import('shiki/wasm')),
		langs: [typescript, javascript],
		themes: [githubDarkDefault],
	}));
	return highlighterPromise;
}
