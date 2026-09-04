import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BufferAccess,
    FrameGraph,
    TextureAccess,
    type FrameGraphCompilationReport,
    type FrameGraphRecorder,
    type TextureHandle,
} from '@zenfg/webgpu';
import {
    DEFAULT_SLIME_MOLD_AGENT_COUNT,
    DEFAULT_SLIME_MOLD_SETTINGS,
    TypeGpuSlimeMold,
} from '../src/index.ts';
import { createFakeDevice, createGpuTrace, installWebGpuGlobals } from './fakeWebGpu.ts';

function createRecording(
    device: GPUDevice,
    format: GPUTextureFormat = 'rgba8unorm',
): { recorder: FrameGraphRecorder; color: TextureHandle } {
    const recorder = new FrameGraph(device).beginFrame();
    const color = recorder.createTexture({
        label: 'test.color',
        format,
        size: [64, 32],
    });
    recorder.markOutput(color);
    return { recorder, color };
}

function resourceLabelForRenderSample(report: FrameGraphCompilationReport): string | undefined {
    const render = report.nodes.find((node) => node.label === 'slime-mold.render');
    const access = report.accesses.find((candidate) => (
        candidate.nodeId === render?.id && candidate.access === TextureAccess.Sampled
    ));
    return report.resources.find((resource) => resource.id === access?.resourceId)?.label;
}

test('records TypeGPU work without submitting and declares exact first-frame semantics', () => {
    const restore = installWebGpuGlobals();
    try {
        const trace = createGpuTrace();
        const device = createFakeDevice(trace);
        const simulation = new TypeGpuSlimeMold({
            device,
            viewport: { width: 64, height: 32 },
            outputFormat: 'rgba8unorm',
            agentCount: 16,
        });
        assert.equal(DEFAULT_SLIME_MOLD_AGENT_COUNT, 200_000);
        assert.ok(trace.shaderSources.length >= 5);
        assert.ok(trace.shaderSources.every((source) => !source.includes('use gpu')));
        assert.equal(trace.submits, 0);

        const { recorder, color } = createRecording(device);
        const pending = simulation.recordFrameGraph(recorder, { color, deltaTime: 1 / 60 });
        const compiled = recorder.compile({ report: true });
        const report = compiled.compilationReport;
        assert.deepEqual(report.nodes.map((node) => node.label), [
            'slime-mold.reset',
            'slime-mold.diffuse',
            'slime-mold.simulate',
            'slime-mold.render',
        ]);
        assert.deepEqual(report.debugGroups, []);
        assert.ok(report.nodes.every((node) => node.debugGroupId === undefined));

        const importedState = report.resources
            .filter((resource) => resource.label === 'slime-mold.agents'
                || resource.label?.startsWith('slime-mold.trail.'))
            .map((resource) => [resource.label, resource.origin, resource.initialContents]);
        assert.deepEqual(importedState, [
            ['slime-mold.agents', 'imported', 'undefined'],
            ['slime-mold.trail.0', 'imported', 'undefined'],
            ['slime-mold.trail.1', 'imported', 'undefined'],
        ]);

        const labelsByResource = new Map(report.resources.map((resource) => [resource.id, resource.label]));
        const accessesFor = (nodeLabel: string) => {
            const nodeId = report.nodes.find((node) => node.label === nodeLabel)?.id;
            return report.accesses
                .filter((access) => access.nodeId === nodeId)
                .map((access) => ({
                    resource: labelsByResource.get(access.resourceId),
                    access: access.access,
                    mode: access.mode,
                    contents: access.contents,
                }));
        };
        assert.deepEqual(accessesFor('slime-mold.diffuse'), [
            { resource: 'slime-mold.params', access: BufferAccess.Uniform, mode: 'read', contents: undefined },
            { resource: 'slime-mold.trail.0', access: TextureAccess.StorageRead, mode: 'read', contents: undefined },
            { resource: 'slime-mold.trail.1', access: TextureAccess.StorageWrite, mode: 'write', contents: 'overwrite' },
        ]);
        assert.deepEqual(accessesFor('slime-mold.simulate'), [
            { resource: 'slime-mold.agents', access: BufferAccess.StorageRead, mode: 'read', contents: undefined },
            { resource: 'slime-mold.params', access: BufferAccess.Uniform, mode: 'read', contents: undefined },
            { resource: 'slime-mold.delta-time', access: BufferAccess.Uniform, mode: 'read', contents: undefined },
            { resource: 'slime-mold.trail.0', access: TextureAccess.StorageRead, mode: 'read', contents: undefined },
            { resource: 'slime-mold.agents', access: BufferAccess.StorageWrite, mode: 'write', contents: 'overwrite' },
            { resource: 'slime-mold.trail.1', access: TextureAccess.StorageWrite, mode: 'write', contents: 'preserve' },
        ]);
        const persistentLabels = report.roots
            .filter((root) => root.reason === 'persistent-state')
            .map((root) => labelsByResource.get(root.resourceId ?? -1));
        assert.deepEqual(persistentLabels, ['slime-mold.agents', 'slime-mold.trail.1']);
        assert.equal(report.nodes.some((node) => node.sideEffect), false);
        assert.equal(trace.submits, 0);

        compiled.execute({
            afterSubmit: () => {
                pending.commit();
                return undefined;
            },
        });
        assert.equal(trace.submits, 1);
        assert.equal(trace.dispatches, 5);
        assert.equal(trace.draws, 1);
        simulation.destroy();
        simulation.destroy();
        assert.equal(trace.destroyedBuffers.length, 4);
        assert.equal(trace.destroyedTextures.length, 2);
    } finally {
        restore();
    }
});

test('commit advances ping-pong while discard preserves index and retries reset', () => {
    const restore = installWebGpuGlobals();
    try {
        const device = createFakeDevice(createGpuTrace());
        const simulation = new TypeGpuSlimeMold({
            device,
            viewport: { width: 64, height: 32 },
            outputFormat: 'rgba8unorm',
            agentCount: 8,
        });

        const first = createRecording(device);
        const discarded = simulation.recordFrameGraph(first.recorder, {
            color: first.color,
            deltaTime: 0.01,
        });
        const firstReport = first.recorder.compile({ report: true }).compilationReport;
        assert.equal(resourceLabelForRenderSample(firstReport), 'slime-mold.trail.1');
        discarded.discard();
        discarded.discard();

        const retry = createRecording(device);
        const committed = simulation.recordFrameGraph(retry.recorder, {
            color: retry.color,
            deltaTime: 0.01,
        });
        const retryCompiled = retry.recorder.compile({ report: true });
        assert.ok(retryCompiled.compilationReport.nodes.some((node) => node.label === 'slime-mold.reset'));
        assert.equal(resourceLabelForRenderSample(retryCompiled.compilationReport), 'slime-mold.trail.1');
        retryCompiled.execute({
            afterSubmit: () => {
                committed.commit();
                return undefined;
            },
        });
        committed.commit();

        const steady = createRecording(device);
        const steadyPending = simulation.recordFrameGraph(steady.recorder, {
            color: steady.color,
            deltaTime: 0.01,
        });
        const steadyReport = steady.recorder.compile({ report: true }).compilationReport;
        assert.deepEqual(steadyReport.nodes.map((node) => node.label), [
            'slime-mold.diffuse',
            'slime-mold.simulate',
            'slime-mold.render',
        ]);
        assert.equal(resourceLabelForRenderSample(steadyReport), 'slime-mold.trail.0');
        assert.ok(steadyReport.resources
            .filter((resource) => resource.label === 'slime-mold.agents'
                || resource.label?.startsWith('slime-mold.trail.'))
            .every((resource) => resource.initialContents === 'defined'));
        steadyPending.discard();

        const afterDiscard = createRecording(device);
        const afterDiscardPending = simulation.recordFrameGraph(afterDiscard.recorder, {
            color: afterDiscard.color,
            deltaTime: 0.01,
        });
        const afterDiscardReport = afterDiscard.recorder.compile({ report: true }).compilationReport;
        assert.equal(resourceLabelForRenderSample(afterDiscardReport), 'slime-mold.trail.0');
        assert.equal(afterDiscardReport.nodes.some((node) => node.label === 'slime-mold.reset'), false);
        afterDiscardPending.discard();
        simulation.destroy();
    } finally {
        restore();
    }
});

test('validates settings, device limits, lifecycle, and resize reset state', () => {
    const restore = installWebGpuGlobals();
    try {
        const trace = createGpuTrace();
        const device = createFakeDevice(trace);
        const simulation = new TypeGpuSlimeMold({
            device,
            viewport: { width: 64, height: 32 },
            outputFormat: 'rgba8unorm',
            agentCount: 8,
        });
        assert.deepEqual(simulation.getSettings(), DEFAULT_SLIME_MOLD_SETTINGS);
        simulation.setSettings({ moveSpeed: 75, evaporationRate: 0.1 });
        assert.equal(simulation.getSettings().moveSpeed, 75);
        assert.equal(simulation.getSettings().evaporationRate, 0.1);
        assert.throws(() => simulation.setSettings({ sensorAngle: Math.PI }), /sensorAngle/);
        assert.throws(() => simulation.setSettings({ sensorDistance: Number.NaN }), /sensorDistance/);

        const initialTrailCreates = trace.textureCreates.length;
        simulation.resize(64, 32);
        assert.equal(trace.textureCreates.length, initialTrailCreates);

        const frame = createRecording(device);
        const pending = simulation.recordFrameGraph(frame.recorder, {
            color: frame.color,
            deltaTime: 0.01,
        });
        assert.throws(() => simulation.resize(80, 40), /frame is pending/);
        assert.throws(() => simulation.recordFrameGraph(frame.recorder, {
            color: frame.color,
            deltaTime: 0.01,
        }), /frame is pending/);
        pending.discard();

        simulation.resize(80, 40);
        assert.equal(trace.textureCreates.length, initialTrailCreates + 2);
        const resized = createRecording(device);
        const resizedPending = simulation.recordFrameGraph(resized.recorder, {
            color: resized.color,
            deltaTime: 0.01,
        });
        const resizedReport = resized.recorder.compile({ report: true }).compilationReport;
        assert.ok(resizedReport.nodes.some((node) => node.label === 'slime-mold.reset'));
        assert.ok(resizedReport.resources
            .filter((resource) => resource.label === 'slime-mold.agents'
                || resource.label?.startsWith('slime-mold.trail.'))
            .every((resource) => resource.initialContents === 'undefined'));
        resizedPending.discard();

        const wrongFormat = createRecording(device, 'bgra8unorm');
        assert.throws(() => simulation.recordFrameGraph(wrongFormat.recorder, {
            color: wrongFormat.color,
            deltaTime: 0.01,
        }), /color format/);
        simulation.destroy();
        assert.throws(() => simulation.getSettings(), /destroyed/);

        assert.throws(() => new TypeGpuSlimeMold({
            device: createFakeDevice(createGpuTrace(), { maxTextureDimension2D: 32 }),
            viewport: { width: 64, height: 32 },
            outputFormat: 'rgba8unorm',
            agentCount: 8,
        }), /maxTextureDimension2D/);
        assert.throws(() => new TypeGpuSlimeMold({
            device: createFakeDevice(createGpuTrace(), { maxStorageBufferBindingSize: 32 }),
            viewport: { width: 64, height: 32 },
            outputFormat: 'rgba8unorm',
            agentCount: 8,
        }), /maxStorageBufferBindingSize/);
    } finally {
        restore();
    }
});
