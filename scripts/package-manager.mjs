import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
export const root = resolve(import.meta.dirname, '..');
export const packageManifest = name => JSON.parse(readFileSync(require.resolve(name + '/package.json'), 'utf8'));
export const installedPackageVersion = name => packageManifest(name).version;

export function pnpmCommand(args, env = process.env) {
    const cli = env.npm_execpath;
    if (!cli || !env.npm_config_user_agent?.startsWith('pnpm/')) {
        throw new Error('Run this command through pnpm run or pnpm exec.');
    }
    return /\.[cm]?js$/iu.test(cli)
        ? { command: process.execPath, args: [cli, ...args], env }
        : { command: cli, args, env };
}

export function npmCommand(args, env = process.env) {
    const manifestPath = require.resolve('npm/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const cli = resolve(dirname(manifestPath), typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.npm);
    const cleaned = Object.fromEntries(Object.entries(env).filter(([key]) =>
        !['npm_config_user_agent', 'npm_config_manage_package_manager_versions', 'npm_config_verify_deps_before_run', 'npm_config_pm_on_fail'].includes(key.toLowerCase())));
    return { command: process.execPath, args: [cli, ...args], env: { ...cleaned, npm_execpath: cli } };
}

export function execute(invocation, options = {}) {
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: invocation.env, ...options,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(invocation.command + ' failed (' + result.status + '): ' + (result.stderr || result.stdout || '').slice(-4000));
    return result.stdout ?? '';
}
export const pnpm = (args, options) => execute(pnpmCommand(args), options);

export function assertWorkspaceReferences(manifests) {
    const versions = new Map(manifests.map(manifest => [manifest.name, manifest.version]));
    for (const manifest of manifests) for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
            if (versions.has(name) && spec !== 'workspace:' + versions.get(name)) {
                throw new Error('Internal workspace reference must match source: ' + manifest.name + ' ' + name);
            }
        }
    }
}

export function assertPackedManifest(source, packed) {
    if (source.name !== packed.name || source.version !== packed.version || packed.private) {
        throw new Error('Packed identity differs from source: ' + source.name);
    }
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
        const expected = source[field] ?? {}, actual = packed[field] ?? {};
        if (JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify(Object.keys(actual).sort())) {
            throw new Error('Packed dependency fields differ: ' + source.name + ' ' + field);
        }
        for (const [name, value] of Object.entries(expected)) {
            const version = typeof value === 'string' && value.startsWith('workspace:') ? value.slice(10) : value;
            if (typeof actual[name] !== 'string' || actual[name].startsWith('workspace:') || actual[name] !== version) {
                throw new Error('Packed dependency differs: ' + source.name + ' ' + name);
            }
        }
    }
}

export function packPackage(directory, destination, runCommand = (command, args, options) => execute({ command, args, env: process.env }, options)) {
    const source = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const invocation = pnpmCommand(['pack', '--json', '--pack-destination', destination]);
    runCommand(invocation.command, invocation.args, { cwd: directory, env: invocation.env });
    // Read the real archive, rather than depending on npm/pnpm JSON schema parity.
    const filename = source.name.replace(/^@/u, '').replaceAll('/', '-') + '-' + source.version + '.tgz';
    if (basename(filename) !== filename) throw new Error('Invalid package archive filename.');
    const archive = join(destination, filename);
    const entries = runCommand('tar', ['-tf', archive]).trim().split(/\r?\n/u);
    if (entries.some(file => !file.startsWith('package/') || file.includes('\\') || file.split('/').includes('..'))) {
        throw new Error('Unsafe package archive entry.');
    }
    const packed = JSON.parse(runCommand('tar', ['-xOf', archive, 'package/package.json']));
    assertPackedManifest(source, packed);
    return { filename, files: entries.filter(file => !file.endsWith('/')).map(file => ({ path: file.slice(8) })) };
}
