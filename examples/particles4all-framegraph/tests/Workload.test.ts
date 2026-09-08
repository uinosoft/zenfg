import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAccess, FrameGraph, type FrameGraphCompilationReport, type FrameGraphRecording } from '@zenfg/webgpu';
import { Particles4All } from '../src/Particles4AllFeature.ts';
import type { Particles4AllSettings } from '../src/particles4allTypes.ts';
import { createFakeDevice, createGpuTrace, installWebGpuGlobals } from './fakeWebGpu.ts';

const viewport = { width: 80, height: 40 };
const tinyScene = { targetParticleCount: 32, spacing: 0.05, box: [0.4, 0.4, 0.4] as [number, number, number], bodies: [], bodySize: 0 };

function createFixture(settings: Partial<Particles4AllSettings> = {}) {
    const restore = installWebGpuGlobals();
    const trace = createGpuTrace();
    const device = createFakeDevice(trace);
    const graph = new FrameGraph(device);
    const workload = new Particles4All({ device, viewport, outputFormat: 'bgra8unorm' });
    workload.applyImportedSettings({
        ...workload.getSettings(), displayMode: 'particles', timeScale: 1,
        substeps: 1, iterations: 2, meshResolution: 48, fieldSmooth: 1, normalSmooth: 1,
        ssfrIterations: 2, ssfrThicknessBlur: 2, ...settings,
    }, tinyScene);
    const start = (present = true) => {
        const recording = graph.beginFrame();
        const color = recording.importSwapchainTexture(device.createTexture({
            label: 'test.backbuffer', format: 'bgra8unorm', size: [viewport.width, viewport.height], usage: GPUTextureUsage.RENDER_ATTACHMENT,
        }), { label: 'test.backbuffer', exposedUsage: GPUTextureUsage.RENDER_ATTACHMENT });
        if (present) recording.markPresent(color);
        return { recording, color };
    };
    const record = (deltaTime = 1 / 60, present = true) => {
        const { recording, color } = start(present);
        const pending = workload.recordFrameGraph(recording, { color, deltaTime });
        const compiled = recording.compile({ report: true });
        return {
            pending, compiled, report: compiled.compilationReport,
            submit() { compiled.execute({ afterSubmit() { pending.commit(); return undefined; } }); },
        };
    };
    return {
        trace, device, workload, graph, start, record,
        dispose() { workload.dispose(); graph.destroy(); restore(); },
    };
}

const labels = (report: FrameGraphCompilationReport) => report.nodes.map(node => node.label ?? '');
const resourceLabels = (report: FrameGraphCompilationReport) => report.resources.map(resource => resource.label ?? '');
const particleRoot = (report: FrameGraphCompilationReport) => report.roots.find(root => (
    root.reason === 'persistent-state'
    && /\.pos[AB]$/.test(report.resources.find(resource => resource.id === root.resourceId)?.label ?? '')
));

for (const mode of ['particles', 'surface-mesh', 'ray-march', 'ssfr'] as const) {
    test(`${mode}: first, stable, and paused frames compile and execute through one submission`, async () => {
        const fixture = createFixture({ displayMode: mode });
        try {
            const { workload, trace, record } = fixture;
            assert.equal(workload.getStats().fluidParticleCount, 32);
            assert.equal(workload.getStats().bodyCount, 0);
            const first = record();
            assert.ok(labels(first.report).includes('particles4all.initialization.grid-scatter'));
            assert.ok(labels(first.report).includes('particles4all.substep-1.predict'));
            assert.ok(first.report.nodes.every(node => !node.sideEffect));
            assert.ok(first.report.roots.some(root => root.reason === 'present'));
            assert.ok(first.report.roots.some(root => root.reason === 'persistent-state'));
            assert.ok(first.report.roots.some(root => root.reason === 'readback'));
            assert.ok(!labels(first.report).some(label => label.includes('rigid-preparation') || label.includes('solid-packing')));
            assert.equal(trace.submits, 0, 'recording and compilation must not submit');
            assert.equal(trace.maps, 0, 'readback must wait for submission');
            first.submit();
            assert.equal(trace.submits, 1);
            assert.ok(trace.maps > 0);
            assert.ok(trace.dispatches > 0 && trace.draws > 0);
            await Promise.resolve();

            const stable = record();
            assert.ok(!labels(stable.report).some(label => label.startsWith('particles4all.initialization.')));
            assert.ok(labels(stable.report).includes('particles4all.substep-1.predict'));
            stable.submit();
            await Promise.resolve();

            workload.setSettings({ paused: true });
            const paused = record();
            assert.ok(!labels(paused.report).some(label => label.startsWith('particles4all.substep-')));
            paused.submit();
            assert.equal(trace.submits, 3);
            assert.ok(trace.renderPipelines.filter(pipeline => pipeline.depthStencil).every(pipeline => (
                pipeline.depthStencil!.format === 'depth24plus' && pipeline.depthStencil!.depthCompare === 'less'
            )), 'preserve upstream forward depth');
            assert.ok(trace.renderPasses.filter(pass => pass.depthStencilAttachment?.depthLoadOp === 'clear')
                .every(pass => pass.depthStencilAttachment!.depthClearValue === 1));
            assert.ok(!resourceLabels(first.report).some(label => /\.uni|\.frameUni|\.bpos|\.bpsi|\.bcellStart|environment/.test(label)),
                'CPU uniforms, boundary samples, and environment remain internal bindings');
            if (mode === 'particles') {
                assert.ok(!resourceLabels(first.report).some(label => /particles4all\.(ssfr|surface|ray)\./.test(label)));
            } else if (mode === 'ssfr') {
                assert.ok(resourceLabels(first.report).some(label => label.startsWith('particles4all.ssfr.')));
                assert.ok(!resourceLabels(first.report).some(label => label.startsWith('particles4all.surface.')));
            }
        } finally { fixture.dispose(); }
    });
}

for (const preset of ['small', 'medium', 'large'] as const) {
    test(`${preset}: mode switching with rigid bodies retains only the resources each branch unwraps`, async () => {
        const fixture = createFixture();
        try {
            const { workload, trace, record } = fixture;
            const presetSettings = workload.getPresetSettings(preset);
            workload.applyImportedSettings({ ...presetSettings, rigidBodiesEnabled: true }, {
                ...tinyScene, bodies: ['sphere:0.5'], bodySize: 0.12,
            });
            assert.equal(workload.getSettings().preset, preset);
            assert.equal(workload.getSettings().substeps, presetSettings.substeps);
            assert.equal(workload.getSettings().timeScale, presetSettings.timeScale);
            assert.ok(workload.getStats().bodyCount > 0);
            const transitions: Partial<Particles4AllSettings>[] = [
                { displayMode: 'ssfr' },
                { displayMode: 'particles' },
                { displayMode: 'surface-mesh', normalSmooth: 0, fieldSmooth: 0 },
                { displayMode: 'ray-march', raySurface: 'field', normalSmooth: 2, fieldSmooth: 2 },
                { displayMode: 'ray-march', raySurface: 'mesh' },
                { displayMode: 'ssfr', paused: true, ssfrIterations: 0, ssfrCleanupPass: false, ssfrThicknessBlur: 0 },
                { displayMode: 'particles', paused: true },
                { displayMode: 'ssfr', paused: false, ssfrIterations: presetSettings.ssfrIterations,
                    ssfrCleanupPass: presetSettings.ssfrCleanupPass, ssfrThicknessBlur: presetSettings.ssfrThicknessBlur },
            ];
            for (const [index, patch] of transitions.entries()) {
                workload.setSettings(patch);
                const frame = record();
                assert.equal(labels(frame.report).includes('particles4all.render.solid-packing'), patch.displayMode !== 'particles',
                    'particle rendering uses body phases without the packed-solid buffer');
                if (patch.displayMode === 'particles') {
                    const packed = frame.report.resources.find(resource => resource.label === 'particles4all.solids.packed');
                    assert.ok(!packed || packed.lifetime === undefined);
                    const retained = new Set(frame.report.nodes.map(node => node.id));
                    assert.ok(!packed || !frame.report.accesses.some(access => access.resourceId === packed.id && retained.has(access.nodeId)));
                }
                if (patch.paused) assert.ok(!labels(frame.report).some(label => label.startsWith('particles4all.substep-')));
                frame.submit();
                assert.equal(trace.submits, index + 1);
                await Promise.resolve();
            }
        } finally { fixture.dispose(); }
    });
}

test('persistent particle roots use active ranges and retain simulation when presentation is omitted', () => {
    const fixture = createFixture();
    try {
        const frame = fixture.record(1 / 60, false);
        assert.ok(!labels(frame.report).some(label => label.startsWith('particles4all.render.')));
        assert.ok(labels(frame.report).includes('particles4all.substep-1.commit'));
        const root = particleRoot(frame.report);
        assert.ok(root && root.reason !== 'side-effect');
        assert.deepEqual(root.range, { kind: 'buffer', offset: 0, size: 32 * 16 });
        const resource = frame.report.resources.find(resource => resource.id === root.resourceId)!;
        assert.equal(resource.origin, 'imported');
        assert.ok(resource.kind === 'buffer' && resource.descriptor.size > root.range.size,
            'unused pour capacity must not be a retention root');
        assert.ok(frame.report.resources.some(resource => resource.origin === 'transient' && resource.physicalAllocationId !== undefined));
        assert.ok(frame.report.accesses.some(access => access.access === BufferAccess.StorageWrite && access.contents === 'preserve'));
        frame.pending.discard();
    } finally { fixture.dispose(); }
});

test('odd and even constraint iterations keep prediction parity valid across submitted frames', async () => {
    const fixture = createFixture();
    try {
        for (const iterations of [1, 2, 3, 4]) {
            fixture.workload.setSettings({ iterations });
            const frame = fixture.record();
            assert.ok(labels(frame.report).some(label => label.includes(`iteration-${iterations}`)));
            frame.submit();
            await Promise.resolve();
        }
        assert.equal(fixture.trace.submits, 4);
    } finally { fixture.dispose(); }
});

test('rigid bodies contribute projection, packed render data, and pose readback dependencies', () => {
    const fixture = createFixture({ displayMode: 'ray-march' });
    try {
        fixture.workload.applyImportedSettings(fixture.workload.getSettings(), {
            ...tinyScene, bodies: ['sphere:0.5'], bodySize: 0.12,
        });
        assert.ok(fixture.workload.getStats().bodyCount > 0);
        const frame = fixture.record();
        assert.ok(labels(frame.report).some(label => label.endsWith('.rigid-preparation')));
        assert.ok(labels(frame.report).some(label => label.endsWith('.rigid-projection')));
        assert.ok(labels(frame.report).includes('particles4all.render.solid-packing'));
        assert.ok(frame.report.roots.some(root => root.reason === 'readback'
            && /pose-readback/.test(frame.report.resources.find(resource => resource.id === root.resourceId)?.label ?? '')));
        const count = frame.report.resources.find(resource => resource.label === 'particles4all.simulation.body-index-count')!;
        assert.ok(frame.report.accesses.filter(access => access.resourceId === count.id)
            .every(access => access.bufferRange?.size === 4), 'only idxCount[0] is written by the rigid kernels');
        const reference = frame.report.resources.find(resource => resource.label === 'particles4all.sim.bodyRef')!;
        assert.ok(frame.report.roots.some(root => root.reason === 'persistent-state' && root.resourceId === reference.id));
        for (const projection of frame.report.nodes.filter(node => node.label?.endsWith('.rigid-projection'))) {
            assert.ok(frame.report.accesses.some(access => access.nodeId === projection.id && access.resourceId === reference.id
                && access.mode === 'write' && access.contents === 'preserve'), 'bodySeed updates the reference centre within each projection');
        }
        frame.submit();
        assert.equal(fixture.trace.submits, 1);
    } finally { fixture.dispose(); }
});

test('body dragging initializes transient indices each frame and pointer impulses survive discarded recordings', () => {
    const fixture = createFixture({ grabEnabled: true });
    try {
        const { workload, record, trace } = fixture;
        workload.applyImportedSettings(workload.getSettings(), {
            ...tinyScene, bodies: ['sphere:0.5'], bodySize: 0.12,
            camera: [0, 0, 0.8, 0.2, 0.3, 0.2],
        });
        trace.deferMaps = true;
        assert.equal(workload.beginBodyDrag(0.5, 0.5), true);
        workload.applyPointerImpulse(0.49, 0.5, 0.51, 0.5);
        const discarded = record();
        assert.ok(labels(discarded.report).includes('particles4all.initialization.pointer-impulse'));
        discarded.pending.discard();
        for (let index = 0; index < 3; index++) {
            workload.updateBodyDrag(0.5 + index * 0.01, 0.5);
            const frame = record();
            assert.equal(labels(frame.report).includes('particles4all.initialization.pointer-impulse'), index === 0);
            const compact = frame.report.nodes.find(node => node.label === 'particles4all.initialization.drag-index')!;
            const predict = frame.report.nodes.find(node => node.label === 'particles4all.substep-1.predict')!;
            assert.ok(compact && predict);
            assert.ok(frame.report.dependencies.some(edge => edge.fromNodeId === compact.id && edge.toNodeId === predict.id && edge.kind === 'value'));
            frame.submit();
        }
        workload.setSettings({ paused: true });
        const paused = record();
        assert.ok(!labels(paused.report).some(label => label.includes('drag-index') || label.startsWith('particles4all.substep-')));
        paused.submit();
        workload.endBodyDrag();
        workload.setSettings({ paused: false });
        const released = record();
        assert.ok(!labels(released.report).some(label => label.includes('drag-index')));
        released.submit();
        assert.equal(trace.submits, 5);
    } finally { fixture.dispose(); }
});

test('a single particle declares only the scalar bytes actually written by simulation kernels', () => {
    const fixture = createFixture();
    try {
        fixture.workload.applyImportedSettings(fixture.workload.getSettings(), { ...tinyScene, targetParticleCount: 1 });
        const frame = fixture.record();
        const scalarIds = new Set(frame.report.resources.filter(resource => (
            resource.label === 'particles4all.sim.density'
            || resource.label === 'particles4all.simulation.lambda'
            || resource.label === 'particles4all.simulation.slot'
        )).map(resource => resource.id));
        const scalarWrites = frame.report.accesses.filter(access => scalarIds.has(access.resourceId)
            && access.access === BufferAccess.StorageWrite);
        assert.ok(scalarWrites.length >= 3);
        assert.ok(scalarWrites.every(access => access.bufferRange?.size === 4));
        frame.submit();
    } finally { fixture.dispose(); }
});

test('surface fields exclude capacity padding and variable-length vertices preserve initialized contents', () => {
    const fixture = createFixture({ displayMode: 'surface-mesh' });
    try {
        const frame = fixture.record();
        const uniform = fixture.trace.bufferWrites.filter(write => write.label === 'particles4all.mesh-uniform-axis-0').at(-1)!;
        const dimensions = new Int32Array(uniform.bytes.buffer, uniform.bytes.byteOffset, 3);
        const fieldBytes = dimensions[0]! * dimensions[1]! * dimensions[2]! * 4;
        const fields = frame.report.resources.filter(resource => /^particles4all\.surface\.(field|field-temporary|normal-field)$/.test(resource.label ?? ''));
        assert.ok(fields.length >= 2);
        for (const field of fields) {
            assert.ok(frame.report.accesses.filter(access => access.resourceId === field.id)
                .every(access => access.bufferRange!.size! <= fieldBytes), 'capacity padding is not produced by the field shaders');
        }
        const vertices = frame.report.resources.find(resource => resource.label === 'particles4all.surface.vertices')!;
        const march = frame.report.nodes.find(node => node.label === 'particles4all.surface.marching-cubes')!;
        const write = frame.report.accesses.find(access => access.resourceId === vertices.id && access.nodeId === march.id)!;
        assert.equal(write.contents, 'preserve', 'GPU-counted output does not overwrite the entire vertex allocation');
        assert.ok(frame.report.accesses.some(access => access.resourceId === vertices.id
            && access.nodeId !== march.id && access.mode === 'write' && access.contents === 'overwrite'));
        frame.submit();
    } finally { fixture.dispose(); }
});

test('time-bank remainder survives commit and discard, and timeScale applies after raw-gap limiting', () => {
    const fixture = createFixture();
    try {
        const sim = (fixture.workload as unknown as { native: { sim: {
            timeBank?: number; lastSubsteps?: number; lastAdvanced?: number; simTime?: number;
        } } }).native.sim;
        const timing = () => ({ timeBank: sim.timeBank ?? 0, substeps: sim.lastSubsteps ?? 0,
            advanced: sim.lastAdvanced ?? 0, simTime: sim.simTime ?? 0 });
        const before = timing();
        const initial = fixture.record(1 / 120);
        assert.ok(!labels(initial.report).some(label => label.startsWith('particles4all.substep-')));
        assert.deepEqual(timing(), before, 'recording does not publish the planned remainder');
        initial.submit();
        assert.equal(timing().timeBank, 1 / 120);
        const committed = timing();
        const discarded = fixture.record(1 / 120);
        assert.ok(labels(discarded.report).includes('particles4all.substep-1.predict'));
        assert.deepEqual(timing(), committed);
        discarded.pending.discard();
        assert.deepEqual(timing(), committed);
        const retry = fixture.record(1 / 120);
        assert.ok(labels(retry.report).includes('particles4all.substep-1.predict'));
        assert.ok(!labels(retry.report).includes('particles4all.substep-2.predict'));
        assert.deepEqual(timing(), committed);
        retry.submit();
        assert.equal(timing().timeBank, 0);
        assert.equal(timing().substeps, 1);
        assert.equal(timing().advanced, 1 / 60);
        fixture.workload.setSettings({ timeScale: 2 });
        const accelerated = fixture.record(0.05);
        assert.equal(labels(accelerated.report).filter(label => label.endsWith('.predict')).length, 6,
            'the old clamp of scaled time to 0.05 incorrectly limits this to three steps');
        accelerated.pending.discard();
    } finally { fixture.dispose(); }
});

test('SSFR filter and thickness branches follow current controls', () => {
    const fixture = createFixture({ displayMode: 'ssfr', ssfrIterations: 2, ssfrCleanupPass: true });
    try {
        const filtered = fixture.record();
        assert.ok(labels(filtered.report).includes('particles4all.ssfr.filter-2'));
        assert.ok(labels(filtered.report).includes('particles4all.ssfr.filter-cleanup'));
        assert.ok(labels(filtered.report).includes('particles4all.ssfr.thickness-blur-horizontal'));
        filtered.pending.discard();
        fixture.workload.setSettings({ ssfrIterations: 0, ssfrCleanupPass: false, ssfrThicknessBlur: 0 });
        const unfiltered = fixture.record();
        assert.ok(!labels(unfiltered.report).some(label => label.startsWith('particles4all.ssfr.filter-') || label.includes('thickness-blur')));
        unfiltered.submit();
    } finally { fixture.dispose(); }
});

test('field ray marching omits surface extraction and triangle readback', () => {
    const fixture = createFixture({ displayMode: 'ray-march', raySurface: 'field' });
    try {
        const frame = fixture.record();
        assert.ok(labels(frame.report).includes('particles4all.surface.density-field'));
        assert.ok(labels(frame.report).includes('particles4all.ray.composite'));
        assert.ok(!labels(frame.report).some(label => /marching-cubes|surface-gbuffer|triangle-count-readback/.test(label)));
        assert.ok(!resourceLabels(frame.report).includes('particles4all.surface.vertices'));
        frame.submit();
    } finally { fixture.dispose(); }
});

test('pour copies become visible only after commit and an abandoned schedule can be retried', () => {
    const fixture = createFixture({ pourSpeed: 10, pourWidth: 0.13 });
    try {
        const { workload, record } = fixture;
        const before = workload.getStats();
        workload.togglePour();
        const abandoned = record();
        assert.ok(labels(abandoned.report).some(label => label.endsWith('.pour-injection')));
        assert.equal(workload.getStats().fluidParticleCount, before.fluidParticleCount);
        const expectedRange = particleRoot(abandoned.report)!.range;
        abandoned.pending.discard();
        assert.equal(workload.getStats().pourRemaining, before.pourRemaining);
        const retry = record();
        assert.deepEqual(particleRoot(retry.report)!.range, expectedRange);
        abandoned.pending.commit();
        retry.submit();
        assert.ok(workload.getStats().fluidParticleCount > before.fluidParticleCount);
        const committedCount = workload.getStats().fluidParticleCount;
        retry.pending.commit(); retry.pending.discard();
        assert.equal(workload.getStats().fluidParticleCount, committedCount);
    } finally { fixture.dispose(); }
});

test('recording errors release pending state and frame settlement is idempotent and scoped', () => {
    const fixture = createFixture();
    try {
        const { workload, start, record } = fixture;
        const { recording, color } = start();
        const failing = new Proxy(recording, {
            get(target, property) {
                if (property === 'compute') return () => { throw new Error('mock recording failure'); };
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as FrameGraphRecording;
        assert.throws(() => workload.recordFrameGraph(failing, { color, deltaTime: 1 / 60 }), /mock recording failure/);
        const abandoned = record();
        assert.ok(labels(abandoned.report).includes('particles4all.initialization.grid-scatter'));
        assert.throws(() => workload.reset(), /pending|frame|idle/i);
        const settings = workload.getSettings();
        assert.throws(() => workload.setSettings({ paused: true }), /pending|frame|idle/i);
        assert.deepEqual(workload.getSettings(), settings);
        abandoned.pending.discard();
        const replacement = record();
        abandoned.pending.commit(); abandoned.pending.discard();
        assert.throws(() => workload.resize(64, 32), /pending|frame|idle/i);
        replacement.submit();
        replacement.pending.commit(); replacement.pending.discard();
        const stable = record();
        assert.ok(!labels(stable.report).some(label => label.startsWith('particles4all.initialization.')));
        workload.dispose();
        assert.doesNotThrow(() => { stable.pending.commit(); stable.pending.discard(); workload.dispose(); });
    } finally { fixture.dispose(); }
});

test('compile, encode, and submit failures can be discarded without consuming initialization', () => {
    const fixture = createFixture();
    try {
        const { workload, start, record, trace } = fixture;
        const { recording, color } = start();
        const pending = workload.recordFrameGraph(recording, { color, deltaTime: 1 / 60 });
        const undefinedInput = recording.createBuffer({ label: 'test.undefined', size: 16 });
        recording.compute({ label: 'test.invalid-read', sideEffect: true,
            uses: [recording.use(undefinedInput, BufferAccess.StorageRead)], encode() {} });
        assert.throws(() => recording.compile(), /undefined|uninitialized|producer/i);
        pending.discard();
        for (const failure of ['throwOnEncode', 'throwOnSubmit'] as const) {
            const frame = record();
            trace[failure] = true;
            assert.throws(() => frame.submit(), /mock.*failure/);
            trace[failure] = false;
            frame.pending.discard();
            assert.equal(trace.submits, 0);
            assert.equal(trace.maps, 0);
        }
        const retry = record();
        assert.ok(labels(retry.report).includes('particles4all.initialization.grid-scatter'));
        retry.submit();
        assert.equal(trace.submits, 1);
    } finally { fixture.dispose(); }
});

test('a scene over the device capacity is rejected before replacing current settings or resources', () => {
    const fixture = createFixture();
    try {
        const { workload, device, trace } = fixture;
        const before = workload.getSettings();
        const beforeStats = workload.getStats();
        const destroyed = trace.destroyedBuffers.length;
        (device.limits as unknown as { maxStorageBufferBindingSize: number }).maxStorageBufferBindingSize = 16;
        assert.throws(() => workload.applyImportedSettings({ ...before, gravity: 1 }, { ...tinyScene, targetParticleCount: 64 }), /capacity|limit|maxStorageBufferBindingSize|buffer/i);
        assert.deepEqual(workload.getSettings(), before);
        assert.deepEqual(workload.getStats(), beforeStats);
        assert.equal(trace.destroyedBuffers.length, destroyed);
    } finally { fixture.dispose(); }
});

test('busy readback slots are skipped and reset invalidates late maps from the old scene', async () => {
    const fixture = createFixture();
    try {
        fixture.trace.deferMaps = true;
        for (let index = 0; index < 3; index++) fixture.record().submit();
        assert.equal(fixture.trace.maps, 3);
        const busy = fixture.record();
        assert.ok(!busy.report.roots.some(root => root.reason === 'readback'));
        assert.ok(!labels(busy.report).some(label => label.startsWith('particles4all.diagnostics.')),
            'diagnostic reductions have no observable output while all staging slots are busy');
        busy.submit();
        assert.equal(fixture.trace.maps, 3, 'mapped staging buffers cannot be reused');
        fixture.workload.reset();
        const resetStats = fixture.workload.getStats();
        for (const resolve of fixture.trace.pendingMaps.splice(0)) resolve();
        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(fixture.workload.getStats(), resetStats);
        const reset = fixture.record();
        assert.ok(labels(reset.report).includes('particles4all.initialization.grid-scatter'));
        reset.pending.discard();
    } finally { fixture.dispose(); }
});
