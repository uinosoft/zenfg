/** Shared preference only; each application owns its interface dictionaries. */
export type SiteLanguage = 'en' | 'zh-CN';
export const languagePreferenceKey = 'zenfg-language';
export function storeLanguage(storage: Pick<Storage, 'setItem'> | undefined, language: SiteLanguage): void {
    try { storage?.setItem(languagePreferenceKey, language); } catch { /* Navigation works with blocked storage. */ }
}

/** Use the same preference order as the homepage's first-render language. */
export function preferredLanguage(window: Window): SiteLanguage {
    try {
        const stored = window.localStorage.getItem(languagePreferenceKey);
        if (stored === 'en' || stored === 'zh-CN') return stored;
    } catch { /* Browser language remains available with blocked storage. */ }
    const languages = window.navigator.languages?.length ? window.navigator.languages : [window.navigator.language];
    for (const candidate of languages) {
        if (/^(zh|cmn)(?:[-_]|$)/i.test(candidate)) return 'zh-CN';
        if (/^en(?:[-_]|$)/i.test(candidate)) break;
    }
    return 'en';
}

/** Keep real links usable for normal clicks, new tabs and deployment prefixes. */
export function updateDocumentLinks(document: Document, language: SiteLanguage): void {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        const href = link.dataset.docsEnglishHref ?? link.getAttribute('href')!;
        if (!/(?:^|\/)docs\//.test(href) || /(?:^|\/)docs\/api\//.test(href)) continue;
        if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) {
            const url = new URL(href, document.location.href);
            if (url.origin !== document.location.origin) continue;
        }
        link.dataset.docsEnglishHref = href.replace(/docs\/zh-CN\//, 'docs/');
        link.setAttribute('href', link.dataset.docsEnglishHref.replace(/docs\//, 'docs/' + (language === 'zh-CN' ? 'zh-CN/' : '')));
    }
}
