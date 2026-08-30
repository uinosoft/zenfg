import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const rootDir = resolve(import.meta.dirname, '..');
const outputDir = resolve(rootDir, '.benchmark-dist');
const outputFile = resolve(outputDir, 'webgpu-compile-benchmark.mjs');

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

try {
    await build({
        entryPoints: [resolve(rootDir, 'packages/webgpu/benchmarks/cli.ts')],
        outfile: outputFile,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node24',
        sourcemap: true,
    });

    const result = spawnSync(process.execPath, [outputFile, ...process.argv.slice(2)], {
        cwd: rootDir,
        env: {
            ...process.env,
            FRAME_GRAPH_COMPILE_BENCHMARK_ROOT: rootDir,
        },
        stdio: 'inherit',
    });
    if (result.error) {
        throw result.error;
    }
    process.exitCode = result.status ?? 1;
} finally {
    rmSync(outputDir, { recursive: true, force: true });
}
