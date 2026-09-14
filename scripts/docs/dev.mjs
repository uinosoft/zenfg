import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
process.env.SITE_BASE = '/';
process.env.DOCS_MODE = 'development';
const { serveDocs } = await import('./dev-server.mjs');
process.chdir(root);
const stopDocs = await serveDocs();
const children = [
    spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'apps/site', '--host', '127.0.0.1', '--port', process.env.SITE_DEV_PORT ?? '5173', '--strictPort'], { stdio: 'inherit', env: process.env }),
];
let stopping = false;
function stop(code) { if (stopping) return; stopping = true; process.exitCode = code; stopDocs(); for (const child of children) child.kill(); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
for (const child of children) { child.on('error', error => { console.error(error); stop(1); }); child.on('exit', code => stop(code ?? 1)); }
