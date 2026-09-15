import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import { catalog, root, read, json, hash, repository, selectPackages, assertContext, validateSelection,
    assertNotes, assertResume, assertChannelAdvance, getJson } from './core.mjs';
import { output, run, npm, writeJson, archivePath, checkFiles, clean, cargoArchive, listFiles, progress } from './io.mjs';
import { consumer } from './consumer.mjs';
import { waitForVersion, publishNpmPackages, publishCargoPackages } from './publication.mjs';

const command = process.argv[2];
const inputs = JSON.parse(process.env.RELEASE_INPUTS ?? '{}');
const packages = catalog();
const manifestPath = join(output, 'manifest.json');
const sha = () => run('git', ['rev-parse', 'HEAD']);
const selected = () => selectPackages(packages, inputs);
const cargoTarget = resolve(root, 'target/release-build');

function staticCheck() {
    const lock = json('package-lock.json');
    const cargoLock = parse(read('Cargo.lock'));
    for (const pkg of packages) {
        if (pkg.registry === 'npm') {
            const manifest = json(pkg.directory + '/package.json');
            if (manifest.private || manifest.publishConfig?.access !== 'public'
                || manifest.publishConfig.registry !== 'https://registry.npmjs.org/'
                || manifest.repository?.url !== 'git+https://github.com/' + repository + '.git') throw new Error('Invalid publication metadata: ' + pkg.name);
            if (lock.packages[pkg.directory]?.version !== pkg.version
                || JSON.stringify(lock.packages[pkg.directory]?.dependencies ?? {}) !== JSON.stringify(manifest.dependencies ?? {})) {
                throw new Error('package-lock.json drift: ' + pkg.name);
            }
        } else if (!cargoLock.package.some(p => p.name === pkg.name && p.version === pkg.version && !p.source)) {
            throw new Error('Cargo.lock drift: ' + pkg.name);
        }
    }
    const unreleased = read('CHANGELOG.md').match(/^## (?:Unreleased|\[Unreleased\])$/gmu) ?? [];
    if (unreleased.length !== 1) throw new Error('CHANGELOG must contain exactly one Unreleased section.');
    console.log('Static release preflight passed (independent versions; no registry availability requirement).');
}
function context() { assertContext(process.env, sha()); }
function manifest() {
    context();
    const value = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assertResume(value, { sha: sha(), runId: process.env.GITHUB_RUN_ID, ids: selected().map(p => p.id) });
    for (const pkg of value.packages) {
        const expected = packages.find(p => p.id === pkg.id);
        for (const key of Object.keys(expected)) {
            if (JSON.stringify(pkg[key]) !== JSON.stringify(expected[key])) throw new Error('Candidate metadata changed: ' + key);
        }
        checkFiles(pkg);
        if (hash(readFileSync(archivePath(pkg.notesFile))) !== pkg.notesSha256) throw new Error('Release notes checksum mismatch.');
    }
    return value;
}
function summary(value) {
    const lines = ['## Release candidate', '', 'Commit: ' + value.sha, '', '| Package | Version | Channel | SHA-256 |',
        '| --- | --- | --- | --- |', ...value.packages.map(p => '| ' + p.name + ' | ' + p.version + ' | '
            + (p.registry === 'npm' ? p.channel : 'crates.io') + ' | ' + p.sha256 + ' |'),
        '', 'Review the release-candidate artifact, notes, file lists and consumer reports before approving release.',
        'Stable npm packages enter latest immediately when published.'];
    const text = lines.join('\n') + '\n';
    writeFileSync(join(output, 'summary.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
async function restore() {
    context();
    const pages = JSON.parse(run('gh', ['api', 'repos/' + repository + '/actions/runs/' + process.env.GITHUB_RUN_ID + '/artifacts?per_page=100', '--paginate', '--slurp']));
    const artifact = pages.flatMap(page => page.artifacts).find(a => a.name === 'release-candidate');
    if (artifact?.expired) throw new Error('Original candidate expired. Do not reconstruct a partially published release.');
    if (artifact) {
        const restored = mkdtempSync(resolve(root, 'target/release-restore-'));
        run('gh', ['run', 'download', process.env.GITHUB_RUN_ID, '--repo', repository, '--name', 'release-candidate', '--dir', restored]);
        cpSync(restored, output, { recursive: true });
        const value = manifest();
        summary(value);
    }
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'restored=' + Boolean(artifact) + '\n');
}
function cargoArgs(items, dryRun) {
    return ['publish', ...(dryRun ? ['--dry-run'] : []), '--locked', '--all-features', '--registry', 'crates-io',
        '--target-dir', cargoTarget, ...items.flatMap(p => ['-p', p.name])];
}
async function prepare() {
    context();
    clean();
    staticCheck();
    const items = selected();
    await validateSelection(items);
    for (const pkg of items.filter(p => p.registry === "npm")) await checkChannel(pkg);
    for (const pkg of items) assertNotes(read(pkg.notes), pkg);
    const value = { schema: 1, sha: sha(), runId: process.env.GITHUB_RUN_ID, packages: items,
        toolchains: { node: process.version, npm: npm(['--version']), cargo: run('cargo', ['--version']) } };
    mkdirSync(output, { recursive: true });
    for (const pkg of items.filter(p => p.registry === 'npm')) {
        const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', output], { cwd: resolve(root, pkg.directory) }))[0];
        pkg.archive = packed.filename;
        pkg.files = packed.files.map(f => f.path);
        const bytes = readFileSync(archivePath(pkg.archive));
        pkg.sha256 = hash(bytes);
        pkg.integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
        pkg.bytes = bytes.length;
        npm(['publish', archivePath(pkg.archive), '--dry-run', '--ignore-scripts', '--access', 'public', '--tag', pkg.channel]);
    }
    const crates = items.filter(p => p.registry === 'cargo');
    if (crates.length) {
        run('cargo', cargoArgs(crates, true));
        for (const pkg of crates) {
            pkg.archive = pkg.name + '-' + pkg.version + '.crate';
            copyFileSync(cargoArchive(pkg, cargoTarget), archivePath(pkg.archive));
            pkg.files = listFiles(archivePath(pkg.archive));
            const prefix = pkg.name + '-' + pkg.version + '/';
            for (const file of ['Cargo.toml', 'Cargo.lock', '.cargo_vcs_info.json', 'LICENSE', 'README.md', 'src/lib.rs']) {
                if (!pkg.files.includes(prefix + file)) throw new Error('Missing crate file: ' + file);
            }
            const bytes = readFileSync(archivePath(pkg.archive));
            pkg.sha256 = hash(bytes);
            pkg.bytes = bytes.length;
        }
    }
    for (const pkg of items) {
        pkg.notesFile = pkg.id + '-notes.md';
        copyFileSync(resolve(root, pkg.notes), archivePath(pkg.notesFile));
        pkg.notesSha256 = hash(readFileSync(archivePath(pkg.notesFile)));
    }
    await consumer(items, 'candidate');
    clean();
    writeJson(manifestPath, value);
    summary(value);
}
async function checkChannel(pkg) {
    const tags = await getJson("https://registry.npmjs.org/-/package/" + encodeURIComponent(pkg.name) + "/dist-tags");
    assertChannelAdvance(pkg, tags);
}
async function publishNpm(ids) {
    const value = manifest();
    clean();
    await publishNpmPackages(value.packages.filter(p => ids.includes(p.id)), {
        checkChannel, emit: progress,
        upload: pkg => npm(["publish", archivePath(pkg.archive), "--ignore-scripts", "--access", "public", "--tag", pkg.channel, "--registry=https://registry.npmjs.org/"]),
    });
}
async function publishCargo() {
    const value = manifest();
    clean();
    const checkArchives = items => {
        for (const pkg of items) if (hash(readFileSync(cargoArchive(pkg, cargoTarget))) !== pkg.sha256) {
            throw new Error("Cargo archive differs from candidate: " + pkg.name);
        }
    };
    await publishCargoPackages(value.packages.filter(p => p.registry === "cargo"), {
        emit: progress,
        prepare: items => { run("cargo", cargoArgs(items, true)); checkArchives(items); },
        upload: items => run("cargo", cargoArgs(items, false)),
        checkArchives,
    });
}
async function verify() {
    const value = manifest();
    const receipts = [];
    for (const pkg of value.packages) {
        const metadata = await waitForVersion(pkg, { emit: progress });
        const url = pkg.registry === 'npm' ? metadata.dist.tarball
            : 'https://static.crates.io/crates/' + pkg.name + '/' + pkg.name + '-' + pkg.version + '.crate';
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== pkg.sha256) throw new Error('Downloaded registry artifact mismatch: ' + pkg.name);
        if (pkg.registry === 'npm') {
            const tags = await getJson('https://registry.npmjs.org/-/package/' + encodeURIComponent(pkg.name) + '/dist-tags');
            if (tags[pkg.channel] !== pkg.version) throw new Error('Unexpected npm ' + pkg.channel + ': ' + pkg.name + '. OIDC cannot repair dist-tags; inspect manually.');
            if (!metadata.dist.attestations) throw new Error('Missing npm provenance metadata: ' + pkg.name);
        }
        receipts.push({ name: pkg.name, version: pkg.version, sha256: pkg.sha256 });
    }
    await consumer(value.packages, 'registry');
    writeJson(join(output, 'verified.json'), { status: 'passed', sha: value.sha, runId: value.runId, receipts });
}
async function finalize() {
    const value = manifest();
    const verified = JSON.parse(readFileSync(join(output, 'verified.json'), 'utf8'));
    if (verified.status !== 'passed' || verified.sha !== value.sha || verified.runId !== value.runId
        || JSON.stringify(verified.receipts) !== JSON.stringify(value.packages.map(p => ({ name: p.name, version: p.version, sha256: p.sha256 })))) {
        throw new Error('Missing matching registry verification.');
    }
    const releases = JSON.parse(run('gh', ['api', 'repos/' + repository + '/releases?per_page=100', '--paginate', '--slurp'])).flat();
    for (const pkg of value.packages) {
        const remote = run('git', ['ls-remote', '--tags', 'origin', 'refs/tags/' + pkg.tag, 'refs/tags/' + pkg.tag + '^{}']);
        const refs = remote.split('\n').filter(Boolean);
        const commit = (refs.find(line => line.endsWith('^{}')) ?? refs[0])?.split(/\s/u)[0];
        if (commit && commit !== value.sha) throw new Error('Existing tag points at another commit: ' + pkg.tag);
        const existing = releases.find(r => r.tag_name === pkg.tag);
        const marker = 'Commit: ' + value.sha + '\nArtifact SHA-256: ' + pkg.sha256;
        if (existing?.draft && !existing.body?.includes(marker)) throw new Error('Existing draft belongs to a different candidate: ' + pkg.tag);
        if (existing && !existing.draft) {
            const published = JSON.parse(run('gh', ['api', 'repos/' + repository + '/releases/tags/' + encodeURIComponent(pkg.tag)]));
            if (!published.body?.includes(marker) || !published.assets.some(a => a.name === pkg.archive && a.digest === 'sha256:' + pkg.sha256)) {
                throw new Error('Existing release does not match candidate: ' + pkg.tag);
            }
            continue;
        }
        if (!commit) {
            const refPath = join(output, pkg.id + '-tag.json');
            writeJson(refPath, { ref: 'refs/tags/' + pkg.tag, sha: value.sha });
            run('gh', ['api', 'repos/' + repository + '/git/refs', '--method', 'POST', '--input', refPath]);
        }
        const notesPath = join(output, pkg.id + '-github-notes.md');
        writeFileSync(notesPath, readFileSync(archivePath(pkg.notesFile), 'utf8') + '\n' + marker + '\n');
        if (!existing) {
            run('gh', ['release', 'create', pkg.tag, '--repo', repository, '--target', value.sha, '--draft',
                '--title', pkg.name + '@' + pkg.version, '--notes-file', notesPath, ...(pkg.channel === 'next' ? ['--prerelease'] : [])]);
        } else {
            run('gh', ['release', 'edit', pkg.tag, '--repo', repository, '--notes-file', notesPath]);
        }
        run('gh', ['release', 'upload', pkg.tag, '--repo', repository, '--clobber', archivePath(pkg.archive), manifestPath, join(output, 'verified.json')]);
        run('gh', ['release', 'edit', pkg.tag, '--repo', repository, '--draft=false', '--latest=false']);
    }
}
try {
    if ((command?.startsWith('publish-') || command === 'finalize') && inputs.dry_run !== false) {
        throw new Error('Publishing is disabled unless dry_run is explicitly false.');
    }
    if (command === 'static') staticCheck();
    else if (command === 'restore') await restore();
    else if (command === 'prepare') await prepare();
    else if (command === 'validate') manifest();
    else if (command === 'publish-snapshot') await publishNpm(['npm_snapshot']);
    else if (command === 'publish-cargo') await publishCargo();
    else if (command === 'publish-npm') await publishNpm(['npm_webgpu', 'npm_inspector']);
    else if (command === 'verify') await verify();
    else if (command === 'finalize') await finalize();
    else throw new Error('Unknown release command: ' + command);
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
