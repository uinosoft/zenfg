import assert from 'node:assert/strict';
import test from 'node:test';
import * as pc from 'playcanvas';
import { prepare } from '../src/loading.ts';
import { cameraMatrices } from '../src/camera.ts';
import { validateAttachments } from '../src/bridge.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';

test('both cameras project near to zero and far to one', () => {
    for (const streaming of [false,true]) {
        const { viewProjection: m } = cameraMatrices(new pc.Vec3(0,0,0), new pc.Vec3(0,0,-1), 1.5, streaming);
        const depth = (z: number) => (m[10]*z + m[14]) / (m[11]*z + m[15]);
        assert.ok(Math.abs(depth(-0.1)) < 1e-5);
        assert.ok(Math.abs(depth(streaming ? -1000 : -100) - 1) < 1e-5);
    }
});
test('cancelled preparation settles promptly and disposes a late result exactly once', async () => {
    const abort = new AbortController();
    let complete!: (value: number) => void;
    const disposed: number[] = [];
    const result = prepare(new Promise<number>(resolve => complete = resolve), abort.signal, value => disposed.push(value));
    abort.abort();
    await assert.rejects(result, /abort/i);
    complete(17); await Promise.resolve();
    assert.deepEqual(disposed, [17]);
});
test('timeout cleans up a late successful preparation', async () => {
    let complete!: (value: number) => void;
    const disposed: number[] = [];
    const result = prepare(new Promise<number>(resolve => complete = resolve), undefined, value => disposed.push(value), 5);
    await assert.rejects(result, /timed out/);
    complete(12); await Promise.resolve();
    assert.deepEqual(disposed, [12]);
});
test('attachment bridge rejects incompatible format and extent', t => {
    t.after(installWebGpuGlobals());
    const { device } = createFakeGpu();
    const color = device.createTexture({ format: 'rgba8unorm', size: [16,16], usage: 20 });
    const depth = device.createTexture({ format: 'depth32float', size: [16,16], usage: 16 });
    assert.doesNotThrow(() => validateAttachments(color, depth, 16, 16));
    assert.throws(() => validateAttachments(color, depth, 32, 16), /incompatible/);
    assert.throws(() => validateAttachments(depth, color, 16, 16), /incompatible/);
});
