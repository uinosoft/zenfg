import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';
import { createViewportTexture, recordPortal } from '../src/graph.ts';
import { createCity } from '../src/scene.ts';
import { initialCamera, portalLayout, viewProjection } from '../src/view.ts';

after(installWebGpuGlobals());

function setup() {
    const { device, trace } = createFakeGpu();
    const graph = new FrameGraph(device);
    const reference = createReferenceRenderer(device, { maxInstances: 64 });
    reference.setInstances(createCity());
    const viewport = createViewportTexture(device, 128);
    const canvas = device.createTexture({ format: 'bgra8unorm', size: [320, 240], usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const pixi = { device, render() { trace.events.push('pixi-render'); device.queue.submit([]); } };
    return { device, trace, graph, reference, viewport, canvas, pixi,
        dispose() { reference.destroy(); graph.destroy(); } };
}

test('one shared image connects native rendering to Pixi and the present root', t => {
    const s = setup();
    t.after(s.dispose);
    const frame = s.graph.beginFrame();
    const imported = t.mock.method(frame, 'importTexture');
    const output = recordPortal(frame, s.reference, s.pixi, s.viewport, s.canvas, viewProjection(initialCamera));
    frame.markPresent(output);
    const compiled = frame.compile({ report: true });
    assert.equal(imported.mock.callCount(), 1);
    assert.equal(imported.mock.calls[0].arguments[0], s.viewport);
    const report = compiled.compilationReport;
    const external = report.nodes.find(node => node.kind === 'external-submission')!;
    const draw = report.nodes.find(node => node.kind === 'render')!;
    assert.equal(report.nodes.length, 4);
    assert.equal(report.culledNodes.length, 0);
    const shared = report.resources.find(resource => resource.label === 'portal.3d-color')!;
    assert.ok(report.accesses.some(access => access.nodeId === external.id && access.resourceId === shared.id && access.access === TextureAccess.Sampled));
    assert.ok(report.dependencies.some(edge => edge.fromNodeId === draw.id && edge.toNodeId === external.id && edge.kind === 'value'));
    assert.ok(!s.trace.events.includes('pixi-render'), 'recording and compilation must not render');
    compiled.execute();
    assert.equal(s.trace.submits, 2);
    assert.ok(s.trace.events.indexOf('submit') < s.trace.events.indexOf('pixi-render'), 'native commands are submitted before Pixi samples them');
    assert.equal(s.trace.renderPipelines[0].fragment?.targets[0]?.format, 'bgra8unorm-srgb');
    s.dispose();
    assert.ok(!s.trace.destroyedTextures.includes(s.viewport));
    assert.ok(!s.trace.destroyedTextures.includes(s.canvas));
    assert.equal(s.trace.deviceDestroys, 0);
});

test('without a present root the entire composition, including Pixi, is culled', t => {
    const s = setup();
    t.after(s.dispose);
    const frame = s.graph.beginFrame();
    recordPortal(frame, s.reference, s.pixi, s.viewport, s.canvas, viewProjection(initialCamera));
    const compiled = frame.compile({ report: true });
    assert.equal(compiled.compilationReport.nodes.length, 0);
    compiled.execute();
    assert.equal(s.trace.submits, 0);
    assert.ok(!s.trace.events.includes('pixi-render'));
});

test('the external boundary rejects a mismatched Pixi device', t => {
    const s = setup();
    t.after(s.dispose);
    const frame = s.graph.beginFrame();
    const pixi = { ...s.pixi, device: createFakeGpu().device };
    frame.markPresent(recordPortal(frame, s.reference, pixi, s.viewport, s.canvas, viewProjection(initialCamera)));
    assert.throws(() => frame.compile().execute(), /same GPUDevice/);
    assert.ok(!s.trace.events.includes('pixi-render'));
});

test('viewport replacement preserves graph behavior and uses the new dimensions', t => {
    const s = setup();
    t.after(s.dispose);
    for (const size of [128, 192, 96]) {
        const viewport = createViewportTexture(s.device, size);
        const frame = s.graph.beginFrame();
        frame.markPresent(recordPortal(frame, s.reference, s.pixi, viewport, s.canvas, viewProjection(initialCamera)));
        const compiled = frame.compile({ report: true });
        const depth = compiled.compilationReport.resources.find(resource => resource.label === 'portal.3d-depth');
        assert.ok(depth);
        compiled.execute();
        viewport.destroy();
    }
    assert.equal(s.trace.submits, 6);
});

test('compact layout keeps the circular portal and its default lens within the canvas', () => {
    for (const [width, height] of [[320, 240], [390, 290], [900, 460]]) {
        const layout = portalLayout(width, height);
        assert.ok(layout.cx - layout.radius >= 0 && layout.cx + layout.radius <= width);
        assert.ok(layout.cy - layout.radius >= 0 && layout.cy + layout.radius <= height - 42);
        assert.ok(layout.lensX + layout.lensRadius < width);
    }
});