/** Shared preference only; each application owns its interface dictionaries. */
export type SiteLanguage = 'en' | 'zh-CN';
export const languagePreferenceKey = 'zenfg-language';
export function storeLanguage(storage: Pick<Storage, 'setItem'> | undefined, language: SiteLanguage): void {
    try { storage?.setItem(languagePreferenceKey, language); } catch { /* Navigation works with blocked storage. */ }
}
