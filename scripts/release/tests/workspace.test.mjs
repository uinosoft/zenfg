import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceVersion, exactVersion } from '../core.mjs';
import { pnpmCommand, npmCommand, assertPackedManifest, assertWorkspaceReferences } from '../../package-manager.mjs';

test('source exact workspace references normalize independently of archive versions', () => {
    assert.equal(sourceVersion('workspace:0.1.1', 'npm'), '0.1.1');
    for (const value of ['workspace:*', 'workspace:^', 'workspace:^0.1.1', 'workspace:../snapshot']) {
        assert.throws(() => sourceVersion(value, 'npm'));
    }
    assert.throws(() => exactVersion('workspace:0.1.1', 'npm'));
    assert.equal(exactVersion('=0.1.1', 'cargo'), '0.1.1');
});

test('native pnpm executable is invoked directly while legacy JavaScript uses Node', () => {
    const env = { npm_execpath: 'E:/tools/pnpm.exe', npm_config_user_agent: 'pnpm/12.11.2 node/24.19.0' };
    assert.deepEqual(pnpmCommand(['pack'], env), { command: env.npm_execpath, args: ['pack'], env });
    assert.equal(pnpmCommand(['pack'], { ...env, npm_execpath: 'E:/tools/pnpm.cjs' }).command, process.execPath);
    assert.throws(() => pnpmCommand(['pack'], { ...env, npm_config_user_agent: 'npm/11.11.0' }), /pnpm run/);
});

test('npm consumers and uploads resolve the pinned npm CLI instead of the parent pnpm', () => {
    const invocation = npmCommand(['--version'], { npm_execpath: 'E:/tools/pnpm.exe', npm_config_user_agent: 'pnpm/12.11.2', npm_config_manage_package_manager_versions: 'true' });
    assert.equal(invocation.command, process.execPath);
    assert.match(invocation.args[0], /npm-cli\.js$/u);
    assert.equal(invocation.env.npm_execpath, invocation.args[0]);
    assert.equal(invocation.env.npm_config_manage_package_manager_versions, undefined);
    assert.equal(invocation.env.npm_config_user_agent, undefined);
});

test('archive manifests preserve exact dependency values and reject protocol leaks', () => {
    const source = { name: '@zenfg/webgpu', version: '0.2.0', dependencies: { '@zenfg/snapshot': 'workspace:0.1.1' } };
    const packed = { ...source, dependencies: { '@zenfg/snapshot': '0.1.1' } };
    assert.doesNotThrow(() => assertPackedManifest(source, packed));
    for (const value of ['workspace:0.1.1', '^0.1.1', '0.1.2']) {
        assert.throws(() => assertPackedManifest(source, { ...packed, dependencies: { '@zenfg/snapshot': value } }), /dependency differs/);
    }
    assert.throws(() => assertPackedManifest(source, { ...packed, peerDependencies: { '@zenfg/snapshot': 'workspace:0.1.1' } }), /fields differ/);
    assert.throws(() => assertPackedManifest(source, { ...packed, version: '0.3.0' }), /identity differs/);
});

test('Snapshot version changes require synchronized root, public and private workspace references', () => {
    const snapshot = { name: '@zenfg/snapshot', version: '0.1.2' };
    const dependent = { name: '@zenfg/webgpu', version: '0.2.0', dependencies: { '@zenfg/snapshot': 'workspace:0.1.2' } };
    const app = { name: '@zenfg/site-app', version: '0.1.0', dependencies: { '@zenfg/snapshot': 'workspace:0.1.2' } };
    const tools = { name: 'zenfg-workspace', version: '0.0.0', devDependencies: { '@zenfg/snapshot': 'workspace:0.1.2' } };
    assert.doesNotThrow(() => assertWorkspaceReferences([snapshot, dependent, app, tools]));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        assert.throws(() => assertWorkspaceReferences([snapshot, { ...tools, [field]: { '@zenfg/snapshot': 'workspace:0.1.1' } }]), /must match source/);
    }
});
