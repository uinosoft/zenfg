import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FrameGraph,
	FrameGraphError,
	TextureAccess,
	type WebGpuRenderPassDescriptorExtras,
} from '../src/index.ts';
import { createFrameGraphSnapshot } from '../src/snapshot.ts';
import { buffer, mockCommandEncoder, mockDevice } from './testUtils.ts';

type NativeDescriptorWithExtras = GPURenderPassDescriptor & Readonly<Record<string, unknown>>;

function captureDevice(descriptors: NativeDescriptorWithExtras[]): GPUDevice {
	return mockDevice(mockCommandEncoder({
		beginRenderPass(descriptor: GPURenderPassDescriptor) {
			descriptors.push(descriptor as NativeDescriptorWithExtras);
			return { end() {} } as GPURenderPassEncoder;
		},
	}));
}

function assertInvalidExtras(extras: unknown): void {
	const recorder = new FrameGraph(mockDevice()).beginFrame();
	assert.throws(
		() => recorder.render({ webgpuDescriptor: extras as WebGpuRenderPassDescriptorExtras }),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG2013'
			&& error.phase === 'record',
	);
}

test('render descriptor extras preserve object identity and shallow recording snapshots across executions', () => {
	const descriptors: NativeDescriptorWithExtras[] = [];
	const table = { version: 1 };
	const occlusionQuerySet = { type: 'occlusion', count: 4 } as GPUQuerySet;
	const extras = { resourceTable: table, occlusionQuerySet, maxDrawCount: 8, vendorMode: 'recorded' };
	const seenFrames: number[] = [];
	const recorder = new FrameGraph(captureDevice(descriptors)).beginFrame();
	recorder.render({
		label: 'extended',
		webgpuDescriptor: extras,
		sideEffect: true,
		encode({ frameIndex }) { seenFrames.push(frameIndex); },
	});
	extras.resourceTable = { version: 99 };
	extras.maxDrawCount = 99;
	extras.vendorMode = 'changed';
	Object.defineProperty(extras, 'timestampWrites', { value: {}, enumerable: true });
	table.version = 2;
	const compiled = recorder.compile();
	compiled.execute({ frameIndex: 2 });
	assert.equal(descriptors[0].resourceTable, table);
	assert.equal(descriptors[0].occlusionQuerySet, occlusionQuerySet);
	assert.equal(descriptors[0].maxDrawCount, 8);
	assert.equal(descriptors[0].vendorMode, 'recorded');
	assert.equal(table.version, 2);
	assert.equal('timestampWrites' in descriptors[0], false);

	Object.assign(descriptors[0], { resourceTable: { version: 100 }, maxDrawCount: 100 });
	compiled.execute({ frameIndex: 3 });
	assert.notEqual(descriptors[1], descriptors[0]);
	assert.equal(descriptors[1].resourceTable, table);
	assert.equal(descriptors[1].maxDrawCount, 8);
	assert.deepEqual(seenFrames, [2, 3]);
	assert.equal(Object.isFrozen(table), false);
});

test('render without extras retains the original native descriptor shape', () => {
	const descriptors: NativeDescriptorWithExtras[] = [];
	const recorder = new FrameGraph(captureDevice(descriptors)).beginFrame();
	recorder.render({ label: 'plain', sideEffect: true });
	recorder.compile().execute();
	assert.deepEqual(descriptors, [{ label: 'plain', colorAttachments: [], depthStencilAttachment: undefined }]);
});

test('render descriptor extras reject graph-owned fields even when inherited or nonenumerable', () => {
	for (const field of ['label', 'colorAttachments', 'depthStencilAttachment', 'timestampWrites']) {
		assertInvalidExtras({ [field]: undefined });
		assertInvalidExtras(new Proxy({ [field]: undefined }, { has: () => false }));
		assertInvalidExtras(Object.defineProperty({}, field, { value: undefined }));
		assertInvalidExtras(Object.create({ [field]: undefined }));
	}
});

test('render descriptor extras reject malformed dictionaries without invoking accessors', () => {
	for (const extras of [null, [], 1, 'resourceTable', true, () => undefined]) {
		assertInvalidExtras(extras);
	}
	for (const field of ['__proto__', 'constructor', 'prototype']) {
		assertInvalidExtras(Object.defineProperty({}, field, { value: {}, enumerable: true }));
	}
	assertInvalidExtras(Object.defineProperty({}, 'resourceTable', { value: {} }));
	assertInvalidExtras({ [Symbol('resourceTable')]: {} });
	let getterCalls = 0;
	assertInvalidExtras({ get resourceTable() { getterCalls += 1; return {}; } });
	assertInvalidExtras({ set resourceTable(_value: unknown) {} });
	assert.equal(getterCalls, 0);
});

test('render extras preserve resolve-discard, stored MSAA attachments, depth and explicit uses dependencies', () => {
	const descriptors: NativeDescriptorWithExtras[] = [];
	const recorder = new FrameGraph(captureDevice(descriptors)).beginFrame();
	const tableTexture = recorder.createTexture({ label: 'table-texture', format: 'rgba8unorm', size: [1, 1] });
	const objectMask = recorder.createTexture({ label: 'object-mask-msaa', format: 'rgba8unorm', size: [1, 1], sampleCount: 4 });
	const resolvedMask = recorder.createTexture({ label: 'object-mask-resolved', format: 'rgba8unorm', size: [1, 1] });
	const storedColors = ['normal', 'F0', 'picking'].map((label) => recorder.createTexture({
		label, format: 'rgba8unorm', size: [1, 1], sampleCount: 4,
	}));
	const depth = recorder.createTexture({ label: 'depth', format: 'depth32float', size: [1, 1], sampleCount: 4 });
	const table = { label: 'scene-table' };
	const events: string[] = [];
	recorder.command({
		label: 'table-producer',
		sideEffect: false,
		uses: [recorder.use(tableTexture, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		encode() { events.push('producer'); },
	});
	const tableTextureUse = recorder.use(tableTexture, TextureAccess.Sampled);
	recorder.render({
		label: 'mesh',
		webgpuDescriptor: { resourceTable: table },
		colorAttachments: [
			{ target: objectMask, resolveTarget: resolvedMask, loadOp: 'clear', storeOp: 'discard' },
			...storedColors.map((target) => ({ target, loadOp: 'clear' as const, storeOp: 'store' as const })),
		],
		depthStencilAttachment: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
		uses: [tableTextureUse],
		encode(ctx) { assert.ok(ctx.unwrap(tableTextureUse)); events.push('mesh'); },
	});
	recorder.command({
		label: 'read-stored-attachments',
		sideEffect: true,
		uses: [
			recorder.use(resolvedMask, TextureAccess.Sampled),
			...storedColors.map((target) => recorder.use(target, TextureAccess.Sampled)),
			recorder.use(depth, TextureAccess.DepthRead),
		],
		encode() { events.push('reader'); },
	});
	const compiled = recorder.compile({ report: true });
	const report = compiled.compilationReport;
	assert.deepEqual(report.nodes.map((node) => node.label), ['table-producer', 'mesh', 'read-stored-attachments']);
	const meshNode = report.nodes.find((node) => node.label === 'mesh');
	assert.ok(meshNode);
	assert.equal(report.accesses.find((access) => access.nodeId === meshNode.id && access.resourceId === objectMask.id)?.producesValue, false);
	for (const target of [resolvedMask, ...storedColors, depth]) {
		assert.equal(report.accesses.find((access) => access.nodeId === meshNode.id && access.resourceId === target.id)?.producesValue, true);
	}
	assert.ok(report.dependencies.some((dependency) => dependency.fromNodeId === report.nodes[0].id
		&& dependency.toNodeId === meshNode.id && dependency.resourceId === tableTexture.id && dependency.kind === 'value'));
	compiled.execute();
	assert.deepEqual(events, ['producer', 'mesh', 'reader']);
	assert.equal(descriptors[0].resourceTable, table);
	const attachments = Array.from(descriptors[0].colorAttachments);
	assert.ok(attachments[0]);
	assert.equal(attachments[0].storeOp, 'discard');
	assert.ok(attachments[0].resolveTarget);
	assert.deepEqual(attachments.slice(1).map((attachment) => attachment?.storeOp), ['store', 'store', 'store']);
	assert.equal(descriptors[0].depthStencilAttachment?.depthLoadOp, 'clear');
	assert.equal(descriptors[0].depthStencilAttachment?.depthStoreOp, 'store');
	assert.equal(descriptors[0].depthStencilAttachment?.depthClearValue, 0);
});

test('render extras retain graph validation and read-after-discard errors', () => {
	const discarded = new FrameGraph(mockDevice()).beginFrame();
	const source = discarded.createTexture({ format: 'rgba8unorm', size: [1, 1], sampleCount: 4 });
	const resolved = discarded.createTexture({ format: 'rgba8unorm', size: [1, 1] });
	discarded.render({
		webgpuDescriptor: { resourceTable: {} },
		colorAttachments: [{ target: source, resolveTarget: resolved, loadOp: 'clear', storeOp: 'discard' }],
	});
	discarded.command({ sideEffect: true, uses: [discarded.use(source, TextureAccess.Sampled)] });
	assert.throws(() => discarded.compile(), (error) => error instanceof FrameGraphError
		&& error.code === 'FG1003' && error.phase === 'compile' && error.resourceId === source.id);

	const invalid = new FrameGraph(mockDevice()).beginFrame();
	const depth = invalid.createTexture({ format: 'depth32float', size: [1, 1] });
	invalid.render({
		webgpuDescriptor: { resourceTable: {} },
		colorAttachments: [{ target: depth, loadOp: 'clear', storeOp: 'store' }],
		sideEffect: true,
	});
	assert.throws(() => invalid.compile(), (error) => error instanceof FrameGraphError
		&& error.code === 'FG1108' && error.phase === 'compile' && error.resourceId === depth.id);
});

test('render descriptor extras stay outside portable compilation reports and snapshots', () => {
	const table: { self?: unknown; inspect(): string } = { inspect: () => 'scene-table' };
	table.self = table;
	const snapshot = (webgpuDescriptor?: WebGpuRenderPassDescriptorExtras) => {
		const recorder = new FrameGraph(mockDevice()).beginFrame();
		const color = recorder.createTexture({ label: 'output', format: 'rgba8unorm', size: [1, 1] });
		recorder.render({
			label: 'mesh', webgpuDescriptor,
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
		});
		recorder.markOutput(color);
		const compilation = recorder.compile({ report: true }).compilationReport;
		return {
			compilation,
			snapshot: createFrameGraphSnapshot({ compilation, frameIndex: 7, capturedAt: '2026-10-10T00:00:00.000Z' }),
		};
	};
	assert.deepEqual(snapshot({ resourceTable: table }), snapshot());
});

test('render descriptor extras coexist with graph-owned GPU timestamps', async () => {
	const descriptors: NativeDescriptorWithExtras[] = [];
	const timestamps = new BigUint64Array([1000n, 6000n]);
	const querySet = { type: 'timestamp', count: 2, destroy() {} } as GPUQuerySet;
	const device = {
		...captureDevice(descriptors),
		features: new Set(['timestamp-query']),
		createQuerySet() { return querySet; },
		createBuffer(desc: GPUBufferDescriptor) {
			return {
				...buffer(desc.label ?? 'timing-buffer', desc.usage),
				size: desc.size,
				getMappedRange: () => timestamps.buffer.slice(0),
			} as GPUBuffer;
		},
	} as unknown as GPUDevice;
	const runtime = new FrameGraph(device);
	const recorder = runtime.beginFrame();
	const table = { label: 'scene-table' };
	recorder.render({ label: 'timed-render', sideEffect: true, webgpuDescriptor: { resourceTable: table } });
	const compiled = recorder.compile();
	const timing = compiled.executeWithTiming({ frameIndex: 7, timing: 'gpu' });
	assert.equal(descriptors[0].resourceTable, table);
	assert.deepEqual(descriptors[0].timestampWrites, {
		querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1,
	});
	assert.deepEqual(await timing.gpu, {
		status: 'available', frameIndex: 7, frameDurationMicros: 5,
		nodes: [{ nodeId: 1, kind: 'render', label: 'timed-render', durationMicros: 5 }],
	});
	compiled.execute();
	assert.equal(descriptors[1].resourceTable, table);
	assert.equal('timestampWrites' in descriptors[1], false);
	runtime.destroy();
});

test('render descriptor extras expose typed standard fields and forbid graph-owned fields', () => {
	assert.ok(true);
	// Type-only contracts cover public boundaries that JavaScript can bypass.
	if (false) {
		const extras: WebGpuRenderPassDescriptorExtras = { resourceTable: { label: 'scene-table' }, maxDrawCount: 10 };
		const recorder = new FrameGraph(null as unknown as GPUDevice).beginFrame();
		recorder.render({ webgpuDescriptor: extras });
		// @ts-expect-error Standard native fields keep their WebGPU types.
		const invalidCount: WebGpuRenderPassDescriptorExtras = { maxDrawCount: 'ten' };
		// @ts-expect-error The graph owns the pass label.
		const invalidLabel: WebGpuRenderPassDescriptorExtras = { label: 'replacement' };
		// @ts-expect-error The graph owns color attachments.
		const invalidColors: WebGpuRenderPassDescriptorExtras = { colorAttachments: [] };
		// @ts-expect-error The graph owns depth attachment metadata.
		const invalidDepth: WebGpuRenderPassDescriptorExtras = { depthStencilAttachment: { view: {} } };
		// @ts-expect-error The graph owns timestamp writes.
		const invalidTiming: WebGpuRenderPassDescriptorExtras = { timestampWrites: {} };
		// @ts-expect-error Optional extras still require a dictionary.
		recorder.render({ webgpuDescriptor: null });
		void [invalidCount, invalidLabel, invalidColors, invalidDepth, invalidTiming];
	}
});
