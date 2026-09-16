import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { transformContent } from '../prepare.mjs';
import { anchors, assertLocalLinks, hideRustDoctestLines, quickStart } from '../markdown.mjs';
import { publicEntrypoints, packages, pages, recipes, snapshotVersion, siteBase, read } from '../catalog.mjs';

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
test('Quick Starts are extracted from actual package READMEs, with no following sections', () => {
    for (const p of packages.filter(p => p.registry === 'npm')) {
        const code = quickStart(read(`${p.directory}/README.md`));
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
