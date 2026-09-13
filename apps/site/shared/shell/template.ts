export type SitePage = 'home' | 'inspector' | 'playground';

/** Static links work before JavaScript loads and under a deployment subdirectory. */
export function renderSiteHeader(page: SitePage): string {
	const root = page === 'home' ? './' : '../';
	const localized = (key: string) => page === 'home' ? ` data-i18n="${key}"` : '';
	const links = ([['home', 'Home', ''], ['inspector', 'Inspector', 'inspector/'], ['playground', 'Playground', 'playground/']] as const)
		.map(([id, label, path]) => `<a class="site-nav-link" href="${root}${path}"${page === id ? ' aria-current="page"' : ''}${localized(id)}>${label}</a>`).join('');
	return `<header class="site-header" data-site-header data-background-region>
	<a class="site-brand" href="${root}" aria-label="ZenFG home">Zen<span class="brand-accent">FG</span></a>
	<nav class="site-navigation" id="site-navigation" aria-label="Site navigation">
		<div class="site-page-links">${links}</div>
		<div class="site-resource-links"><a class="site-nav-link" href="https://github.com/uinosoft/zenfg/blob/main/docs/README.md" target="_blank" rel="noopener noreferrer"><span${localized('docs')}>Docs</span><span data-site-icon="external" aria-hidden="true"></span></a></div>
	</nav>
	<div class="site-header-actions">
		${page === 'home' ? '<div class="site-language-menu" data-language-root><button class="site-control site-language" type="button" data-language-toggle aria-haspopup="menu" aria-expanded="false" aria-controls="site-language-menu" aria-label="Choose language"><span data-site-icon="globe" aria-hidden="true"></span></button><div class="site-language-options" id="site-language-menu" role="menu" aria-label="Language" hidden><button type="button" role="menuitemradio" aria-checked="false" tabindex="-1" data-language-choice="zh-CN" lang="zh-CN">简体中文<span class="language-check" aria-hidden="true">✓</span></button><button type="button" role="menuitemradio" aria-checked="true" tabindex="-1" data-language-choice="en" lang="en">English<span class="language-check" aria-hidden="true">✓</span></button></div></div>' : ''}
		<a class="site-control site-github" aria-label="GitHub" title="GitHub" href="https://github.com/uinosoft/zenfg" target="_blank" rel="noopener noreferrer"><span data-site-icon="github" aria-hidden="true"></span></a>
		<button class="site-control site-theme-toggle" type="button" data-theme-toggle aria-label="Switch to light theme">Theme</button>
		<button class="site-control site-menu-toggle" type="button" data-site-menu aria-expanded="false" aria-controls="site-navigation" aria-label="Open navigation">Menu</button>
	</div>
</header>`;
}

/** Shared footer for public content pages; links remain usable before hydration. */
export function renderSiteFooter(page: 'home' | 'playground'): string {
	const localized = (key: string) => page === 'home' ? ` data-i18n="${key}"` : '';
	return `<footer class="site-footer" data-background-region>
	<a class="site-brand" href="${page === 'home' ? './' : '../'}" aria-label="ZenFG home">Zen<span class="brand-accent">FG</span></a>
	<p class="note"${localized('note')}>Open source / MIT licensed</p>
	<nav class="footer-links" aria-label="Project resources"${page === 'home' ? ' data-i18n-aria="projectLinks"' : ''}>
	<a href="https://github.com/uinosoft/zenfg/blob/main/docs/README.md" target="_blank" rel="noopener noreferrer"${localized('docs')}>Docs</a>
	<a class="site-github" href="https://github.com/uinosoft/zenfg" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub"><span data-site-icon="github" aria-hidden="true"></span></a>
	</nav>
	</footer>`;
}
