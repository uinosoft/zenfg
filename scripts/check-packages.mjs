import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
    basename,
    dirname,
    isAbsolute,
    join,
    posix,
    relative,
    resolve,
    win32,
} from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) {
    throw new Error('Run this check through `npm run pack:check` so npm_execpath is available.');
}
const packages = [
    {
        name: '@zenfg/snapshot',
        directory: 'packages/snapshot',
        requiredFiles: [
            'LICENSE',
            'README.md',
            'SPEC.md',
            'dist/index.d.ts',
            'dist/index.d.ts.map',
            'dist/index.js',
            'src/index.ts',
            'schema/frame-graph-snapshot-v1.schema.json',
            'conformance/manifest.json',
            'conformance/producers/manifest.json',
            'conformance/producers/goldens/aliasing.projection.json',
            'conformance/producers/goldens/buffer-range.projection.json',
            'conformance/producers/goldens/external-submission.projection.json',
            'conformance/producers/goldens/linear-dependency.projection.json',
            'conformance/producers/goldens/overwrite-culling.projection.json',
            'conformance/producers/goldens/preserve-discard.projection.json',
            'conformance/producers/goldens/texture-subresource.projection.json',
            'fixtures/full-webgpu.fgsnapshot.json',
            'fixtures/stable-keys.fgsnapshot.json',
            'fixtures/legacy-candidate-v1-canonical.json',
            'fixtures/legacy-candidate-v1.expected.fgsnapshot.json',
        ],
    },
    {
        name: '@zenfg/webgpu',
        directory: 'packages/webgpu',
        requiredFiles: [
            'LICENSE',
            'README.md',
            'dist/index.d.ts',
            'dist/index.d.ts.map',
            'dist/index.js',
            'dist/snapshot.d.ts',
            'dist/snapshot.d.ts.map',
            'dist/snapshot.js',
            'src/index.ts',
            'examples/README.md',
            'examples/tsconfig.json',
            'examples/minimal-frame.ts',
            'examples/transient-to-present.ts',
            'examples/imported-resource.ts',
            'examples/persistent-state.ts',
            'examples/external-submission.ts',
            'examples/snapshot-export.ts',
            'examples/gpu-timing.ts',
            'examples/compute-output.ts',
        ],
    },
    {
        name: '@zenfg/inspector',
        directory: 'packages/inspector',
        requiredFiles: [
            'LICENSE',
            'README.md',
            'dist/index.d.ts',
            'dist/index.d.ts.map',
            'dist/index.js',
            'src/index.ts',
        ],
    },
];

function run(command, args, options = {}) {
    const { capture = false, ...spawnOptions } = options;
    const result = spawnSync(command, args, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
        ...spawnOptions,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}.`);
    }
    return result.stdout ?? '';
}

function runNpm(args, options) {
    return run(process.execPath, [npmCli, ...args], options);
}

function parsePackOutput(output, label) {
    try {
        const parsed = JSON.parse(output);
        if (!Array.isArray(parsed) || parsed.length !== 1) {
            throw new Error('expected one package result');
        }
        return parsed[0];
    } catch (error) {
        throw new Error(`Could not parse npm pack output for ${label}: ${error}`);
    }
}

function filesBelow(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(path) : [path];
    });
}

function isOutside(parent, child) {
    const path = relative(parent, child);
    return path === '..' || path.startsWith(`..${win32.sep}`) || path.startsWith(`..${posix.sep}`) || isAbsolute(path);
}

function isAbsoluteMapPath(path) {
    return isAbsolute(path) || win32.isAbsolute(path) || posix.isAbsolute(path) || /^[a-z][a-z0-9+.-]*:/iu.test(path);
}

function validateDeclarationMaps(packageName, packageDirectory) {
    const distDirectory = join(packageDirectory, 'dist');
    const declarations = filesBelow(distDirectory).filter((file) => file.endsWith('.d.ts'));
    if (declarations.length === 0) {
        throw new Error(`${packageName} contains no declaration files.`);
    }
    for (const declaration of declarations) {
        const mapPath = `${declaration}.map`;
        if (!existsSync(mapPath)) {
            throw new Error(`${packageName} is missing a declaration map for ${relative(packageDirectory, declaration)}.`);
        }
        let map;
        try {
            map = JSON.parse(readFileSync(mapPath, 'utf8'));
        }
        catch (error) {
            throw new Error(`${packageName} has an invalid declaration map at ${relative(packageDirectory, mapPath)}: ${error}`);
        }
        if (
            typeof map.file !== 'string'
            || map.file.length === 0
            || isAbsoluteMapPath(map.file)
            || resolve(dirname(mapPath), map.file) !== resolve(declaration)
        ) {
            throw new Error(`${packageName} declaration map ${relative(packageDirectory, mapPath)} has an invalid declaration target.`);
        }
        if (map.sourceRoot !== undefined && typeof map.sourceRoot !== 'string') {
            throw new Error(`${packageName} declaration map ${relative(packageDirectory, mapPath)} has an invalid sourceRoot.`);
        }
        const sourceRoot = map.sourceRoot ?? '';
        if (isAbsoluteMapPath(sourceRoot)) {
            throw new Error(`${packageName} declaration map ${relative(packageDirectory, mapPath)} has an absolute sourceRoot.`);
        }
        if (!Array.isArray(map.sources) || map.sources.length === 0) {
            throw new Error(`${packageName} declaration map ${relative(packageDirectory, mapPath)} has no sources.`);
        }
        for (const source of map.sources) {
            if (typeof source !== 'string' || source.length === 0 || isAbsoluteMapPath(source)) {
                throw new Error(`${packageName} declaration map ${relative(packageDirectory, mapPath)} has an invalid or absolute source path.`);
            }
            const target = resolve(dirname(mapPath), sourceRoot, source);
            if (isOutside(packageDirectory, target)) {
                throw new Error(`${packageName} declaration map ${relative(packageDirectory, mapPath)} escapes the package: ${source}`);
            }
            const packagedPath = relative(packageDirectory, target).replaceAll('\\', '/');
            if (!packagedPath.startsWith('src/') || !existsSync(target)) {
                throw new Error(`${packageName} declaration map ${relative(packageDirectory, mapPath)} points to missing packaged source: ${source}`);
            }
        }
    }
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'zenfg-package-check-'));

try {
    for (const packageSpec of packages) {
        const distDirectory = resolve(rootDir, packageSpec.directory, 'dist');
        rmSync(distDirectory, { recursive: true, force: true });
        if (existsSync(distDirectory)) {
            throw new Error(`Could not remove ${packageSpec.directory}/dist before the package lifecycle check.`);
        }
    }

    const tarballs = [];
    for (const packageSpec of packages) {
        const packageDirectory = resolve(rootDir, packageSpec.directory);
        const packed = parsePackOutput(runNpm([
            'pack',
            '--json',
            '--pack-destination',
            temporaryDirectory,
        ], {
            cwd: packageDirectory,
            capture: true,
        }), packageSpec.directory);
        if (!existsSync(resolve(packageDirectory, 'dist'))) {
            throw new Error(`${packageSpec.name} did not build itself during its prepack lifecycle.`);
        }
        const packedFiles = new Set(packed.files.map(({ path }) => path.replaceAll('\\', '/')));
        for (const requiredFile of packageSpec.requiredFiles) {
            if (!packedFiles.has(requiredFile)) {
                throw new Error(`${packageSpec.directory} is missing ${requiredFile} from its tarball.`);
            }
        }
        for (const file of packedFiles) {
            if (file.includes('node_modules/') || file.includes('.test-dist/') || file.includes('workspace:')) {
                throw new Error(`${packageSpec.directory} leaked workspace-only content: ${file}`);
            }
        }
        tarballs.push({
            name: packageSpec.name,
            path: join(temporaryDirectory, basename(packed.filename)),
        });
    }

    const consumerDirectory = join(temporaryDirectory, 'consumer');
    mkdirSync(consumerDirectory, { recursive: true });
    writeFileSync(join(consumerDirectory, 'package.json'), `${JSON.stringify({
        private: true,
        type: 'module',
        devDependencies: {
            typescript: '6',
        },
    }, null, 2)}\n`);
    runNpm([
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        ...tarballs.map(({ path }) => path),
    ], { cwd: consumerDirectory });
    const smokeTest = [
        "import * as snapshot from '@zenfg/snapshot'",
        "import * as webgpu from '@zenfg/webgpu'",
        "import * as webgpuSnapshot from '@zenfg/webgpu/snapshot'",
        "import * as inspector from '@zenfg/inspector'",
        "import schema from '@zenfg/snapshot/schema/v1.json' with { type: 'json' }",
        "if (typeof snapshot.decodeFrameGraphSnapshot !== 'function') throw new Error('snapshot import failed')",
        "if (typeof webgpu.FrameGraph !== 'function') throw new Error('webgpu import failed')",
        "if (typeof webgpuSnapshot.createFrameGraphSnapshot !== 'function') throw new Error('webgpu snapshot import failed')",
        "if (typeof inspector.mountFrameGraphInspector !== 'function') throw new Error('inspector import failed')",
        "if (schema.$id !== 'https://uinosoft.github.io/zenfg/schema/frame-graph-snapshot-v1.schema.json') throw new Error('snapshot schema import failed')",
    ].join(';');
    run(process.execPath, ['--input-type=module', '--eval', smokeTest], { cwd: consumerDirectory });

    for (const { name } of tarballs) {
        const installedPackageDirectory = join(
            consumerDirectory,
            'node_modules',
            ...name.split('/'),
        );
        const packageJson = JSON.parse(readFileSync(join(installedPackageDirectory, 'package.json'), 'utf8'));
        if (Object.values(packageJson.dependencies ?? {}).some((value) => String(value).startsWith('workspace:'))) {
            throw new Error(`${packageJson.name} contains a workspace dependency in its published manifest.`);
        }
        if (packageJson.dependencies?.['@webgpu/types'] !== undefined) {
            throw new Error(`${packageJson.name} must not expose @webgpu/types as a runtime dependency.`);
        }
        validateDeclarationMaps(packageJson.name, installedPackageDirectory);
    }

    const exampleDirectory = join(consumerDirectory, 'examples');
    mkdirSync(exampleDirectory, { recursive: true });
    const installedWebGpuExamples = join(consumerDirectory, 'node_modules', '@zenfg', 'webgpu', 'examples');
    for (const example of [
        'minimal-frame.ts',
        'transient-to-present.ts',
        'imported-resource.ts',
        'persistent-state.ts',
        'external-submission.ts',
        'snapshot-export.ts',
        'gpu-timing.ts',
        'compute-output.ts',
    ]) {
        copyFileSync(join(installedWebGpuExamples, example), join(exampleDirectory, example));
    }

    writeFileSync(join(consumerDirectory, 'tsconfig.json'), `${JSON.stringify({
        compilerOptions: {
            module: 'ESNext',
            target: 'ES2022',
            moduleResolution: 'Bundler',
            lib: ['DOM', 'ES2022'],
            types: [],
            strict: true,
            skipLibCheck: false,
            resolveJsonModule: true,
            noEmit: true,
        },
        include: ['index.ts', 'examples/**/*.ts'],
    }, null, 2)}\n`);
    writeFileSync(join(consumerDirectory, 'index.ts'), [
        'import {',
        '    decodeFrameGraphSnapshot,',
        '    parseFrameGraphSnapshot,',
        '    stringifyFrameGraphSnapshot,',
        '    type FrameGraphSnapshot,',
        "} from '@zenfg/snapshot';",
        "import {",
        "    FrameGraph,",
        "    type BufferHandle,",
        "    type CopyOperation,",
        "    type TextureHandle,",
        "    type TextureOrigin,",
        "    type TextureSize,",
        "} from '@zenfg/webgpu';",
        "import { createFrameGraphSnapshot } from '@zenfg/webgpu/snapshot';",
        'import {',
        '    mountFrameGraphInspector,',
        '    type FrameGraphInspectorOptions,',
        "} from '@zenfg/inspector';",
        "import schema from '@zenfg/snapshot/schema/v1.json' with { type: 'json' };",
        '',
        '// Snapshot README Quick Start: parse/decode, narrow the result, and stringify.',
        'export function normalizeSnapshots(jsonText: string, value: unknown): readonly string[] {',
        '    const canonicalJson: string[] = [];',
        '    const parsed = parseFrameGraphSnapshot(jsonText);',
        '    if (parsed.ok) {',
        '        canonicalJson.push(stringifyFrameGraphSnapshot(parsed.snapshot, { pretty: true }));',
        '        void [parsed.source, parsed.migrated, parsed.issues];',
        '    } else {',
        '        void parsed.issues;',
        '    }',
        '',
        '    const decoded = decodeFrameGraphSnapshot(value);',
        '    if (decoded.ok) {',
        '        canonicalJson.push(stringifyFrameGraphSnapshot(decoded.snapshot));',
        '        void [decoded.source, decoded.migrated, decoded.issues];',
        '    } else {',
        '        void decoded.issues;',
        '    }',
        '    return canonicalJson;',
        '}',
        '',
        '// WebGPU README Quick Start: compile and execute a clear-only surface frame.',
        'declare const device: GPUDevice;',
        'declare const context: GPUCanvasContext;',
        'declare let frameIndex: number;',
        'const graph = new FrameGraph(device);',
        '',
        'export function renderFrame(): void {',
        '    const recorder = graph.beginFrame();',
        '    const backbuffer = recorder.importSwapchainTexture(',
        '        context.getCurrentTexture(),',
        "        { label: 'backbuffer' },",
        '    );',
        '    recorder.render({',
        "        label: 'clear-backbuffer',",
        '        colorAttachments: [{',
        '            target: backbuffer,',
        "            loadOp: 'clear',",
        "            storeOp: 'store',",
        '            clearValue: { r: 0.04, g: 0.06, b: 0.1, a: 1 },',
        '        }],',
        '    });',
        '    recorder.markPresent(backbuffer);',
        '    recorder.compile().execute({ frameIndex: frameIndex++ });',
        '}',
        '',
        '// Inspector README Quick Start: mount with options, update, and clean up.',
        'export function mountInspector(host: HTMLElement, existingSnapshot: FrameGraphSnapshot): void {',
        '    const options: FrameGraphInspectorOptions = {',
        '        captureSnapshot: () => existingSnapshot,',
        '        maxImportBytes: 64 * 1024 * 1024,',
        '        maxGraphElements: 5_000,',
        '    };',
        '    const inspector = mountFrameGraphInspector(host, options);',
        '    inspector.setSnapshot(existingSnapshot);',
        '    inspector.destroy();',
        '}',
        '',
        '// Other supported declarations and entrypoints.',
        'const textureSize: TextureSize = new Uint32Array([1, 1, 1]);',
        'const textureOrigin: TextureOrigin = new Uint32Array([0, 0, 0]);',
        'declare const textureHandle: TextureHandle;',
        'declare const bufferHandle: BufferHandle;',
        'const copyOperations: readonly CopyOperation[] = [',
        "    { type: 'texture-to-texture', source: textureHandle, destination: textureHandle, sourceOrigin: textureOrigin, destinationOrigin: textureOrigin, copySize: textureSize },",
        "    { type: 'buffer-to-texture', source: bufferHandle, destination: textureHandle, sourceLayout: {}, destinationOrigin: textureOrigin, copySize: textureSize },",
        "    { type: 'texture-to-buffer', source: textureHandle, destination: bufferHandle, destinationLayout: {}, sourceOrigin: textureOrigin, copySize: textureSize },",
        '];',
        '// @ts-expect-error Texture extent dictionaries reject the deprecated `depth` spelling.',
        'const invalidTextureSize: TextureSize = { width: 1, depth: 1 };',
        'const schemaId: string = schema.$id;',
        'void [createFrameGraphSnapshot, textureSize, textureOrigin, copyOperations, invalidTextureSize, schemaId];',
        '',
    ].join('\n'));
    const tscPath = join(consumerDirectory, 'node_modules', 'typescript', 'bin', 'tsc');
    const typescriptVersion = run(process.execPath, [tscPath, '--version'], {
        cwd: consumerDirectory,
        capture: true,
    }).trim();
    if (!/^Version 6\./u.test(typescriptVersion)) {
        throw new Error(`Expected TypeScript 6 in the empty consumer, received ${typescriptVersion}.`);
    }
    run(process.execPath, [tscPath, '--project', 'tsconfig.json'], { cwd: consumerDirectory });

    process.stdout.write(`Verified npm tarball contents, source-backed declaration maps, runtime imports, and ${typescriptVersion} declarations plus recipes from a temporary empty project.\n`);
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
}
