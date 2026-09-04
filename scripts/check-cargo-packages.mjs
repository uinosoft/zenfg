import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const packageDirectory = resolve(rootDir, 'target/package');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'zenfg-cargo-package-check-'));

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: 'inherit',
        ...options,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}.`);
    }
}

function capture(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        ...options,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}.`);
    }
    return result.stdout;
}

const cargoMetadata = JSON.parse(capture(
    'cargo',
    ['metadata', '--format-version', '1', '--no-deps'],
));

function crateInfo(name) {
    const packageMetadata = cargoMetadata.packages.find((candidate) => candidate.name === name);
    if (!packageMetadata) {
        throw new Error(`Cargo metadata does not contain the ${name} package.`);
    }
    return {
        name,
        version: packageMetadata.version,
        archiveRoot: `${name}-${packageMetadata.version}`,
    };
}

function cratePath(crate) {
    const path = resolve(packageDirectory, `${crate.archiveRoot}.crate`);
    if (!existsSync(path)) {
        throw new Error(`Cargo did not create ${path}.`);
    }
    return path;
}

const snapshotCrate = crateInfo('zenfg-snapshot');
const runtimeCrate = crateInfo('zenfg');

try {
    run('cargo', ['package', '-p', 'zenfg-snapshot', '--locked', '--allow-dirty']);

    // The runtime's optional protocol dependency is intentionally unpublished
    // during the bootstrap release. Assemble the exact archive without registry
    // verification, then compile that archive with a local crates.io patch.
    run('cargo', [
        'package',
        '-p',
        'zenfg',
        '--no-verify',
        '--exclude-lockfile',
        '--allow-dirty',
    ]);

    for (const [crate, requiredFiles] of [
        [snapshotCrate, [
            'Cargo.toml',
            'LICENSE',
            'README.md',
            'examples/basic.rs',
            'src/lib.rs',
        ]],
        [runtimeCrate, [
            'Cargo.toml',
            'LICENSE',
            'README.md',
            'examples/external_submission.rs',
            'examples/gpu_timing.rs',
            'examples/compute_output.rs',
            'examples/imported_resource.rs',
            'examples/minimal_frame.rs',
            'examples/persistent_state.rs',
            'examples/snapshot_export.rs',
            'examples/transient_to_present.rs',
            'src/lib.rs',
        ]],
    ]) {
        const archive = cratePath(crate);
        const listing = spawnSync('tar', ['-tf', archive], {
            cwd: rootDir,
            encoding: 'utf8',
        });
        if (listing.error) {
            throw listing.error;
        }
        if (listing.status !== 0) {
            throw new Error(`Could not inspect ${archive}.`);
        }
        const files = new Set(listing.stdout.split(/\r?\n/u));
        for (const requiredFile of requiredFiles) {
            const archivedPath = `${crate.archiveRoot}/${requiredFile}`;
            if (!files.has(archivedPath)) {
                throw new Error(`${archive} is missing ${requiredFile}.`);
            }
        }
        run('tar', ['-xzf', archive, '-C', temporaryDirectory]);
    }

    const snapshotDirectory = join(temporaryDirectory, snapshotCrate.archiveRoot);
    run('cargo', [
        'check',
        '--manifest-path',
        join(snapshotDirectory, 'Cargo.toml'),
        '--example',
        'basic',
    ], {
        cwd: snapshotDirectory,
        env: {
            ...process.env,
            CARGO_TARGET_DIR: join(temporaryDirectory, 'target'),
            RUSTUP_TOOLCHAIN: '1.98.0',
        },
    });

    const runtimeDirectory = join(temporaryDirectory, runtimeCrate.archiveRoot);
    const cargoConfigDirectory = join(runtimeDirectory, '.cargo');
    mkdirSync(cargoConfigDirectory, { recursive: true });
    const snapshotPath = join(temporaryDirectory, snapshotCrate.archiveRoot).replaceAll('\\', '/');
    writeFileSync(
        join(cargoConfigDirectory, 'config.toml'),
        `[patch.crates-io]\nzenfg-snapshot = { path = ${JSON.stringify(snapshotPath)} }\n`,
    );
    run('cargo', [
        'check',
        '--manifest-path',
        join(runtimeDirectory, 'Cargo.toml'),
        '--all-features',
        '--examples',
    ], {
        cwd: runtimeDirectory,
        env: {
            ...process.env,
            CARGO_TARGET_DIR: join(temporaryDirectory, 'target'),
            RUSTUP_TOOLCHAIN: '1.98.0',
        },
    });
    process.stdout.write(
        'Verified both crate archives and their public examples outside the workspace.\n',
    );
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
}
