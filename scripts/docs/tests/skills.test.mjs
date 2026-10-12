import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { renderSkill, skillRegions, rebaseLinks, checkSkill } from '../skills.mjs';
import { usagePath } from '../usage.mjs';

function fixture(t, body) {
    const root = mkdtempSync(resolve(tmpdir(), 'zenfg-skill-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(resolve(root, 'docs'));
    writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@zenfg/fixture', version: '1.0.0' }));
    writeFileSync(resolve(root, 'README.md'), '# Package\n<!-- usage-source: docs/guide.md -->\n');
    writeFileSync(resolve(root, 'docs/guide.md'), body);
    return root;
}
const description = '<!-- skill:description:start -->\nUse the fixture to validate graph data.\n<!-- skill:description:end -->\n';
const region = text => '<!-- skill:core:start -->\n' + text + '\n<!-- skill:core:end -->\n';

test('Skills preserve marked content, normalize line endings and reject drift', t => {
    const root = fixture(t, description + region('## Core\n\n[Details](#core)'));
    const a = renderSkill(root), b = renderSkill(root);
    assert.equal(a.content, b.content);
    assert.ok(a.content.includes('name: zenfg-fixture'));
    assert.ok(a.content.includes('[Details](../../docs/guide.md#core)'));
    mkdirSync(dirname(a.path), { recursive: true });
    writeFileSync(a.path, a.content);
    assert.doesNotThrow(() => checkSkill(root));
    writeFileSync(a.path, a.content + 'manual edit');
    assert.throws(() => checkSkill(root), /differs/);
    writeFileSync(resolve(root, 'docs/guide.md'), (description + region('## Core\n\n[Details](#core)')).replaceAll('\n', '\r\n'));
    assert.equal(renderSkill(root).content, a.content);
});

test('marker parsing fails closed and ignores literal markers inside code', () => {
    assert.throws(() => skillRegions(description + region('one') + region('two')), /duplicate/);
    assert.throws(() => skillRegions(description + '<!-- skill:core:start -->\nmissing'), /Unclosed/);
    assert.throws(() => skillRegions(description + '<!-- skill:core:end -->'), /Unpaired/);
    assert.throws(() => skillRegions(description + region('')), /Empty/);
    const tick = String.fromCharCode(96).repeat(3);
    assert.equal(skillRegions(description + region(tick + 'md\n<!-- skill:fake:start -->\n' + tick)).size, 2);
});

test('link relocation handles references, images, queries and spaces without changing code', () => {
    const root = resolve(tmpdir(), 'zenfg-skill-links');
    const source = resolve(root, 'docs/guide.md'), output = resolve(root, 'skills/fixture/SKILL.md');
    const tick = String.fromCharCode(96);
    const code = tick.repeat(3) + 'md\n[Literal](../outside.md)\n' + tick.repeat(3);
    const input = '[Details](#core)\n![Image](<./image one.svg>)\n[ref]: ./guide.md?q=1#core "Title"\n' + tick + '[Literal](./x.md)' + tick + '\n' + code;
    const result = rebaseLinks(input, source, output, root);
    assert.ok(result.includes('[Details](../../docs/guide.md#core)'));
    assert.ok(result.includes('![Image](<../../docs/image one.svg>)'));
    assert.ok(result.includes('[ref]: ../../docs/guide.md?q=1#core "Title"'));
    assert.ok(result.includes(code));
    assert.ok(result.includes(tick + '[Literal](./x.md)' + tick));
    assert.throws(() => rebaseLinks('[Escape](../../outside.md)', source, output, root), /leaves package/);
});

test('source declarations cannot escape the package and omitted reference definitions fail', t => {
    const root = fixture(t, description + region('## Core\n\n[Details][other]') + '\n[other]: #core\n');
    assert.throws(() => renderSkill(root), /Reference definition outside/);
    writeFileSync(resolve(root, 'README.md'), '<!-- usage-source: ../outside.md -->');
    assert.throws(() => usagePath(root), /inside its package/);
    writeFileSync(resolve(root, 'README.md'), '<!-- usage-source: docs/guide.md -->\n<!-- usage-source: docs/guide.md -->');
    assert.throws(() => usagePath(root), /Duplicate/);
});
