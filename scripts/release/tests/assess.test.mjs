import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assess, markdown, latestTag } from '../assess.mjs';
import { definitions } from '../core.mjs';

function fixture(t, tags = true) {
    const cwd = mkdtempSync(join(tmpdir(), 'zenfg-assess-test-'));
    t.after(() => {
        assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
        assert.ok(cwd.includes('zenfg-assess-test-'));
        rmSync(cwd, { recursive: true, force: true });
    });
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = (path, value) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), value); };
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release test');
    git('config', 'user.email', 'release-test@example.invalid');
    for (const [, registry, slug] of definitions) {
        const dir = (registry === 'npm' ? 'packages/' : 'crates/') + slug;
        if (registry === 'npm') write(dir + '/package.json', JSON.stringify({ name: '@zenfg/' + slug, version: '0.1.0-beta.10', files: ['dist', 'src', 'README.md', 'examples', 'schema'],
            dependencies: slug === 'snapshot' ? {} : { '@zenfg/snapshot': '0.1.0-beta.10' } }));
        else write(dir + '/Cargo.toml', '[package]\nname = "' + slug + '"\nversion = "0.1.0-beta.10"\nexclude = ["tests/**"]\n'
            + (slug === 'zenfg' ? '[dependencies]\nzenfg-snapshot = { version = "=0.1.0-beta.10" }\n' : ''));
        write(dir + '/src/' + (registry === 'npm' ? 'index.ts' : 'lib.rs'), '// baseline\n');
    }
    const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); };
    commit();
    if (tags) for (const [, registry, slug] of definitions) git('tag', registry + '/' + slug + '/v0.1.0-beta.10');
    return { cwd, git, write, commit };
}
const byId = (r, id) => r.packages.find(p => p.id === id);
test('baseline uses SemVer and ignores unreachable higher tags', t => {
    const f = fixture(t);
    f.git('tag', 'npm/snapshot/v0.1.0-beta.9');
    f.git('checkout', '-b', 'future');
    f.write('future.txt', 'future'); f.commit();
    f.git('tag', 'npm/snapshot/v9.0.0');
    f.git('checkout', 'main');
    const report = assess(f);
    assert.equal(byId(report, 'npm_snapshot').baseline, 'npm/snapshot/v0.1.0-beta.10');
    assert.ok(report.packages.every(p => p.status === 'unchanged'));
    assert.equal(latestTag({ registry: 'npm', slug: 'snapshot' }, ['npm/snapshot/vnot-semver']), null);
});
test('single Inspector source change does not select or mark unrelated packages', t => {
    const f = fixture(t);
    f.write('packages/inspector/src/index.ts', '// changed'); f.commit();
    const report = assess(f);
    assert.equal(byId(report, 'npm_inspector').status, 'changed');
    assert.ok(report.packages.filter(p => p.id !== 'npm_inspector').every(p => p.status === 'unchanged'));
    assert.match(markdown(report), /choose packages and versions explicitly/);
});
test('test, CI and website changes are separated from package content', t => {
    const f = fixture(t);
    f.write('packages/webgpu/tests/check.ts', '// test');
    f.write('crates/zenfg/src/snapshot/tests.rs', '// test only');
    f.write('.github/workflows/ci.yml', 'name: ci');
    f.write('apps/site/page.html', '<p>site</p>'); f.commit();
    const report = assess(f);
    assert.ok(report.packages.every(p => p.status === 'unchanged'));
    assert.deepEqual(byId(report, 'cargo_zenfg').changes.development, ['crates/zenfg/src/snapshot/tests.rs']);
    assert.deepEqual(byId(report, 'npm_webgpu').changes.development, ['packages/webgpu/tests/check.ts']);
});
test('shared build changes request review; packaged schema changes are content', t => {
    const f = fixture(t);
    f.write('scripts/build-package.mjs', '// build');
    f.write('packages/snapshot/schema/snapshot.json', '{}'); f.commit();
    const report = assess(f);
    assert.equal(byId(report, 'npm_snapshot').status, 'changed');
    assert.equal(byId(report, 'npm_webgpu').status, 'review');
    assert.equal(byId(report, 'cargo_snapshot').status, 'unchanged');
});
test('Snapshot changes produce explicit dependency review hints without automatic version bumps', t => {
    const f = fixture(t);
    f.write('packages/snapshot/src/index.ts', '// protocol change'); f.commit();
    const report = assess(f), dependent = byId(report, 'npm_webgpu');
    assert.equal(dependent.status, 'review');
    assert.equal(dependent.version, '0.1.0-beta.10');
    assert.equal(dependent.dependencyReview[0].requiredVersion, '0.1.0-beta.10');
    const manifest = JSON.parse(readFileSync(join(f.cwd, 'packages/webgpu/package.json'), 'utf8'));
    manifest.dependencies['@zenfg/snapshot'] = '0.1.0-beta.11';
    f.write('packages/webgpu/package.json', JSON.stringify(manifest)); f.commit();
    const updated = byId(assess(f), 'npm_webgpu');
    assert.equal(updated.dependencyChanges[0].internal, true);
    assert.equal(updated.dependencyChanges[0].after, '0.1.0-beta.11');
});
test('missing baseline is unknown; uncommitted versions and content are excluded without mutations', t => {
    const f = fixture(t, false);
    assert.ok(assess(f).packages.every(p => p.status === 'no-baseline'));
    for (const [, registry, slug] of definitions) f.git('tag', registry + '/' + slug + '/v0.1.0-beta.10');
    f.write('packages/snapshot/package.json', '{"name":"@zenfg/snapshot","version":"99.0.0"}');
    f.write('untracked.txt', 'not committed');
    const before = f.git('status', '--porcelain');
    const report = assess(f);
    assert.equal(report.dirty, true);
    assert.match(report.warnings[0], /committed HEAD only/);
    assert.equal(byId(report, 'npm_snapshot').version, '0.1.0-beta.10');
    assert.equal(byId(report, 'npm_snapshot').status, 'unchanged');
    assert.equal(f.git('status', '--porcelain'), before);
});
