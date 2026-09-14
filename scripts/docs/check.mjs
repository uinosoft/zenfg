import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { root, packages, pages, read, siteBase, publicEntrypoints, contentDir } from './catalog.mjs';
import { assertLocalLinks, markdownFiles } from './markdown.mjs';
const built = process.argv.includes('--built');
if (!built) {
    const files = [...new Set(['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', ...pages.map(p => p.source)].map(p => resolve(root, p)))];
    assertLocalLinks(root, files);
    for (const p of packages) assertLocalLinks(resolve(root, p.directory));
    console.log(`Checked source links and ${publicEntrypoints().length} public entrypoints; package links remain within their artifact.`);
} else {
    const output = resolve(root, 'apps/site/dist');
    const base = siteBase();
    function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]); }
    const htmlFiles = files(resolve(output, 'docs')).filter(p => p.endsWith('.html'));
    const ids = new Map();
    const failures = [];
    function anchors(file) {
        if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\bid="([^"]+)"/g)].map(m => m[1])));
        return ids.get(file);
    }
    for (const file of htmlFiles) {
        const html = readFileSync(file, 'utf8');
        if (!file.endsWith('404.html') && (!html.includes('text/markdown') || !html.includes('Development branch'))) failures.push(`${file}: missing format/version discovery`);
        if (html.includes('Choose language') || html.includes('VPNavBarTranslations')) failures.push(`${file}: unexpected language switch`);
        for (const match of html.matchAll(/<(?:a|link|script|img)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
            const url = match[1].replaceAll('&amp;', '&');
            if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(url)) continue;
            const [path, hash] = url.split('#');
            let target;
            if (!path) target = file;
            else if (path.startsWith(base)) target = resolve(output, decodeURIComponent(path.slice(base.length).split('?')[0]));
            else if (path.startsWith('/')) { failures.push(`${relative(output, file)}: URL escapes deployment prefix: ${url}`); continue; }
            else target = resolve(dirname(file), decodeURIComponent(path.split('?')[0]));
            if (path.endsWith('/')) target = resolve(target, 'index.html');
            if (!existsSync(target) && !/\.[a-z0-9]+$/i.test(target)) target += '.html';
            if (!existsSync(target)) failures.push(`${relative(output, file)}: missing ${url}`);
            else if (hash && target.endsWith('.html') && !anchors(target).has(decodeURIComponent(hash))) failures.push(`${relative(output, file)}: missing anchor ${url}`);
        }
    }
    const meta = JSON.parse(read(resolve(contentDir, 'metadata.json')));
    for (const p of meta.pages) if (!existsSync(resolve(output, 'docs', `${p.route}.md`))) failures.push(`Missing Markdown ${p.route}`);
    if (failures.length) throw new Error([...new Set(failures)].slice(0, 60).join('\n') + `\n${failures.length} total documentation output errors.`);
    console.log(`Verified ${htmlFiles.length} built HTML pages, deep links, deployment prefix and Markdown alternatives.`);
}
