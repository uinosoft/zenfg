import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

export const markdown = new MarkdownIt({ html: true });
// Links in literal code are part of the example, never navigation metadata.
export function mapProseLinks(text, rewrite) {
    return text.split(/(```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~|`+[^`\n]*`+)/g).map((part, i) => i % 2 ? part : part
        .replace(/(\]\()([^\s)]+)(\))/g, (_, left, url, right) => left + rewrite(url) + right)
        .replace(/^(\[[^\]]+\]:\s*)(\S+)/gm, (_, left, url) => left + rewrite(url))
        .replace(/(\b(?:href|src)=")(.*?)"/g, (_, left, url) => left + rewrite(url) + '"')).join('');
}
export function markdownFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (['node_modules', 'dist', 'src', 'tests', '.vitepress', '.generated', '.git'].includes(entry.name)) return [];
        const file = resolve(directory, entry.name);
        return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : [];
    });
}
export function links(text) {
    const result = [];
    for (const token of markdown.parse(text, {})) for (const child of token.children ?? []) {
        const url = child.type === 'link_open' ? child.attrGet('href') : child.type === 'image' ? child.attrGet('src') : undefined;
        if (url) result.push(url);
    }
    return result;
}
export function anchors(text) {
    const slugger = new GithubSlugger();
    const tokens = markdown.parse(text, {});
    const result = new Set();
    tokens.forEach((token, i) => {
        if (token.type === 'heading_open') {
            const content = tokens[i + 1].children?.filter(t => t.type !== 'html_inline').map(t => t.content).join('') ?? tokens[i + 1].content;
            result.add(slugger.slug(content));
        }
    });
    for (const match of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
    return result;
}
export function assertLocalLinks(directory, files = markdownFiles(directory)) {
    const failures = [];
    for (const file of files) for (const url of links(readFileSync(file, 'utf8'))) {
        if (/^(?:[a-z][\w+.-]*:|\/)/i.test(url)) continue;
        const [path, fragment] = url.split('#');
        const target = path ? resolve(dirname(file), decodeURIComponent(path.split('?')[0])) : file;
        const rel = relative(directory, target);
        if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
            failures.push(`${relative(directory, file)}: link leaves artifact: ${url}`); continue;
        }
        if (!existsSync(target)) { failures.push(`${relative(directory, file)}: missing ${url}`); continue; }
        if (fragment && target.endsWith('.md') && !anchors(readFileSync(target, 'utf8')).has(decodeURIComponent(fragment))) failures.push(`${relative(directory, file)}: missing anchor ${url}`);
    }
    if (failures.length) throw new Error(failures.join('\n'));
}
export function quickStart(text, language = 'ts') {
    const section = text.match(/^## Quick start\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1];
    if (!section) throw new Error('README has no Quick start section.');
    const code = markdown.parse(section, {}).find(t => t.type === 'fence' && t.info.split(',')[0] === language)?.content;
    if (!code) throw new Error(`Quick start has no ${language} code block.`);
    return code;
}
export function hideRustDoctestLines(text) {
    return text.replace(/```rust[^\n]*\n([\s\S]*?)```/g, (_, code) => '```rust\n' + code.split('\n').filter(line => !/^\s*#(?: |$)/.test(line)).map(line => line.replace(/^(\s*)##/, '$1#')).join('\n') + '```');
}

// Keep explicit main/tag URLs intact. Cross-package relative prose links point
// to development source; the manifest-generated release entry remains separate.
export function packageRepositoryLinks(text, file, directory, root, repository) {
    return text.split(/(```[^\n]*\n[\s\S]*?```|\x60+[^\x60]*\x60+|~~~[^\n]*\n[\s\S]*?~~~)/g).map((part, i) => i % 2 ? part : part
        .replace(/\]\((\.\.\/[^)#]+)(#[^)]*)?\)/g, (match, destination, fragment = '') => {
            const target = resolve(dirname(file), destination);
            const local = relative(directory, target);
            if (local !== '..' && !local.startsWith('../') && !local.startsWith('..\\') && !isAbsolute(local)) return match;
            return '](' + repository + '/blob/main/' + relative(root, target).replaceAll('\\', '/') + fragment + ')';
        })).join('');
}

export function assertRequiredAnchors(expected, actual, label) {
    const missing = expected.filter(id => !actual.has(id));
    if (missing.length) throw new Error(label + ': missing legacy anchors: ' + missing.join(', '));
}

export function assertRustdocLinks(directory, websiteDirectory) {
    const files = ['zenfg/index.html', 'zenfg_snapshot/index.html'].map(file => resolve(directory, file));
    const failures = [];
    const ids = file => new Set([...readFileSync(file, 'utf8').matchAll(/\bid=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/g)].map(m => m[1] ?? m[2] ?? m[3]));
    for (const file of files) {
        const html = readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
        for (const [, raw] of html.matchAll(/<(?:a|link|img)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
            const url = raw.replaceAll('&amp;', '&');
            const docsPrefix = 'https://uinosoft.github.io/zenfg/docs/';
            const siteLink = websiteDirectory && url.startsWith(docsPrefix);
            if (!siteLink && /^(?:[a-z][\w+.-]*:|\/\/)/i.test(url)) continue;
            const [path, hash] = (siteLink ? url.slice(docsPrefix.length) : url).split('#');
            let target = siteLink ? resolve(websiteDirectory, decodeURIComponent(path.split('?')[0] || 'index.html'))
                : path ? resolve(dirname(file), decodeURIComponent(path.split('?')[0])) : file;
            if (path?.endsWith('/')) target = resolve(target, 'index.html');
            if (!existsSync(target)) { failures.push(relative(directory, file) + ': missing ' + url); continue; }
            if (hash && target.endsWith('.html')) {
                const targetIds = ids(target);
                // rustdoc source-line ranges are interpreted by its JavaScript.
                const line = /\/src\/.*\.rs\.html$/.test(target.replaceAll('\\', '/')) && hash.match(/^(\d+)-\d+$/)?.[1];
                if (!targetIds.has(decodeURIComponent(hash)) && !(line && targetIds.has(line))) failures.push(relative(directory, file) + ': missing anchor ' + url);
            }
        }
    }
    if (failures.length) throw new Error(failures.join('\n'));
}


export function sourceDigest(text) {
    return createHash('sha256').update(text).digest('hex');
}

export function assertBuildSources(metadata, commit, readSource) {
    if (metadata.commit !== commit) throw new Error('Documentation build is stale; rebuild for current HEAD.');
    for (const page of metadata.pages.filter(page => page.source)) {
        if (page.sourceHash !== sourceDigest(readSource(page.source))) throw new Error('Documentation build is stale for ' + page.source + '; rebuild after editing its source.');
        if (page.translationSource && page.translationHash !== sourceDigest(readSource(page.translationSource))) throw new Error('Documentation build is stale for ' + page.translationSource + '; rebuild after editing its translation.');
    }
}
