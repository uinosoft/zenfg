import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { parse } from 'smol-toml';
import { root, json, read } from './core.mjs';
import { archivePath, listFiles, npm, run, writeJson, output } from './io.mjs';
import { assertLocalLinks, quickStart } from '../docs/markdown.mjs';

export async function consumer(packages, mode) {
    const dir = mkdtempSync(join(tmpdir(), 'zenfg-release-consumer-'));
    const js = packages.filter(p => p.registry === 'npm');
    const rust = packages.filter(p => p.registry === 'cargo');
    const samples = join(dir, 'samples');
    mkdirSync(samples);
    try {
        if (js.length) {
            const tsVersion = json('package-lock.json').packages['node_modules/typescript'].version;
            writeJson(join(dir, 'package.json'), { private: true, type: 'module' });
            npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org',
                'typescript@' + tsVersion, ...js.map(p => mode === 'registry' ? p.name + '@' + p.version : archivePath(p.archive))], { cwd: dir });
            const smoke = ['import { readFileSync, writeFileSync, readdirSync } from "node:fs";'];
            const types = [];
            const examples = join(dir, 'examples');
            mkdirSync(examples);
            for (const p of js) {
                const installed = join(dir, 'node_modules', ...p.name.split('/'));
                const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
                if (manifest.version !== p.version) throw new Error('Consumer resolved wrong version of ' + p.name);
                assertLocalLinks(installed);
                for (const [subpath, target] of Object.entries(manifest.exports)) {
                    if (typeof target !== 'object' || !target.import) continue;
                    const spec = p.name + (subpath === '.' ? '' : subpath.slice(1));
                    smoke.push('await import(' + JSON.stringify(spec) + ');');
                    types.push('import ' + JSON.stringify(spec) + ';');
                }
                const setup = p.slug === 'webgpu' ? 'declare const device: GPUDevice;\ndeclare const context: GPUCanvasContext;\n' : '';
                writeFileSync(join(examples, 'readme-' + p.slug + '.ts'), setup + quickStart(readFileSync(join(installed, 'README.md'), 'utf8').replaceAll('\r\n', '\n')));
                if (p.slug === 'webgpu') {
                    for (const file of readdirSync(join(installed, 'examples')).filter(f => f.endsWith('.ts'))) {
                        copyFileSync(join(installed, 'examples', file), join(examples, file));
                    }
                }
                if (p.slug === 'inspector') {
                    smoke.push('if (!readFileSync(new URL(import.meta.resolve("@zenfg/inspector/themes.css")), "utf8").includes("data-zfgi-theme")) throw new Error("Missing Inspector themes");');
                }
            }
            writeFileSync(join(dir, 'index.ts'), types.join('\n'));
            writeJson(join(dir, 'tsconfig.json'), { compilerOptions: { module: 'ESNext', target: 'ES2022', moduleResolution: 'Bundler',
                lib: ['DOM', 'ES2022'], types: [], strict: true, skipLibCheck: false, resolveJsonModule: true, noEmit: true },
                include: ['index.ts', 'examples/**/*.ts'] });
            run(process.execPath, [join(dir, 'node_modules/typescript/bin/tsc'), '-p', join(dir, 'tsconfig.json')], { cwd: dir });
            writeFileSync(join(dir, 'smoke.mjs'), smoke.join('\n'));
            run(process.execPath, [join(dir, 'smoke.mjs')], { cwd: dir });

            // Bundle test scaffolding, but resolve every runtime import from the installed packages.
            if (js.some(p => p.slug === 'webgpu')) {
                const source = read('packages/webgpu/tests/crossLanguageProducerCases.ts')
                    .replaceAll("'../src/snapshot.ts'", "'@zenfg/webgpu/snapshot'")
                    .replaceAll("'../src/index.ts'", "'@zenfg/webgpu'");
                await build({ stdin: { contents: source, resolveDir: resolve(root, 'packages/webgpu/tests'), loader: 'ts' },
                    outfile: join(dir, 'producer.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['@zenfg/*'] });
                writeFileSync(join(dir, 'produce.mjs'), 'import { createTypeScriptProducerSnapshots } from "./producer.mjs";\n'
                    + 'import { writeFileSync } from "node:fs";\n'
                    + 'for (const [name, value] of createTypeScriptProducerSnapshots()) writeFileSync(' + JSON.stringify(samples + '/ts-')
                    + ' + name + ".json", JSON.stringify(value));');
                run(process.execPath, [join(dir, 'produce.mjs')], { cwd: dir });
            }
        }
        if (rust.length) {
            const rustDir = join(dir, 'rust');
            mkdirSync(rustDir);
            const snapshot = rust.find(p => p.name === 'zenfg-snapshot');
            const runtime = rust.find(p => p.name === 'zenfg');
            let manifest = '[package]\nname = "zenfg-release-consumer"\nversion = "0.0.0"\nedition = "2024"\n[dependencies]\nserde_json = "1"\n';
            for (const p of rust) manifest += p.name + ' = { version = "=' + p.version + '"' + (p.name === 'zenfg' ? ', features = ["snapshot", "serde"]' : '') + ' }\n';
            if (runtime) manifest += 'wgpu = { version = ' + JSON.stringify(parse(read('Cargo.toml')).workspace.dependencies.wgpu) + ', features = ["noop"] }\n';
            if (mode !== 'registry') {
                manifest += '[patch.crates-io]\n';
                for (const p of rust) {
                    listFiles(archivePath(p.archive));
                    run('tar', ['-xzf', archivePath(p.archive), '-C', rustDir]);
                    manifest += p.name + ' = { path = ' + JSON.stringify(p.name + '-' + p.version) + ' }\n';
                }
            }
            const example = runtime ? 'crates/zenfg/examples/snapshot_export.rs' : 'crates/zenfg-snapshot/examples/basic.rs';
            writeFileSync(join(rustDir, 'produce.rs'), read(example));
            manifest += '[[bin]]\nname = "produce"\npath = "produce.rs"\n';
            const codec = snapshot ? 'zenfg_snapshot' : 'zenfg::snapshot';
            writeFileSync(join(rustDir, 'decode.rs'), 'fn main() { for path in std::env::args().skip(1) { let value = std::fs::read_to_string(path).unwrap(); '
                + codec + '::parse_frame_graph_snapshot(&value).expect("cross-language decode"); } }\n');
            manifest += '[[bin]]\nname = "decode"\npath = "decode.rs"\n';
            writeFileSync(join(rustDir, 'Cargo.toml'), manifest);
            const env = { ...process.env, RUSTUP_TOOLCHAIN: '1.98.0', CARGO_TARGET_DIR: resolve(root, 'target/release-consumers') };
            const rustSample = run('cargo', ['run', '--quiet', '--bin', 'produce'], { cwd: rustDir, env });
            JSON.parse(rustSample);
            writeFileSync(join(samples, 'rust.json'), rustSample);
            const paths = readdirSync(samples).map(f => join(samples, f));
            run('cargo', ['run', '--quiet', '--locked', '--bin', 'decode', '--', ...paths], { cwd: rustDir, env });
            if (mode === 'registry' && readFileSync(join(rustDir, 'Cargo.lock'), 'utf8').includes('path+')) throw new Error('Registry consumer leaked local paths.');
        }
        if (js.length) {
            // Inspector also consumes Snapshot transitively. Verify the actual installed reader.
            const codecFile = join(dir, 'decode.mjs');
            const corpus = resolve(root, 'packages/snapshot/conformance');
            writeFileSync(codecFile, [
                'import { decodeFrameGraphSnapshot } from "@zenfg/snapshot";',
                'import { readFileSync, readdirSync } from "node:fs";',
                'for (const file of readdirSync(' + JSON.stringify(samples) + ')) {',
                'const result = decodeFrameGraphSnapshot(JSON.parse(readFileSync(' + JSON.stringify(samples + '/') + ' + file, "utf8")));',
                'if (!result.ok) throw new Error(file + ": " + JSON.stringify(result));',
                '}',
                ...(js.some(p => p.slug === 'snapshot') ? [
                    'const corpus = ' + JSON.stringify(corpus) + ';',
                    'const manifest = JSON.parse(readFileSync(corpus + "/manifest.json", "utf8"));',
                    'for (const entry of manifest.cases) {',
                    'const text = readFileSync(corpus + "/" + entry.file, "utf8");',
                    'let value; try { value = JSON.parse(text); } catch { continue; }',
                    'const result = decodeFrameGraphSnapshot(value);',
                    'if (typeof entry.runtimeValid === "boolean" && result.ok !== entry.runtimeValid) throw new Error("Corpus mismatch: " + entry.id);',
                    '}',
                ] : []),
            ].join('\n'));
            run(process.execPath, [codecFile], { cwd: dir });
        }
        writeJson(join(output, 'consumer-' + mode + '.json'), { status: 'passed', packages: packages.map(p => p.name + '@' + p.version) });
    } finally {
        // This path comes directly from mkdtemp under the OS temp directory.
        rmSync(dir, { recursive: true, force: true });
    }
}
