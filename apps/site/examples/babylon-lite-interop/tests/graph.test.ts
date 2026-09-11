import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';
import type { BabylonLiteLayer } from '../src/bridge.ts';
import { recordCoRendering } from '../src/graph.ts';
import { createAttachmentResolver } from '../src/resolve.ts';

after(installWebGpuGlobals());
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function setup() {
    const { device, trace } = createFakeGpu();
    const graph = new FrameGraph(device);
    const reference = createReferenceRenderer(device, { maxInstances: 1 });
    reference.setInstances([{ shape: 'cube', transform: identity(), color: [1, 0.5, 0] }]);
    const attachments = {
        color: device.createTexture({ format: 'rgba16float', size: [64, 48], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
        depth: device.createTexture({ format: 'depth32float', size: [64, 48], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
    };
    const babylon: BabylonLiteLayer = {
        device,
        getAttachments: () => attachments,
        render() { trace.events.push('lite-render'); device.queue.submit([]); },
    };
    return { device, trace, graph, reference, attachments, babylon };
}

test(`co-rendering imports each attachment once and retains both renderers from color output (reverse Z)`, t => {
    const { trace, graph, reference, attachments, babylon } = setup();
    t.after(() => { reference.destroy(); graph.destroy(); });
    const frame = graph.beginFrame();
    const imports = t.mock.method(frame, 'importTexture');
    const record = t.mock.method(reference, 'record');
    const viewProjection = identity();
    const { color, depth } = recordCoRendering(frame, babylon, reference, viewProjection, createAttachmentResolver(babylon.device));
    assert.equal(imports.mock.callCount(), 2);
    assert.deepEqual(imports.mock.calls.map(call => call.arguments[0]), [attachments.color, attachments.depth]);
    assert.equal(record.mock.callCount(), 1);
    const options = record.mock.calls[0].arguments[1];
    assert.equal(options.viewProjection, viewProjection);
    assert.equal(options.depthConvention, 'reverse-z');
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
    assert.equal(textures.length, 3);
    assert.equal(textures.filter(resource => resource.origin === 'imported').length, 2);
    const writes = report.accesses.filter(access => access.nodeId === external.id);
    assert.deepEqual(writes.map(access => access.access).sort(), [TextureAccess.ColorAttachmentWrite, TextureAccess.DepthWrite].sort());
    assert.ok(writes.every(access => access.contents === 'overwrite'));
    const nativeColorId = report.resources.find(resource => resource.label === 'babylon-lite-interop.native-color')!.id;
    const nativeDepthId = report.resources.find(resource => resource.label === 'babylon-lite-interop.native-depth')!.id;
    const referenceDraw = report.nodes.find(node => node.label === 'Draw')!;
    assert.ok(report.accesses.some(access => access.nodeId === draw.id && access.resourceId === nativeColorId && access.access === TextureAccess.Sampled));
    assert.ok(report.accesses.some(access => access.nodeId === referenceDraw.id && access.resourceId === nativeDepthId
        && access.access === TextureAccess.DepthWrite && access.contents === 'preserve'));
    assert.equal(report.accesses.filter(access => access.nodeId === draw.id).some(access => access.resourceId === nativeDepthId), false);
    assert.ok(report.dependencies.some(edge => edge.fromNodeId === external.id && edge.toNodeId === draw.id && edge.kind === 'value'));
    assert.ok(!trace.events.includes('lite-render'), 'recording and compilation must not render');
    compiled.execute();
    assert.equal(trace.events.filter(event => event === 'lite-render').length, 1);
    assert.ok(trace.events.indexOf('lite-render') < trace.events.indexOf('render'));
    assert.equal(trace.submits, 2, 'one Lite submission and one graph submission');
    assert.equal(trace.indirectDraws.length, 3);
    assert.equal(trace.renderPasses.length, 2);
    assert.equal(trace.renderPasses[0].depthStencilAttachment, undefined);
    assert.equal(Array.from(trace.renderPasses[1].colorAttachments)[0]!.loadOp, 'load');
    assert.equal(trace.renderPasses[1].depthStencilAttachment!.depthLoadOp, 'load');
    assert.equal(trace.renderPipelines[0].depthStencil, undefined);
    assert.equal(trace.renderPipelines[1].depthStencil!.depthCompare, 'greater');
    reference.destroy(); graph.destroy();
    assert.ok(!trace.destroyedTextures.includes(attachments.color));
    assert.ok(!trace.destroyedTextures.includes(attachments.depth));
    assert.equal(trace.deviceDestroys, 0);
});

test('without output roots both Lite submission and reference drawing are culled', t => {
    const { trace, graph, reference, babylon } = setup();
    t.after(() => { reference.destroy(); graph.destroy(); });
    const frame = graph.beginFrame();
    recordCoRendering(frame, babylon, reference, identity(), createAttachmentResolver(babylon.device));
    const compiled = frame.compile({ report: true });
    assert.equal(compiled.compilationReport.nodes.length, 0);
    assert.equal(compiled.compilationReport.culledNodes.length, 5);
    compiled.execute();
    assert.ok(!trace.events.includes('lite-render'));
    assert.equal(trace.submits, 0);
    assert.equal(trace.dispatches.length, 0);
    assert.equal(trace.indirectDraws.length, 0);
});

test('execution rejects a Lite device mismatch before Lite renders or submits', t => {
    const { trace, graph, reference, babylon } = setup();
    t.after(() => { reference.destroy(); graph.destroy(); });
    const other = createFakeGpu();
    const frame = graph.beginFrame();
    const { color } = recordCoRendering(frame, { ...babylon, device: other.device }, reference, identity(), createAttachmentResolver(babylon.device));
    frame.markOutput(color);
    const compiled = frame.compile();
    assert.throws(() => compiled.execute(), /Babylon Lite and ZenFG must share the same GPUDevice/);
    assert.ok(!trace.events.includes('lite-render'));
    assert.equal(trace.submits, 0);
    assert.equal(other.trace.submits, 0);
    assert.equal(trace.indirectDraws.length, 0);
});
