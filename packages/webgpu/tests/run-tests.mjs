import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packageDir = resolve(import.meta.dirname, '..');
const outDir = resolve(packageDir, '..', '..', '.test-dist', 'frame-graph');
const requestedTestPaths = process.argv.slice(2).map((path) => resolve(packageDir, path));
const testPaths = requestedTestPaths.length > 0
	? requestedTestPaths
	: [resolve(packageDir, 'tests')];

function collectTestFiles(path) {
	let stats;
	try {
		stats = statSync(path);
	}
	catch {
		return [];
	}
	if (stats.isFile()) {
		return path.endsWith('.test.ts') ? [path] : [];
	}
	if (!stats.isDirectory()) {
		return [];
	}

	const entries = readdirSync(path, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = join(path, entry.name);
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

const entryPoints = testPaths.flatMap((path) => collectTestFiles(path));
if (entryPoints.length === 0) {
	console.error('No test files were found in the configured frame-graph test paths.');
	process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
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
});

const compiledTests = readdirSync(outDir)
	.filter((file) => file.endsWith('.cjs'))
	.map((file) => join(outDir, file));

const result = spawnSync(process.execPath, ['--test', ...compiledTests], {
	cwd: resolve(packageDir, '..', '..'),
	stdio: 'inherit',
});

process.exit(result.status ?? 1);
