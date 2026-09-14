import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

export const markdown = new MarkdownIt({ html: true });
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
