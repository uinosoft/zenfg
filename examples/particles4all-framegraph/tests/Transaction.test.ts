import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameGraph } from '@zenfg/webgpu';
import { Particles4All } from '../src/Particles4AllFeature.ts';
import type { Particles4AllSettings } from '../src/particles4allTypes.ts';
import { createFakeDevice, createGpuTrace, installWebGpuGlobals } from './fakeWebGpu.ts';

function fixture(settings: Partial<Particles4AllSettings> = {}, box: [number, number, number] = [0.4, 0.4, 0.4]) {
    const restore = installWebGpuGlobals();
    const trace = createGpuTrace();
    const device = createFakeDevice(trace);
    const graph = new FrameGraph(device);
    const workload = new Particles4All({ device, viewport: { width: 80, height: 40 }, outputFormat: 'bgra8unorm' });
    workload.applyImportedSettings({ ...workload.getSettings(), displayMode: 'particles', meshResolution: 48,
        substeps: 1, iterations: 1, timeScale: 1, ...settings }, {
        targetParticleCount: 32, spacing: 0.05, box, bodies: [], bodySize: 0,
    });
    const record = (deltaTime: number) => {
        const recording = graph.beginFrame();
        const color = recording.importSwapchainTexture(device.createTexture({
            size: [80, 40], format: 'bgra8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT,
        }));
        const pending = workload.recordFrameGraph(recording, { color, deltaTime });
        recording.markPresent(color);
        return { pending, submit() {
            recording.compile().execute({ afterSubmit() { pending.commit(); return undefined; } });
        } };
    };
    return { trace, device, graph, workload, record,
        dispose() { workload.dispose(); graph.destroy(); restore(); } };
}

test('discarded animated box deformation is resubmitted before the next box step overwrites its old-box baseline', () => {
    const f = fixture();
    try {
        f.record(0).submit();
        f.workload.setSettings({ boxScaleX: 0.5 });
        const first = f.record(0.05);
        const resizeWrites = () => f.trace.bufferWrites.filter((write) => write.size === 96);
        const initialResize = resizeWrites().at(-1)!;
        const initialValues = new Float32Array(initialResize.bytes.buffer);
        assert.ok(Math.abs(initialValues[4]! - 0.4) < 1e-6);
        assert.ok(Math.abs(initialValues[12]! - 0.3) < 1e-6);
        first.pending.discard();
        const writeCount = resizeWrites().length;
        const retry = f.record(0.05);
        assert.equal(resizeWrites().length, writeCount, 'retry must retain the original resize uniform');
        assert.equal(retry.pending.transientResourceKey, first.pending.transientResourceKey);
        retry.submit();
        const next = f.record(0.05);
        const nextValues = new Float32Array(resizeWrites().at(-1)!.bytes.buffer);
        assert.ok(Math.abs(nextValues[4]! - 0.3) < 1e-6);
        assert.ok(Math.abs(nextValues[12]! - 0.2) < 1e-6);
        assert.notEqual(next.pending.transientResourceKey, retry.pending.transientResourceKey);
        next.pending.discard();
    } finally { f.dispose(); }
});

test('first-frame wall resize binds the position buffer selected after grid priming', () => {
    const f = fixture({ boxScaleX: 0.5 });
    try {
        const frame = f.record(0.001);
        const sim = (f.workload as unknown as { native: { sim: { resizeUni: GPUBuffer } } }).native.sim;
        frame.submit();
        const resizeGroups = f.trace.bindGroups.filter(group => [...group.entries].some(entry =>
            entry.binding === 0 && 'buffer' in entry.resource && entry.resource.buffer === sim.resizeUni));
        const position = [...resizeGroups.at(-1)!.entries].find(entry => entry.binding === 1)!.resource as GPUBufferBinding;
        assert.equal(position.buffer.label, 'posB', 'priming changes parity before the scheduled resize encodes');
    } finally { f.dispose(); }
});

test('box settings reject an oversized field at an intermediate longest-axis crossover before mutating the scene', () => {
    const f = fixture({ displayMode: 'ray-march', raySurface: 'field' }, [0.3, 0.4, 0.4]);
    try {
        // At resolution 48: the current field is 405,756 bytes and the target
        // (0.6, 0.4, 0.4) is 249,900; the intervening cube needs 530,604 bytes.
        (f.device.limits as unknown as { maxStorageBufferBindingSize: number }).maxStorageBufferBindingSize = 450_000;
        f.workload.setSettings({ gravity: 1 });
        const before = f.workload.getSettings();
        const allocations = f.trace.bufferCreates.length;
        assert.throws(() => f.workload.setSettings({ boxScaleX: 2 }), /surface field.*buffer limits/);
        assert.deepEqual(f.workload.getSettings(), before);
        assert.equal(f.trace.bufferCreates.length, allocations);
        f.record(0).submit();
    } finally { f.dispose(); }
});

test('SSFR transient keys follow prepared pour counts before submission while stable frames retain their key', () => {
    const f = fixture({ displayMode: 'ssfr', pourWidth: 0.04, pourSpeed: 3 });
    try {
        const initial = f.record(0); initial.submit();
        const stable = f.record(0); stable.submit();
        assert.equal(stable.pending.transientResourceKey, initial.pending.transientResourceKey);
        f.workload.togglePour();
        const before = f.workload.getStats().particleCount;
        const first = f.record(0.02);
        assert.equal(f.workload.getStats().particleCount, before);
        assert.notEqual(first.pending.transientResourceKey, stable.pending.transientResourceKey);
        first.submit();
        assert.ok(f.workload.getStats().particleCount > before);
        const second = f.record(0.02);
        assert.notEqual(second.pending.transientResourceKey, first.pending.transientResourceKey);
        second.pending.discard();
    } finally { f.dispose(); }
});

test('pending recordings reject camera, body-drag and pour mutations until settled', () => {
    const f = fixture();
    try {
        const frame = f.record(0.02);
        const actions = [
            () => f.workload.beginBodyDrag(0.5, 0.5), () => f.workload.updateBodyDrag(0.5, 0.5),
            () => f.workload.endBodyDrag(), () => f.workload.togglePour(), () => f.workload.stopPour(),
            () => f.workload.orbit(1, 1), () => f.workload.pan(1, 1),
            () => f.workload.zoom(1), () => f.workload.resetCamera(),
        ];
        for (const action of actions) assert.throws(action, /pending/);
        frame.pending.discard();
        for (const action of actions) assert.doesNotThrow(action);
        const next = f.record(0.02); next.submit();
        assert.doesNotThrow(() => f.workload.stopPour());
    } finally { f.dispose(); }
});

test('scene reset replaces busy triangle readback slots and ignores late results from the old surface', async () => {
    const f = fixture({ displayMode: 'surface-mesh' });
    try {
        f.trace.deferMaps = true;
        for (let i = 0; i < 3; i++) f.record(0.02).submit();
        const oldReadbacks = f.trace.copies.filter((copy) => copy.size === 4).map((copy) => copy.destination);
        assert.equal(oldReadbacks.length, 3);
        assert.equal(f.trace.maps, 6, 'three statistics and three triangle slots');
        for (const buffer of oldReadbacks) buffer.getMappedRange = () => new Uint32Array([777]).buffer;
        f.record(0.02).submit();
        assert.equal(f.trace.maps, 6, 'busy triangle and statistics slots cannot be reused');
        f.workload.reset();
        assert.equal(f.workload.getStats().meshTriangles, 0);
        for (const resolve of f.trace.pendingMaps.splice(0)) resolve();
        await Promise.resolve(); await Promise.resolve();
        assert.equal(f.workload.getStats().meshTriangles, 0, 'old triangle count must not reach the new scene');
        assert.ok(oldReadbacks.every((buffer) => f.trace.destroyedBuffers.includes(buffer)));
        f.record(0.02).submit();
        const newReadback = f.trace.copies.filter((copy) => copy.size === 4).at(-1)!.destination;
        assert.ok(!oldReadbacks.includes(newReadback));
        f.workload.dispose();
        for (const resolve of f.trace.pendingMaps.splice(0)) resolve();
        await Promise.resolve(); await Promise.resolve();
        assert.doesNotThrow(() => f.workload.dispose());
    } finally { f.dispose(); }
});
