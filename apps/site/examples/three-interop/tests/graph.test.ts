import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';
import type { ThreeLayer } from '../src/bridge.ts';
import { recordCoRendering } from '../src/graph.ts';

after(installWebGpuGlobals());
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function setup(reverseZ = false) {
    const { device, trace } = createFakeGpu();
    const graph = new FrameGraph(device);
    const reference = createReferenceRenderer(device, { maxInstances: 1 });
    reference.setInstances([{ shape: 'cube', transform: identity(), color: [1, 0.5, 0] }]);
    const attachments = {
        color: device.createTexture({ format: 'rgba16float', size: [64, 48], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
        depth: device.createTexture({ format: 'depth32float', size: [64, 48], usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    };
    const three: ThreeLayer = {
        device, reverseZ,
        getAttachments: () => attachments,
        render() { trace.events.push('three-render'); device.queue.submit([]); },
    };
    return { device, trace, graph, reference, attachments, three };
}

for (const reverseZ of [false, true]) {
    test(`co-rendering imports each attachment once and retains both renderers from color output (${reverseZ ? 'reverse' : 'forward'} Z)`, t => {
        const { trace, graph, reference, attachments, three } = setup(reverseZ);
        t.after(() => { reference.destroy(); graph.destroy(); });
        const frame = graph.beginFrame();
        const imports = t.mock.method(frame, 'importTexture');
        const record = t.mock.method(reference, 'record');
        const viewProjection = identity();
        const { color, depth } = recordCoRendering(frame, three, reference, viewProjection);
        assert.equal(imports.mock.callCount(), 2);
        assert.deepEqual(imports.mock.calls.map(call => call.arguments[0]), [attachments.color, attachments.depth]);
        assert.equal(record.mock.callCount(), 1);
        const options = record.mock.calls[0].arguments[1];
        assert.equal(options.viewProjection, viewProjection);
        assert.equal(options.depthConvention, reverseZ ? 'reverse-z' : 'forward-z');
        assert.deepEqual(options.color, { target: color, loadOp: 'load', storeOp: 'store' });
        assert.deepEqual(options.depth, { target: depth, depthLoadOp: 'load', depthStoreOp: 'store' });
        frame.markOutput(color);
        const compiled = frame.compile({ report: true });
        const report = compiled.compilationReport;
        const external = report.nodes.find(node => node.kind === 'external-submission');
        const draw = report.nodes.find(node => node.kind === 'render');
        assert.ok(external);
        assert.ok(draw);
        assert.equal(report.nodes.filter(node => node.kind === 'compute').length, 2);
        assert.equal(report.culledNodes.length, 0);
        const textures = report.resources.filter(resource => resource.kind === 'texture');
        assert.equal(textures.length, 2);
        assert.ok(textures.every(resource => resource.origin === 'imported'));
        const writes = report.accesses.filter(access => access.nodeId === external.id);
        assert.deepEqual(writes.map(access => access.access).sort(), [TextureAccess.ColorAttachmentWrite, TextureAccess.DepthWrite].sort());
        assert.ok(writes.every(access => access.contents === 'overwrite'));
        for (const write of writes) {
            assert.ok(report.accesses.some(access => access.nodeId === draw.id && access.resourceId === write.resourceId && access.contents === 'preserve'));
        }
        assert.ok(report.dependencies.some(edge => edge.fromNodeId === external.id && edge.toNodeId === draw.id && edge.kind === 'value'));
        assert.ok(!trace.events.includes('three-render'), 'recording and compilation must not render');
        compiled.execute();
        assert.equal(trace.events.filter(event => event === 'three-render').length, 1);
        assert.ok(trace.events.indexOf('three-render') < trace.events.indexOf('render'));
        assert.equal(trace.submits, 2, 'one Three submission and one graph submission');
        assert.equal(trace.indirectDraws.length, 3);
        assert.equal(trace.renderPasses.length, 1);
        assert.equal(Array.from(trace.renderPasses[0].colorAttachments)[0]!.loadOp, 'load');
        assert.equal(trace.renderPasses[0].depthStencilAttachment!.depthLoadOp, 'load');
        assert.equal(trace.renderPipelines[0].depthStencil!.depthCompare, reverseZ ? 'greater' : 'less');
        reference.destroy(); graph.destroy();
        assert.ok(!trace.destroyedTextures.includes(attachments.color));
        assert.ok(!trace.destroyedTextures.includes(attachments.depth));
        assert.equal(trace.deviceDestroys, 0);
    });
}

test('without output roots both Three submission and reference drawing are culled', t => {
    const { trace, graph, reference, three } = setup();
    t.after(() => { reference.destroy(); graph.destroy(); });
    const frame = graph.beginFrame();
    recordCoRendering(frame, three, reference, identity());
    const compiled = frame.compile({ report: true });
    assert.equal(compiled.compilationReport.nodes.length, 0);
    assert.equal(compiled.compilationReport.culledNodes.length, 4);
    compiled.execute();
    assert.ok(!trace.events.includes('three-render'));
    assert.equal(trace.submits, 0);
    assert.equal(trace.dispatches.length, 0);
    assert.equal(trace.indirectDraws.length, 0);
});

test('execution rejects a Three device mismatch before Three renders or submits', t => {
    const { trace, graph, reference, three } = setup();
    t.after(() => { reference.destroy(); graph.destroy(); });
    const other = createFakeGpu();
    const frame = graph.beginFrame();
    const { color } = recordCoRendering(frame, { ...three, device: other.device }, reference, identity());
    frame.markOutput(color);
    const compiled = frame.compile();
    assert.throws(() => compiled.execute(), /Three\.js and ZenFG must share the same GPUDevice/);
    assert.ok(!trace.events.includes('three-render'));
    assert.equal(trace.submits, 0);
    assert.equal(other.trace.submits, 0);
    assert.equal(trace.indirectDraws.length, 0);
});
