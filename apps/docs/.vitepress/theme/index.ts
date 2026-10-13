import DefaultTheme from 'vitepress/theme';
import { h, onMounted, onUnmounted, ref, watch } from 'vue';
import { useData } from 'vitepress';
import { createSiteTheme } from '../../../site/shared/theme/controller.ts';
import { siteNavigation } from '../../../site/shared/navigation.ts';
import { icons, iconAttributes } from '../../../site/shared/icons.ts';
import { themeAction } from '../../../site/shared/theme/action.ts';
import type { ThemeMode } from '../../../site/shared/theme/index.ts';
import { storeLanguage } from '../../../site/shared/language.ts';
import { docsUi } from '../locales.ts';
import './style.css';
function interfaceText(language: string) { return docsUi[language === 'zh-CN' ? 'zh-CN' : 'en']; }
const ThemeButton = {
    setup() {
        const { lang } = useData();
        const mode = ref<ThemeMode>('dark');
        let theme: ReturnType<typeof createSiteTheme> | undefined;
        let unsubscribe: (() => void) | undefined;
        onMounted(() => {
            theme = createSiteTheme(window);
            const sync = (next: ThemeMode) => { mode.value = next; document.documentElement.classList.toggle('dark', next === 'dark'); };
            sync(theme.get()); unsubscribe = theme.subscribe(sync);
        });
        onUnmounted(() => { unsubscribe?.(); theme?.destroy(); });
        return () => {
            const { icon } = themeAction(mode.value);
            const ui = interfaceText(lang.value), label = mode.value === 'dark' ? ui.light : ui.dark;
            return h('button', { class: 'project-theme-control', type: 'button', title: label, 'aria-label': label, onClick: () => theme?.set(mode.value === 'dark' ? 'light' : 'dark') },
                [h('svg', { ...iconAttributes(icon), 'data-icon': icon }, icons[icon].map(([tag, attributes]) => h(tag, attributes)))]);
        };
    },
};
const ProjectNav = {
    props: { mobile: Boolean },
    setup(props: { mobile?: boolean }) {
        const { theme, lang } = useData();
        return () => h('nav', { class: props.mobile ? 'docs-mobile-nav' : 'docs-project-nav', 'aria-label': interfaceText(lang.value).navigation.label },
            siteNavigation.map(item => h('a', { class: 'project-nav-link', href: `${theme.value.projectBase}${item.path}${item.id === 'docs' && lang.value === 'zh-CN' ? 'zh-CN/' : ''}`, target: '_self', 'data-no-prefetch': '', 'aria-current': item.id === 'docs' ? 'page' : undefined }, interfaceText(lang.value).navigation[item.id])));
    },
};
const LanguageMenu = {
    setup() {
        const { frontmatter, lang, hash } = useData();
        const mounted = ref(false), expanded = ref(false);
        const root = ref<HTMLElement>(), toggle = ref<HTMLButtonElement>();
        const choices: (HTMLAnchorElement | null)[] = [];
        let stop: (() => void) | undefined;
        const close = (returnFocus = false) => { expanded.value = false; if (returnFocus) toggle.value?.focus(); };
        const open = (index = lang.value === 'zh-CN' ? 0 : 1) => {
            expanded.value = true;
            // The links exist while hidden, so focus follows Vue's DOM update.
            requestAnimationFrame(() => choices[index]?.focus());
        };
        const outside = (event: PointerEvent) => { if (root.value && !event.composedPath().includes(root.value)) close(); };
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && expanded.value) { event.preventDefault(); event.stopPropagation(); close(true); return; }
            if (event.key === 'Tab' && expanded.value) { close(true); return; }
            if (event.key === ' ' && expanded.value && choices.includes(document.activeElement as HTMLAnchorElement)) {
                event.preventDefault(); (document.activeElement as HTMLAnchorElement).click(); return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (!expanded.value) { open(event.key === 'ArrowUp' || event.key === 'End' ? 1 : 0); return; }
            const index = choices.indexOf(document.activeElement as HTMLAnchorElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + 2) % 2;
            choices[next]?.focus();
        };
        onMounted(() => {
            mounted.value = true;
            window.addEventListener('pointerdown', outside);
            stop = watch(lang, value => {
                close();
                if (!frontmatter.value.englishOnlyApi) {
                    try { storeLanguage(window.localStorage, value === 'zh-CN' ? 'zh-CN' : 'en'); } catch { /* URL remains authoritative. */ }
                }
            }, { immediate: true });
        });
        onUnmounted(() => { stop?.(); window.removeEventListener('pointerdown', outside); });
        return () => {
            if (!frontmatter.value.alternateUrl) return null;
            let fragment = mounted.value ? hash.value : '';
            if (fragment && lang.value === 'zh-CN') {
                const id = decodeURIComponent(fragment.slice(1));
                const mapped = frontmatter.value.anchorMap?.[id];
                if (mapped) fragment = '#' + mapped;
            }
            // English-only API pages link to the Chinese documentation index.
            if (frontmatter.value.englishOnlyApi) fragment = '';
            const currentUrl = String(frontmatter.value.markdownUrl).replace(/\/index\.md$/, '/').replace(/\.md$/, '.html');
            const label = interfaceText(lang.value).languageAction;
            return h('div', { class: 'site-language-menu docs-language-menu', ref: root, onKeydown: keydown,
                onFocusout: (event: FocusEvent) => { if (!root.value?.contains(event.relatedTarget as Node | null)) close(); } }, [
                h('button', { class: 'site-language', ref: toggle, type: 'button', 'data-doc-language-toggle': '', 'aria-haspopup': 'menu', 'aria-expanded': expanded.value, 'aria-controls': 'docs-language-menu', 'aria-label': label, title: label,
                    onClick: () => expanded.value ? close(true) : open() }, [h('svg', { ...iconAttributes('globe'), 'data-icon': 'globe' }, icons.globe.map(([tag, attributes]) => h(tag, attributes)))]),
                h('div', { class: 'site-language-options', id: 'docs-language-menu', role: 'menu', 'aria-label': label, hidden: !expanded.value },
                    (['zh-CN', 'en'] as const).map((language, index) => h('a', { role: 'menuitemradio', 'aria-checked': lang.value === language, tabindex: -1,
                        ref: (element: unknown) => { choices[index] = element as HTMLAnchorElement | null; }, 'data-doc-language-choice': language, lang: language,
                        href: (language === lang.value ? currentUrl : frontmatter.value.alternateUrl) + fragment,
                        onClick: (event: MouseEvent) => { if (language === lang.value) event.preventDefault(); close(language === lang.value); } },
                    [language === 'zh-CN' ? '简体中文' : 'English', h('span', { class: 'language-check', 'aria-hidden': 'true' }, '✓')]))),
            ]);
        };
    },
};
const DocumentContext = {
    setup() {
        const { frontmatter, lang } = useData();
        return () => {
            const ui = interfaceText(lang.value).context;
            return h('aside', { class: 'docs-context', 'aria-label': ui.label }, [
            h('p', [h('strong', ui.development), ` · ${String(frontmatter.value.commit ?? '').slice(0, 8)}`]),
            h('details', [h('summary', ui.versions),
                h('p', [h('strong', ui.sourceVersions), frontmatter.value.packageVersions]),
                h('p', [h('strong', ui.releases), String(frontmatter.value.publishedPackageVersions).replaceAll('(release tags unavailable)', ui.unavailable)]),
            ]),
            h('p', [h('a', { href: frontmatter.value.markdownUrl, target: '_self', 'data-no-prefetch': '' }, ui.markdown), ' · ', h('a', { href: frontmatter.value.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, ui.source),
                ...(frontmatter.value.translationUrl ? [' · ', h('a', { href: frontmatter.value.translationUrl, target: '_blank', rel: 'noopener noreferrer' }, ui.translation)] : [])]),
            ...(frontmatter.value.translationState === 'pending' ? [h('p', { 'data-translation-pending': '' }, ui.pending)] : []),
        ]);
        };
    },
};
export default {
    extends: DefaultTheme,
    Layout: () => h(DefaultTheme.Layout, null, { 'nav-bar-content-before': () => h(ProjectNav), 'nav-bar-content-after': () => [h(LanguageMenu), h(ThemeButton)], 'nav-screen-content-before': () => h(ProjectNav, { mobile: true }), 'doc-before': () => h(DocumentContext) }),
};
