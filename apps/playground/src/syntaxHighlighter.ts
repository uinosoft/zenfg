type BrowserHighlighter = {
	codeToHtml: (code: string, options: { readonly lang: 'typescript'; readonly theme: 'github-dark-default' }) => string;
	dispose: () => void;
};

let highlighterPromise: Promise<BrowserHighlighter> | undefined;

export function highlightTypeScript(source: string): Promise<string> {
	return getHighlighter().then((highlighter) => highlighter.codeToHtml(source, {
		lang: 'typescript',
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
		import('@shikijs/themes/github-dark-default'),
	]).then(async ([{ createHighlighterCore }, { createOnigurumaEngine }, { default: typescript }, { default: githubDarkDefault }]) => createHighlighterCore({
		engine: createOnigurumaEngine(import('shiki/wasm')),
		langs: [typescript],
		themes: [githubDarkDefault],
	}));
	return highlighterPromise;
}
