import DefaultTheme from 'vitepress/theme';
import { h, onMounted, onUnmounted, ref } from 'vue';
import { useData } from 'vitepress';
import { createSiteTheme } from '../../../site/shared/theme/controller.ts';
import { siteNavigation } from '../../../site/shared/navigation.ts';
import { icons, iconAttributes } from '../../../site/shared/icons.ts';
import { themeAction } from '../../../site/shared/theme/action.ts';
import type { ThemeMode } from '../../../site/shared/theme/index.ts';
import './style.css';
const ThemeButton = {
    setup() {
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
            const { icon, label } = themeAction(mode.value);
            return h('button', { class: 'project-theme-control', type: 'button', title: label, 'aria-label': label, onClick: () => theme?.set(mode.value === 'dark' ? 'light' : 'dark') },
                [h('svg', { ...iconAttributes(icon), 'data-icon': icon }, icons[icon].map(([tag, attributes]) => h(tag, attributes)))]);
        };
    },
};
const ProjectNav = {
    props: { mobile: Boolean },
    setup(props: { mobile?: boolean }) {
        const { theme } = useData();
        return () => h('nav', { class: props.mobile ? 'docs-mobile-nav' : 'docs-project-nav', 'aria-label': 'Project navigation' },
            siteNavigation.map(item => h('a', { class: 'project-nav-link', href: `${theme.value.projectBase}${item.path}`, target: '_self', 'data-no-prefetch': '', 'aria-current': item.id === 'docs' ? 'page' : undefined }, item.text)));
    },
};
const DocumentContext = {
    setup() {
        const { frontmatter } = useData();
        return () => h('aside', { class: 'docs-context', 'aria-label': 'Documentation version and formats' }, [
            h('p', [h('strong', 'Development branch'), ` · ${String(frontmatter.value.commit ?? '').slice(0, 8)}`]),
            h('details', [h('summary', 'Package versions'), h('p', frontmatter.value.packageVersions)]),
            h('p', [h('a', { href: frontmatter.value.markdownUrl, target: '_self', 'data-no-prefetch': '' }, 'Read Markdown'), ' · ', h('a', { href: frontmatter.value.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'View source ↗')]),
        ]);
    },
};
export default {
    extends: DefaultTheme,
    Layout: () => h(DefaultTheme.Layout, null, { 'nav-bar-content-before': () => h(ProjectNav), 'nav-bar-content-after': () => h(ThemeButton), 'nav-screen-content-before': () => h(ProjectNav, { mobile: true }), 'doc-before': () => h(DocumentContext) }),
};
