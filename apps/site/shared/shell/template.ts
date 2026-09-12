export type SitePage = 'home' | 'inspector' | 'playground';

/** Static links work before JavaScript loads and under a deployment subdirectory. */
export function renderSiteHeader(page: SitePage): string {
	const root = page === 'home' ? './' : '../';
	const localized = (key: string) => page === 'home' ? ` data-i18n="${key}"` : '';
	const links = ([['home', 'Home', ''], ['inspector', 'Inspector', 'inspector/'], ['playground', 'Playground', 'playground/']] as const)
		.map(([id, label, path]) => `<a class="site-nav-link" href="${root}${path}"${page === id ? ' aria-current="page"' : ''}${localized(id)}>${label}</a>`).join('');
	return `<header class="site-header" data-site-header data-background-region>
	<a class="site-brand" href="${root}" aria-label="ZenFG home">ZenFG</a>
	<nav class="site-navigation" id="site-navigation" aria-label="Site navigation">
		<div class="site-page-links">${links}</div>
		<div class="site-resource-links"><a class="site-nav-link" href="https://github.com/uinosoft/zenfg/blob/main/docs/README.md" target="_blank" rel="noopener noreferrer"><span${localized('docs')}>Docs</span><span data-site-icon="external" aria-hidden="true"></span></a><a class="site-nav-link" href="https://github.com/uinosoft/zenfg" target="_blank" rel="noopener noreferrer"><span data-site-icon="github" aria-hidden="true"></span>GitHub<span data-site-icon="external" aria-hidden="true"></span></a></div>
	</nav>
	<div class="site-header-actions">
		${page === 'home' ? '<button class="site-control site-language" type="button" data-language-toggle aria-controls="site-content" aria-label="Switch to Simplified Chinese"><span data-site-icon="globe" aria-hidden="true"></span><span data-language-label>中文</span></button>' : ''}
		<div class="site-theme-switch" role="group" aria-label="Appearance"><button class="site-control" type="button" data-theme-mode="dark" aria-pressed="true">Dark</button><button class="site-control" type="button" data-theme-mode="light" aria-pressed="false">Light</button></div>
		<button class="site-control site-menu-toggle" type="button" data-site-menu aria-expanded="false" aria-controls="site-navigation" aria-label="Open navigation">Menu</button>
	</div>
</header>`;
}
