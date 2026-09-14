import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const outputRoot = join(rootDir, 'target', 'release-validation');
mkdirSync(outputRoot, { recursive: true });
const outputDir = mkdtempSync(join(outputRoot, 'zenfg-'));
const logPath = join(outputDir, 'commands.log');
const reportPath = join(outputDir, 'result.json');
const report = { status: 'failed', startedAt: new Date().toISOString(), commands: [] };

function run(command, args) {
    report.commands.push({ command, args });
    console.log(`> ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    appendFileSync(logPath, `> ${command} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}\n`);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
    return result.stdout;
}

try {
    if (process.argv.length > 2) throw new Error('This release gate does not accept extra arguments.');
    report.commit = run('git', ['rev-parse', 'HEAD']).trim();
    report.worktreeStatus = run('git', ['status', '--porcelain', '--untracked-files=no']).trim();
    report.cargoVersion = run('cargo', ['--version']).trim();
    const metadata = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--no-deps']));
    const runtime = metadata.packages.find(({ name }) => name === 'zenfg');
    if (!runtime) throw new Error('Workspace metadata is missing zenfg.');
    report.version = runtime.version;
    report.snapshotRequirement = runtime.dependencies.find(({ name }) => name === 'zenfg-snapshot')?.req;

    // Cargo verifies the registry-resolved archive itself, including Snapshot.
    // Never use bootstrap flags, a local patch, or --allow-dirty in this gate.
    run('cargo', [
        'publish', '--dry-run', '--locked', '-p', 'zenfg', '--all-features',
        '--registry', 'crates-io', '--target-dir', outputDir,
    ]);
    const archiveRoot = `zenfg-${runtime.version}`;
    // Cargo 1.98 publish keeps its dry-run archive in tmp-crate; ordinary
    // package output uses package/. Both locations belong to this unique run.
    const generatedArchive = [
        join(outputDir, 'package', 'tmp-crate', `${archiveRoot}.crate`),
        join(outputDir, 'package', `${archiveRoot}.crate`),
    ].find(existsSync);
    if (!generatedArchive) throw new Error('Cargo did not retain the final dry-run archive.');
    const archive = join(outputDir, `${archiveRoot}.crate`);
    copyFileSync(generatedArchive, archive);
    const files = run('tar', ['-tf', archive]).trim().split(/\r?\n/u);
    for (const required of ['Cargo.toml', 'Cargo.lock', '.cargo_vcs_info.json', 'src/lib.rs']) {
        if (!files.includes(`${archiveRoot}/${required}`)) {
            throw new Error(`Final archive is missing ${required}.`);
        }
    }
    const bytes = readFileSync(archive);
    report.archive = { path: archive, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files };
    report.status = 'passed';
} catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    console.error(`Final release validation failed: ${report.error}`);
    process.exitCode = 1;
} finally {
    report.finishedAt = new Date().toISOString();
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Release validation ${report.status}; report: ${reportPath}`);
}
