import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { decodeFrameGraphSnapshot, validateFrameGraphSnapshot } from '@zenfg/snapshot';
import { build } from 'esbuild';

import { jsonDiff, normalizeProducerSnapshot } from './cross-language/normalize.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const outputDir = resolve(rootDir, '.test-dist', 'cross-language');
const typescriptRawDir = resolve(outputDir, 'raw', 'typescript');
const rustRawDir = resolve(outputDir, 'raw', 'rust');
const projectionsDir = resolve(outputDir, 'projections');
const producerRoot = resolve(rootDir, 'packages', 'snapshot', 'conformance', 'producers');
const differenceLimit = 20;

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(typescriptRawDir, { recursive: true });
mkdirSync(rustRawDir, { recursive: true });
mkdirSync(projectionsDir, { recursive: true });

let manifest;
try {
    manifest = JSON.parse(readFileSync(resolve(producerRoot, 'manifest.json'), 'utf8'));
} catch (error) {
    fail(`Could not read the producer manifest: ${errorMessage(error)}.`, 'manifest');
}

const bundlePath = resolve(outputDir, 'typescript-producer.mjs');
try {
    await build({
        entryPoints: [resolve(rootDir, 'packages', 'webgpu', 'tests', 'crossLanguageProducerCases.ts')],
        outfile: bundlePath,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node24',
        sourcemap: 'inline',
        logLevel: 'silent',
    });
} catch (error) {
    fail(`Could not build the TypeScript producer: ${errorMessage(error)}.`, 'typescript-build');
}

let producerModule;
try {
    producerModule = await import(`${pathToFileURL(bundlePath).href}?run=${Date.now()}`);
} catch (error) {
    fail(`Could not load the TypeScript producer: ${errorMessage(error)}.`, 'typescript-load');
}
const declaredCases = [...producerModule.CROSS_LANGUAGE_PRODUCER_CASES];
const manifestCases = manifest.cases.map((entry) => entry.name);
if (JSON.stringify(declaredCases) !== JSON.stringify(manifestCases)) {
    fail(
        `Producer case list does not match manifest: ${JSON.stringify(declaredCases)} vs ${JSON.stringify(manifestCases)}.`,
        'manifest',
    );
}

let firstSnapshots;
let secondSnapshots;
try {
    firstSnapshots = producerModule.createTypeScriptProducerSnapshots();
    secondSnapshots = producerModule.createTypeScriptProducerSnapshots();
} catch (error) {
    fail(`TypeScript producer threw while creating snapshots: ${errorMessage(error)}.`, 'typescript-producer');
}
for (const name of declaredCases) {
    const first = firstSnapshots.get(name);
    const second = secondSnapshots.get(name);
    if (first === undefined || second === undefined) {
        fail(`${name}: TypeScript producer did not return a Snapshot.`, 'typescript-producer');
    }
    const firstText = `${JSON.stringify(first, null, 2)}\n`;
    const secondText = `${JSON.stringify(second, null, 2)}\n`;
    writeFileSync(resolve(typescriptRawDir, snapshotFile(name)), firstText);
    writeProjection('typescript', name, first);
    if (firstText !== secondText) {
        writeJson(resolve(outputDir, 'raw', 'typescript-repeat', snapshotFile(name)), second);
        fail(`${name}: TypeScript producer is not deterministic.`, 'typescript-determinism');
    }
    assertTypeScriptAccepts(name, first, 'TypeScript');
}

const cargo = spawnSync('cargo', [
    'test',
    '-p',
    'zenfg',
    '--features',
    'snapshot',
    '--test',
    'cross_language_producers',
    '--',
    '--nocapture',
], {
    cwd: rootDir,
    env: { ...process.env, ZENFG_CROSS_LANGUAGE_OUTPUT_DIR: outputDir },
    stdio: 'inherit',
});
if (cargo.error) {
    writeAvailableRustProjections();
    fail(`Failed to start Rust producer test: ${cargo.error.message}`, 'rust-process');
}
if (cargo.status !== 0) {
    writeAvailableRustProjections();
    fail(`Rust producer test exited with status ${cargo.status ?? 'unknown'}.`, 'rust-producer');
}

const failures = [];
let differencesTruncated = false;
for (const entry of manifest.cases) {
    const name = entry.name;
    const typescriptSnapshot = readSnapshot(resolve(typescriptRawDir, snapshotFile(name)));
    const rustSnapshot = readSnapshot(resolve(rustRawDir, snapshotFile(name)));
    assertTypeScriptAccepts(name, rustSnapshot, 'Rust');

    const typescriptProjection = readProjection('typescript', name);
    const rustProjection = writeProjection('rust', name, rustSnapshot);

    const golden = readJson(resolve(producerRoot, entry.golden), `${name}-golden-read`);
    differencesTruncated = collectFailure(failures, name, 'typescript-vs-golden', golden, typescriptProjection)
        || differencesTruncated;
    differencesTruncated = collectFailure(failures, name, 'rust-vs-golden', golden, rustProjection)
        || differencesTruncated;
    differencesTruncated = collectFailure(failures, name, 'typescript-vs-rust', typescriptProjection, rustProjection)
        || differencesTruncated;
}

if (failures.length > 0) {
    writeJson(resolve(outputDir, 'diff.json'), {
        differenceLimit,
        differencesTruncated,
        failures,
    });
    for (const failure of failures) {
        console.error(`${failure.case} (${failure.comparison})`);
        for (const difference of failure.differences) {
            console.error(`  ${difference.path || '/'}: expected ${JSON.stringify(difference.expected)}, actual ${JSON.stringify(difference.actual)}`);
        }
    }
    console.error(`Cross-language conformance failed; artifacts remain in ${outputDir}.`);
    process.exit(1);
}

console.log(`Cross-language conformance passed for ${manifest.cases.length} mirrored producer cases.`);

function assertTypeScriptAccepts(name, snapshot, producer) {
    const issues = validateFrameGraphSnapshot(snapshot);
    if (issues.length > 0) {
        fail(
            `${name}: TypeScript validator rejected ${producer} output: ${JSON.stringify(issues)}`,
            `${producer.toLowerCase()}-typescript-validation`,
        );
    }
    const decoded = decodeFrameGraphSnapshot(snapshot);
    if (!decoded.ok || decoded.source !== 'v1' || decoded.migrated) {
        fail(
            `${name}: TypeScript decoder rejected ${producer} Snapshot V1 output: ${JSON.stringify(decoded)}`,
            `${producer.toLowerCase()}-typescript-decode`,
        );
    }
}

function collectFailure(failures, caseName, comparison, expected, actual) {
    const used = failures.reduce((count, failure) => count + failure.differences.length, 0);
    const remaining = Math.max(0, differenceLimit - used);
    if (remaining === 0) return jsonDiff(expected, actual, 1).length > 0;
    const differences = jsonDiff(expected, actual, remaining + 1);
    if (differences.length === 0) return false;
    failures.push({
        case: caseName,
        comparison,
        differences: differences.slice(0, remaining),
    });
    return differences.length > remaining;
}

function readSnapshot(path) {
    return readJson(path, 'snapshot-read');
}

function readJson(path, comparison) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        fail(`Could not read JSON ${path}: ${errorMessage(error)}.`, comparison);
    }
}

function readProjection(language, name) {
    const path = resolve(projectionsDir, language, projectionFile(name));
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        fail(`Could not read ${language} projection for ${name}: ${errorMessage(error)}.`, `${language}-projection-read`);
    }
}

function writeProjection(language, name, snapshot) {
    try {
        const projection = normalizeProducerSnapshot(name, snapshot);
        writeJson(resolve(projectionsDir, language, projectionFile(name)), projection);
        return projection;
    } catch (error) {
        fail(`Could not normalize ${language} producer case ${name}: ${errorMessage(error)}.`, `${language}-projection`);
    }
}

function writeAvailableRustProjections() {
    if (!manifest?.cases) return;
    for (const entry of manifest.cases) {
        const path = resolve(rustRawDir, snapshotFile(entry.name));
        if (!existsSync(path)) continue;
        try {
            const snapshot = JSON.parse(readFileSync(path, 'utf8'));
            const projection = normalizeProducerSnapshot(entry.name, snapshot);
            writeJson(resolve(projectionsDir, 'rust', projectionFile(entry.name)), projection);
        } catch {
            // Preserve every usable partial artifact without hiding the primary failure.
        }
    }
}

function writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function snapshotFile(name) {
    return `${name}.fgsnapshot.json`;
}

function projectionFile(name) {
    return `${name}.projection.json`;
}

function fail(message, comparison = 'harness') {
    writeJson(resolve(outputDir, 'diff.json'), {
        differenceLimit,
        differencesTruncated: false,
        failures: [{
            case: null,
            comparison,
            differences: [{ path: '', expected: 'success', actual: message }],
        }],
    });
    console.error(message);
    console.error(`Cross-language conformance failed; artifacts remain in ${outputDir}.`);
    process.exit(1);
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
