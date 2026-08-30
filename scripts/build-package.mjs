import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const packagesDir = resolve(rootDir, 'packages');
const packageDir = resolve(process.cwd());
const relativePackageDir = relative(packagesDir, packageDir);
const watch = process.argv.includes('--watch');
const unexpectedArgs = process.argv.slice(2).filter((arg) => arg !== '--watch');

if (
    !relativePackageDir
    || relativePackageDir.startsWith('..')
    || isAbsolute(relativePackageDir)
    || relativePackageDir.includes(sep)
) {
    console.error('Package builds must run from a direct child of the workspace packages directory.');
    process.exit(1);
}

if (unexpectedArgs.length > 0) {
    console.error(`Unsupported package build arguments: ${unexpectedArgs.join(' ')}`);
    process.exit(1);
}

const packageJsonPath = resolve(packageDir, 'package.json');
const buildConfigPath = resolve(packageDir, 'tsconfig.build.json');
if (!existsSync(packageJsonPath) || !existsSync(buildConfigPath)) {
    console.error(`Missing package.json or tsconfig.build.json in ${packageDir}.`);
    process.exit(1);
}

const outDir = resolve(packageDir, 'dist');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const tscPath = resolve(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [
    tscPath,
    '--project',
    buildConfigPath,
    ...(watch ? ['--watch', '--preserveWatchOutput'] : []),
], {
    cwd: packageDir,
    stdio: 'inherit',
});

if (result.error) {
    console.error(result.error);
    process.exit(1);
}

process.exit(result.status ?? 1);
