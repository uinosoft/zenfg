import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { FrameGraph, TextureAccess } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';
import { createSharedTexture, recordSurface } from '../src/graph.ts';
import { createScene, screenVertices } from '../src/scene.ts';
import { initialCamera, renderSize, viewProjection } from '../src/view.ts';
import { advanceMotions, createMotions } from '../src/motion.ts';

after(installWebGpuGlobals());
function setup() {
    const { device, trace } = createFakeGpu();
    const graph = new FrameGraph(device);
    const reference = createReferenceRenderer(device, { maxInstances: 3 });
    reference.setInstances(createScene(0));
    const shared = createSharedTexture(device);
    const canvas = device.createTexture({ format: 'bgra8unorm', size: [320,240], usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const pixi = { device, render() { trace.events.push('pixi-render'); device.queue.submit([]); } };
    function record() {
        const frame = graph.beginFrame();
        const output = recordSurface(frame, reference, pixi, shared, canvas, [640,480], viewProjection(initialCamera, 4/3),
            { draw() { trace.events.push('screen-draw'); } }, { draw() {} });
        return { frame, output };
    }
    return { device, trace, graph, reference, shared, canvas, pixi, record,
        dispose() { reference.destroy(); graph.destroy(); shared.destroy(); canvas.destroy(); } };
}
test('Pixi writes before screen sampling; native color and depth continue into the screen pass', t => {
    const s = setup(); t.after(s.dispose);
    const { frame, output } = s.record(); frame.markPresent(output);
    const compiled = frame.compile({ report: true }), report = compiled.compilationReport;
    assert.equal(report.nodes.length, 6);
    const pixi = report.nodes.find(n => n.label === 'surface.pixi-animation')!;
    const screen = report.nodes.find(n => n.label === 'surface.draw-screen')!;
    const shared = report.resources.filter(r => r.label === 'surface.pixi-color');
    assert.equal(shared.length, 1);
    assert.ok(report.dependencies.some(e => e.fromNodeId === pixi.id && e.toNodeId === screen.id && e.kind === 'value'));
    assert.ok(report.accesses.some(a => a.nodeId === screen.id && a.resourceId === shared[0].id && a.access === TextureAccess.Sampled));
    for (const label of ['surface.scene-color', 'surface.scene-depth']) {
        const resource = report.resources.find(r => r.label === label)!;
        assert.ok(report.accesses.some(a => a.nodeId === screen.id && a.resourceId === resource.id));
    }
    assert.ok(!s.trace.events.includes('pixi-render'));
    compiled.execute();
    assert.equal(s.trace.events.filter(e => e === 'pixi-render').length, 1);
    assert.ok(s.trace.events.indexOf('pixi-render') < s.trace.events.indexOf('screen-draw'));
    const screenPass = s.trace.renderPasses.at(-2)!;
    assert.equal(Array.from(screenPass.colorAttachments)[0]?.loadOp, 'load');
    assert.equal(screenPass.depthStencilAttachment?.depthReadOnly, true);
});
test('no present root culls the entire graph, including external rendering', t => {
    const s = setup(); t.after(s.dispose);
    const { frame } = s.record();
    const compiled = frame.compile({ report: true });
    assert.equal(compiled.compilationReport.nodes.length, 0);
    compiled.execute(); assert.equal(s.trace.submits, 0);
});
test('consecutive frames import the same persistent image once per frame', t => {
    const s = setup(); t.after(s.dispose);
    for (let i = 0; i < 3; i++) {
        const { frame, output } = s.record(); frame.markPresent(output);
        const compiled = frame.compile({ report: true });
        assert.equal(compiled.compilationReport.resources.filter(r => r.label === 'surface.pixi-color').length, 1);
        compiled.execute();
    }
    assert.equal(s.trace.events.filter(e => e === 'pixi-render').length, 3);
});
test('render sizes preserve aspect, respect DPR and cap supersampled attachments', () => {
    for (const dpr of [1, 1.25, 2]) {
        const size = renderSize(640,400,dpr,8192);
        assert.equal(size.width, 640*dpr); assert.deepEqual(size.scene, [1280*dpr,800*dpr]);
    }
    assert.deepEqual(renderSize(3000,2000,2,8192).scene, [4096,2731]);
    assert.ok(renderSize(3000,2000,2,2048).scene.every(n => n <= 2048));
});
test('fixed initialization resets motion; time advances it and pause preserves it', () => {
    const initial = createMotions(), moving = createMotions();
    assert.deepEqual(initial,moving);
    advanceMotions(moving,0); assert.deepEqual(initial,moving);
    advanceMotions(moving,0.04); assert.notDeepEqual(initial,moving);
    for (let i=0;i<10000;i++) advanceMotions(moving,0.04);
    assert.ok(moving.every(m => m.x >= -160 && m.x < 2208 && m.y >= -160 && m.y < 1184));
    assert.deepEqual(initial,createMotions());
});
test('screen UVs cover a 2:1 static curved surface and orbit clears its edges', () => {
    const data = screenVertices();
    assert.equal(data.length,48*6*5);
    for (let i=0;i<data.length;i+=5) {
        assert.ok(data[i+3]>=0 && data[i+3]<=1 && data[i+4]>=0 && data[i+4]<=1);
        assert.ok(Math.abs(data[i])<=3 && data[i+2]>=0 && data[i+2]<0.81);
    }
});
