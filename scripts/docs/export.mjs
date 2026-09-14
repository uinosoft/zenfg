import { resolve, posix } from 'node:path';
import { contentDir, read, write, website } from './catalog.mjs';
export function plainMarkdown(page, meta) {
    let text = read(resolve(contentDir, `${page.route}.md`)).replace(/^---\n[\s\S]*?\n---\n/, '');
    text = text.split(/(```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~)/g).map((part, index) => index % 2 ? part : part.replace(/\]\(([^)]+)\)/g, (match, url) => {
        if (/^(?:https?:|mailto:|#)/.test(url)) return match;
        const [path, hash] = url.split('#');
        if (path.endsWith('.txt')) return `](${meta.docsBase}${path.replace(/^\//, '')})`;
        let route;
        if (path.startsWith(meta.docsBase)) route = path.slice(meta.docsBase.length);
        else if (path.startsWith('/')) route = path.slice(1);
        else route = posix.normalize(posix.join(posix.dirname(page.route), path));
        if (route.endsWith('/')) route += 'index';
        if (!route) route = 'index';
        route = route.replace(/\.(?:md|html)$/, '');
        return `](${meta.docsBase}${route}.md${hash ? '#' + hash : ''})`;
    })).join('');
    return `> Development branch documentation · commit ${meta.commit}\n> Package versions: ${meta.packages.map(p => `${p.name} ${p.version}`).join(', ')}\n> Source: ${page.sourceUrl}\n\n${text.trim()}\n`;
}
export function llmsIndex(meta) {
    return ['# ZenFG documentation', '', '> Composable FrameGraph infrastructure for WebGPU and wgpu. These are development-branch docs, not a published-version archive.', '',
        `Build commit: ${meta.commit}. For an installed version, start with its README and declaration/source files; use that package\'s release tag or versioned docs.rs.`, '',
        ...['Introduction', 'Getting started', 'Concepts', 'Guides & examples', 'Reference', 'Compatibility & migration'].flatMap(group => [
            `## ${group}`, '', ...meta.pages.filter(p => p.group === group).map(p => `- [${p.title}](${website}docs/${p.route}.md)`), '',
        ]),
        '## API', '', ...meta.pages.filter(p => p.group === 'TypeScript API' && /^(api\/index|api\/[^/]+\/index)$/.test(p.route)).map(p => `- [${p.title}](${website}docs/${p.route}.md)`),
        ...meta.packages.filter(p => p.registry === 'cargo' && p.published).map(p => `- [${p.name} ${p.published} Rust API](https://docs.rs/${p.name}/${p.published}/)`), '',
        '## Optional', '', ...meta.pages.filter(p => p.code).map(p => `- [${p.title}](${website}docs/${p.route}.md)`), '',
    ].join('\n');
}
export function exportMarkdown(outDir, meta) {
    for (const page of meta.pages) write(resolve(outDir, `${page.route}.md`), plainMarkdown(page, meta));
    write(resolve(outDir, 'llms.txt'), llmsIndex(meta));
}
