import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'smol-toml';

export const root = resolve(import.meta.dirname, '../..');
export const repository = 'uinosoft/zenfg';
export const definitions = [
    ['npm_snapshot', 'npm', 'snapshot'],
    ['cargo_snapshot', 'cargo', 'zenfg-snapshot'],
    ['cargo_zenfg', 'cargo', 'zenfg'],
    ['npm_webgpu', 'npm', 'webgpu'],
    ['npm_inspector', 'npm', 'inspector'],
];
export const read = path => readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n');
export const json = path => JSON.parse(read(path));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/u;

export function exactVersion(value, registry) {
    const version = registry === 'cargo' && typeof value === 'string' ? value.replace(/^=/u, '') : value;
    if (typeof version !== 'string' || !semver.test(version) || (registry === 'cargo' && value !== '=' + version)) {
        throw new Error('Expected an exact internal dependency version: ' + value);
    }
    return version;
}
export function channel(version) {
    if (!semver.test(version)) throw new Error('Invalid release version: ' + version);
    return version.includes('-') ? 'next' : 'latest';
}
export function catalog(readAt = read) {
    return definitions.map(([id, registry, slug]) => {
        const directory = (registry === 'npm' ? 'packages/' : 'crates/') + slug;
        const manifest = registry === 'npm' ? JSON.parse(readAt(directory + '/package.json')) : parse(readAt(directory + '/Cargo.toml'));
        const pkg = registry === 'npm' ? manifest : manifest.package;
        const dependencies = Object.entries(manifest.dependencies ?? {}).filter(([name]) =>
            registry === 'npm' ? name.startsWith('@zenfg/') : name === 'zenfg-snapshot',
        ).map(([name, spec]) => ({ name, version: exactVersion(typeof spec === 'string' ? spec : spec.version, registry) }));
        return { id, registry, slug, directory, name: pkg.name, version: pkg.version,
            tag: registry + '/' + slug + '/v' + pkg.version, dependencies,
            channel: channel(pkg.version),
            notes: 'docs/releases/' + registry + '-' + slug + '-' + pkg.version + '.md' };
    });
}
export function selectPackages(packages, inputs) {
    const selected = packages.filter(p => inputs[p.id] === true || inputs[p.id] === 'true');
    if (!selected.length) throw new Error('Select at least one package.');
    return selected;
}
export function assertContext(env, sha) {
    if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_REF !== 'refs/heads/main'
        || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
        || env.GITHUB_WORKFLOW_REF !== repository + '/.github/workflows/publish.yml@refs/heads/main'
        || !/^[a-f0-9]{40}$/u.test(sha) || env.GITHUB_SHA !== sha || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? '')) {
        throw new Error('Publishing requires publish.yml dispatched on uinosoft/zenfg main at the original SHA.');
    }
}
export async function getJson(url, { allowMissing = false, fetcher = fetch } = {}) {
    const response = await fetcher(url, { headers: { 'User-Agent': 'zenfg-release-ci (github.com/uinosoft/zenfg)' },
        signal: AbortSignal.timeout(30000) });
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok) throw new Error('Registry request failed: HTTP ' + response.status + ' ' + url);
    return response.json();
}
export async function registryVersion(pkg) {
    if (pkg.registry === 'npm') {
        return getJson('https://registry.npmjs.org/' + encodeURIComponent(pkg.name) + '/' + encodeURIComponent(pkg.version), { allowMissing: true });
    }
    const data = await getJson('https://crates.io/api/v1/crates/' + pkg.name + '/' + pkg.version, { allowMissing: true });
    return data?.version ?? null;
}
export async function validateSelection(selected, lookup = registryVersion) {
    for (const pkg of selected) {
        if (await lookup(pkg)) throw new Error(pkg.name + '@' + pkg.version + ' is already published; prepare a new version.');
        for (const dep of pkg.dependencies) {
            const planned = selected.find(p => p.registry === pkg.registry && p.name === dep.name);
            if (planned) {
                if (planned.version !== dep.version) throw new Error(pkg.name + ' requires ' + dep.name + '@' + dep.version + ', but selected version differs.');
            } else {
                const existing = await lookup({ registry: pkg.registry, ...dep });
                if (!existing || existing.yanked) throw new Error('Missing dependency: select or publish ' + dep.name + '@' + dep.version + ' first.');
            }
        }
    }
}
export function assertNotes(text, pkg) {
    if (!text.startsWith('# ' + pkg.name + ' ' + pkg.version + '\n') || !/^Date: \d{4}-\d{2}-\d{2}$/mu.test(text)) {
        throw new Error('Release notes must start with "# ' + pkg.name + ' ' + pkg.version + '" and contain "Date: YYYY-MM-DD": ' + pkg.notes);
    }
}
export function assertResume(manifest, expected) {
    if (manifest.schema !== 1 || manifest.sha !== expected.sha || manifest.runId !== expected.runId
        || JSON.stringify(manifest.packages.map(p => p.id)) !== JSON.stringify(expected.ids)) {
        throw new Error('Candidate does not belong to this SHA, workflow run, and selection.');
    }
}
export function publicationState(pkg, metadata) {
    if (!metadata) return 'pending';
    if (metadata.yanked) throw new Error(pkg.name + ' is yanked; refusing resume.');
    const checksum = pkg.registry === 'npm' ? metadata.dist?.integrity : metadata.checksum;
    const expected = pkg.registry === 'npm' ? pkg.integrity : pkg.sha256;
    if (!expected || checksum !== expected) throw new Error(pkg.name + ' registry artifact differs from the approved candidate.');
    return 'published';
}


export function compareVersions(a, b) {
    channel(a); channel(b);
    const parts = value => { const i = value.indexOf('-'); return [value.slice(0, i < 0 ? undefined : i).split('.'), i < 0 ? null : value.slice(i + 1).split('.')]; };
    const [am, ap] = parts(a), [bm, bp] = parts(b);
    for (let i = 0; i < 3; i++) if (BigInt(am[i]) !== BigInt(bm[i])) return BigInt(am[i]) < BigInt(bm[i]) ? -1 : 1;
    if (!ap || !bp) return ap === bp ? 0 : ap ? -1 : 1;
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
        if (ap[i] === undefined || bp[i] === undefined) return ap[i] === undefined ? -1 : 1;
        if (ap[i] === bp[i]) continue;
        const an = /^\d+$/u.test(ap[i]), bn = /^\d+$/u.test(bp[i]);
        if (an && bn) return BigInt(ap[i]) < BigInt(bp[i]) ? -1 : 1;
        if (an !== bn) return an ? -1 : 1;
        return ap[i] < bp[i] ? -1 : 1;
    }
    return 0;
}
export function assertChannelAdvance(pkg, tags) {
    const current = tags[pkg.channel];
    if (current && compareVersions(pkg.version, current) < 0) throw new Error('Refusing to move npm ' + pkg.channel + ' backwards: ' + pkg.name);
}

export function assertCargoRegistrySources(lock, packages) {
    for (const pkg of packages) {
        const resolved = lock.package.find(p => p.name === pkg.name && p.version === pkg.version);
        if (resolved?.source !== "registry+https://github.com/rust-lang/crates.io-index" || resolved.checksum !== pkg.sha256) {
            throw new Error("Registry consumer must resolve the approved crates.io archive: " + pkg.name);
        }
    }
}
