import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { catalog, channel, compareVersions, root } from './core.mjs';

export function latestTag(pkg, tags) {
    const prefix = pkg.registry + '/' + pkg.slug + '/v';
    return tags.filter(tag => {
        if (!tag.startsWith(prefix)) return false;
        try { channel(tag.slice(prefix.length)); return true; } catch { return false; }
    }).sort((a, b) => compareVersions(b.slice(prefix.length), a.slice(prefix.length)))[0] ?? null;
}
function manifestPath(pkg) { return pkg.directory + (pkg.registry === 'npm' ? '/package.json' : '/Cargo.toml'); }
function readManifest(pkg, text) { return pkg.registry === 'npm' ? JSON.parse(text) : parse(text); }
function shipped(pkg, path, manifests) {
    if (/^(README(?:\.[^/]+)?|LICENSE(?:\.[^/]+)?|package\.json|Cargo\.toml)$/iu.test(path)) return true;
    if (path.startsWith('src/')) return true;
    if (pkg.registry === 'cargo') {
        return manifests.some(m => {
            const { include, exclude = [] } = m.package;
            return (!include || include.some(p => posix.matchesGlob(path, p)))
                && !exclude.some(p => posix.matchesGlob(path, p));
        });
    }
    return manifests.some(m => !m.files || m.files.some(p => {
        const pattern = p.replace(/^\.\//u, '').replace(/\/$/u, '');
        return path === pattern || path.startsWith(pattern + '/') || posix.matchesGlob(path, pattern);
    }));
}
function sharedImpact(pkg, path) {
    if (path === 'LICENSE' || path === 'scripts/docs/sync.mjs' || path === 'scripts/docs/catalog.mjs') return true;
    if (pkg.registry === 'npm') {
        return ['package.json', 'package-lock.json', '.npmrc', 'scripts/build-package.mjs'].includes(path)
            || /^tsconfig[^/]*\.json$/u.test(path)
            || (pkg.slug === 'inspector' && path === 'scripts/build-inspector-themes.mjs');
    }
    return ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'rust-toolchain'].includes(path) || path.startsWith('.cargo/');
}
export function classifyChanges(pkg, paths, manifests) {
    const result = { source: [], shipped: [], development: [], shared: [], other: [] };
    for (const path of paths) {
        if (path.startsWith(pkg.directory + '/')) {
            const local = path.slice(pkg.directory.length + 1);
            if (/(^|\/)(tests?|__tests__|benches|benchmarks)\/|(^|\/)tests\.rs$|\.(test|spec)\.[cm]?[jt]sx?$/u.test(local)) result.development.push(path);
            else if (local.startsWith('src/')) result.source.push(path);
            else if (shipped(pkg, local, manifests)) result.shipped.push(path);
            else result.development.push(path);
        } else if (sharedImpact(pkg, path)) result.shared.push(path);
        else result.other.push(path);
    }
    return result;
}
export function assess({ cwd = root } = {}) {
    const git = (...args) => execFileSync('git', args, {
        cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    const head = git('rev-parse', '--verify', 'HEAD').trim();
    const readAt = (ref, file) => git('show', ref + ':' + file).replaceAll('\r\n', '\n');
    const packages = catalog(file => readAt(head, file));
    const tags = git('tag', '--merged', head, '--list').trim().split('\n').filter(Boolean);
    const dirty = Boolean(git('status', '--porcelain', '--untracked-files=normal').trim());
    const reports = packages.map(pkg => {
        const baseline = latestTag(pkg, tags);
        const result = { id: pkg.id, name: pkg.name, registry: pkg.registry, version: pkg.version,
            channel: pkg.registry === 'npm' ? pkg.channel : 'crates.io', baseline,
            status: 'no-baseline', changes: { source: [], shipped: [], development: [], shared: [], other: [] },
            dependencyChanges: [], dependencyReview: [] };
        if (!baseline) return result;
        const paths = git('diff', '--name-only', '-z', '--no-renames', baseline, head, '--').split('\0').filter(Boolean);
        const oldManifest = readManifest(pkg, readAt(baseline, manifestPath(pkg)));
        const currentManifest = readManifest(pkg, readAt(head, manifestPath(pkg)));
        result.changes = classifyChanges(pkg, paths, [oldManifest, currentManifest]);
        const before = oldManifest.dependencies ?? {}, after = currentManifest.dependencies ?? {};
        for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (JSON.stringify(before[name]) !== JSON.stringify(after[name])) {
                result.dependencyChanges.push({ name, before: before[name] ?? null, after: after[name] ?? null,
                    internal: packages.some(p => p.registry === pkg.registry && p.name === name) });
            }
        }
        result.status = result.changes.source.length || result.changes.shipped.length ? 'changed'
            : result.changes.shared.length ? 'review' : 'unchanged';
        return result;
    });
    // Use direct content/build changes, not newly added review hints, to avoid order-dependent propagation.
    const changedIds = new Set(reports.filter(p => p.status !== 'unchanged').map(p => p.id));
    for (const [index, pkg] of packages.entries()) {
        for (const dep of pkg.dependencies) {
            const dependency = packages.find(p => p.registry === pkg.registry && p.name === dep.name);
            if (dependency && changedIds.has(dependency.id)) {
                reports[index].dependencyReview.push({ name: dep.name, requiredVersion: dep.version,
                    dependencyHeadVersion: dependency.version, reason: 'Dependency has changes or lacks a baseline; decide whether this package needs its newer version.' });
            }
        }
        if (reports[index].status === 'unchanged' && reports[index].dependencyReview.length) reports[index].status = 'review';
    }
    return { schema: 1, head, dirty, baselinePolicy: 'Highest SemVer component tag reachable from HEAD, using local tags.',
        warnings: [...(dirty ? ['Uncommitted changes are excluded; this report covers committed HEAD only.'] : []),
            ...(git('rev-parse', '--is-shallow-repository').trim() === 'true' ? ['Shallow history: fetch complete history and tags before deciding release scope.'] : [])],
        packages: reports };
}
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('\n', ' ');
export function markdown(report) {
    const lines = ['# Release assessment', '', 'Commit: ' + report.head, '',
        'Advisory only: choose packages and versions explicitly before dispatch. ' + report.baselinePolicy, '',
        ...report.warnings.map(w => '**Warning: ' + escape(w) + '**'), '',
        '| Package | HEAD version | Channel | Baseline | Assessment |',
        '| --- | --- | --- | --- | --- |',
        ...report.packages.map(p => '| ' + [p.name, p.version, p.channel, p.baseline ?? 'No baseline', p.status].map(escape).join(' | ') + ' |'),
        '', 'changed = package content changed; review = build/dependency impact needs review; unchanged = no detected package content change; no-baseline = unknown.', ''];
    for (const pkg of report.packages) {
        lines.push('## ' + escape(pkg.name), '');
        for (const [kind, paths] of Object.entries(pkg.changes)) {
            if (paths.length) lines.push('- ' + kind + ': ' + paths.length + ' file(s): ' + paths.slice(0, 15).map(escape).join(', ') + (paths.length > 15 ? ' … (full list in JSON)' : ''));
        }
        for (const dep of pkg.dependencyChanges) lines.push('- Dependency ' + escape(dep.name) + ': ' + escape(JSON.stringify(dep.before)) + ' → ' + escape(JSON.stringify(dep.after)));
        for (const dep of pkg.dependencyReview) lines.push('- Review ' + escape(dep.name) + ': required ' + escape(dep.requiredVersion) + ', HEAD ' + escape(dep.dependencyHeadVersion) + '. ' + dep.reason);
        if (!pkg.baseline) lines.push('- No reachable release tag; no conclusion about released changes is possible.');
        lines.push('');
    }
    return lines.join('\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        if (args.some(a => a !== '--json' && a !== '--summary')) throw new Error('Usage: release:assess [--json] [--summary]');
        const report = assess(), rendered = markdown(report);
        console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : rendered);
        if (args.includes('--summary')) {
            if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('--summary requires GITHUB_STEP_SUMMARY.');
            appendFileSync(process.env.GITHUB_STEP_SUMMARY, rendered + '\n');
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
