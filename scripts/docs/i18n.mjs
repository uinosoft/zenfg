import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import { pages, packages, root, read, write, repository, website } from './catalog.mjs';
import { anchors, links, markdown, markdownFiles, mapProseLinks, sourceDigest } from './markdown.mjs';
import { within } from './usage.mjs';

const marker = /^<!-- translation: (.+) -->\n/m;
const pendingNotice = /<!-- translation-pending:start -->[\s\S]*?<!-- translation-pending:end -->\s*/g;
export const translationPath = source => source.replace(/\.md$/, '.zh-CN.md');
export const localeRoute = (route, locale) => locale === 'zh-CN' ? 'zh-CN/' + route : route;
export const routeLink = route => '/' + (route === 'index' ? '' : route.endsWith('/index') ? route.slice(0, -5) : route + '.html');
export const allowPending = () => process.env.DOCS_I18N_ALLOW_PENDING === '1' && !process.env.CI;

export function generatedBlocks(text) {
    return [...text.matchAll(/<!-- generated:([\w-]+):start -->[\s\S]*?<!-- generated:\1:end -->/g)].map(m => ({ name: m[1], text: m[0] }));
}
export function translationDigest(text) {
    return sourceDigest(text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')
        .replace(marker, '').replace(/<!-- generated:([\w-]+):start -->[\s\S]*?<!-- generated:\1:end -->/g, '<!-- generated:$1 -->'));
}
export function translationMetadata(text) {
    const matches = [...text.matchAll(/^<!-- translation: (.+) -->$/gm)];
    if (matches.length !== 1) throw new Error('Expected one translation metadata comment.');
    const value = JSON.parse(matches[0][1]);
    if (value.version !== 1 || typeof value.source !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash)
        || !['pending', 'ready'].includes(value.state)) throw new Error('Invalid translation metadata.');
    return value;
}
export function withTranslationMetadata(text, source, sourceHash, state) {
    const notice = state === 'pending' ? `<!-- translation-pending:start -->\n> 中文译文尚未确认；请以[英文源文档](./${basename(source)})为准。\n<!-- translation-pending:end -->\n\n` : '';
    return '<!-- translation: ' + JSON.stringify({ version: 1, source, sourceHash, state }) + ' -->\n\n' + notice + text.replace(marker, '').replace(pendingNotice, '').trim() + '\n';
}
export function sourceHeadings(text) {
    const slugger = new GithubSlugger(), result = [];
    const tokens = markdown.parse(text, {});
    tokens.forEach((token, i) => {
        if (token.type !== 'heading_open') return;
        const inline = tokens[i + 1];
        const title = inline.children?.filter(t => t.type !== 'html_inline').map(t => t.content).join('') ?? inline.content;
        result.push({ title, id: slugger.slug(title), level: token.tag, line: token.map[0] });
    });
    return result;
}
export function addSourceAnchors(text, source) {
    const original = sourceHeadings(source), translated = sourceHeadings(text);
    if (original.length !== translated.length || original.some((h, i) => h.level !== translated[i].level)) {
        throw new Error('Translation must preserve heading order and levels.');
    }
    const ids = anchors(text), lines = text.split('\n');
    for (let i = original.length - 1; i >= 0; i--) {
        if (!ids.has(original[i].id)) {
            lines.splice(translated[i].line, 0, `<a id="${original[i].id}"></a>`, '');
            ids.add(original[i].id);
        }
    }
    return lines.join('\n');
}
export function languageBlock(source, chinese = false) {
    // Reference names can be overridden by crate-level rustdoc includes.
    const en = basename(source), zh = basename(translationPath(source));
    return '<!-- generated:language:start -->\n'
        + (chinese ? '[English][documentation-en] | **简体中文**' : '**English** | [简体中文][documentation-zh]')
        + `\n\n[documentation-en]: ./${en}\n[documentation-zh]: ./${zh}\n<!-- generated:language:end -->`;
}
export function syncLanguage(text, source, chinese = false) {
    const block = languageBlock(source, chinese);
    if (text.includes('<!-- generated:language:start -->')) {
        return text.replace(/<!-- generated:language:start -->[\s\S]*?<!-- generated:language:end -->/, block);
    }
    // Root READMEs already have a language selector in their presentation header.
    if (source === 'README.md') return text;
    return text.replace(/^(# .+\n)/m, '$1\n' + block + '\n');
}
export function localizeDestination(destination, source, inverse = false) {
    if (/^(?:#|\/\/)/.test(destination)) return destination;
    const catalog = new Set(pages.map(p => p.source));
    const [path, fragment] = destination.split('#');
    let target, prefix;
    if (path.startsWith(repository + '/blob/main/')) {
        prefix = repository + '/blob/main/'; target = path.slice(prefix.length);
    } else if (path.startsWith(website + 'docs/')) {
        const suffix = path.slice((website + 'docs/').length).replace(/^zh-CN\//, '');
        const route = suffix.replace(/\.(?:html|md)$/, '').replace(/\/$/, '') || 'index';
        if (suffix !== 'llms.txt' && !pages.some(p => p.route === route)) return destination;
        return website + 'docs/' + (inverse ? '' : 'zh-CN/') + suffix + (fragment ? '#' + fragment : '');
    } else if (/^(?:[a-z][\w+.-]*:|\/)/i.test(path)) return destination;
    else target = relative(root, resolve(root, dirname(source), path)).replaceAll('\\', '/');
    const english = target.replace(/\.zh-CN\.md$/, '.md');
    if (!catalog.has(english)) return destination;
    const localized = inverse ? english : translationPath(english);
    const value = prefix ? prefix + localized : relative(resolve(root, dirname(source)), resolve(root, localized)).replaceAll('\\', '/');
    return value + (fragment ? '#' + fragment : '');
}
export function localizeLinks(text, source) {
    return text.split(/(<!-- generated:language:start -->[\s\S]*?<!-- generated:language:end -->|<a href="README\.md" lang="en">[\s\S]*?<\/a>)/g)
        .map((part, i) => i % 2 ? part : mapProseLinks(part, url => localizeDestination(url, source))).join('');
}
function ungenerated(text) {
    return text.replace(marker, '').replace(pendingNotice, '').replace(/<!-- generated:([\w-]+):start -->[\s\S]*?<!-- generated:\1:end -->/g, '');
}
export function assertTranslationStructure(sourceText, translatedText, source) {
    const english = ungenerated(sourceText), chinese = ungenerated(translatedText);
    const original = sourceHeadings(english), translated = sourceHeadings(chinese);
    if (original.length !== translated.length || original.some((h, i) => h.level !== translated[i].level)) throw new Error('Heading structure differs.');
    const literals = text => markdown.parse(text, {}).flatMap(t => t.type === 'fence' || t.type === 'code_block'
        ? [t.type + ':' + t.info + ':' + t.content] : (t.children ?? []).filter(c => c.type === 'code_inline').map(c => c.content));
    if (JSON.stringify(literals(english)) !== JSON.stringify(literals(chinese))) throw new Error('Code blocks or inline code differ.');
    const destinations = text => links(text).map(url => localizeDestination(url, source, true)).sort();
    if (JSON.stringify(destinations(english)) !== JSON.stringify(destinations(chinese))) throw new Error('Link destinations differ beyond locale mapping.');
    const blocks = text => generatedBlocks(text).map(b => b.name);
    if (JSON.stringify(blocks(sourceText)) !== JSON.stringify(blocks(translatedText))) throw new Error('Generated block structure differs.');
    const ids = anchors(translatedText);
    if ([...anchors(sourceText)].some(id => !ids.has(id))) throw new Error('English heading or explicit anchors are missing.');
}
export function translationStatus(page, readSource = read, exists = path => existsSync(resolve(root, path))) {
    const source = page.source, file = translationPath(source), sourceHash = translationDigest(readSource(source));
    const item = { source, file, sourceHash };
    if (!exists(file)) return { ...item, state: 'missing' };
    try {
        const text = readSource(file), metadata = translationMetadata(text);
        if (metadata.source !== source) throw new Error('Translation source does not match its sibling.');
        if (metadata.sourceHash !== sourceHash) return { ...item, state: 'stale' };
        if (metadata.state === 'pending') return { ...item, state: 'pending' };
        assertTranslationStructure(readSource(source), text, source);
        return { ...item, state: 'ready' };
    } catch (error) { return { ...item, state: 'invalid', error: error.message }; }
}
export function assertTranslationStatuses(statuses, allow = false, orphans = []) {
    const failures = statuses.filter(p => p.state !== 'ready' && !(allow && p.state === 'pending'));
    if (failures.length || orphans.length) throw new Error('Chinese documentation is not ready:\n'
        + [...failures.map(p => `${p.state}: ${p.file}${p.error ? ' — ' + p.error : ''}`), ...orphans.map(p => 'orphan: ' + relative(root, p))].join('\n')
        + '\nRun pnpm run docs:i18n:status. Local scaffold preview only: DOCS_I18N_ALLOW_PENDING=1 (disabled in CI).');
}
export function checkTranslations({ allow = allowPending(), directory = root } = {}) {
    const selected = pages.filter(p => within(resolve(directory), resolve(root, p.source)));
    const statuses = selected.map(p => translationStatus(p));
    const expected = new Set(pages.map(p => resolve(root, translationPath(p.source))));
    // Scan document owners, not build caches or the independent website copy.
    const files = resolve(directory) === root
        ? [...readdirSync(root, { withFileTypes: true }).filter(e => e.isFile()).map(e => resolve(root, e.name)), ...['docs', ...packages.map(p => p.directory)].flatMap(p => markdownFiles(resolve(root, p)))]
        : markdownFiles(directory);
    const orphans = files.filter(f => f.endsWith('.zh-CN.md') && !expected.has(f));
    assertTranslationStatuses(statuses, allow, orphans);
    return statuses;
}
export function finalizeTranslation(english, translated, source, expectedHash) {
    const hash = translationDigest(english);
    if (expectedHash !== hash) throw new Error('Source changed or expected hash is missing; inspect docs:i18n:status again.');
    const metadata = translationMetadata(translated);
    if (metadata.source !== source) throw new Error('Translation source does not match.');
    const prose = markdown.parse(ungenerated(translated), {}).filter(t => t.type === 'inline').flatMap(t => (t.children ?? []).filter(c => c.type === 'text').map(c => c.content)).join('');
    if (!/\p{Script=Han}/u.test(prose)) throw new Error('Translate the placeholder prose before accepting it.');
    const text = addSourceAnchors(localizeLinks(translated, source), english);
    assertTranslationStructure(english, text, source);
    return withTranslationMetadata(text, source, hash, 'ready');
}
export function acceptTranslation(source, expectedHash) {
    if (!pages.some(p => p.source === source)) throw new Error('Source is not in the public documentation catalog.');
    const file = translationPath(source);
    write(file, finalizeTranslation(read(source), read(file), source, expectedHash));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'status' && args.every(a => a === '--json')) {
        const statuses = pages.map(p => translationStatus(p));
        console.log(args.includes('--json') ? JSON.stringify(statuses, null, 2) : statuses.map(p => `${p.state.padEnd(8)} ${p.file}\n         sourceHash=${p.sourceHash}${p.error ? '\n         ' + p.error : ''}`).join('\n'));
    } else if (command === 'check' && args.every(a => a === '--package')) {
        const statuses = checkTranslations({ directory: args.includes('--package') ? process.cwd() : root });
        console.log(`Checked ${statuses.length} Chinese documents${allowPending() ? ' (local pending preview)' : ''}.`);
    } else if (command === 'seed' && args.length === 0) {
        for (const page of pages) {
            const file = translationPath(page.source);
            if (existsSync(resolve(root, file)) && read(file).match(marker)) continue;
            const text = existsSync(resolve(root, file)) ? read(file) : localizeLinks(read(page.source), page.source);
            write(file, withTranslationMetadata(syncLanguage(text, page.source, true), page.source, translationDigest(read(page.source)), 'pending'));
        }
        console.log('Seeded pending translations; existing translated prose was preserved.');
    } else if (command === 'accept' && args.length === 2 && args[1].startsWith('--source-hash=')) {
        acceptTranslation(args[0], args[1].slice('--source-hash='.length));
        console.log('Accepted ' + translationPath(args[0]) + '; review its translation diff.');
    } else throw new Error('Usage: i18n.mjs status [--json] | check [--package] | seed | accept SOURCE --source-hash=HASH');
}
