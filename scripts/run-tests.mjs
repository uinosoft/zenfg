import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

const outDir = resolve(rootDir, '.test-dist', 'tests');
const defaultTestRoots = [
	resolve(rootDir, 'packages', 'webgpu', 'tests'),
	resolve(rootDir, 'packages', 'snapshot', 'tests'),
	resolve(rootDir, 'packages', 'inspector', 'tests'),
	resolve(rootDir, 'apps', 'inspector', 'tests'),
];
const requestedTestRoots = process.argv.slice(2).map((path) => resolve(rootDir, path));
const testRoots = requestedTestRoots.length > 0 ? requestedTestRoots : defaultTestRoots;

const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmArgsPrefix = npmExecPath ? [npmExecPath] : [];
const packageBuild = spawnSync(npmCommand, [
    ...npmArgsPrefix,
    'run',
    'build:packages',
], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: !npmExecPath && process.platform === 'win32',
});

if (packageBuild.error) {
    console.error(packageBuild.error);
    process.exit(1);
}
if (packageBuild.status !== 0) {
    process.exit(packageBuild.status ?? 1);
}

function collectTestFiles(dir) {
    try {
        if (!statSync(dir).isDirectory()) {
            return [];
        }
    }
    catch {
        return [];
    }

    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTestFiles(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith('.test.ts')) {
            files.push(fullPath);
        }
    }

    return files;
}

function collectCompiledTestFiles(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectCompiledTestFiles(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith('.cjs')) {
            files.push(fullPath);
        }
    }

    return files;
}

const entryPoints = testRoots.flatMap((dir) => collectTestFiles(dir));
if (entryPoints.length === 0) {
    console.error('No test files were found in the configured test roots.');
    process.exit(1);
}

rmSync(resolve(rootDir, '.test-dist'), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
    entryPoints,
    outdir: outDir,
    bundle: true,
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    target: 'node24',
    sourcemap: 'inline',
    logLevel: 'silent',
    plugins: [{
        name: 'vite-url-test-stub',
        setup(buildContext) {
            buildContext.onResolve({ filter: /\?url$/ }, (args) => ({
                path: args.path,
                namespace: 'vite-url-test-stub',
            }));
            buildContext.onLoad({ filter: /.*/, namespace: 'vite-url-test-stub' }, () => ({
                contents: 'export default "test-asset-url";',
                loader: 'js',
            }));
        },
	}],
});

const compiledTests = collectCompiledTestFiles(outDir)
    .filter((file) => statSync(file).isFile());

const result = spawnSync(process.execPath, ['--test', ...compiledTests], {
    cwd: rootDir,
    stdio: 'inherit',
});

process.exit(result.status ?? 1);
