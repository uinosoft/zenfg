import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

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
            'dist/index.js',
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
            'fixtures/legacy-t3d-v1-canonical.json',
            'fixtures/legacy-t3d-v1.expected.fgsnapshot.json',
        ],
    },
    {
        name: '@zenfg/webgpu',
        directory: 'packages/webgpu',
        requiredFiles: [
            'LICENSE',
            'README.md',
            'dist/index.d.ts',
            'dist/index.js',
            'dist/snapshot.d.ts',
            'dist/snapshot.js',
        ],
    },
    {
        name: '@zenfg/inspector',
        directory: 'packages/inspector',
        requiredFiles: [
            'LICENSE',
            'README.md',
            'dist/index.d.ts',
            'dist/index.js',
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
        const packageJson = JSON.parse(readFileSync(join(
            consumerDirectory,
            'node_modules',
            ...name.split('/'),
            'package.json',
        ), 'utf8'));
        if (Object.values(packageJson.dependencies ?? {}).some((value) => String(value).startsWith('workspace:'))) {
            throw new Error(`${packageJson.name} contains a workspace dependency in its published manifest.`);
        }
        if (packageJson.dependencies?.['@webgpu/types'] !== undefined) {
            throw new Error(`${packageJson.name} must not expose @webgpu/types as a runtime dependency.`);
        }
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
        include: ['index.ts'],
    }, null, 2)}\n`);
    writeFileSync(join(consumerDirectory, 'index.ts'), [
        "import * as snapshot from '@zenfg/snapshot';",
        "import * as webgpu from '@zenfg/webgpu';",
        "import * as webgpuSnapshot from '@zenfg/webgpu/snapshot';",
        "import * as inspector from '@zenfg/inspector';",
        "import schema from '@zenfg/snapshot/schema/v1.json' with { type: 'json' };",
        '',
        'const textureSize: webgpu.TextureSize = [1, 1, 1];',
        'const schemaId: string = schema.$id;',
        'void [snapshot, webgpu, webgpuSnapshot, inspector, textureSize, schemaId];',
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

    process.stdout.write(`Verified npm tarball contents, runtime imports, and ${typescriptVersion} declarations from a temporary empty project.\n`);
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
}
