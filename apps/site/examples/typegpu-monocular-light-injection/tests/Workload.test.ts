import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAccess, FrameGraph, TextureAccess } from '@zenfg/webgpu';
import { createMonocularLightInjection, type MonocularLightInjectionWorkload } from '../src/index.ts';
import { createDispatchContext } from '../src/inference/dispatch-helpers.ts';

import { installWebGpuGlobals, fakeDevice, minimalBundle, deferPipelineCreation } from './fakeWebGpu.ts';

function record(feature: MonocularLightInjectionWorkload, device: GPUDevice, updateDepth: boolean) {
    return recordDetailed(feature, device, updateDepth);
}

function recordDetailed(feature: MonocularLightInjectionWorkload, device: GPUDevice, updateDepth: boolean) {
    const graph = new FrameGraph(device).beginFrame();
    const color = graph.createTexture({
        label: 'test.backbuffer', format: 'bgra8unorm', size: [80, 40],
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    let importCount = 0;
    const countedGraph = new Proxy(graph, {
        get(target, property) {
            const value = Reflect.get(target, property);
            if (property === 'importBuffer' || property === 'importTexture') {
                return (...args: unknown[]) => {
                    importCount += 1;
                    return (value as (...callArgs: unknown[]) => unknown).apply(target, args);
                };
            }
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const pending = feature.recordFrame(countedGraph, {
        color,
        source: {} as HTMLVideoElement,
        uvTransform: [1, 0, 0, 1],
        swapAxes: false,
        updateDepth,
    });
    graph.markOutput(color);
    return { report: graph.compile({ report: true }).compilationReport, importCount, pending };
}

test('workload keeps inference in one compute node and commits history only after submit', async () => {
    const restore = installWebGpuGlobals();
    try {
        const device = fakeDevice();
        const feature = await createMonocularLightInjection({ device, outputFormat: 'bgra8unorm' });
        await assert.rejects(feature.setModelBundle(new ArrayBuffer(4)), /DepthART v1/);
        const metadata = await feature.setModelBundle(minimalBundle());
        assert.deepEqual(metadata.outputSize, [2, 2]);
        await assert.rejects(feature.setModelBundle(new ArrayBuffer(4)), /DepthART v1/);
        assert.equal(feature.getRuntimeStats().model, metadata.model);

        const firstFrame = record(feature, device, false);
        const first = firstFrame.report;
        assert.deepEqual(first.nodes.map((node) => node.label), [
            'monocular-light-injection.depth',
            'monocular-light-injection.relight',
        ]);
        const depthNode = first.nodes.find((node) => node.label === 'monocular-light-injection.depth')!;
        const relightNode = first.nodes.find((node) => node.label === 'monocular-light-injection.relight')!;
        assert.equal(depthNode.sideEffect, false);
        assert.deepEqual(first.dependencies.map(edge => [edge.fromNodeId, edge.toNodeId, edge.kind]), [
            [depthNode.id, relightNode.id, 'value'],
        ]);
        assert.deepEqual(first.roots.filter((root) => root.reason === 'persistent-state').map((root) =>
            first.resources.find((resource) => resource.id === root.resourceId)!.label).sort(),
        ['monocular.history', 'monocular.stable-range', 'monocular.surface']);
        assert.equal(first.resources.find((resource) => resource.label === 'monocular.surface')!.initialContents, 'undefined');
        assert.ok(first.accesses.some((access) => access.nodeId === depthNode.id && access.access === BufferAccess.StorageWrite));
        assert.ok(first.accesses.some((access) => access.nodeId === depthNode.id && access.access === TextureAccess.StorageWrite));
        assert.ok(first.accesses.some((access) => access.nodeId === relightNode.id && access.access === TextureAccess.Sampled));
        const accessFor = (label: string) => {
            const resource = first.resources.find((entry) => entry.label === label)!;
            return first.accesses.filter((access) => access.nodeId === depthNode.id && access.resourceId === resource.id);
        };
        assert.deepEqual(accessFor('monocular.stable-range').map(({ access, contents }) => ({ access, contents })), [
            { access: BufferAccess.StorageWrite, contents: 'preserve' },
        ]);
        assert.deepEqual(accessFor('monocular.history').map(({ access, contents }) => ({ access, contents })), [
            { access: BufferAccess.StorageWrite, contents: 'preserve' },
        ]);
        assert.deepEqual(accessFor('monocular.surface').map(({ access, contents }) => ({ access, contents })), [
            { access: TextureAccess.StorageWrite, contents: 'overwrite' },
        ]);
        assert.deepEqual(first.resources.map((resource) => resource.label).sort(), [
            'monocular.history', 'monocular.stable-range', 'monocular.surface', 'test.backbuffer',
        ]);
        firstFrame.pending.discard();
        assert.equal(feature.getRuntimeStats().submittedDepthUpdates, 0);

        const secondFrame = record(feature, device, false);
        secondFrame.pending.commit();
        secondFrame.pending.commit();
        secondFrame.pending.discard();
        assert.equal(feature.getRuntimeStats().submittedDepthUpdates, 1);
        const stable = recordDetailed(feature, device, false);
        assert.equal(stable.report.resources.find((resource) => resource.label === 'monocular.surface')!.initialContents, 'defined');
        assert.deepEqual(stable.report.nodes.map((node) => node.label), ['monocular-light-injection.relight']);
        assert.equal(stable.importCount, 1);
        assert.deepEqual(
            stable.report.resources.filter((resource) => resource.origin === 'imported').map((resource) => resource.label).sort(),
            ['monocular.surface'],
        );
        assert.equal(stable.report.resources.length, 2);
        stable.pending.commit();
        feature.resetHistory();
        const reset = record(feature, device, false);
        assert.equal(reset.report.nodes[0]?.label, 'monocular-light-injection.depth');
        reset.pending.discard();
        feature.dispose();
    } finally {
        restore();
    }
});

test('recording failure releases frame state and stale settlement cannot affect a later frame', async () => {
    const restore = installWebGpuGlobals();
    try {
        const device = fakeDevice();
        const workload = await createMonocularLightInjection({ device, outputFormat: 'bgra8unorm' });
        await workload.setModelBundle(minimalBundle());
        const original = device.importExternalTexture;
        device.importExternalTexture = () => { throw new Error('Expired source'); };
        assert.throws(() => record(workload, device, true), /Expired source/);
        device.importExternalTexture = original;
        const abandoned = record(workload, device, false);
        assert.throws(() => workload.setSettings({ intensity: 1 }), /pending/);
        abandoned.pending.discard();
        const replacement = record(workload, device, false);
        abandoned.pending.commit();
        assert.equal(workload.getRuntimeStats().submittedDepthUpdates, 0);
        replacement.pending.commit();
        assert.equal(workload.getRuntimeStats().submittedDepthUpdates, 1);
        await workload.setModelBundle(minimalBundle());
        const nextModel = record(workload, device, false);
        assert.equal(nextModel.report.nodes.length, 2);
        workload.dispose();
        assert.doesNotThrow(() => { nextModel.pending.commit(); nextModel.pending.discard(); });
    } finally { restore(); }
});

test('history roots retain depth independently of presentation without retaining relight', async () => {
    const restore = installWebGpuGlobals();
    try {
        const device = fakeDevice();
        const workload = await createMonocularLightInjection({ device, outputFormat: 'bgra8unorm' });
        await workload.setModelBundle(minimalBundle());
        const recording = new FrameGraph(device).beginFrame();
        const color = recording.createTexture({ format: 'bgra8unorm', size: [32, 32], usage: GPUTextureUsage.RENDER_ATTACHMENT });
        const frame = workload.recordFrame(recording, { color, source: {} as VideoFrame, uvTransform: [1, 0, 0, 1], swapAxes: false, updateDepth: true });
        const report = recording.compile({ report: true }).compilationReport;
        assert.deepEqual(report.nodes.map((node) => node.label), ['monocular-light-injection.depth']);
        frame.discard(); workload.dispose();
    } finally { restore(); }
});

test('model loading enforces storage limits before replacing the active plan', async () => {
    const restore = installWebGpuGlobals();
    try {
        const device = fakeDevice({ maxStorageBufferBindingSize: 32 });
        const feature = await createMonocularLightInjection({ device, outputFormat: 'bgra8unorm' });
        await assert.rejects(feature.setModelBundle(minimalBundle()), /maxStorageBufferBindingSize/);
        assert.equal(feature.getRuntimeStats().ready, false);
        feature.dispose();
    } finally {
        restore();
    }
});

test('dispatch resources keep immutable byte storage separate from mutable scratch', () => {
    const nativeBuffers: GPUBuffer[] = [];
    const root = {
        createBuffer(_schema: unknown, initializer?: (value: { arrayBuffer: ArrayBuffer }) => void) {
            const native = { size: 4, usage: 128, destroy() {} } as GPUBuffer;
            nativeBuffers.push(native);
            if (initializer) initializer({ arrayBuffer: new ArrayBuffer(4) });
            return {
                native,
                $usage() { return this; },
                destroy() {},
            };
        },
        unwrap(resource: { native: GPUBuffer }) { return resource.native; },
    };
    const context = createDispatchContext(root as never, {} as never, {} as never, {} as never);
    const mutable = root.createBuffer(undefined);
    context.ownStorage(mutable as never);
    const readonly = context.storageFromBytes(new Uint8Array(4));
    assert.deepEqual(context.mutableStorageBuffers, [mutable.native]);
    assert.deepEqual(context.readonlyStorageBuffers, [readonly]);
    assert.notEqual(mutable.native, readonly);
});

test('overlapping model loads are rejected and destroy cancels pending replacement', async () => {
    const restore = installWebGpuGlobals();
    try {
        const device = fakeDevice();
        const feature = await createMonocularLightInjection({ device, outputFormat: 'bgra8unorm' });
        const resolvePipelines = deferPipelineCreation(device);
        const loading = feature.setModelBundle(minimalBundle());
        await assert.rejects(feature.setModelBundle(minimalBundle()), /while setModelBundle\(\) is still pending/);
        feature.dispose();
        resolvePipelines();
        await assert.rejects(loading, /was cancelled because the workload was disposed/);
    } finally {
        restore();
    }
});
