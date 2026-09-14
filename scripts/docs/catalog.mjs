import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'smol-toml';

export const root = resolve(import.meta.dirname, '../..');
export const repository = 'https://github.com/uinosoft/zenfg';
export const website = 'https://uinosoft.github.io/zenfg/';
export const contentDir = resolve(root, 'apps/docs/.generated', process.env.DOCS_MODE === 'development' ? 'development' : 'production');
export const read = path => readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
export function write(path, text) {
    const target = resolve(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
}
export const workspace = JSON.parse(read('package.json'));
export const cargo = parse(read('Cargo.toml'));
export const packages = [
    ['npm', 'webgpu'], ['npm', 'snapshot'], ['npm', 'inspector'],
    ['cargo', 'zenfg'], ['cargo', 'zenfg-snapshot'],
].map(([registry, slug]) => {
    const directory = `${registry === 'npm' ? 'packages' : 'crates'}/${slug}`;
    const manifest = registry === 'npm' ? JSON.parse(read(`${directory}/package.json`)) : parse(read(`${directory}/Cargo.toml`)).package;
    return { registry, slug, directory, manifest, name: manifest.name, version: manifest.version,
        tag: `${registry}/${slug}/v${manifest.version}`, route: `packages/${slug}` };
});
export function publicEntrypoints() {
    return packages.filter(p => p.registry === 'npm').flatMap(p => Object.entries(p.manifest.exports).flatMap(([subpath, target]) => {
        if (!target || typeof target !== 'object' || typeof target.types !== 'string') return [];
        const match = target.types.match(/^\.\/dist\/(.+)\.d\.ts$/u);
        if (!match) throw new Error(`Unsupported types target: ${p.name} ${subpath}`);
        return [{ name: subpath === '.' ? p.name : `${p.name}/${subpath.slice(2)}`, source: `${p.directory}/src/${match[1]}.ts`, slug: p.slug, subpath }];
    }));
}
export function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
export function siteBase(value = process.env.SITE_BASE ?? '/zenfg/') {
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value)) throw new Error(`SITE_BASE must be an absolute directory path: ${value}`);
    return value;
}
export function publishedVersion(p) {
    const tags = git('tag', '--list', `${p.registry}/${p.slug}/v*`, '--sort=-version:refname').split('\n').filter(Boolean);
    return tags[0]?.split('/v').at(-1);
}
export function snapshotVersion() {
    const ts = read('packages/snapshot/src/format.ts').match(/FRAME_GRAPH_SNAPSHOT_VERSION\s*=\s*Object.freeze\(\{\s*major:\s*(\d+),\s*minor:\s*(\d+)/);
    const rs = read('crates/zenfg-snapshot/src/lib.rs').match(/FRAME_GRAPH_SNAPSHOT_VERSION[^=]*=\s*SnapshotVersion\s*\{\s*major:\s*(\d+),\s*minor:\s*(\d+)/);
    if (!ts || !rs || ts[1] !== rs[1] || ts[2] !== rs[2]) throw new Error('Snapshot TypeScript and Rust wire versions disagree.');
    return `${ts[1]}.${ts[2]}`;
}

// This is a website content allowlist, not a second documentation corpus.
export const pages = [
    { source: 'README.md', route: 'index', title: 'Introduction', group: 'Introduction' },
    { source: 'docs/README.md', route: 'getting-started', title: 'Choose your path', group: 'Getting started' },
    ...packages.map(p => ({ source: `${p.directory}/README.md`, route: p.route, title: p.name, group: 'Getting started' })),
    { source: 'docs/core-concepts.md', route: 'concepts', title: 'Core concepts', group: 'Concepts' },
    { source: 'packages/webgpu/examples/README.md', route: 'guides/examples', title: 'Examples and recipes', group: 'Guides & examples' },
    { source: 'packages/inspector/GUIDE.md', route: 'guides/inspector', title: 'Inspector workbench', group: 'Guides & examples' },
    { source: 'packages/inspector/THEMING.md', route: 'guides/themes', title: 'Inspector themes', group: 'Guides & examples' },
    { source: 'packages/snapshot/SPEC.md', route: 'reference/snapshot', title: 'Snapshot specification', group: 'Reference' },
    { source: 'docs/compatibility.md', route: 'compatibility', title: 'Compatibility', group: 'Compatibility & migration' },
    { source: 'docs/migration-0.1.0-beta.3.md', route: 'migration/beta-3', title: 'Migrating to beta.3', group: 'Compatibility & migration' },
    { source: 'CHANGELOG.md', route: 'changelog', title: 'Changelog', group: 'Compatibility & migration' },
];
export const recipes = packages.filter(p => p.slug === 'webgpu' || p.slug === 'zenfg').flatMap(p =>
    ['minimal-frame', 'transient-to-present', 'imported-resource', 'persistent-state', 'external-submission', 'snapshot-export', 'gpu-timing', 'compute-output'].map(name => ({
        source: `${p.directory}/examples/${p.registry === 'npm' ? name + '.ts' : name.replaceAll('-', '_') + '.rs'}`,
        route: `examples/${p.slug}/${name}`, title: `${p.slug}: ${name}`, group: 'Examples', code: p.registry === 'npm' ? 'ts' : 'rust',
    })));
recipes.push({ source: 'crates/zenfg-snapshot/examples/basic.rs', route: 'examples/zenfg-snapshot/basic', title: 'Rust Snapshot workflow', group: 'Examples', code: 'rust' });
