import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { BufferAccess, FrameGraph, type FrameGraphRecording, type RenderDepthStencilAttachmentDesc } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../src/renderer.ts';
import type { ReferenceRenderer } from '../src/types.ts';
import { createFakeGpu, installWebGpuGlobals } from './fakeWebGpu.ts';

after(installWebGpuGlobals());

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const cube = () => ({ shape: 'cube' as const, transform: identity(), color: [0.3, 0.6, 0.9] as const });

function recordScene(frame: FrameGraphRecording, renderer: ReferenceRenderer, convention: 'reverse-z' | 'forward-z' = 'reverse-z') {
	const color = frame.createTexture({ label: 'test-color', format: 'rgba8unorm', size: [64, 48] });
	const depth = frame.createTexture({ label: 'test-depth', format: 'depth24plus', size: [64, 48] });
	renderer.record(frame, {
		viewProjection: identity(), depthConvention: convention,
		color: { target: color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
		depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: convention === 'reverse-z' ? 0 : 1 },
	});
	return { color, depth };
}

test('the retained graph orders reset, GPU culling and three indirect batches in one submission', () => {
	const { device, trace } = createFakeGpu();
	const graph = new FrameGraph(device);
	const renderer = createReferenceRenderer(device, { maxInstances: 8 });
	renderer.setInstances([cube(), { ...cube(), shape: 'sphere' }, { ...cube(), shape: 'plane' }]);
	const frame = graph.beginFrame();
	const { color } = recordScene(frame, renderer);
	frame.markOutput(color);
	const compiled = frame.compile({ report: true });
	const report = compiled.compilationReport;
	assert.deepEqual(report.nodes.map(node => node.kind), ['compute', 'compute', 'render']);
	const [reset, cull, draw] = report.nodes;
	assert.ok(report.dependencies.some(edge => edge.fromNodeId === reset.id && edge.toNodeId === cull.id && edge.kind === 'value'));
	assert.ok(report.dependencies.some(edge => edge.fromNodeId === cull.id && edge.toNodeId === draw.id && edge.kind === 'value'));
	const indirectAccess = report.accesses.find(access => access.nodeId === draw.id && access.access === BufferAccess.Indirect);
	assert.ok(indirectAccess);
	const indirect = report.resources.find(resource => resource.id === indirectAccess.resourceId)!;
	assert.equal(indirect.origin, 'transient');
	assert.equal(indirect.usage & (GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT), GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT);
	const cullWrites = report.accesses.filter(access => access.nodeId === cull.id && access.access === BufferAccess.StorageWrite);
	assert.equal(cullWrites.length, 2);
	assert.ok(cullWrites.every(access => access.contents === 'preserve'));
	assert.deepEqual(report.executionSegments.map(segment => segment.kind), ['frame-graph']);
	const writesBeforeExecute = trace.writes.length;
	compiled.execute();
	assert.equal(trace.writes.length, writesBeforeExecute, 'uploads must not occur inside encode callbacks');
	assert.equal(trace.dispatches.length, 2);
	assert.ok(trace.dispatches.every(dispatch => dispatch.x > 0));
	assert.deepEqual(trace.indirectDraws.map(call => call.offset), [0, 20, 40]);
	assert.equal(new Set(trace.indirectDraws.map(call => call.buffer)).size, 1);
	assert.equal(trace.submits, 1);
	renderer.destroy();
	graph.destroy();
});

test('unconsumed drawing is culled without submitting GPU work', () => {
	const { device, trace } = createFakeGpu();
	const graph = new FrameGraph(device);
	const renderer = createReferenceRenderer(device, { maxInstances: 1 });
	renderer.setInstances([cube()]);
	const frame = graph.beginFrame();
	recordScene(frame, renderer);
	const compiled = frame.compile({ report: true });
	assert.equal(compiled.compilationReport.nodes.length, 0);
	compiled.execute();
	assert.equal(trace.submits, 0);
	assert.equal(trace.indirectDraws.length, 0);
	renderer.destroy();
	graph.destroy();
});

test('empty instances retain attachment clearing and the fixed indirect draw path', () => {
	const { device, trace } = createFakeGpu();
	const graph = new FrameGraph(device);
	const renderer = createReferenceRenderer(device, { maxInstances: 1 });
	renderer.setInstances([]);
	const frame = graph.beginFrame();
	const { color } = recordScene(frame, renderer);
	frame.markOutput(color);
	frame.compile().execute();
	assert.equal(trace.renderPasses.length, 1);
	const attachment = Array.from(trace.renderPasses[0].colorAttachments)[0]!;
	assert.equal(attachment.loadOp, 'clear');
	assert.equal(trace.indirectDraws.length, 3);
	renderer.destroy();
	graph.destroy();
});

test('pipeline selection follows view format, pure depth format and readonly depth', () => {
	const { device, trace } = createFakeGpu();
	const graph = new FrameGraph(device);
	const renderer = createReferenceRenderer(device, { maxInstances: 1 });
	renderer.setInstances([cube()]);
	const frame = graph.beginFrame();
	const color = frame.createTexture({ format: 'rgba8unorm', viewFormats: ['rgba8unorm-srgb'], size: [32, 32] });
	const colorView = frame.createTextureView(color, { format: 'rgba8unorm-srgb' });
	const depth = frame.createTexture({ format: 'depth16unorm', size: [32, 32] });
	const depthView = frame.createTextureView(depth);
	frame.render({ depthStencilAttachment: { target: depthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
	renderer.record(frame, {
		viewProjection: identity(), depthConvention: 'forward-z',
		color: { target: colorView, loadOp: 'clear', storeOp: 'store' },
		depth: { target: depthView, depthReadOnly: true },
	});
	frame.markOutput(color);
	frame.compile().execute();
	assert.equal(trace.renderPipelines.length, 1);
	const pipeline = trace.renderPipelines[0];
	assert.equal(Array.from(pipeline.fragment!.targets)[0]!.format, 'rgba8unorm-srgb');
	assert.equal(pipeline.depthStencil!.format, 'depth16unorm');
	assert.equal(pipeline.depthStencil!.depthWriteEnabled, false);
	assert.equal(pipeline.depthStencil!.depthCompare, 'less');
	assert.equal(trace.renderPasses.at(-1)!.depthStencilAttachment!.depthReadOnly, true);
	renderer.destroy();
	graph.destroy();
});

test('independent renderers share imported attachments and preserve earlier color and depth', () => {
	const { device, trace } = createFakeGpu();
	const graph = new FrameGraph(device);
	const first = createReferenceRenderer(device, { maxInstances: 1 });
	const second = createReferenceRenderer(device, { maxInstances: 1 });
	first.setInstances([cube()]);
	second.setInstances([{ ...cube(), shape: 'sphere' }]);
	const colorTexture = device.createTexture({ label: 'borrowed-color', format: 'rgba16float', size: [32, 32], usage: GPUTextureUsage.RENDER_ATTACHMENT });
	const depthTexture = device.createTexture({ label: 'borrowed-depth', format: 'depth32float', size: [32, 32], usage: GPUTextureUsage.RENDER_ATTACHMENT });
	const frame = graph.beginFrame();
	const color = frame.importTexture(colorTexture, { initialContents: 'undefined' });
	const depth = frame.importTexture(depthTexture, { initialContents: 'undefined' });
	for (const [index, renderer] of [first, second].entries()) {
		const depthAttachment: RenderDepthStencilAttachmentDesc = index === 0
			? { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 }
			: { target: depth, depthLoadOp: 'load', depthStoreOp: 'store' };
		renderer.record(frame, {
			viewProjection: identity(),
			color: { target: color, loadOp: index === 0 ? 'clear' : 'load', storeOp: 'store' },
			depth: depthAttachment,
		});
	}
	frame.markOutput(color);
	const compiled = frame.compile({ report: true });
	const draws = compiled.compilationReport.nodes.filter(node => node.kind === 'render');
	assert.equal(draws.length, 2);
	assert.ok(compiled.compilationReport.dependencies.some(edge => edge.fromNodeId === draws[0].id && edge.toNodeId === draws[1].id && edge.kind === 'value'));
	compiled.execute();
	assert.equal(trace.indirectDraws.length, 6);
	assert.equal(trace.submits, 1);
	assert.equal(trace.renderPipelines[0].depthStencil!.depthCompare, 'greater');
	assert.equal(trace.renderPipelines[0].depthStencil!.depthWriteEnabled, true);
	first.destroy(); second.destroy(); graph.destroy();
	assert.ok(!trace.destroyedTextures.includes(colorTexture));
	assert.ok(!trace.destroyedTextures.includes(depthTexture));
	assert.equal(trace.deviceDestroys, 0);
});

test('one renderer rejects recording twice into the same graph recording', () => {
	const { device } = createFakeGpu();
	const graph = new FrameGraph(device);
	const renderer = createReferenceRenderer(device, { maxInstances: 1 });
	const frame = graph.beginFrame();
	recordScene(frame, renderer);
	assert.throws(() => recordScene(frame, renderer), /once|already|record/i);
	renderer.destroy(); graph.destroy();
});

test('overwritten instance inputs or a newer recording invalidate old compiled work', () => {
	for (const invalidate of ['instances', 'recording'] as const) {
		const { device, trace } = createFakeGpu();
		const graph = new FrameGraph(device);
		const renderer = createReferenceRenderer(device, { maxInstances: 1 });
		renderer.setInstances([cube()]);
		const frame = graph.beginFrame();
		const { color } = recordScene(frame, renderer);
		frame.markOutput(color);
		const compiled = frame.compile();
		if (invalidate === 'instances') renderer.setInstances([]);
		else recordScene(graph.beginFrame(), renderer);
		assert.throws(() => compiled.execute(), /changed|stale|generation|invalid|record|snapshot|overwrit|updated/i);
		assert.equal(trace.submits, 0);
		renderer.destroy(); graph.destroy();
	}
});

test('serial frames reuse owned storage and cache matching render pipelines', () => {
	const { device, trace } = createFakeGpu();
	const graph = new FrameGraph(device);
	const renderer = createReferenceRenderer(device, { maxInstances: 2 });
	for (const x of [0, 2]) {
		const instance = cube();
		instance.transform[12] = x;
		renderer.setInstances([instance]);
		const frame = graph.beginFrame();
		const { color } = recordScene(frame, renderer);
		frame.markOutput(color);
		frame.compile().execute();
	}
	assert.equal(trace.submits, 2);
	assert.equal(trace.renderPipelines.length, 1);
	assert.equal(trace.indirectDraws.length, 6);
	assert.ok(trace.events.indexOf('submit') < trace.events.lastIndexOf('write'));
	renderer.destroy(); graph.destroy();
});

test('caller mutations after setInstances and record do not mutate uploaded snapshots', () => {
	const { device, trace } = createFakeGpu();
	const graph = new FrameGraph(device);
	const renderer = createReferenceRenderer(device, { maxInstances: 1 });
	const instance = cube();
	const camera = identity();
	renderer.setInstances([instance]);
	const frame = graph.beginFrame();
	const color = frame.createTexture({ format: 'rgba8unorm', size: [16, 16] });
	const depth = frame.createTexture({ format: 'depth24plus', size: [16, 16] });
	renderer.record(frame, {
		viewProjection: camera,
		color: { target: color, loadOp: 'clear', storeOp: 'store' },
		depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
	});
	const snapshots = trace.writes.map(write => write.bytes.slice());
	instance.transform.fill(99);
	camera.fill(99);
	frame.markOutput(color);
	frame.compile().execute();
	assert.deepEqual(trace.writes.map(write => write.bytes), snapshots);
	assert.equal(trace.indirectDraws.length, 3);
	renderer.destroy(); graph.destroy();
});

test('a graph on another device is rejected before submitting renderer work', () => {
	const owner = createFakeGpu();
	const other = createFakeGpu();
	const graph = new FrameGraph(other.device);
	const renderer = createReferenceRenderer(owner.device, { maxInstances: 1 });
	const frame = graph.beginFrame();
	const { color } = recordScene(frame, renderer);
	frame.markOutput(color);
	assert.throws(() => frame.compile().execute(), /device/i);
	assert.equal(other.trace.submits, 0);
	renderer.destroy(); graph.destroy();
});

test('destroy is idempotent, owns its buffers and invalidates pending work', () => {
	const { device, trace } = createFakeGpu();
	const graph = new FrameGraph(device);
	const renderer = createReferenceRenderer(device, { maxInstances: 1 });
	const frame = graph.beginFrame();
	const { color } = recordScene(frame, renderer);
	frame.markOutput(color);
	const compiled = frame.compile();
	const ownedBuffers = trace.buffers.slice();
	renderer.destroy();
	assert.deepEqual(new Set(trace.destroyedBuffers), new Set(ownedBuffers));
	const destroyCount = trace.destroyedBuffers.length;
	renderer.destroy();
	assert.equal(trace.destroyedBuffers.length, destroyCount);
	assert.throws(() => renderer.setInstances([]), /destroy|disposed/i);
	assert.throws(() => recordScene(graph.beginFrame(), renderer), /destroy|disposed/i);
	assert.throws(() => compiled.execute(), /destroy|disposed/i);
	assert.equal(trace.submits, 0);
	assert.equal(trace.deviceDestroys, 0);
	graph.destroy();
});

test('capacity rejects malformed values and overflowing instance lists', () => {
	const { device } = createFakeGpu();
	for (const maxInstances of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(() => createReferenceRenderer(device, { maxInstances }), /maxInstances|capacity|positive|integer/i);
	}
	const renderer = createReferenceRenderer(device, { maxInstances: 1 });
	assert.throws(() => renderer.setInstances([cube(), cube()]), /capacity|count|maxInstances/i);
	renderer.destroy();
});
