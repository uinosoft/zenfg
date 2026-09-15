import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { catalog, channel, exactVersion, selectPackages, assertContext, assertResume,
    validateSelection, getJson, publicationState, assertNotes, assertChannelAdvance, compareVersions, assertCargoRegistrySources, root } from '../core.mjs';

const pkg = (id, name, version, dependencies = [], registry = 'npm') => ({ id, name, version, dependencies, registry });
const snapshot = pkg('s', '@zenfg/snapshot', '0.2.0');
const webgpu = pkg('w', '@zenfg/webgpu', '0.3.0', [{ name: snapshot.name, version: snapshot.version }]);
test('independent versions and explicit subset selection are supported', async () => {
    assert.deepEqual(selectPackages([snapshot, webgpu], { w: true }), [webgpu]);
    assert.throws(() => selectPackages([snapshot, webgpu], {}), /Select/);
    await validateSelection([snapshot, webgpu], async () => null);
    await validateSelection([webgpu], async p => p.name === snapshot.name ? { version: snapshot.version } : null);
});
test('missing, yanked or mismatched exact dependencies block before publication', async () => {
    await assert.rejects(validateSelection([webgpu], async () => null), /Missing dependency/);
    await assert.rejects(validateSelection([webgpu], async p => p.name === snapshot.name ? { yanked: true } : null), /Missing dependency/);
    await assert.rejects(validateSelection([{ ...snapshot, version: '0.1.0' }, webgpu], async () => null), /differs/);
});
test('fresh run rejects occupied versions rather than silently skipping', async () => {
    await assert.rejects(validateSelection([snapshot], async () => ({ version: snapshot.version })), /already published/);
});
test('only a 404 is absence; auth, rate limit, outage and network errors fail closed', async () => {
    assert.equal(await getJson('https://example.test', { allowMissing: true, fetcher: async () => ({ status: 404, ok: false }) }), null);
    for (const status of [401, 403, 429, 500, 503]) {
        await assert.rejects(getJson('https://example.test', { allowMissing: true, fetcher: async () => ({ status, ok: false }) }), /HTTP/);
    }
    await assert.rejects(getJson('https://example.test', { allowMissing: true, fetcher: async () => { throw new Error('offline'); } }), /offline/);
});
test('exact dependencies reject ranges, file references and prerelease numeric leading zeros', () => {
    for (const value of ['^1.2.3', 'workspace:*', 'file:../snapshot', '1.2.3-beta.01']) assert.throws(() => exactVersion(value, 'npm'));
    assert.equal(exactVersion('=0.1.0-beta.4', 'cargo'), '0.1.0-beta.4');
    assert.throws(() => exactVersion('0.1.0-beta.4', 'cargo'));
    assert.equal(channel('0.1.0-beta.4'), 'next');
    assert.equal(channel('0.1.0'), 'latest');
});
test('OIDC publishing source must match dispatch repository, workflow, branch and original SHA', () => {
    const sha = 'a'.repeat(40);
    const env = { GITHUB_REPOSITORY: 'uinosoft/zenfg', GITHUB_REF: 'refs/heads/main',
        GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW_REF: 'uinosoft/zenfg/.github/workflows/publish.yml@refs/heads/main',
        GITHUB_SHA: sha, GITHUB_RUN_ID: '123' };
    assert.doesNotThrow(() => assertContext(env, sha));
    for (const key of Object.keys(env)) assert.throws(() => assertContext({ ...env, [key]: 'wrong' }, sha), /requires/);
});
test('reruns bind candidate to the same run, SHA and ordered selection', () => {
    const manifest = { schema: 1, sha: 'a', runId: '1', packages: [snapshot, webgpu] };
    const expected = { sha: 'a', runId: '1', ids: ['s','w'] };
    assert.doesNotThrow(() => assertResume(manifest, expected));
    for (const change of [{ sha: 'b' }, { runId: '2' }, { ids: ['s'] }, { ids: ['w','s'] }]) {
        assert.throws(() => assertResume(manifest, { ...expected, ...change }), /Candidate/);
    }
});
test('partial publication resumes only with matching immutable registry checksums', () => {
    assert.equal(publicationState(snapshot, null), 'pending');
    const npm = { ...snapshot, integrity: 'sha512-approved' };
    assert.equal(publicationState(npm, { dist: { integrity: npm.integrity } }), 'published');
    assert.throws(() => publicationState(npm, { dist: { integrity: 'sha512-other' } }), /differs/);
    const cargo = { ...snapshot, registry: 'cargo', sha256: 'approved' };
    assert.equal(publicationState(cargo, { checksum: 'approved', yanked: false }), 'published');
    assert.throws(() => publicationState(cargo, { checksum: 'approved', yanked: true }), /yanked/);
    assert.throws(() => publicationState(cargo, { checksum: 'other' }), /differs/);
});
test('release notes identify a specific package version and date', () => {
    assert.doesNotThrow(() => assertNotes('# @zenfg/snapshot 0.2.0\n\nDate: 2026-09-15\n\nChanges.\n', snapshot));
    assert.throws(() => assertNotes('# Unreleased\nDate: 2026-09-15\n', snapshot));
});
test('current package catalog stays an explicit five-package allowlist', () => {
    assert.equal(catalog().length, 5);
    assert.equal(catalog().filter(p => p.registry === 'npm').length, 3);
    assert.equal(catalog().filter(p => p.registry === 'cargo').length, 2);
});
test('direct invocation cannot publish without the trusted workflow context', () => {
    const env = { ...process.env, GITHUB_REPOSITORY: 'fork/zenfg', RELEASE_INPUTS: '{"npm_snapshot":true,"dry_run":false}' };
    const result = spawnSync(process.execPath, ['scripts/release/run.mjs', 'publish-snapshot'], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Publishing requires/);
    assert.doesNotMatch(result.stdout, /npm-cli.*publish/);
});
test('publication workflow has a manual source, credential-free candidate and isolated verification', () => {
    const source = readFileSync(root + '/.github/workflows/publish.yml', 'utf8');
    assert.match(source, /workflow_dispatch:/);
    assert.doesNotMatch(source, /workflow_run:|pull_request_target:|NPM_TOKEN|secrets\.CARGO/);
    const candidate = source.split('\n  candidate:')[1].split('\n  publish:')[0];
    const verify = source.split('\n  verify:')[1].split('\n  finalize:')[0];
    assert.doesNotMatch(candidate + verify, /id-token: write|contents: write|environment: release/);
    assert.match(source, /environment: release/);
    assert.equal((source.match(/id-token: write/g) ?? []).length, 1);
    for (const match of source.matchAll(/uses: ([^\s]+)/g)) {
        if (!match[1].startsWith('./')) assert.match(match[1], /@[a-f0-9]{40}$/);
    }
});


test("npm channels cannot be rolled backwards by an older rerun", () => {
    assert.throws(() => assertChannelAdvance({ ...snapshot, version: "0.1.0", channel: "latest" }, { latest: "0.2.0" }), /backwards/);
    assert.doesNotThrow(() => assertChannelAdvance({ ...snapshot, version: "0.2.0", channel: "latest" }, { latest: "0.2.0-beta.3" }));
    assert.equal(compareVersions("0.1.0-beta.10", "0.1.0-beta.9"), 1);
    assert.equal(compareVersions("0.1.0-beta.3", "0.1.0-beta.3"), 0);
});
test("dry-run mode blocks publish commands even before source validation", () => {
    const result = spawnSync(process.execPath, ["scripts/release/run.mjs", "publish-cargo"], { cwd: root, env: { ...process.env, RELEASE_INPUTS: "{\"dry_run\":true}" }, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Publishing is disabled/);
});

test("registry Cargo consumers reject local replacements and wrong archive checksums", () => {
    const pkg = { name: "zenfg-snapshot", version: "0.2.0", sha256: "approved" };
    const resolved = { ...pkg, source: "registry+https://github.com/rust-lang/crates.io-index", checksum: "approved" };
    assert.doesNotThrow(() => assertCargoRegistrySources({ package: [resolved] }, [pkg]));
    for (const replacement of [{ ...resolved, source: undefined }, { ...resolved, checksum: "other" }, { ...resolved, version: "0.1.0" }]) {
        assert.throws(() => assertCargoRegistrySources({ package: [replacement] }, [pkg]), /approved crates.io archive/);
    }
});

test("CI only runs main pushes, PRs and dispatch; artifact downloads fail on digest mismatch", () => {
    const ci = readFileSync(root + "/.github/workflows/ci.yml", "utf8");
    assert.match(ci, /push:\s*\n\s*branches: \[main\]/);
    assert.match(ci, /cancel-in-progress:.*github.event_name == .pull_request./);
    assert.match(ci, /github.event.pull_request.number \|\| github.run_id/);
    for (const file of ["publish.yml", "checks.yml"]) {
        const source = readFileSync(root + "/.github/workflows/" + file, "utf8");
        assert.doesNotMatch(source, /ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093/);
        assert.equal((source.match(/uses: actions\/download-artifact@/g) ?? []).length, (source.match(/digest-mismatch: error/g) ?? []).length);
    }
});
