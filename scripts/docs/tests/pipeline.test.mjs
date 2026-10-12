import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { transformContent } from '../prepare.mjs';
import { plainMarkdown } from '../export.mjs';
import { anchors, assertLocalLinks, assertBuildSources, sourceDigest, assertRequiredAnchors, assertRustdocLinks, packageRepositoryLinks, hideRustDoctestLines, quickStart } from '../markdown.mjs';
import { usageText } from '../usage.mjs';
import { publicEntrypoints, packages, pages, recipes, snapshotVersion, siteBase, read, publishedVersion } from '../catalog.mjs';

test('all public typed exports are discovered without inventing runtime subpaths', () => {
    assert.deepEqual(publicEntrypoints().map(e => e.name).sort(), ['@zenfg/inspector', '@zenfg/inspector/theme', '@zenfg/snapshot', '@zenfg/snapshot/format', '@zenfg/webgpu', '@zenfg/webgpu/snapshot'].sort());
    for (const p of packages.filter(p => p.registry === 'npm')) assert.equal(publicEntrypoints().filter(e => e.slug === p.slug).length, Object.values(p.manifest.exports).filter(e => typeof e === 'object' && e.types).length);
    assert.match(snapshotVersion(), /^\d+\.\d+$/);
});
test('source projection remaps current and release-tag links, leaves literal code intact', () => {
    const input = '# Guide\n\n<!-- generated:badges:start -->\nbadge\n<!-- generated:badges:end -->\n[Local](../../docs/core-concepts.md#resources)\n[Release](https://github.com/uinosoft/zenfg/blob/npm/webgpu/v1.2.3/docs/core-concepts.md)\n[Source](./src/index.ts)\n```ts\nconst link = "[literal](./src/index.ts)";\n```\n';
    const output = transformContent(input, 'packages/webgpu/README.md', new Map([['docs/core-concepts.md', 'concepts']]), 'abcdef');
    assert.match(output, /\[Local\]\(@DOCS@\/concepts.html#resources\)/);
    assert.match(output, /\[Release\]\(@DOCS@\/concepts.html\)/);
    assert.match(output, /blob\/abcdef\/packages\/webgpu\/src\/index.ts/);
    assert.ok(output.includes('"[literal](./src/index.ts)"'));
    assert.ok(!output.includes('badge'));
});
test('Rust hiding affects only doctest scaffolding, preserving attributes and code', () => {
    const value = '```rust,no_run\n# fn main() {\n#[derive(Debug)]\nstruct A;\n## literal\n# }\n```\n```ts\n# untouched\n```';
    const result = hideRustDoctestLines(value);
    assert.ok(!result.includes('fn main'));
    assert.ok(result.includes('#[derive(Debug)]'));
    assert.ok(result.includes('# literal'));
    assert.ok(result.includes('# untouched'));
});
test('installed artifact validation catches escaping links, absent files and absent headings', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'zenfg-docs-links-'));
    try {
        const file = resolve(dir, 'README.md');
        writeFileSync(file, '# Package\n[Missing](missing.md)');
        assert.throws(() => assertLocalLinks(dir), /missing/);
        writeFileSync(file, '# Package\n[Escape](../README.md)');
        assert.throws(() => assertLocalLinks(dir), /leaves artifact/);
        writeFileSync(file, '# Package\n[Bad](#unknown)');
        assert.throws(() => assertLocalLinks(dir), /missing anchor/);
        writeFileSync(file, '# Package\n[Good](#package)\n```md\n[not a link](../outside)\n```');
        assert.doesNotThrow(() => assertLocalLinks(dir));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Quick Starts are extracted from declared package usage sources, with no following sections', () => {
    for (const p of packages.filter(p => p.registry === 'npm')) {
        const code = quickStart(usageText(resolve(p.directory)));
        assert.match(code, /import /);
        assert.ok(!code.includes('## Common tasks'));
    }
    assert.throws(() => quickStart('# No example'), /Quick start/);
    assert.deepEqual([...anchors('# A\n## Same\n## Same')], ['a', 'same', 'same-1']);
});
test('public content allowlist excludes maintainer documents and preserves unique routes', () => {
    assert.equal(new Set([...pages, ...recipes].map(p => p.route)).size, pages.length + recipes.length);
    assert.ok(!pages.some(p => /release-|review|documentation\.md/.test(p.source)));
    assert.equal(siteBase('/'), '/');
    assert.equal(siteBase('/zenfg/'), '/zenfg/');
    assert.throws(() => siteBase('../'), /SITE_BASE/);
});

test('explicit release-history links are preserved while ordinary guidance uses current pages', () => {
    const tagUrl = 'https://github.com/uinosoft/zenfg/blob/npm/webgpu/v0.1.0-beta.3/docs/core-concepts.md';
    const input = `[Current guide](${tagUrl})\n<!-- generated:documentation:start -->\n[For this release](${tagUrl})\n<!-- generated:documentation:end -->`;
    const output = transformContent(input, 'packages/webgpu/README.md', new Map([['docs/core-concepts.md', 'concepts']]), 'abcdef');
    assert.ok(output.includes('[Current guide](@DOCS@/concepts.html)'));
    assert.ok(output.includes(`[For this release](${tagUrl})`));
});


test('README screenshot is omitted from docs while its semantic example link survives', () => {
    const input = '# ZenFG\n<!-- readme-showcase:start -->\n<img src="apps/site/public/media/three-co-rendering.png">\n<!-- readme-showcase:end -->\n[Three.js](https://uinosoft.github.io/zenfg/playground/?example=three-interop)';
    const result = transformContent(input, 'README.md', new Map(), 'abcdef');
    assert.ok(!result.includes('<img'));
    assert.ok(!result.includes('readme-showcase'));
    assert.ok(result.includes('[Three.js](https://uinosoft.github.io/zenfg/playground/?example=three-interop)'));
});

test('published component versions use SemVer, preserve independent versions and report missing tags', () => {
    const tags = [
        'npm/webgpu/v0.1.0-beta.4', 'npm/webgpu/v0.1.0', 'npm/webgpu/vinvalid',
        'npm/snapshot/v0.1.1', 'cargo/zenfg/v0.2.0-beta.10', 'cargo/zenfg/v0.2.0-beta.9',
    ];
    assert.equal(publishedVersion({ registry: 'npm', slug: 'webgpu' }, tags), '0.1.0');
    assert.equal(publishedVersion({ registry: 'npm', slug: 'snapshot' }, tags), '0.1.1');
    assert.equal(publishedVersion({ registry: 'cargo', slug: 'zenfg' }, tags), '0.2.0-beta.10');
    assert.equal(publishedVersion({ registry: 'cargo', slug: 'zenfg-snapshot' }, tags), undefined);
    assert.equal(publishedVersion({ registry: 'npm', slug: 'webgpu' }, []), undefined);
});


test('explicit repository revisions survive metadata sync; new cross-package links use development source', () => {
    const root = resolve('fixture');
    const directory = resolve(root, 'packages/webgpu');
    const file = resolve(directory, 'README.md');
    const repository = 'https://github.com/uinosoft/zenfg';
    const historic = repository + '/blob/npm/webgpu/v0.1.0-beta.3/crates/zenfg/README.md';
    const current = repository + '/blob/main/crates/zenfg/docs/README.md';
    const input = '[History](' + historic + ')\n[Development](' + current + ')\n[Other](../../crates/zenfg/docs/README.md#quick-start)\n[Own](../webgpu/docs/README.md)\n`[inline](../../missing.md)`\n```md\n[literal](../../missing.md)\n```';
    const output = packageRepositoryLinks(input, file, directory, root, repository);
    assert.ok(output.includes('[History](' + historic + ')'));
    assert.ok(output.includes('[Development](' + current + ')'));
    assert.ok(output.includes('[Other](' + current + '#quick-start)'));
    assert.ok(output.includes('[Own](../webgpu/docs/README.md)'));
    assert.ok(output.includes('`[inline](../../missing.md)`'));
    assert.ok(output.includes('[literal](../../missing.md)'));
});

test('pre-migration anchors survive source editing and website projection', () => {
    const legacy = JSON.parse(read('scripts/docs/legacy-anchors.json')).pages;
    const mapping = new Map(pages.map(page => [page.source, page.route]));
    for (const [file, expected] of Object.entries(legacy)) {
        assertRequiredAnchors(expected, anchors(read(file)), file);
        assertRequiredAnchors(expected, anchors(transformContent(read(file), file, mapping, 'abcdef')), file);
    }
    assert.throws(() => assertRequiredAnchors(['inspector-workbench-guide'], anchors('# Changed heading'), 'Guide'), /missing legacy anchors: inspector-workbench-guide/);
});

test('rustdoc HTML checks catch packaged-guide links missing from rendered output', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'zenfg-rustdoc-links-'));
    try {
        mkdirSync(resolve(dir, 'zenfg'));
        mkdirSync(resolve(dir, 'zenfg_snapshot'));
        writeFileSync(resolve(dir, 'zenfg_snapshot/index.html'), '<h1 id="snapshot">Snapshot</h1>');
        const file = resolve(dir, 'zenfg/index.html');
        writeFileSync(file, '<h1 id="usage">Usage</h1><a href="./CONCEPTS.md#resources">Concepts</a>');
        assert.throws(() => assertRustdocLinks(dir), /missing \.\/CONCEPTS\.md#resources/);
        writeFileSync(file, '<h1 id="usage">Usage</h1><a href="#missing">Missing</a>');
        assert.throws(() => assertRustdocLinks(dir), /missing anchor #missing/);
        writeFileSync(file, '<h1 id="usage">Usage</h1><a href="#usage">Usage</a><a href="https://uinosoft.github.io/zenfg/docs/concepts/zenfg.html">Concepts</a><script>const template = \'<link href="../missing.css">\';</script>');
        assert.doesNotThrow(() => assertRustdocLinks(dir));
        const site = resolve(dir, 'site');
        mkdirSync(site);
        assert.throws(() => assertRustdocLinks(dir, site), /missing https:\/\/uinosoft.github.io\/zenfg\/docs\/concepts\/zenfg.html/);
        mkdirSync(resolve(site, 'concepts'));
        writeFileSync(resolve(site, 'concepts/zenfg.html'), '<h1 id="concepts">Concepts</h1>');
        assert.doesNotThrow(() => assertRustdocLinks(dir, site));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('built documentation rejects an old commit or changed guide source at the same HEAD', () => {
    const source = '# Guide\nCurrent guidance\n';
    const metadata = { commit: 'current', pages: [{ source: 'guide.md', sourceHash: sourceDigest(source) }, { route: 'api/root' }] };
    assert.doesNotThrow(() => assertBuildSources(metadata, 'current', () => source));
    assert.throws(() => assertBuildSources(metadata, 'next', () => source), /stale/);
    assert.throws(() => assertBuildSources(metadata, 'current', () => source + 'New paragraph\n'), /stale for guide.md/);
});


test('plain Markdown alternatives rebase inline and reference-definition links without changing code', () => {
    const page = { route: 'guides/zenfg', sourceUrl: 'https://example.com/source' };
    const meta = { commit: 'current', packages: [], docsBase: '/zenfg/docs/' };
    const source = '# Usage\n[Inline](/concepts/zenfg.html#resources)\n[Concepts][concepts]\n[concepts]: /concepts/zenfg.html#resources\n[Recipe][recipe]\n[recipe]: /examples/zenfg/resource-pool-control.html\n```md\n[literal]: /unchanged.html\n```';
    const output = plainMarkdown(page, meta, source);
    assert.ok(output.includes('[Inline](/zenfg/docs/concepts/zenfg.md#resources)'));
    assert.ok(output.includes('[concepts]: /zenfg/docs/concepts/zenfg.md#resources'));
    assert.ok(output.includes('[recipe]: /zenfg/docs/examples/zenfg/resource-pool-control.md'));
    assert.ok(output.includes('[literal]: /unchanged.html'));
});
