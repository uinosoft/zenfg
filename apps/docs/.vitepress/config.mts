import { socialHead } from '../../site/shared/social.ts';
import { defineConfig } from 'vitepress';
import { resolve } from 'node:path';
import { root, contentDir, read, pages } from '../../../scripts/docs/catalog.mjs';
import { exportMarkdown, plainMarkdown, llmsIndex } from '../../../scripts/docs/export.mjs';
import { visualThemes, visualMetrics } from '../../../packages/inspector/src/themePalette.ts';
import { readThemePreference, themePreferenceKey } from '../../site/shared/theme/preference.ts';
import { docsUi, chineseTheme, chineseSearch } from './locales.ts';
import { tokenize } from './search.mjs';
const meta = JSON.parse(read(resolve(contentDir, 'metadata.json')));
const apiSidebar = JSON.parse(read(resolve(contentDir, 'api/typedoc-sidebar.json')));
function sidebar(locale: 'en' | 'zh-CN') {
    const ui = docsUi[locale];
    const result = [...new Set(pages.map(p => p.group))].map(group => ({ text: ui.groups[group as keyof typeof ui.groups], items: meta.pages.filter(p => p.locale === locale && p.group === group).map(p => ({ text: p.title, link: p.route === 'index' ? '/' : p.route.endsWith('/index') ? `/${p.route.slice(0, -5)}` : `/${p.route}` })) }));
    result.push({ text: ui.context.api, items: apiSidebar });
    result.push({ text: 'Rust API ↗', items: meta.packages.filter(p => p.registry === 'cargo' && p.published).map(p => ({ text: `${p.name} ${p.published}`, link: `https://docs.rs/${p.name}/${p.published}/` })) });
    return result;
}
const paletteCss = Object.entries(visualThemes).map(([mode, t]) => `${mode === 'dark' ? 'html.dark' : ':root'}{${Object.entries({
    '--vp-c-bg': t.canvas, '--vp-c-bg-alt': t.sidebar, '--vp-c-bg-elv': t.panel, '--vp-c-bg-soft': t.inset,
    '--vp-c-bg-hover': t.hover,
    '--vp-c-text-1': t.text, '--vp-c-text-2': t.secondary, '--vp-c-text-3': t.muted,
    '--vp-c-brand-1': t.accent, '--vp-c-brand-2': t.accent, '--vp-c-brand-3': t.accent,
    '--vp-c-divider': t.divider, '--vp-c-border': t.border,
    '--vp-font-family-base': visualMetrics.fontUi, '--vp-font-family-mono': visualMetrics.fontMono,
}).map(([k, v]) => `${k}:${v}`).join(';')}}`).join('');
export default defineConfig({
    title: 'ZenFG', description: 'FrameGraph guides and API reference for WebGPU and wgpu.', lang: 'en',
    srcDir: contentDir, outDir: 'dist', base: meta.docsBase,
    appearance: false, cleanUrls: false,
    ignoreDeadLinks: [/^\/(?:zh-CN\/)?llms\.txt$/],
    // Empty labels suppress the stock menu, which invents Chinese API URLs.
    // The public theme slots below use the catalog's actual counterpart links.
    locales: {
        root: { lang: 'en', themeConfig: { sidebar: sidebar('en'), docsUi: docsUi.en } },
        'zh-CN': { lang: 'zh-CN', description: docsUi['zh-CN'].description, themeConfig: { ...chineseTheme, sidebar: sidebar('zh-CN'), docsUi: docsUi['zh-CN'] } },
    },
    head: [
        ['link', { rel: 'icon', href: meta.docsBase + 'favicon.ico', sizes: 'any' }],
        ['link', { rel: 'icon', href: meta.docsBase + 'favicon.svg', type: 'image/svg+xml' }],
        ['link', { rel: 'apple-touch-icon', href: meta.docsBase + 'apple-touch-icon.png', sizes: '180x180' }],
        ['link', { rel: 'manifest', href: meta.docsBase + 'site.webmanifest' }],
        ['meta', { name: 'theme-color', content: visualThemes.dark.canvas }],
        ['style', {}, paletteCss],
        ['script', {}, `(()=>{const themePreferenceKey=${JSON.stringify(themePreferenceKey)};const readThemePreference=${readThemePreference.toString()};let storage;try{storage=localStorage}catch{}const mode=readThemePreference(storage);document.documentElement.classList.toggle('dark',mode==='dark');document.documentElement.dataset.theme=mode})()`],
    ],
    markdown: { languages: ['ts', 'typescript', 'rust', 'json', 'sh', 'text', 'toml', 'html'] },
    themeConfig: {
        siteTitle: 'Zen<span class="brand-accent">FG</span>', projectBase: meta.base,
        logo: { src: '/brand/zenfg-mark.svg', alt: '' },
        logoLink: { link: meta.base, target: '_self' },
        nav: [],
        search: { provider: 'local', options: { miniSearch: { options: { tokenize } }, locales: { 'zh-CN': { translations: chineseSearch } } } },
        outline: [2, 3],
        socialLinks: [{ icon: 'github', link: 'https://github.com/uinosoft/zenfg' }],
        footer: { message: 'Open source / MIT licensed' },
        editLink: { pattern: ({ frontmatter }) => frontmatter.editUrl, text: 'Edit this page' },
    },
    transformPageData(pageData) {
        const route = pageData.relativePath.replaceAll('\\', '/').replace(/\.md$/, '');
        const entry = meta.pages.find(p => p.route === route);
        if (entry) {
            pageData.frontmatter.markdownUrl = entry.markdownUrl;
            pageData.frontmatter.sourceUrl = entry.sourceUrl;
            pageData.frontmatter.editUrl = entry.editUrl;
            pageData.frontmatter.commit = meta.commit;
            pageData.frontmatter.locale = entry.locale;
            pageData.frontmatter.alternateUrl = entry.alternateUrl;
            pageData.frontmatter.translationUrl = entry.translationUrl;
            pageData.frontmatter.translationState = entry.translationState;
            pageData.frontmatter.anchorMap = entry.anchorMap;
            pageData.frontmatter.englishOnlyApi = entry.group === 'TypeScript API';
        }
        pageData.frontmatter.packageVersions = meta.packages.map(p => `${p.name} ${p.version}`).join(' · ');
        pageData.frontmatter.publishedPackageVersions = meta.packages.map(p => `${p.name} ${p.published ?? '(release tags unavailable)'}`).join(' / ');
    },
    transformHead({ pageData }) {
        const route = pageData.relativePath.replaceAll('\\', '/').replace(/\.md$/, '');
        const social = socialHead('docs/' + (route === 'index' ? '' : route + '.html'),
            (pageData.title ? pageData.title + ' | ' : '') + 'ZenFG',
            pageData.description || 'FrameGraph guides and API reference for WebGPU and wgpu.');
        if (!pageData.frontmatter.markdownUrl) return social;
        return [
            ...social,
            ['link', { rel: 'alternate', type: 'text/markdown', href: pageData.frontmatter.markdownUrl }],
            ['link', { rel: 'describedby', href: `${meta.docsBase}${pageData.frontmatter.locale === 'zh-CN' ? 'zh-CN/' : ''}llms.txt` }],
            ...(pageData.frontmatter.alternateUrl ? [['link', { rel: 'alternate', hreflang: pageData.frontmatter.locale === 'zh-CN' ? 'en' : 'zh-CN', href: pageData.frontmatter.alternateUrl }] as [string, Record<string, string>]] : []),
        ];
    },
    buildEnd(config) { exportMarkdown(config.outDir, meta); },
    vite: {
        publicDir: resolve(root, 'apps/docs/public'),
        resolve: { alias: { '@zenfg/inspector/theme': resolve(root, 'packages/inspector/src/theme.ts') } },
        server: { hmr: { clientPort: Number(process.env.DOCS_DEV_PORT ?? 5174) }, fs: { allow: [root] } },
        plugins: [{
            name: 'zenfg-docs-sources',
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    // Vite imports Markdown as JavaScript during development. Only
                    // ordinary document/fetch requests should receive the raw text.
                    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
                    if (requestUrl.searchParams.has('import') || req.headers['sec-fetch-dest'] === 'script') { next(); return; }
                    const url = requestUrl.pathname;
                    const current = JSON.parse(read(resolve(contentDir, 'metadata.json')));
                    if (url === `${meta.docsBase}llms.txt` || url === `${meta.docsBase}zh-CN/llms.txt`) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(llmsIndex(current, url.includes('/zh-CN/') ? 'zh-CN' : 'en')); return; }
                    const page = current.pages.find(p => p.markdownUrl === url);
                    if (page) { res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.end(plainMarkdown(page, current)); return; }
                    next();
                });

            },
        }],
    },
});
