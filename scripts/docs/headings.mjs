import { sourceHeadings } from './i18n.mjs';

function renderedHeadings(renderer, text) {
    const headings = sourceHeadings(text);
    // Render headings through the public VitePress renderer to preserve its
    // actual slug rules, including numbered sections and duplicate headings.
    const outline = headings.map(h => '#'.repeat(Number(h.level.slice(1))) + ' ' + h.title.replace(/([\\`*{}\[\]<>()#+.!_\-])/g, '\\$1')).join('\n\n');
    const ids = [...renderer.render(outline).matchAll(/<h[1-6]\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
    return headings.map((heading, i) => ({ ...heading, websiteId: ids[i] }));
}
export function projectHeadingAliases(renderer, english, chinese) {
    const original = renderedHeadings(renderer, english), translated = renderedHeadings(renderer, chinese);
    // Pending, pre-existing prose can still need structural reconciliation.
    // Ready translations have already passed the heading-structure check.
    if (original.length !== translated.length) return { text: chinese, anchorMap: {} };
    const ids = new Set([...translated.map(h => h.websiteId), ...[...chinese.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])]);
    const lines = chinese.split('\n'), anchorMap = {};
    for (let i = original.length - 1; i >= 0; i--) {
        const en = original[i].websiteId, zh = translated[i].websiteId;
        anchorMap[zh] = en;
        if (!ids.has(en)) { lines.splice(translated[i].line, 0, `<a id="${en}"></a>`, ''); ids.add(en); }
    }
    return { text: lines.join('\n'), anchorMap };
}
