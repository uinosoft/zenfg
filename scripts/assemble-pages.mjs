import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const outputDir = resolve(rootDir, '.pages');
const siteDist = resolve(rootDir, 'apps', 'site', 'dist');
const inspectorDist = resolve(rootDir, 'apps', 'inspector', 'dist');
const playgroundDist = resolve(rootDir, 'apps', 'playground', 'dist');

async function requireDirectory(path, label) {
	try {
		if ((await stat(path)).isDirectory()) return;
	} catch {
		// Report the same actionable error for missing and unreadable output.
	}

	throw new Error(`${label} build output is missing. Run npm run build first.`);
}

await Promise.all([
	requireDirectory(siteDist, 'Project site'),
	requireDirectory(inspectorDist, 'Inspector'),
	requireDirectory(playgroundDist, 'Playground'),
]);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(siteDist, outputDir, { recursive: true });
await cp(inspectorDist, resolve(outputDir, 'inspector'), { recursive: true });
await cp(playgroundDist, resolve(outputDir, 'playground'), { recursive: true });

await Promise.all([
	stat(resolve(outputDir, 'index.html')),
	stat(resolve(outputDir, 'inspector', 'index.html')),
	stat(resolve(outputDir, 'playground', 'index.html')),
]);

console.log('Assembled GitHub Pages output in .pages/');
