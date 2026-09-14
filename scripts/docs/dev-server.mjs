import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { root, pages, recipes, packages } from './catalog.mjs';

// Regenerate with a fresh process, then start a fresh VitePress search index.
// In-process Vite restarts retain VitePress's MiniSearch cache.
export async function serveDocs() {
    let child, timer, pending = false, busy = false, stopping = false;
    const watchers = [];
    function launch(args) {
        return spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
    }
    async function rebuild() {
        if (busy) { pending = true; return; }
        busy = true;
        if (child) { const ended = once(child, 'exit'); child.kill(); await ended; }
        if (stopping) return;
        child = launch([resolve(root, 'scripts/docs/prepare.mjs')]);
        const [code] = await once(child, 'exit');
        child = undefined;
        if (stopping) return;
        if (code === 0) {
            child = launch([resolve(root, 'node_modules/vitepress/bin/vitepress.js'), 'dev', 'apps/docs', '--host', '127.0.0.1', '--port', process.env.DOCS_DEV_PORT ?? '5174', '--strictPort']);
            child.on('error', fail);
            child.on('exit', code => { if (!busy && !stopping) fail(new Error(`Documentation server exited (${code}).`)); });
        } else console.error('Documentation generation failed; fix the source to retry.');
        busy = false;
        if (pending) { pending = false; await rebuild(); }
    }
    function changed() { clearTimeout(timer); timer = setTimeout(() => { void rebuild().catch(fail); }, 300); }
    function stop() { stopping = true; clearTimeout(timer); for (const watcher of watchers) watcher.close(); child?.kill(); }
    function fail(error) { console.error(error); process.exitCode = 1; stop(); }
    const files = [...pages, ...recipes].map(p => p.source);
    files.push('package.json', 'Cargo.toml', ...packages.map(p => `${p.directory}/${p.registry === 'npm' ? 'package.json' : 'Cargo.toml'}`));
    // Watch parent directories so atomic editor saves remain observable.
    const byDirectory = new Map();
    for (const file of new Set(files)) {
        const path = resolve(root, file), directory = resolve(path, '..');
        if (!byDirectory.has(directory)) byDirectory.set(directory, new Set());
        byDirectory.get(directory).add(path);
    }
    for (const [directory, paths] of byDirectory) watchers.push(watch(directory, (_, name) => { if (!name || paths.has(resolve(directory, String(name)))) changed(); }));
    for (const p of packages) watchers.push(watch(resolve(root, p.directory, 'src'), { recursive: true }, changed));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
    await rebuild();
    return stop;
}
