import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BufferAccess,
	FrameGraph,
	TextureAccess,
	type FrameGraphCompilationReport,
	type FrameGraphGpuTimingReport,
	type FrameGraphRecorder,
} from '../src/index.ts';
import { estimateTextureByteSize } from '../src/resourceDescriptors.ts';
import { buffer, mockCommandEncoder, mockDevice, texture, textureUsage } from './testUtils.ts';

function timingDevice(options: {
	readonly timestamps?: readonly bigint[];
	readonly mapAsync?: () => Promise<void>;
	readonly feature?: boolean;
	readonly onSubmit?: () => void;
} = {}): GPUDevice {
	const timestamps = new BigUint64Array(options.timestamps ?? [1000n, 5000n]);
	return {
		...mockDevice(mockCommandEncoder()),
		features: new Set(options.feature === false ? [] : ['timestamp-query']),
		createQuerySet(desc: GPUQuerySetDescriptor) {
			return { type: desc.type, count: desc.count, destroy() {} } as GPUQuerySet;
		},
		createBuffer(desc: GPUBufferDescriptor) {
			return {
				...buffer(desc.label ?? 'timing-buffer', desc.usage),
				size: desc.size,
				mapAsync: options.mapAsync ?? (() => Promise.resolve()),
				getMappedRange: () => timestamps.buffer.slice(0),
				unmap() {},
			} as GPUBuffer;
		},
		queue: { submit() { options.onSubmit?.(); } },
	} as unknown as GPUDevice;
}

function recordTimedGraph(recorder: FrameGraphRecorder, onExecute?: (frameIndex: number) => void): void {
	const output = recorder.createBuffer({ label: 'output', size: 4 });
	const write = recorder.use(output, BufferAccess.StorageWrite, { contents: 'overwrite' });
	recorder.compute({
		label: 'compute-output',
		uses: [write],
		encode: ({ frameIndex }) => { onExecute?.(frameIndex); },
	});
	recorder.markOutput(output);
}

function recordCompilationInvariantGraph(recorder: FrameGraphRecorder): void {
	const source = recorder.createBuffer({ label: 'source', size: 4 });
	const intermediate = recorder.createBuffer({ label: 'intermediate', size: 4 });
	const externalOutput = recorder.createBuffer({ label: 'external-output', size: 4 });
	const culled = recorder.createBuffer({ label: 'culled', size: 4 });

	recorder.command({
		label: 'produce-source',
		sideEffect: false,
		uses: [recorder.use(source, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	recorder.command({
		label: 'produce-intermediate',
		sideEffect: false,
		uses: [
			recorder.use(source, BufferAccess.StorageRead),
			recorder.use(intermediate, BufferAccess.StorageWrite, { contents: 'overwrite' }),
		],
	});
	recorder.externalSubmission({
		label: 'external',
		uses: [
			recorder.use(intermediate, BufferAccess.StorageRead),
			recorder.use(externalOutput, BufferAccess.StorageWrite, { contents: 'overwrite' }),
		],
		submit() {},
	});
	recorder.command({
		label: 'consume-external-output',
		uses: [recorder.use(externalOutput, BufferAccess.StorageRead)],
	});
	recorder.command({
		label: 'culled',
		sideEffect: false,
		uses: [recorder.use(culled, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
}

function withoutDebugGroupDiagnostics(report: FrameGraphCompilationReport): unknown {
	const snapshot = structuredClone(report) as unknown as {
		debugGroups?: unknown;
		nodes: Array<{ debugGroupId?: number }>;
		culledNodes: Array<{ debugGroupId?: number }>;
		resources: Array<{ debugGroupId?: number }>;
	};
	delete snapshot.debugGroups;
	for (const entry of [...snapshot.nodes, ...snapshot.culledNodes, ...snapshot.resources]) {
		delete entry.debugGroupId;
	}
	return snapshot;
}

test('compilation reports are opt-in snapshots', () => {
	const runtime = new FrameGraph(mockDevice());
	const plainRecorder = runtime.beginFrame();
	recordTimedGraph(plainRecorder);
	const plain = plainRecorder.compile();
	assert.equal('compilationReport' in plain, false);

	const reportedRecorder = runtime.beginFrame();
	recordTimedGraph(reportedRecorder);
	const reported = reportedRecorder.compile({ report: true });
	assert.deepEqual(reported.compilationReport.nodes.map((node) => node.label), ['compute-output']);
	assert.equal(reported.compilationReport.accesses.length, 1);
	assert.deepEqual(reported.compilationReport.accesses[0].bufferRange, { offset: 0, size: 4 });
});


test('texture byte estimates account for defaults, mip levels, samples, dimensions, and compressed blocks', () => {
	assert.equal(estimateTextureByteSize({ format: 'rgba8unorm', size: [8, 4] }), 128);
	assert.equal(estimateTextureByteSize({
		format: 'rgba8unorm',
		size: [8, 4],
		mipLevelCount: 3,
		sampleCount: 4,
	}), 672);
	assert.equal(estimateTextureByteSize({
		format: 'bc1-rgba-unorm',
		size: [8, 8],
		mipLevelCount: 2,
	}), 40);
	assert.equal(estimateTextureByteSize({
		format: 'r8unorm',
		size: [4, 4, 4],
		dimension: '3d',
		mipLevelCount: 3,
	}), 73);
});

test('compilation reports expose normalized descriptors and physical allocation estimates', () => {
	const recorder = new FrameGraph(mockDevice()).beginFrame();
	const color = recorder.createTexture({ label: 'color', format: 'rgba8unorm', size: [8, 4] });
	const first = recorder.createBuffer({ label: 'first', size: 70 });
	const second = recorder.createBuffer({ label: 'second', size: 70 });
	recorder.command({
		label: 'color',
		sideEffect: true,
		uses: [recorder.use(color, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' })],
	});
	for (const [label, handle] of [['first', first], ['second', second]] as const) {
		recorder.command({
			label,
			sideEffect: true,
			uses: [recorder.use(handle, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		});
	}

	const report = recorder.compile({ report: true }).compilationReport;
	const colorReport = report.resources.find((resource) => resource.label === 'color');
	assert.ok(colorReport?.kind === 'texture');
	assert.deepEqual(colorReport.descriptor, {
		format: 'rgba8unorm',
		size: { width: 8, height: 4, depthOrArrayLayers: 1 },
		dimension: '2d',
		mipLevelCount: 1,
		sampleCount: 1,
		viewFormats: [],
	});
	assert.equal(colorReport.estimatedByteSize, 128);

	const buffers = report.resources.filter((resource) => resource.kind === 'buffer');
	assert.deepEqual(buffers.map((resource) => resource.descriptor.size), [70, 70]);
	assert.deepEqual(buffers.map((resource) => resource.estimatedByteSize), [70, 70]);
	assert.equal(buffers[0]?.physicalAllocationId, buffers[1]?.physicalAllocationId);
	const bufferAllocations = report.allocations.filter((allocation) => allocation.kind === 'buffer');
	assert.equal(bufferAllocations.length, 1);
	assert.equal(bufferAllocations[0]?.estimatedByteSize, 128);
	assert.equal(report.allocations.reduce((sum, allocation) => sum + allocation.estimatedByteSize, 0), 256);
});

test('imported and swapchain resources report native normalized descriptors without changing execution plans', () => {
	const recorder = new FrameGraph(mockDevice()).beginFrame();
	const imported = recorder.importTexture(texture(
		'native-asset',
		textureUsage.TEXTURE_BINDING,
		{ format: 'rgba8unorm', size: [8, 4, 2], mipLevelCount: 3 },
	));
	const swapchain = recorder.importSwapchainTexture(texture(
		'native-canvas',
		textureUsage.RENDER_ATTACHMENT,
		{ format: 'bgra8unorm', size: [32, 24] },
	));
	recorder.command({
		label: 'read-import',
		sideEffect: true,
		uses: [recorder.use(imported, TextureAccess.Sampled)],
	});
	recorder.command({
		label: 'write-swapchain',
		sideEffect: true,
		uses: [recorder.use(swapchain, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' })],
	});

	const compiled = recorder.compile({ report: true });
	assert.deepEqual(compiled.compilationReport.nodes.map((node) => node.label), ['read-import', 'write-swapchain']);
	const importedReport = compiled.compilationReport.resources.find((resource) => resource.origin === 'imported');
	const swapchainReport = compiled.compilationReport.resources.find((resource) => resource.origin === 'swapchain');
	assert.ok(importedReport?.kind === 'texture');
	assert.ok(swapchainReport?.kind === 'texture');
	assert.deepEqual(importedReport.descriptor.size, { width: 8, height: 4, depthOrArrayLayers: 2 });
	assert.equal(importedReport.descriptor.mipLevelCount, 3);
	assert.deepEqual(swapchainReport.descriptor.size, { width: 32, height: 24, depthOrArrayLayers: 1 });
	assert.equal(swapchainReport.estimatedByteSize, 32 * 24 * 4);
	assert.doesNotThrow(() => compiled.execute());
});

test('compilation reports preserve nested debug groups without changing retention', () => {
	const runtime = new FrameGraph(mockDevice());
	const recorder = runtime.beginFrame();
	let retainedId = 0;
	let culledId = 0;
	let outerResourceId = 0;
	let innerResourceId = 0;

	recorder.withDebugGroup('Feature', () => {
		const retained = recorder.createBuffer({ label: 'retained', size: 4 });
		outerResourceId = retained.id;
		const retainedWrite = recorder.use(retained, BufferAccess.StorageWrite, { contents: 'overwrite' });
		recorder.command({ label: 'retained', sideEffect: true, uses: [retainedWrite] });
		retainedId = 1;

		recorder.withDebugGroup('Phase', () => {
			const culled = recorder.createBuffer({ label: 'culled', size: 4 });
			innerResourceId = culled.id;
			const culledWrite = recorder.use(culled, BufferAccess.StorageWrite, { contents: 'overwrite' });
			recorder.command({ label: 'culled', sideEffect: false, uses: [culledWrite] });
			culledId = 2;
		});
	});

	const report = recorder.compile({ report: true }).compilationReport;
	assert.deepEqual(report.debugGroups, [
		{ id: 1, parentId: undefined, label: 'Feature' },
		{ id: 2, parentId: 1, label: 'Phase' },
	]);
	assert.equal(report.nodes.find((node) => node.id === retainedId)?.debugGroupId, 1);
	assert.equal(report.culledNodes.find((node) => node.id === culledId)?.debugGroupId, 2);
	assert.equal(report.resources.find((resource) => resource.id === outerResourceId)?.debugGroupId, 1);
	assert.equal(report.resources.find((resource) => resource.id === innerResourceId)?.debugGroupId, 2);
	assert.deepEqual(report.nodes.map((node) => node.label), ['retained']);
});

test('debug groups change only diagnostic fields in compilation reports', () => {
	const compile = (grouped: boolean): FrameGraphCompilationReport => {
		const recorder = new FrameGraph(mockDevice()).beginFrame();
		if (grouped) {
			recorder.withDebugGroup('Diagnostics', () => recordCompilationInvariantGraph(recorder));
		}
		else {
			recordCompilationInvariantGraph(recorder);
		}
		return recorder.compile({ report: true }).compilationReport;
	};

	assert.deepEqual(
		withoutDebugGroupDiagnostics(compile(true)),
		withoutDebugGroupDiagnostics(compile(false)),
	);
});

test('debug group stack validation is deterministic and withDebugGroup restores after throws', () => {
	const runtime = new FrameGraph(mockDevice());
	const recorder = runtime.beginFrame();
	assert.equal(recorder.withDebugGroup('Value', () => 42), 42);
	assert.throws(() => recorder.withDebugGroup('Failure', () => { throw new Error('record failed'); }), /record failed/);
	const erasedAsyncRecord: () => unknown = async () => {};
	assert.throws(
		() => recorder.withDebugGroup('Async', erasedAsyncRecord),
		/FrameGraph\.withDebugGroup\(\) callback must complete synchronously/,
	);
	const erasedThenableRecord: () => unknown = () => ({ then() {} });
	assert.throws(
		() => recorder.withDebugGroup('Thenable', erasedThenableRecord),
		/FrameGraph\.withDebugGroup\(\) callback must complete synchronously/,
	);
	assert.equal(recorder.withDebugGroup('Failure', () => 'recovered'), 'recovered');
	assert.throws(() => recorder.popDebugGroup(), /stack is empty/);
	recorder.pushDebugGroup('Open');
	assert.throws(() => recorder.pushDebugGroup(' \t '), /label must not be empty/);
	assert.throws(() => recorder.compile(), /unclosed debug group "Open"/);
});

test('duplicate debug group labels create independent normalized scopes', () => {
	const runtime = new FrameGraph(mockDevice());
	const recorder = runtime.beginFrame();
	const resourceIds: number[] = [];
	const recordRootGroup = (groupLabel: string, nodeLabel: string) => recorder.withDebugGroup(groupLabel, () => {
		const resource = recorder.createBuffer({ label: `${nodeLabel}-buffer`, size: 4 });
		resourceIds.push(resource.id);
		const write = recorder.use(resource, BufferAccess.StorageWrite, { contents: 'overwrite' });
		recorder.command({ label: nodeLabel, sideEffect: true, uses: [write] });
	});

	recordRootGroup(' Bloom ', 'first');
	recordRootGroup('Bloom', 'second');
	recordRootGroup('Other', 'other');
	recordRootGroup('Bloom', 'third');
	recorder.withDebugGroup('Bloom', () => {
		recorder.withDebugGroup('Bloom', () => {
			recorder.command({ label: 'nested', sideEffect: true });
		});
	});

	const report = recorder.compile({ report: true }).compilationReport;
	assert.deepEqual(report.debugGroups, [
		{ id: 1, parentId: undefined, label: 'Bloom' },
		{ id: 2, parentId: undefined, label: 'Bloom' },
		{ id: 3, parentId: undefined, label: 'Other' },
		{ id: 4, parentId: undefined, label: 'Bloom' },
		{ id: 5, parentId: undefined, label: 'Bloom' },
		{ id: 6, parentId: 5, label: 'Bloom' },
	]);
	assert.deepEqual(report.nodes.map((node) => [node.label, node.debugGroupId]), [
		['first', 1],
		['second', 2],
		['other', 3],
		['third', 4],
		['nested', 6],
	]);
	assert.deepEqual(resourceIds.map((id) => report.resources.find((resource) => resource.id === id)?.debugGroupId), [1, 2, 3, 4]);
});

test('report mutation does not affect compact execution or GPU debug group plans', () => {
	let executeCount = 0;
	const calls: string[] = [];
	const commandEncoder = mockCommandEncoder({
		pushDebugGroup(label: string) {
			calls.push(`push:${label}`);
		},
		popDebugGroup() {
			calls.push('pop');
		},
		finish() {
			calls.push('finish');
			return {} as GPUCommandBuffer;
		},
	});
	const runtime = new FrameGraph(mockDevice(commandEncoder));
	const recorder = runtime.beginFrame();
	recorder.withDebugGroup('Diagnostics', () => {
		recordTimedGraph(recorder, () => {
			executeCount++;
			calls.push('node');
		});
	});
	const compiled = recorder.compile({ report: true });

	(compiled.compilationReport.executionSegments[0].nodeIds as number[]).length = 0;
	(compiled.compilationReport.accesses[0].bufferRange as { offset: number }).offset = 128;
	(compiled.compilationReport.debugGroups as unknown[]).length = 0;
	(compiled.compilationReport.nodes[0] as { debugGroupId?: number }).debugGroupId = 999;
	compiled.execute({ gpuDebugGroups: true });
	assert.equal(executeCount, 1);
	assert.deepEqual(calls, ['push:Diagnostics', 'node', 'pop', 'finish']);
});

test('compact plan excludes culled nodes and execution-unneeded imports', () => {
	const runtime = new FrameGraph(mockDevice());
	const recorder = runtime.beginFrame();
	const retained = recorder.createBuffer({ label: 'retained', size: 4 });
	const culledImport = recorder.importBuffer(buffer('culled-import'), {
		label: 'culled-import', exposedSize: 64, exposedUsage: GPUBufferUsage.STORAGE,
	});
	const retainedWrite = recorder.use(retained, BufferAccess.StorageWrite, { contents: 'overwrite' });
	const culledRead = recorder.use(culledImport, BufferAccess.StorageRead);
	recorder.command({ label: 'retained', sideEffect: true, uses: [retainedWrite] });
	recorder.command({ label: 'culled', sideEffect: false, uses: [culledRead], encode() { throw new Error('culled callback ran'); } });
	const compiled = recorder.compile({ report: true });
	const plan = (recorder as unknown as {
		compiledPlan: { nodes: readonly { label?: string }[]; resources: readonly { resource: { handle: { label?: string } } }[] };
	}).compiledPlan;

	assert.deepEqual(plan.nodes.map((node) => node.label), ['retained']);
	assert.deepEqual(plan.resources.map((entry) => entry.resource.handle.label), ['retained']);
	assert.deepEqual(compiled.compilationReport.nodes.map((node) => node.label), ['retained']);
	assert.deepEqual(compiled.compilationReport.culledNodes.map((node) => node.label), ['culled']);
	assert.deepEqual(compiled.compilationReport.nodes.map((node) => node.recordingOrder), [0]);
	assert.deepEqual(compiled.compilationReport.culledNodes.map((node) => node.recordingOrder), [1]);
	assert.doesNotThrow(() => compiled.execute());
});

test('the same compiled frame accepts a different frame index on every execution', () => {
	const seen: number[] = [];
	const runtime = new FrameGraph(mockDevice());
	const recorder = runtime.beginFrame();
	recordTimedGraph(recorder, (frameIndex) => seen.push(frameIndex));
	const compiled = recorder.compile();
	compiled.execute({ frameIndex: 3 });
	compiled.execute({ frameIndex: 9 });
	assert.deepEqual(seen, [3, 9]);
});

test('GPU timing is asynchronous while ordinary execution is synchronous', async () => {
	const runtime = new FrameGraph(timingDevice({ timestamps: [1000n, 6000n] }));
	const recorder = runtime.beginFrame();
	recordTimedGraph(recorder);
	const compiled = recorder.compile();
	assert.equal(compiled.execute({ frameIndex: 6 }), undefined);
	const result = compiled.execute({ frameIndex: 7, gpuTiming: true });
	assert.ok(result instanceof Promise);
	assert.deepEqual(await result, {
		status: 'available', frameIndex: 7, frameDurationMicros: 5,
		nodes: [{ nodeId: 1, kind: 'compute', label: 'compute-output', durationMicros: 5 }],
	});
});

test('concurrent GPU timing requests execute and report busy', async () => {
	let finishMap!: () => void;
	const pendingMap = new Promise<void>((resolve) => { finishMap = resolve; });
	let executeCount = 0;
	const runtime = new FrameGraph(timingDevice({ mapAsync: () => pendingMap }));
	const recorder = runtime.beginFrame();
	recordTimedGraph(recorder, () => executeCount++);
	const compiled = recorder.compile();
	const first = compiled.execute({ frameIndex: 1, gpuTiming: true });
	const second = compiled.execute({ frameIndex: 2, gpuTiming: true });
	assert.deepEqual(await second, { status: 'unavailable', frameIndex: 2, reason: 'busy' });
	assert.equal(executeCount, 2);
	finishMap();
	assert.equal((await first).status, 'available');
});

test('timing reports unsupported and readback failures without blocking execution', async () => {
	for (const scenario of [
		{ device: timingDevice({ feature: false }), reason: 'unsupported' },
		{ device: timingDevice({ mapAsync: () => Promise.reject(new Error('map failed')) }), reason: 'readback-failed' },
	] as const) {
		let executeCount = 0;
		const runtime = new FrameGraph(scenario.device);
		const recorder = runtime.beginFrame();
		recordTimedGraph(recorder, () => executeCount++);
		const report = await recorder.compile().execute({ frameIndex: 4, gpuTiming: true });
		assert.deepEqual(report, { status: 'unavailable', frameIndex: 4, reason: scenario.reason });
		assert.equal(executeCount, 1);
	}
});

test('destroy rejects a pending timing readback', async () => {
	const runtime = new FrameGraph(timingDevice({ mapAsync: () => new Promise<void>(() => {}) }));
	const recorder = runtime.beginFrame();
	recordTimedGraph(recorder);
	const report: Promise<FrameGraphGpuTimingReport> = recorder.compile().execute({ gpuTiming: true });
	runtime.destroy();
	await assert.rejects(report, /destroyed before GPU timing readback/);
});
