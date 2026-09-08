import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
// @ts-expect-error Pinned upstream JavaScript.
import { Sim } from '../src/upstream/sim.js';
// @ts-expect-error Pinned upstream JavaScript.
import { Renderer, Camera, screenRay } from '../src/upstream/render.js';
// @ts-expect-error Pinned upstream JavaScript.
import { SurfaceMesh } from '../src/upstream/mesh.js';
// @ts-expect-error Pinned upstream JavaScript.
import { Solids } from '../src/upstream/solids.js';
// @ts-expect-error Pinned upstream JavaScript.
import { RayMarch } from '../src/upstream/ray.js';
// @ts-expect-error Pinned upstream JavaScript.
import { FluidSSFR } from '../src/upstream/ssfr.js';
// @ts-expect-error Pinned upstream JavaScript.
import { Environment } from '../src/upstream/env.js';
// @ts-expect-error Pinned upstream JavaScript.
import { buildScene, defaultParams } from '../src/upstream/scene.js';

Object.assign(globalThis, {
    GPUBufferUsage: { UNIFORM: 64, STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, MAP_READ: 1 },
    GPUTextureUsage: { TEXTURE_BINDING: 4, COPY_DST: 2 }, GPUMapMode: { READ: 1 },
});

test('simulation, scene and rendering shaders match the fixed upstream revision', () => {
    // SHA-256 of sources fetched from 58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0,
    // omitting comments/whitespace removed by the original t3d-next vendoring.
    const hashes = {
        'aniso_wgsl.js': '4c0a2fe745f0a1ac62697dc1409bd0c424d31d3d37088fd60f9d0ca2257f193e',
        'mesh_wgsl.js': '46b30dfcf5112a004671c6fc0025cce841bbeadfd76c600d54205ffd76067f9d',
        'ray_wgsl.js': 'e83c903b73628f0eb80082ac53f3a7ed397100da45b929975cba2f48ae5bfad2',
        'scene.js': '60f4d9039dcefc665f9290457873ac365ecf1f60b489685e58e825b770aa782d',
        'solid_wgsl.js': '951f16641bc9705ec68add5ed448dc69a81c8f2ea8352c93c468ec28f4fedd02',
        'ssfr_composite_wgsl.js': 'ca307ca02cc9953c1153ea56fef395b9e63b08fcfcfafc017de1e84d9dfd0fb1',
        'ssfr_wgsl.js': 'c4330e4a7d4269efd912f3ad6357019ee2764357688b0d67f6e9ca71b64f0f0a',
        'wgsl.js': '2e144ba12398b8fe868d6216a7e14d2d5961e580d98a55bb106c7f967e57d7a3',
    };
    for (const [file, expected] of Object.entries(hashes)) {
        const source = readFileSync(`examples/particles4all-framegraph/src/upstream/${file}`, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
        assert.equal(createHash('sha256').update(source).digest('hex'), expected, file);
    }
});

class BufferStub {
    data: ArrayBuffer;
    destroyed = false;
    completeMapping: (() => void) | undefined;
    constructor(readonly size: number) { this.data = new ArrayBuffer(size); }
    mapAsync(): Promise<void> { return new Promise(resolve => { this.completeMapping = resolve; }); }
    getMappedRange(): ArrayBuffer { return this.data; }
    unmap(): void {}
    destroy(): void { this.destroyed = true; }
}

class TextureStub {
    destroyed = false;
    createView(): object { return { texture: this }; }
    destroy(): void { this.destroyed = true; }
}

function fakeDevice(limit = 8) {
    const buffers: BufferStub[] = [];
    const textures: TextureStub[] = [];
    const depthStates: GPUDepthStencilState[] = [];
    const moduleSources: string[] = [];
    let failUpload = false;
    const device = {
        limits: { maxTextureDimension2D: 2048 },
        createBuffer: ({ size }: { size: number }) => { const buffer = new BufferStub(size); buffers.push(buffer); return buffer; },
        createTexture: () => { const texture = new TextureStub(); textures.push(texture); return texture; },
        createSampler: () => ({}), createBindGroup: () => ({}),
        createShaderModule: ({ code }: { code: string }) => {
            const storageCount = (code.match(/var\s*<\s*storage\b/g) || []).length;
            assert.ok(storageCount <= limit, `${storageCount} storage bindings exceeds ${limit}`);
            moduleSources.push(code);
            return {};
        },
        createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
        createRenderPipeline: ({ depthStencil }: { depthStencil?: GPUDepthStencilState }) => {
            if (depthStencil) depthStates.push(depthStencil);
            return { getBindGroupLayout: () => ({}) };
        },
        queue: {
            writeBuffer: (buffer: BufferStub, offset: number, data: ArrayBuffer | ArrayBufferView) => {
                const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
                new Uint8Array(buffer.data).set(bytes, offset);
            },
            writeTexture: () => { if (failUpload) throw new Error('upload failed'); },
        },
    };
    return { device, buffers, textures, depthStates, moduleSources, setFailUpload: (value: boolean) => { failUpload = value; } };
}

test('all native pipelines fit eight storage buffers and use original conventional depth', () => {
    for (const limit of [8, 10, 16]) {
        const fake = fakeDevice(limit);
        new Sim(fake.device); new Renderer(fake.device, 'bgra8unorm'); new SurfaceMesh(fake.device, 'bgra8unorm');
        new Solids(fake.device, 'bgra8unorm'); new RayMarch(fake.device, 'bgra8unorm'); new FluidSSFR(fake.device, 'bgra8unorm');
        assert.ok(fake.moduleSources.length > 30);
        assert.ok(fake.depthStates.length >= 5);
        for (const state of fake.depthStates) assert.deepEqual(state, { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
    }
    const root = 'examples/particles4all-framegraph/src/upstream';
    const source = readdirSync(root).filter(file => file.endsWith('.js')).map(file => readFileSync(`${root}/${file}`, 'utf8')).join('\n');
    assert.doesNotMatch(source, /@t3d-next|gl-matrix|reverse-z|depth32float/);
    assert.doesNotMatch(source, /createCommandEncoder\s*\(|queue\.submit\s*\(|beginComputePass\s*\(|beginRenderPass\s*\(/);
    assert.match(source, /nearH\s*=\s*[^\n]*vec4f\([^\n]*-1\.0,\s*1\.0\)/);
    assert.match(source, /farH\s*=\s*[^\n]*vec4f\([^\n]*1\.0,\s*1\.0\)/);
});

test('original perspective and screen ray agree at center and off-center pixels', () => {
    const fake = fakeDevice();
    const renderer = new Renderer(fake.device, 'bgra8unorm');
    const camera = new Camera();
    renderer.resize(800, 500);
    renderer.prepare({ n: 0 }, camera, { display: 0, radius: 0.5, speedMax: 3 });
    const projection = renderer.view.slice(32, 48);
    const projectDepth = (z: number) => (projection[10] * z + projection[14]) / (-z);
    assert.ok(Math.abs(projectDepth(-0.05) + 1) < 1e-5);
    assert.ok(Math.abs(projectDepth(-100) - 1) < 1e-5);
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.7], [0.8, 0.1]]) {
        const ray = screenRay(camera, u, v, 1.6);
        const point = ray.origin.map((component: number, index: number) => component + ray.dir[index]);
        const result = renderer.project(point, camera, 1.6);
        assert.ok(Math.abs(result[0] - u!) < 1e-6);
        assert.ok(Math.abs(result[1] - v!) < 1e-6);
    }
});

const minimalParams = () => ({ ...defaultParams('small'), targetParticleCount: 32, box: [0.4, 0.4, 0.4], spacing: 0.05, bodies: [], bodySize: 0 });

test('scene data stays deterministic and reset/dispose invalidate pending diagnostics', async () => {
    const params = minimalParams();
    const first = buildScene(params);
    const second = buildScene(minimalParams());
    assert.deepEqual(first.pos, second.pos);
    assert.deepEqual(first.boundary.pts, second.boundary.pts);
    const fake = fakeDevice();
    const sim = new Sim(fake.device);
    sim.reset(params, first);
    const readback = sim.statsRing[0] as BufferStub;
    new Uint32Array(readback.data).set([1024 * sim.n, 2048, 3072, 4096]);
    sim.statsReadbackArmed = true; sim.statsReadbackSlot = 0;
    sim.afterSubmit();
    sim.n *= 2;
    readback.completeMapping!();
    await Promise.resolve();
    assert.equal(sim.stats.avgRho, 1, 'diagnostics normalize by count at submission');
    sim.statsReadbackArmed = true; sim.statsReadbackSlot = 0;
    sim.afterSubmit();
    const previousStats = { ...sim.stats };
    sim.reset(minimalParams());
    readback.completeMapping!();
    await Promise.resolve();
    assert.deepEqual(sim.stats, previousStats);
    sim.destroy(); sim.destroy();
    assert.ok(fake.buffers.every(buffer => buffer.destroyed));
    assert.throws(() => sim.reset(minimalParams()), /disposed/);
});

test('mesh scene reset rejects old triangle mappings and accepts the new scene result', async () => {
    const fake = fakeDevice();
    const mesh = new SurfaceMesh(fake.device, 'bgra8unorm');
    const previous = mesh.triRing.slice() as BufferStub[];
    new Uint32Array(previous[0]!.data)[0] = 1234;
    mesh.triState[0] = 1;
    mesh.frame = 9;
    mesh.lastTriangles = 456;
    mesh.pollTriangles();
    mesh.resetReadbacks();
    assert.equal(mesh.frame, 0);
    assert.equal(mesh.lastTriangles, 0);
    assert.ok(previous.every(buffer => buffer.destroyed));
    const current = mesh.triRing[0] as BufferStub;
    new Uint32Array(current.data)[0] = 789;
    mesh.triState[0] = 1;
    mesh.pollTriangles();
    previous[0]!.completeMapping!();
    await Promise.resolve();
    assert.equal(mesh.lastTriangles, 0);
    assert.equal(mesh.triState[0], 2, 'stale mapping cannot release a busy slot in the new ring');
    current.completeMapping!();
    await Promise.resolve();
    assert.equal(mesh.lastTriangles, 789);
    assert.equal(mesh.triState[0], 0);
    mesh.destroy();
    assert.ok(fake.buffers.every(buffer => buffer.destroyed));
});

test('mesh disposal invalidates asynchronous triangle counts', async () => {
    const fake = fakeDevice();
    const mesh = new SurfaceMesh(fake.device, 'bgra8unorm');
    const buffer = mesh.triRing[0] as BufferStub;
    new Uint32Array(buffer.data)[0] = 1234;
    mesh.triState[0] = 1;
    mesh.pollTriangles();
    mesh.destroy(); mesh.destroy();
    buffer.completeMapping!();
    await Promise.resolve();
    assert.equal(mesh.lastTriangles, 0);
    assert.ok(fake.buffers.every(item => item.destroyed));
});

function hdrBlob(): Blob {
    const header = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n');
    const bytes = new Uint8Array(header.length + 32);
    bytes.set(header);
    for (let index = header.length; index < bytes.length; index += 4) bytes.set([128, 128, 128, 128], index);
    return new Blob([bytes]);
}

test('environment replacement is atomic, latest-wins, and clear/dispose invalidate pending loads', async () => {
    const fake = fakeDevice();
    const env = new Environment(fake.device);
    const oldFetch = globalThis.fetch;
    let finish: ((response: Response) => void) | undefined;
    globalThis.fetch = (() => new Promise(resolve => { finish = resolve; })) as typeof fetch;
    try {
        const stale = env.load('old.hdr');
        await env.load(hdrBlob());
        const latest = env.texture;
        finish!(new Response(await hdrBlob().arrayBuffer()));
        await stale;
        assert.equal(env.texture, latest);
        fake.setFailUpload(true);
        await assert.rejects(env.load(hdrBlob()), /upload failed/);
        assert.equal(env.texture, latest);
        assert.equal(latest.destroyed, false);
        assert.equal(fake.textures.at(-1)!.destroyed, true);
        fake.setFailUpload(false);
        const clearPending = env.load('clear.hdr');
        env.clear();
        finish!(new Response(await hdrBlob().arrayBuffer()));
        await clearPending;
        assert.equal(env.has, false);
        const destroyedPending = env.load('destroy.hdr');
        env.destroy(); env.destroy();
        finish!(new Response(await hdrBlob().arrayBuffer()));
        await destroyedPending;
        assert.equal(env.texture, null);
        assert.ok(fake.textures.every(texture => texture.destroyed));
        await assert.rejects(env.load(hdrBlob()), /disposed/);
    } finally { globalThis.fetch = oldFetch; }
});

test('malformed HDR terminates with an error and leaves the environment intact', async () => {
    const env = new Environment(fakeDevice().device);
    await env.load(hdrBlob());
    const previous = env.texture;
    for (const source of [new Blob(['#?RADIANCE']), new Blob(['#?RADIANCE\n\n-Y 2 +X 4\n']), new Blob(['#?RADIANCE\n\n-Y 2 +X 4\n', new Uint8Array([1, 1, 1, 1])])]) {
        await assert.rejects(env.load(source), /\.hdr/);
        assert.equal(env.texture, previous);
    }
    env.destroy();
});
