import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedBlocks, translationDigest, translationMetadata, withTranslationMetadata, translationStatus, translationPath, finalizeTranslation, assertTranslationStructure, assertTranslationStatuses, addSourceAnchors, localizeLinks, localizeDestination, syncLanguage, allowPending } from '../i18n.mjs';
import { anchors, assertBuildSources, sourceDigest } from '../markdown.mjs';
import { pages, read } from '../catalog.mjs';
import { llmsIndex, plainMarkdown } from '../export.mjs';
import { tokenize } from '../../../apps/docs/.vitepress/search.mjs';
import { createRequire } from 'node:module';
import { createMarkdownRenderer } from 'vitepress';
import { projectHeadingAliases } from '../headings.mjs';
// Exercise the search engine used by the pinned VitePress dependency without
// introducing a separate root dependency or relying on transitive hoisting.
const MiniSearch = createRequire(import.meta.resolve('vitepress/package.json'))('minisearch');

const source = 'packages/webgpu/docs/README.md';
const english = '# Usage\n\nRead `FrameGraph`.\n\n## Quick start\n\n[Concepts](./CONCEPTS.md#resources)\n\n```ts\nconst graph = new FrameGraph();\n```\n';
const chinese = '# 使用指南\n\n阅读 `FrameGraph`。\n\n## 快速入门\n\n[概念](./CONCEPTS.zh-CN.md#resources)\n\n```ts\nconst graph = new FrameGraph();\n```\n';
const pending = text => withTranslationMetadata(text, source, translationDigest(english), 'pending');

test('translation hashes ignore generated values and platform newlines, but retain code and prose changes', () => {
    const input = english + '<!-- generated:installation:start -->\nversion 1\n<!-- generated:installation:end -->';
    assert.equal(translationDigest(input), translationDigest('\uFEFF' + input.replaceAll('\n', '\r\n').replace('version 1', 'version 2')));
    assert.notEqual(translationDigest(input), translationDigest(input.replace('FrameGraph()', 'OtherGraph()')));
    assert.notEqual(translationDigest(input), translationDigest(input + '\nNew requirement.'));
});
test('acceptance checks the caller hash, adds English anchors, preserves literals and requires translated prose', () => {
    const ready = finalizeTranslation(english, pending(chinese), source, translationDigest(english));
    assert.equal(translationMetadata(ready).state, 'ready');
    assert.ok(anchors(ready).has('quick-start'));
    assert.doesNotThrow(() => assertTranslationStructure(english, ready, source));
    assert.throws(() => finalizeTranslation(english + '\nChanged', pending(chinese), source, translationDigest(english)), /Source changed/);
    assert.throws(() => finalizeTranslation(english, pending(english), source, translationDigest(english)), /placeholder prose/);
    assert.throws(() => finalizeTranslation(english, pending(chinese.replace('const graph', 'let graph')), source, translationDigest(english)), /Code blocks/);
    assert.throws(() => finalizeTranslation(english, pending(chinese.replace('CONCEPTS.zh-CN.md', 'missing.md')), source, translationDigest(english)), /Link destinations/);
});
test('status distinguishes missing, pending, stale, invalid and ready without rewriting any source', () => {
    const file = translationPath(source), ready = finalizeTranslation(english, pending(chinese), source, translationDigest(english));
    const status = (text, original = english) => translationStatus({ source }, path => path === source ? original : text, () => text !== undefined);
    assert.equal(status(undefined).state, 'missing');
    assert.equal(status(pending(chinese)).state, 'pending');
    assert.equal(status(pending(chinese), english + 'new').state, 'stale');
    assert.equal(status('broken').state, 'invalid');
    assert.equal(status(ready).state, 'ready');
    assert.equal(status(ready).file, file);
    assert.equal(status(ready.replace('"source":"' + source + '"', '"source":"elsewhere.md"')).state, 'invalid');
});
test('locale links preserve code, English language selectors, API links and explicit historical revisions', () => {
    const input = '[Concept](./CONCEPTS.md#resources)\n`[literal](./CONCEPTS.md)`\n```md\n[literal](./CONCEPTS.md)\n```';
    const output = localizeLinks(input, source);
    assert.ok(output.includes('[Concept](CONCEPTS.zh-CN.md#resources)'));
    assert.ok(output.includes('`[literal](./CONCEPTS.md)`'));
    assert.ok(output.includes('```md\n[literal](./CONCEPTS.md)'));
    const historical = 'https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0/packages/webgpu/docs/README.md';
    assert.equal(localizeDestination(historical, source), historical);
    const api = 'https://uinosoft.github.io/zenfg/docs/api/webgpu/';
    assert.equal(localizeDestination(api, source), api);
    const selector = '<a href="README.md" lang="en">English</a>';
    assert.equal(localizeLinks(selector, 'README.md'), selector);
    const text = syncLanguage(english, source, true);
    assert.ok(localizeLinks(text, source).includes('[documentation-en]: ./README.md'));
});
test('anchor aliases are idempotent and repeated headings preserve their original identities', () => {
    const input = '# 标题\n## 相同\n## 相同\n', original = '# Title\n## Same\n## Same\n';
    const value = addSourceAnchors(input, original);
    assert.equal(addSourceAnchors(value, original), value);
    assert.ok(anchors(value).has('same-1'));
    assert.throws(() => addSourceAnchors('# 标题', original), /heading order/);
});
test('website aliases use actual VitePress slugs for numbered and translated sections', async () => {
    const renderer = await createMarkdownRenderer('.', { languages: [] });
    const english = '# Guide\n## 1. Status\n## Same\n## Same\n';
    const chinese = '# 指南\n## 1. 状态\n## 相同\n## 相同\n';
    const projection = projectHeadingAliases(renderer, english, chinese);
    assert.ok(projection.text.includes('id="_1-status"'));
    assert.ok(projection.text.includes('id="same-1"'));
    assert.equal(projection.anchorMap['_1-状态'], '_1-status');
    assert.equal(projectHeadingAliases(renderer, english, projection.text).text, projection.text);
});
test('the catalog defines only package-owned sibling translations and matching generated blocks', () => {
    for (const page of pages) {
        const translated = read(translationPath(page.source));
        assert.equal(translationMetadata(translated).source, page.source);
        assert.deepEqual(generatedBlocks(translated).map(b => b.name), generatedBlocks(read(page.source)).map(b => b.name));
        assert.ok(!/skills\//.test(translationPath(page.source)));
    }
});
test('pending files are blocked by default, with an explicit local preview exception disabled in CI', () => {
    const statuses = [{ state: 'pending', file: 'README.zh-CN.md' }];
    assert.throws(() => assertTranslationStatuses(statuses), /not ready/);
    assert.doesNotThrow(() => assertTranslationStatuses(statuses, true));
    assert.throws(() => assertTranslationStatuses([{ state: 'stale', file: 'README.zh-CN.md' }], true), /stale/);
    assert.throws(() => assertTranslationStatuses([], true, ['orphan.zh-CN.md']), /orphan/);
    const previous = { allow: process.env.DOCS_I18N_ALLOW_PENDING, ci: process.env.CI };
    try {
        process.env.DOCS_I18N_ALLOW_PENDING = '1'; delete process.env.CI;
        assert.equal(allowPending(), true);
        process.env.CI = 'true'; assert.equal(allowPending(), false);
    } finally {
        for (const [key, value] of [['DOCS_I18N_ALLOW_PENDING', previous.allow], ['CI', previous.ci]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});
test('GitHub root READMEs keep their existing mutual language links', () => {
    assert.match(read('README.md'), /href="README\.zh-CN\.md"/);
    assert.match(read('README.zh-CN.md'), /href="README\.md" lang="en"/);
    for (const page of pages.filter(p => p.source.endsWith('/README.md'))) {
        assert.match(read(page.source), /\[documentation-zh\]: \.\/README\.zh-CN\.md/);
        assert.match(read(translationPath(page.source)), /\[documentation-en\]: \.\/README\.md/);
    }
});
test('a changed translation at the same HEAD invalidates the built site', () => {
    const metadata = { commit: 'head', pages: [{ source, sourceHash: sourceDigest(english), translationSource: translationPath(source), translationHash: sourceDigest(chinese) }] };
    assert.doesNotThrow(() => assertBuildSources(metadata, 'head', path => path === source ? english : chinese));
    assert.throws(() => assertBuildSources(metadata, 'head', path => path === source ? english : chinese + 'new'), /stale/);
});
test('Chinese search finds phrases embedded in sentences and mixed GPU identifiers', () => {
    const options = { fields: ['text'], tokenize };
    const index = new MiniSearch(options);
    index.add({ id: 'zh', text: '使用帧图管理临时GPU资源与 FrameGraph.execute' });
    const browser = MiniSearch.loadJSON(JSON.stringify(index), options);
    assert.equal(browser.search('帧图')[0]?.id, 'zh');
    assert.equal(browser.search('GPU资源')[0]?.id, 'zh');
    assert.equal(browser.search('FrameGraph.execute')[0]?.id, 'zh');
});
test('locale Markdown and llms indexes keep Chinese routes, pending notices and shared English API references', () => {
    const page = { locale: 'zh-CN', route: 'zh-CN/guides/webgpu', group: 'Guides & examples', title: '使用指南', sourceUrl: 'source', translationState: 'pending' };
    const meta = { commit: 'head', docsBase: '/zenfg/docs/', packages: [], pages: [page, { locale: 'en', route: 'guides/webgpu', group: 'Guides & examples', title: 'English' }, { locale: 'en', route: 'api/index', group: 'TypeScript API', title: 'API' }] };
    const output = plainMarkdown(page, meta, '[Concept](/zh-CN/concepts/webgpu.html#resources)');
    assert.ok(output.includes('/zenfg/docs/zh-CN/concepts/webgpu.md#resources'));
    assert.ok(output.includes('中文译文尚未确认'));
    const llms = llmsIndex(meta, 'zh-CN');
    assert.ok(llms.includes('/docs/zh-CN/guides/webgpu.md'));
    assert.ok(llms.includes('/docs/api/index.md'));
    assert.ok(!llms.includes('/docs/guides/webgpu.md'));
});
