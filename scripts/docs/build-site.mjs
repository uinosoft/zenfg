import { spawnSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, siteBase } from './catalog.mjs';
process.env.SITE_BASE = siteBase();
function run(args) {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
run([resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'apps/site/vite.config.ts', 'apps/site']);
run(['scripts/docs/run.mjs', 'build']);
const source = resolve(root, 'apps/docs/dist');
if (!existsSync(source)) throw new Error('Documentation output is missing.');
cpSync(source, resolve(root, 'apps/site/dist/docs'), { recursive: true });
run(['scripts/docs/check.mjs', '--built']);
