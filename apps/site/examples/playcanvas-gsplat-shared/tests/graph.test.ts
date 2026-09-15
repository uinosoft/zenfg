import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';
import { recordCoRendering, type SplatLayer } from '../src/graph.ts';
import { createComposite } from '../src/composite.ts';
after(installWebGpuGlobals());
const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
function fixture() {
    const { device, trace } = createFakeGpu();
    const graph = new FrameGraph(device), reference = createReferenceRenderer(device, { maxInstances: 1 });
    reference.setInstances([{ shape: 'cube', color: [1,0.5,0], transform: identity }]);
    const attachments = {
        color: device.createTexture({ format: 'rgba8unorm', size: [32,32], usage: 20 }),
        depth: device.createTexture({ format: 'depth32float', size: [32,32], usage: 16 }),
    };
    const layer: SplatLayer = { device, getAttachments: () => attachments,
        render() { trace.events.push('external'); device.queue.submit([]); } };
    return { device, trace, graph, reference, layer };
}
test('native producer, external consumer and composite retain one shared depth and submit in order', t => {
    const { device, trace, graph, reference, layer } = fixture();
    t.after(() => { reference.destroy(); graph.destroy(); });
    const frame = graph.beginFrame(), imports = t.mock.method(frame, 'importTexture');
    const handles = recordCoRendering(frame, layer, reference, identity, 0, 'test');
    assert.equal(imports.mock.callCount(), 2);
    const target = frame.importTexture(device.createTexture({ format: 'rgba8unorm', size: [32,32], usage: 16 }));
    createComposite(device, 'rgba8unorm', 'test')(frame, handles.color, handles.splatColor, target);
    frame.markOutput(target);
    const compiled = frame.compile({ report: true });
    const report = compiled.compilationReport;
    assert.equal(trace.submits, 0);
    assert.deepEqual(report.nodes.map(n => n.label), ['Reset','Cull','Draw','test.playcanvas','test.composite-present']);
    const external = report.nodes.find(n => n.kind === 'external-submission')!;
    assert.deepEqual(report.accesses.filter(a => a.nodeId === external.id).map(a => a.access).sort(),
        [TextureAccess.DepthRead, TextureAccess.ColorAttachmentWrite].sort());
    compiled.execute();
    assert.equal(trace.submits, 3, 'fixture has exactly one external submit, bracketed by two native submissions');
    assert.equal(trace.events.filter(e => e === 'external').length, 1);
    assert.equal(trace.renderPasses[0].depthStencilAttachment!.depthClearValue, 1);
    assert.equal(trace.renderPipelines[1].depthStencil?.depthCompare ?? trace.renderPipelines[0].depthStencil?.depthCompare, 'less');
});
test('without a root the entire composition is culled and never calls PlayCanvas', t => {
    const { trace, graph, reference, layer } = fixture();
    t.after(() => { reference.destroy(); graph.destroy(); });
    const frame = graph.beginFrame();
    recordCoRendering(frame, layer, reference, identity, 0, 'test');
    const compiled = frame.compile({ report: true });
    assert.equal(compiled.compilationReport.nodes.length, 0);
    compiled.execute();
    assert.equal(trace.submits, 0);
});
test('external execution rejects a different device', t => {
    const { graph, reference, layer } = fixture();
    t.after(() => { reference.destroy(); graph.destroy(); });
    const frame = graph.beginFrame();
    const handles = recordCoRendering(frame, { ...layer, device: createFakeGpu().device }, reference, identity, 0, 'test');
    frame.markOutput(handles.splatColor);
    assert.throws(() => frame.compile().execute(), /one GPUDevice/);
});
