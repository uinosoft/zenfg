import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const roots = ['packages', 'crates', 'apps'];
const excludedDirectories = new Set(['dist', 'target', '.test-dist', '.benchmark-dist', 'node_modules']);

function collectFiles(directory, files = []) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
            continue;
        }
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            collectFiles(path, files);
        } else if (entry.isFile()) {
            files.push(path);
        }
    }
    return files;
}

const files = roots
    .flatMap((directory) => collectFiles(resolve(rootDir, directory)))
    .map((path) => ({
        path: relative(rootDir, path).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

const manifest = {
    schemaVersion: 1,
    generatedBy: 'scripts/write-migration-manifest.mjs',
    sources: {
        typescript: {
            repository: 't3d-next',
            commit: '287ff8c26e018d0905fddf1389181424934d8a3c',
        },
        rust: {
            repository: 'zen-proto',
            commit: '5b8bc75809085195eb386259edd61aacb420e9d0',
        },
    },
    exclusions: [...excludedDirectories].sort(),
    files,
};

writeFileSync(
    resolve(rootDir, 'docs/migration-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(`Recorded ${files.length} migrated source and fixture files.\n`);
