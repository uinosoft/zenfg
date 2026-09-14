import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const mode = process.argv[2] ?? 'build';
if (!['build', 'dev'].includes(mode)) throw new Error(`Unknown docs command ${mode}`);
process.env.SITE_BASE ??= mode === 'dev' ? '/' : '/zenfg/';
process.env.DOCS_MODE = mode === 'dev' ? 'development' : 'production';
if (mode === 'dev') {
    const { serveDocs } = await import('./dev-server.mjs');
    await serveDocs();
} else {
    const { prepare } = await import('./prepare.mjs');
    process.chdir(root);
    await prepare();
    const child = spawn(process.execPath, [resolve(root, 'node_modules/vitepress/bin/vitepress.js'), mode, 'apps/docs'], { cwd: root, stdio: 'inherit', env: process.env });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', error => { console.error(error); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });

}
