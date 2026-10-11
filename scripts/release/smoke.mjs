// Local/PR artifact smoke tests. This command never uploads or creates a release manifest.
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalog, root } from './core.mjs';
import { output, run, cargoArchive, archivePath } from './io.mjs';
import { consumer } from './consumer.mjs';
import { packPackage } from '../package-manager.mjs';

const registry = process.argv[2];
if (!['npm', 'cargo', 'all'].includes(registry)) throw new Error('Expected npm, cargo or all.');
const packages = catalog().filter(p => registry === 'all' || p.registry === registry);
mkdirSync(output, { recursive: true });
if (registry !== 'cargo') {
    for (const pkg of packages.filter(p => p.registry === 'npm')) {
        const result = packPackage(resolve(root, pkg.directory), output, run);
        pkg.archive = result.filename;
    }
}
if (registry !== 'npm') {
    const crates = packages.filter(p => p.registry === 'cargo');
    const target = resolve(root, 'target/release-smoke-cargo');
    run('cargo', ['publish', '--dry-run', '--locked', '--all-features', '--allow-dirty', '--target-dir', target,
        ...crates.flatMap(p => ['-p', p.name])]);
    for (const pkg of crates) {
        pkg.archive = pkg.name + '-' + pkg.version + '.crate';
        copyFileSync(cargoArchive(pkg, target), archivePath(pkg.archive));
    }
}
await consumer(packages, 'candidate');
console.log(registry + ' release artifact consumers passed.');
