import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BufferAccess,
	FrameGraph,
	FrameGraphError,
	TextureAccess,
	type CompiledFrameExecuteOptions,
	type FrameGraphRecorder,
} from '../src/index.ts';

import {
	textureUsage,
	bufferUsage,
	texture,
	buffer,
	mockCommandEncoder,
	mockDevice,
	compiledResource,
} from './testUtils.ts';

function executeCompiled(graph: FrameGraphRecorder, options: CompiledFrameExecuteOptions = {}): void {
	graph.compile().execute(options);
}

test('construction and compile stay CPU-only while parameterless execute uses the bound device', () => {
	let deviceAccessCount = 0;
	let executedFrameIndex = -1;
	const baseDevice = mockDevice();
	const device = new Proxy(baseDevice, {
		get(target, property, receiver) {
			deviceAccessCount += 1;
			return Reflect.get(target, property, receiver);
		},
	});
	const runtime = new FrameGraph(device);
	const graph = runtime.beginFrame();
	const output = graph.createBuffer({ label: 'output', size: 4 });
	graph.command({
		label: 'write-output',
		uses: [graph.use(output, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		encode(ctx) {
			assert.equal(ctx.device, device);
			executedFrameIndex = ctx.frameIndex;
		},
	});
	graph.markOutput(output);

	const compiled = graph.compile({ report: true });
	assert.equal(deviceAccessCount, 0);

	compiled.execute();
	assert.equal(executedFrameIndex, 0);
	assert.ok(deviceAccessCount > 0);
});

test('retained nodes execute as a stable subsequence of recording order', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const token = graph.createBuffer({ label: 'token', size: 4 });
	const events: string[] = [];

	const write = graph.use(token, BufferAccess.StorageWrite, { contents: 'overwrite' });
	graph.command({
		label: 'producer',
		sideEffect: false,
		uses: [write],
		encode: () => { events.push('producer'); },
	});
	const read = graph.use(token, BufferAccess.StorageRead);
	graph.command({
		label: 'dependent',
		uses: [read],
		encode: () => { events.push('dependent'); },
	});
	graph.command({
		label: 'culled',
		sideEffect: false,
		encode: () => { events.push('culled'); },
	});
	graph.command({
		label: 'independent',
		encode: () => { events.push('independent'); },
	});

	const compiled = graph.compile({ report: true });
	assert.deepEqual(compiled.compilationReport.nodes.map((node) => node.label), [
		'producer',
		'dependent',
		'independent',
	]);
	compiled.execute();
	assert.deepEqual(events, ['producer', 'dependent', 'independent']);
});

test('WebGPU debug groups stay disabled by default', () => {
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
	const graph = new FrameGraph(mockDevice(commandEncoder)).beginFrame();
	graph.withDebugGroup('Feature', () => {
		graph.command({ encode: () => { calls.push('node'); } });
	});

	graph.compile().execute();

	assert.deepEqual(calls, ['node', 'finish']);
});

test('WebGPU debug groups follow retained recording paths without requiring a report', () => {
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
	const graph = new FrameGraph(mockDevice(commandEncoder)).beginFrame();
	graph.withDebugGroup('Culled', () => {
		graph.command({ sideEffect: false, encode: () => { calls.push('culled'); } });
	});
	graph.withDebugGroup('PostFX', () => {
		graph.withDebugGroup('Bloom', () => {
			graph.command({ encode: () => { calls.push('bloom-1'); } });
			graph.command({ encode: () => { calls.push('bloom-2'); } });
		});
		graph.withDebugGroup('FXAA', () => {
			graph.command({ encode: () => { calls.push('fxaa'); } });
		});
		graph.command({ encode: () => { calls.push('postfx'); } });
	});
	graph.command({ encode: () => { calls.push('present'); } });

	graph.compile().execute({
		gpuDebugGroups: true,
		beforeSubmit: () => { calls.push('beforeSubmit'); },
	});

	assert.deepEqual(calls, [
		'push:PostFX',
		'push:Bloom',
		'bloom-1',
		'bloom-2',
		'pop',
		'push:FXAA',
		'fxaa',
		'pop',
		'postfx',
		'pop',
		'present',
		'beforeSubmit',
		'finish',
	]);
});

test('adjacent duplicate debug group labels emit independent WebGPU markers', () => {
	const calls: string[] = [];
	const commandEncoder = mockCommandEncoder({
		pushDebugGroup(label: string) {
			calls.push(`push:${label}`);
		},
		popDebugGroup() {
			calls.push('pop');
		},
	});
	const graph = new FrameGraph(mockDevice(commandEncoder)).beginFrame();
	graph.withDebugGroup(' Same ', () => {
		graph.command({ encode: () => { calls.push('first'); } });
	});
	graph.withDebugGroup('Same', () => {
		graph.command({ encode: () => { calls.push('second'); } });
	});

	graph.compile().execute({ gpuDebugGroups: true });

	assert.deepEqual(calls, [
		'push:Same',
		'first',
		'pop',
		'push:Same',
		'second',
		'pop',
	]);
});

test('WebGPU debug groups reopen around external submission segments', () => {
	const calls: string[] = [];
	let encoderIndex = 0;
	const device = {
		...mockDevice(),
		createCommandEncoder() {
			const index = encoderIndex++;
			return mockCommandEncoder({
				pushDebugGroup(label: string) {
					calls.push(`push:${index}:${label}`);
				},
				popDebugGroup() {
					calls.push(`pop:${index}`);
				},
				finish() {
					calls.push(`finish:${index}`);
					return { label: `segment-${index}` } as GPUCommandBuffer;
				},
			});
		},
		queue: {
			submit(commandBuffers: readonly GPUCommandBuffer[]) {
				calls.push(`submit:${commandBuffers[0]?.label ?? 'external'}`);
			},
		},
	} as unknown as GPUDevice;
	const graph = new FrameGraph(device).beginFrame();
	graph.withDebugGroup('PostFX', () => {
		graph.command({ encode: () => { calls.push('before'); } });
		graph.externalSubmission({
			submit(ctx) {
				calls.push('external');
				ctx.device.queue.submit([]);
			},
		});
		graph.command({ encode: () => { calls.push('after'); } });
	});

	graph.compile().execute({
		gpuDebugGroups: true,
		beforeSubmit: ({ segmentIndex }) => { calls.push(`beforeSubmit:${segmentIndex}`); },
	});

	assert.deepEqual(calls, [
		'push:0:PostFX',
		'before',
		'pop:0',
		'beforeSubmit:0',
		'finish:0',
		'submit:segment-0',
		'external',
		'submit:external',
		'push:1:PostFX',
		'after',
		'pop:1',
		'beforeSubmit:1',
		'finish:1',
		'submit:segment-1',
	]);
});

test('destroy leaves imported resources under caller ownership', () => {
	let destroyCount = 0;
	const importedTexture = {
		...texture('imported'),
		destroy() {
			destroyCount += 1;
		},
	} as GPUTexture;
	const runtime = new FrameGraph(mockDevice());
	const graph = runtime.beginFrame();
	graph.importTexture(importedTexture, { label: 'imported', exposedUsage: textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING });

	runtime.destroy();

	assert.equal(destroyCount, 0);
});

test('copy execution forwards texture mip level and aspect descriptors', () => {
	const calls: string[] = [];
	const commandEncoder = mockCommandEncoder({
		copyTextureToTexture(
			source: GPUTexelCopyTextureInfo,
			destination: GPUTexelCopyTextureInfo,
			size: GPUExtent3D,
		) {
			calls.push(`${source.texture.label}:${source.mipLevel}:${source.aspect}->${destination.texture.label}:${destination.mipLevel}:${destination.aspect}:${Array.from(size as readonly number[]).join('x')}`);
		},
	});
	const device = mockDevice(commandEncoder);
	const graph = new FrameGraph(device).beginFrame();
	const source = graph.importTexture({
		...texture('source', textureUsage.COPY_SRC),
		width: 4,
		height: 4,
		mipLevelCount: 2,
		format: 'depth24plus',
	} as GPUTexture, { label: 'source', exposedUsage: textureUsage.COPY_SRC });
	const destination = graph.importTexture({
		...texture('destination', textureUsage.COPY_DST | textureUsage.TEXTURE_BINDING),
		width: 4,
		height: 4,
		mipLevelCount: 2,
		format: 'depth24plus',
	} as GPUTexture, { label: 'destination', exposedUsage: textureUsage.COPY_DST | textureUsage.TEXTURE_BINDING });

	graph.copy({
		label: 'copy-depth-mip',
		operations: [{
			type: 'texture-to-texture',
			source,
			destination,
			sourceMipLevel: 1,
			destinationMipLevel: 1,
			sourceAspect: 'depth-only',
			destinationAspect: 'depth-only',
			copySize: [2, 2],
		}],
	});
	graph.command({ label: 'sample', sideEffect: true, uses: [graph.use(destination, TextureAccess.Sampled)] });

	executeCompiled(graph, { frameIndex: 0 });

	assert.deepEqual(calls, ['source:1:depth-only->destination:1:depth-only:2x2']);
});

test('clear buffer node records native clear commands and validates ranges', () => {
	const calls: string[] = [];
	const commandEncoder = mockCommandEncoder({
		clearBuffer(target: GPUBuffer, offset?: GPUSize64, size?: GPUSize64) {
			calls.push(`${target.label}:${offset ?? 0}:${size ?? 'all'}`);
		},
	});
	const device = mockDevice(commandEncoder);
	const graph = new FrameGraph(device).beginFrame();
	const target = graph.importBuffer(buffer('target', bufferUsage.COPY_DST | bufferUsage.STORAGE), { label: 'target', exposedSize: 64, exposedUsage: bufferUsage.COPY_DST | bufferUsage.STORAGE });

	graph.clearBuffer({
		label: 'clear',
		operations: [{ target, offset: 4, size: 16 }],
	});
	graph.command({
		label: 'consume',
		sideEffect: true,
		uses: [graph.use(target, BufferAccess.StorageRead)],
	});

	const compiledFrame = graph.compile({ report: true });
	const compiled = compiledFrame.compilationReport;
	const debug = compiled;
	assert.deepEqual(
		debug.accesses
			.filter((access) => access.resourceId === target.id)
			.map((access) => ({ access: access.access, mode: access.mode, bufferRange: access.bufferRange })),
		[
			{ access: BufferAccess.CopyDst, mode: 'write', bufferRange: { offset: 4, size: 16 } },
			{ access: BufferAccess.StorageRead, mode: 'read', bufferRange: { offset: 0, size: 64 } },
		],
	);
	compiledFrame.execute();

	assert.deepEqual(calls, ['target:4:16']);

	const invalid = new FrameGraph(device).beginFrame();
	const invalidTarget = invalid.createBuffer({ label: 'invalid', size: 64 });
	invalid.clearBuffer({
		label: 'invalid-clear',
		operations: [{ target: invalidTarget, offset: 2, size: 16 }],
	});
	invalid.markOutput(invalidTarget);

	assert.throws(() => invalid.compile({ report: true }).compilationReport, /4-byte aligned/);
});

test('clear buffer snapshots operation objects and the operations array', () => {
	const calls: string[] = [];
	const commandEncoder = mockCommandEncoder({
		clearBuffer(target: GPUBuffer, offset?: GPUSize64, size?: GPUSize64) {
			calls.push(`${target.label}:${offset ?? 0}:${size ?? 'all'}`);
		},
	});
	const graph = new FrameGraph(mockDevice(commandEncoder)).beginFrame();
	const target = graph.importBuffer(buffer('snapshot-target', bufferUsage.COPY_DST), {
		exposedSize: 64,
		exposedUsage: bufferUsage.COPY_DST,
	});
	const replacement = graph.importBuffer(buffer('replacement-target', bufferUsage.COPY_DST), {
		exposedSize: 64,
		exposedUsage: bufferUsage.COPY_DST,
	});
	const operation = { target, offset: 4, size: 8 };
	const operations = [operation];

	graph.clearBuffer({ label: 'snapshot-clear', sideEffect: true, operations });
	operation.target = replacement;
	operation.offset = 16;
	operation.size = 16;
	operations.length = 0;

	const compiled = graph.compile({ report: true });
	assert.deepEqual(
		compiled.compilationReport.accesses.map((access) => ({
			resourceId: access.resourceId,
			bufferRange: access.bufferRange,
		})),
		[{ resourceId: target.id, bufferRange: { offset: 4, size: 8 } }],
	);
	compiled.execute();

	assert.deepEqual(calls, ['snapshot-target:4:8']);
});

test('command encode can only unwrap declared imported resources', () => {
	const device = mockDevice();
	const graph = new FrameGraph(device).beginFrame();
	const imported = graph.importTexture(texture('asset', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'asset', exposedUsage: textureUsage.TEXTURE_BINDING });
	let resolved: GPUTextureView | undefined;

	const importedSampledUse = graph.use(imported, TextureAccess.Sampled);
	graph.command({
		sideEffect: true,
		uses: [importedSampledUse],
		encode(ctx) {
			resolved = ctx.unwrap(importedSampledUse);
		},
	});

	executeCompiled(graph);

	assert.equal(resolved?.label, 'asset');
});

test('execute materializes role-specific default views and caches them per execution', () => {
	const descriptors: GPUTextureViewDescriptor[] = [];
	const physical = {
		...texture('multi-role', textureUsage.TEXTURE_BINDING | textureUsage.STORAGE_BINDING),
		width: 4,
		height: 4,
		mipLevelCount: 3,
		usage: textureUsage.TEXTURE_BINDING | textureUsage.STORAGE_BINDING,
		createView(descriptor: GPUTextureViewDescriptor = {}) {
			descriptors.push(descriptor);
			return { label: `view-${descriptors.length}` } as GPUTextureView;
		},
	} as unknown as GPUTexture;
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importTexture(physical, { label: 'multi-role', exposedUsage: textureUsage.TEXTURE_BINDING | textureUsage.STORAGE_BINDING });
	let sampledA: GPUTextureView | undefined;
	let sampledB: GPUTextureView | undefined;
	let storage: GPUTextureView | undefined;
	const cachedSampledUse = graph.use(imported, TextureAccess.Sampled);
	const cachedStorageReadUse = graph.use(imported, TextureAccess.StorageRead);
	graph.command({
		sideEffect: true,
		uses: [cachedSampledUse, cachedStorageReadUse],
		encode(ctx) {
			sampledA = ctx.unwrap(cachedSampledUse);
			sampledB = ctx.unwrap(cachedSampledUse);
			storage = ctx.unwrap(cachedStorageReadUse);
		},
	});

	executeCompiled(graph);

	assert.equal(sampledA, sampledB);
	assert.notEqual(sampledA, storage);
	assert.equal(descriptors.length, 2);
	assert.equal(descriptors[0]?.mipLevelCount, 3);
	assert.equal(descriptors[0]?.usage, textureUsage.TEXTURE_BINDING);
	assert.equal(descriptors[1]?.mipLevelCount, 1);
	assert.equal(descriptors[1]?.usage, textureUsage.STORAGE_BINDING);
});

test('execute caches raw default views by role across read and write accesses', () => {
	const descriptors: GPUTextureViewDescriptor[] = [];
	const physical = {
		...texture('storage', textureUsage.STORAGE_BINDING),
		createView(descriptor: GPUTextureViewDescriptor = {}) {
			descriptors.push(descriptor);
			return { label: `storage-view-${descriptors.length}` } as GPUTextureView;
		},
	} as unknown as GPUTexture;
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const storage = graph.importTexture(physical, { label: 'storage', exposedUsage: textureUsage.STORAGE_BINDING });
	let writeView: GPUTextureView | undefined;
	let readView: GPUTextureView | undefined;
	const storageWriteUse = graph.use(storage, TextureAccess.StorageWrite, { contents: 'overwrite' });
	graph.command({
		label: 'write',
		sideEffect: true,
		uses: [storageWriteUse],
		encode(ctx) {
			writeView = ctx.unwrap(storageWriteUse);
		},
	});
	const storageReadUse = graph.use(storage, TextureAccess.StorageRead);
	graph.command({
		label: 'read',
		sideEffect: true,
		uses: [storageReadUse],
		encode(ctx) {
			readView = ctx.unwrap(storageReadUse);
		},
	});

	executeCompiled(graph);

	assert.equal(writeView, readView);
	assert.equal(descriptors.length, 1);
});

test('execute materializes one cached view for a logical TextureViewHandle', () => {
	let createViewCount = 0;
	let materializedDescriptor: GPUTextureViewDescriptor | undefined;
	const physical = {
		...texture('alternate', textureUsage.TEXTURE_BINDING),
		createView(descriptor: GPUTextureViewDescriptor = {}) {
			createViewCount++;
			materializedDescriptor = descriptor;
			return { label: 'alternate-view' } as GPUTextureView;
		},
	} as unknown as GPUTexture;
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importTexture(physical, { label: 'alternate', viewFormats: ['rgba8unorm-srgb'], exposedUsage: textureUsage.TEXTURE_BINDING });
	const view = graph.createTextureView(imported, {
		label: 'srgb',
		format: 'rgba8unorm-srgb',
	});
	const sampledViewUse = graph.use(view, TextureAccess.Sampled);
	graph.command({
		sideEffect: true,
		uses: [sampledViewUse],
		encode(ctx) {
			assert.equal(ctx.unwrap(sampledViewUse), ctx.unwrap(sampledViewUse));
		},
	});

	executeCompiled(graph);

	assert.equal(createViewCount, 1);
	assert.equal(materializedDescriptor?.format, 'rgba8unorm-srgb');
	assert.equal(materializedDescriptor?.usage, textureUsage.TEXTURE_BINDING);
	assert.equal(materializedDescriptor?.swizzle, undefined);
});

test('logical view usage is derived only from retained nodes', () => {
	let physicalDescriptor: GPUTextureDescriptor | undefined;
	let materializedDescriptor: GPUTextureViewDescriptor | undefined;
	const baseDevice = mockDevice();
	const device = {
		...baseDevice,
		createTexture(desc: GPUTextureDescriptor) {
			physicalDescriptor = desc;
			return {
				...texture('transient', desc.usage),
				createView(viewDesc: GPUTextureViewDescriptor = {}) {
					materializedDescriptor = viewDesc;
					return { label: 'retained-view' } as GPUTextureView;
				},
			} as unknown as GPUTexture;
		},
	} as unknown as GPUDevice;
	const graph = new FrameGraph(device).beginFrame();
	const target = graph.createTexture({
		label: 'target',
		format: 'rgba8unorm',
		size: [1, 1],
	});
	const view = graph.createTextureView(target);
	graph.render({
		label: 'retained-render',
		sideEffect: true,
		colorAttachments: [{ target: view, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		label: 'culled-sample',
		sideEffect: false,
		uses: [graph.use(view, TextureAccess.Sampled)],
	});

	const compiledFrame = graph.compile({ report: true });
	const compiled = compiledFrame.compilationReport;
	compiledFrame.execute();

	assert.equal(compiledResource(compiled, target).usage, textureUsage.RENDER_ATTACHMENT);
	assert.equal(physicalDescriptor?.usage, textureUsage.RENDER_ATTACHMENT);
	assert.equal(materializedDescriptor?.usage, textureUsage.RENDER_ATTACHMENT);
});

test('render and compute nodes create pass encoders and close them after execute', () => {
	const calls: string[] = [];
	const commandEncoder = mockCommandEncoder({
		beginRenderPass(desc: GPURenderPassDescriptor) {
			calls.push(`render:${desc.label}:${Array.from(desc.colorAttachments).length}`);
			return {
				draw() {
					calls.push('draw');
				},
				end() {
					calls.push('render:end');
				},
			};
		},
		beginComputePass(desc?: GPUComputePassDescriptor) {
			calls.push(`compute:${desc?.label ?? ''}`);
			return {
				dispatchWorkgroups() {
					calls.push('dispatch');
				},
				end() {
					calls.push('compute:end');
				},
			};
		},
	});
	const device = mockDevice(commandEncoder);
	const runtime = new FrameGraph(device);
	const graph = runtime.beginFrame();
	const target = graph.importSwapchainTexture(texture('backbuffer', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'backbuffer', exposedUsage: textureUsage.RENDER_ATTACHMENT });

	graph.render({
		label: 'render',
		colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store' }],
		encode(ctx) {
			assert.ok(ctx.pass);
			ctx.pass.draw(3);
		},
	});
	graph.compute({
		label: 'compute',
		sideEffect: true,
		encode(ctx) {
			assert.ok(ctx.pass);
			ctx.pass.dispatchWorkgroups(1);
		},
	});
	graph.markPresent(target);
	executeCompiled(graph);

	assert.deepEqual(calls, [
		'render:render:1',
		'draw',
		'render:end',
		'compute:compute',
		'dispatch',
		'compute:end',
	]);
});

test('render pass descriptor forwards explicit depth clear values', () => {
	const captured: Array<number | undefined> = [];
	const commandEncoder = mockCommandEncoder({
		beginRenderPass(desc: GPURenderPassDescriptor) {
			captured.push(desc.depthStencilAttachment?.depthClearValue);
			return { end() {} };
		},
	});
	const device = mockDevice(commandEncoder);
	for (const depthClearValue of [0, 1]) {
		const graph = new FrameGraph(device).beginFrame();
		const color = graph.importSwapchainTexture(texture(`backbuffer-${depthClearValue}`, undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: `backbuffer-${depthClearValue}`, exposedUsage: textureUsage.RENDER_ATTACHMENT });
		const depth = graph.createTexture({
			label: `depth-${depthClearValue}`,
			format: 'depth24plus',
			size: [1, 1],
		});

		graph.render({
			label: `depth-clear-${depthClearValue}`,
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
			depthStencilAttachment: {
				target: depth,
				depthLoadOp: 'clear',
				depthStoreOp: 'store',
				depthClearValue,
			},
		});
		graph.markPresent(color);
		executeCompiled(graph);
	}

	assert.deepEqual(captured, [0, 1]);
});

test('render snapshots color dictionaries, arrays, and one-shot iterables for repeated execution', () => {
	const captured: number[][][] = [];
	const commandEncoder = mockCommandEncoder({
		beginRenderPass(desc: GPURenderPassDescriptor) {
			captured.push(Array.from(desc.colorAttachments, (attachment) => {
				assert.ok(attachment);
				const color = attachment.clearValue as GPUColorDict;
				return [color.r, color.g, color.b, color.a];
			}));
			return { end() {} };
		},
	});
	const graph = new FrameGraph(mockDevice(commandEncoder)).beginFrame();
	const targets = Array.from({ length: 3 }, (_, index) => graph.createTexture({
		label: `color-${index}`,
		format: 'rgba8unorm',
		size: [1, 1],
	}));
	const dictionary = { r: 0.1, g: 0.2, b: 0.3, a: 0.4 };
	const array = [0.5, 0.6, 0.7, 0.8];
	function* oneShotColor(): Generator<number> {
		yield 0.9;
		yield 1;
		yield 1.1;
		yield 1.2;
	}

	graph.render({
		label: 'snapshotted-colors',
		sideEffect: true,
		colorAttachments: [
			{ target: targets[0], loadOp: 'clear', storeOp: 'store', clearValue: dictionary },
			{ target: targets[1], loadOp: 'clear', storeOp: 'store', clearValue: array },
			{ target: targets[2], loadOp: 'clear', storeOp: 'store', clearValue: oneShotColor() as unknown as GPUColor },
		],
	});
	dictionary.r = 9;
	dictionary.a = 9;
	array.fill(9);

	const compiled = graph.compile();
	compiled.execute();
	compiled.execute();

	const expected = [
		[0.1, 0.2, 0.3, 0.4],
		[0.5, 0.6, 0.7, 0.8],
		[0.9, 1, 1.1, 1.2],
	];
	assert.deepEqual(captured, [expected, expected]);
});

test('render pass descriptor forwards 3d color attachment depthSlice', () => {
	let captured: GPURenderPassDescriptor | undefined;
	const commandEncoder = mockCommandEncoder({
		beginRenderPass(desc: GPURenderPassDescriptor) {
			captured = desc;
			return { end() {} };
		},
	});
	const graph = new FrameGraph(mockDevice(commandEncoder)).beginFrame();
	const volume = graph.createTexture({
		label: 'volume',
		format: 'rgba8unorm',
		size: [4, 4, 3],
		dimension: '3d',
	});
	graph.render({
		colorAttachments: [{
			target: volume,
			depthSlice: 1,
			loadOp: 'clear',
			storeOp: 'store',
		}],
	});
	graph.markOutput(volume);

	executeCompiled(graph);

	assert.equal(Array.from(captured?.colorAttachments ?? [])[0]?.depthSlice, 1);
});

test('execute submits the command buffer and runs frame callbacks in order', () => {
	const calls: string[] = [];
	const commandEncoder = mockCommandEncoder({
		finish() {
			calls.push('finish');
			return {} as GPUCommandBuffer;
		},
	});
	const device = {
		...mockDevice(commandEncoder),
		queue: {
			submit(commandBuffers: readonly GPUCommandBuffer[]) {
				calls.push(`submit:${commandBuffers.length}`);
			},
		},
	} as unknown as GPUDevice;
	const graph = new FrameGraph(device).beginFrame();

	graph.command({
		label: 'callback',
		encode(ctx) {
			assert.equal(ctx.device, device);
			calls.push('node');
		},
	});

	executeCompiled(graph, {
		frameIndex: 7,
		beforeSubmit(ctx) {
			assert.equal(ctx.device, device);
			assert.equal(ctx.frameIndex, 7);
			assert.equal(ctx.commandEncoder, commandEncoder);
			calls.push('beforeSubmit');
		},
		afterSubmit(ctx) {
			assert.equal(ctx.device, device);
			assert.equal(ctx.frameIndex, 7);
			calls.push('afterSubmit');
		},
	});

	assert.deepEqual(calls, ['node', 'beforeSubmit', 'finish', 'submit:1', 'afterSubmit']);
});

test('execute submits FrameGraph command segments around opaque external queue work', () => {
	const calls: string[] = [];
	let encoderIndex = 0;
	const baseDevice = mockDevice();
	const device = {
		...baseDevice,
		createCommandEncoder() {
			const index = encoderIndex++;
			return mockCommandEncoder({
				finish() {
					calls.push(`finish:${index}`);
					return { label: `frame-graph-${index}` } as GPUCommandBuffer;
				},
			});
		},
		queue: {
			submit(commandBuffers: readonly GPUCommandBuffer[]) {
				calls.push(`submit:${commandBuffers[0]?.label ?? 'unknown'}`);
			},
		},
	} as unknown as GPUDevice;
	const graph = new FrameGraph(device).beginFrame();
	const meshOutput = graph.createBuffer({ label: 'mesh-output', size: 4 });
	const externalOutput = graph.createBuffer({ label: 'external-output', size: 4 });

	graph.command({
		label: 'mesh',
		uses: [graph.use(meshOutput, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		encode() {
			calls.push('mesh');
		},
	});
	const meshOutputReadUse = graph.use(meshOutput, BufferAccess.StorageRead);
	graph.externalSubmission({
		label: 'external',
		uses: [meshOutputReadUse, graph.use(externalOutput, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		submit(ctx) {
			assert.equal(ctx.device, device);
			assert.equal('commandEncoder' in ctx, false);
			assert.equal(ctx.unwrap(meshOutputReadUse).label, 'transient-buffer-0');
			calls.push('external');
			ctx.device.queue.submit([{ label: 'external' } as GPUCommandBuffer]);
		},
	});
	graph.command({
		label: 'present',
		uses: [graph.use(externalOutput, BufferAccess.StorageRead)],
		encode() {
			calls.push('present');
		},
	});

	executeCompiled(graph, {
		beforeSubmit(ctx) {
			calls.push(`before:${ctx.segmentIndex}/${ctx.segmentCount}`);
		},
		afterSubmit() {
			calls.push('after');
		},
	});

	assert.deepEqual(calls, [
		'mesh',
		'before:0/2',
		'finish:0',
		'submit:frame-graph-0',
		'external',
		'submit:external',
		'present',
		'before:1/2',
		'finish:1',
		'submit:frame-graph-1',
		'after',
	]);
});

test('execute skips empty FrameGraph segments around external submissions', () => {
	const executeAndCount = (record: (graph: FrameGraphRecorder) => void) => {
		let encoderCount = 0;
		let beforeSubmitCount = 0;
		let afterSubmitCount = 0;
		const device = {
			...mockDevice(),
			createCommandEncoder() {
				encoderCount++;
				return mockCommandEncoder();
			},
		} as unknown as GPUDevice;
		const graph = new FrameGraph(device).beginFrame();
		record(graph);
		executeCompiled(graph, {
			beforeSubmit() {
				beforeSubmitCount++;
			},
			afterSubmit() {
				afterSubmitCount++;
			},
		});
		return { encoderCount, beforeSubmitCount, afterSubmitCount };
	};

	assert.deepEqual(executeAndCount((graph) => {
		graph.externalSubmission({ submit() {} });
	}), { encoderCount: 0, beforeSubmitCount: 0, afterSubmitCount: 1 });
	assert.deepEqual(executeAndCount((graph) => {
		graph.externalSubmission({ submit() {} });
		graph.command({ encode() {} });
	}), { encoderCount: 1, beforeSubmitCount: 1, afterSubmitCount: 1 });
	assert.deepEqual(executeAndCount((graph) => {
		graph.command({ encode() {} });
		graph.externalSubmission({ submit() {} });
	}), { encoderCount: 1, beforeSubmitCount: 1, afterSubmitCount: 1 });
	assert.deepEqual(executeAndCount((graph) => {
		graph.command({ encode() {} });
		graph.externalSubmission({ submit() {} });
		graph.externalSubmission({ submit() {} });
		graph.command({ encode() {} });
	}), { encoderCount: 2, beforeSubmitCount: 2, afterSubmitCount: 1 });
});

test('external submission failure releases prefix transients', () => {
	let submitCount = 0;
	let afterSubmitCalled = false;
	const device = {
		...mockDevice(),
		queue: {
			submit() {
				submitCount++;
			},
		},
	} as unknown as GPUDevice;
	const runtime = new FrameGraph(device);
	const graph = runtime.beginFrame();
	const transient = graph.createBuffer({ label: 'prefix-transient', size: 4 });
	graph.command({
		label: 'prefix',
		uses: [graph.use(transient, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.externalSubmission({
		label: 'failing-external',
		uses: [graph.use(transient, BufferAccess.StorageRead)],
		submit() {
			throw new Error('external failure');
		},
	});
	const compiled = graph.compile();
	assert.throws(() => compiled.execute({
		afterSubmit() {
			afterSubmitCalled = true;
		},
	}), /external failure/);
	assert.equal(submitCount, 1);
	assert.equal(afterSubmitCalled, false);
	assert.equal(runtime.getResourcePoolStats().retainedCount, 1);
});

test('later FrameGraph encoding failure preserves prior submissions and releases transients', () => {
	const calls: string[] = [];
	const device = {
		...mockDevice(),
		queue: {
			submit(commandBuffers: readonly GPUCommandBuffer[]) {
				calls.push(`submit:${commandBuffers[0]?.label ?? 'external'}`);
			},
		},
		createCommandEncoder() {
			return mockCommandEncoder({
				finish() {
					return { label: 'frame-graph' } as GPUCommandBuffer;
				},
			});
		},
	} as unknown as GPUDevice;
	const runtime = new FrameGraph(device);
	const graph = runtime.beginFrame();
	const transient = graph.createBuffer({ label: 'cross-segment-transient', size: 4 });
	graph.command({
		label: 'prefix',
		uses: [graph.use(transient, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.externalSubmission({
		label: 'external',
		uses: [graph.use(transient, BufferAccess.StorageRead)],
		submit(ctx) {
			calls.push('external');
			ctx.device.queue.submit([]);
		},
	});
	graph.command({
		label: 'failing-suffix',
		uses: [graph.use(transient, BufferAccess.StorageRead)],
		encode() {
			throw new Error('suffix encoding failure');
		},
	});
	const compiled = graph.compile();
	assert.throws(() => compiled.execute(), /suffix encoding failure/);
	assert.deepEqual(calls, ['submit:frame-graph', 'external', 'submit:external']);
	assert.equal(runtime.getResourcePoolStats().retainedCount, 1);
});

test('copy node records declarative buffer copy operations', () => {
	const calls: string[] = [];
	const commandEncoder = mockCommandEncoder({
		copyBufferToBuffer(
			source: GPUBuffer,
			sourceOffset: GPUSize64,
			destination: GPUBuffer,
			destinationOffset: GPUSize64,
			size: GPUSize64,
		) {
			calls.push(`${source.label}:${sourceOffset}->${destination.label}:${destinationOffset}:${size}`);
		},
	});
	const device = mockDevice(commandEncoder);
	const graph = new FrameGraph(device).beginFrame();
	const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 64, exposedUsage: bufferUsage.COPY_SRC });
	const destination = graph.importBuffer(buffer('destination', bufferUsage.COPY_DST | bufferUsage.MAP_READ), { label: 'destination', exposedSize: 64, exposedUsage: bufferUsage.COPY_DST | bufferUsage.MAP_READ });

	graph.copy({
		label: 'copy',
		operations: [{ type: 'buffer-to-buffer', source, destination, sourceOffset: 4, destinationOffset: 8, size: 16 }],
	});
	graph.markReadback(destination);

	executeCompiled(graph);

	assert.deepEqual(calls, ['source:4->destination:8:16']);
});

test('execute rejects resolving resources not declared by the node', () => {
	const device = mockDevice();
	const graph = new FrameGraph(device).beginFrame();
	const declared = graph.importTexture(texture('declared', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'declared', exposedUsage: textureUsage.TEXTURE_BINDING });
	const undeclared = graph.importTexture(texture('undeclared', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'undeclared', exposedUsage: textureUsage.TEXTURE_BINDING });

	const declaredSampledUse = graph.use(declared, TextureAccess.Sampled);
	const undeclaredUse = graph.use(undeclared, TextureAccess.Sampled);
	graph.command({
		label: 'callback',
		sideEffect: true,
		uses: [declaredSampledUse],
		encode(ctx) {
			ctx.unwrap(undeclaredUse);
		},
	});

	assert.throws(() => executeCompiled(graph), (error) => error instanceof FrameGraphError
		&& error.code === 'FG4010'
		&& error.phase === 'execute'
		&& error.nodeId === 1
		&& error.resourceId === undeclared.id
		&& error.message.includes('was not declared'));
});

test('execute rejects asynchronous render and compute callbacks before submission', () => {
	let endCount = 0;
	let submitCount = 0;
	const commandEncoder = mockCommandEncoder({
		beginRenderPass() {
			return { end() { endCount++; } };
		},
		beginComputePass() {
			return { end() { endCount++; } };
		},
	});
	const device = {
		...mockDevice(commandEncoder),
		queue: { submit() { submitCount++; } },
	} as unknown as GPUDevice;

	const renderGraph = new FrameGraph(device).beginFrame();
	const color = renderGraph.createTexture({ format: 'rgba8unorm', size: [1, 1] });
	renderGraph.render({
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
		encode: (async () => {}) as unknown as never,
	});
	renderGraph.markOutput(color);
	assert.throws(() => renderGraph.compile().execute(), (error) => error instanceof FrameGraphError
		&& error.code === 'FG4012'
		&& error.phase === 'execute'
		&& error.nodeId === 1
		&& error.message.includes('FrameGraph.render encode callback must complete synchronously'));
	assert.equal(endCount, 1);
	assert.equal(submitCount, 0);

	const computeGraph = new FrameGraph(device).beginFrame();
	computeGraph.compute({ sideEffect: true, encode: (async () => {}) as unknown as never });
	assert.throws(() => computeGraph.compile().execute(), /FrameGraph\.compute encode callback must complete synchronously/);
	assert.equal(endCount, 2);
	assert.equal(submitCount, 0);
});

test('execute rejects asynchronous command callbacks before finishing the encoder', () => {
	let finishCount = 0;
	const commandEncoder = mockCommandEncoder({
		finish() {
			finishCount++;
			return {} as GPUCommandBuffer;
		},
	});
	const graph = new FrameGraph(mockDevice(commandEncoder)).beginFrame();
	graph.command({ encode: (async () => {}) as unknown as never });

	assert.throws(() => graph.compile().execute(), /FrameGraph\.command encode callback must complete synchronously/);
	assert.equal(finishCount, 0);
});

test('execute rejects asynchronous external, beforeSubmit, and afterSubmit callbacks', () => {
	let submitCount = 0;
	let encoderCount = 0;
	const device = {
		...mockDevice(),
		createCommandEncoder() {
			encoderCount++;
			return mockCommandEncoder();
		},
		queue: { submit() { submitCount++; } },
	} as unknown as GPUDevice;

	const externalGraph = new FrameGraph(device).beginFrame();
	externalGraph.externalSubmission({ submit: (async () => {}) as unknown as never });
	assert.throws(() => externalGraph.compile().execute(), /FrameGraph\.externalSubmit callback must complete synchronously/);
	assert.equal(encoderCount, 0);
	assert.equal(submitCount, 0);

	const beforeGraph = new FrameGraph(device).beginFrame();
	beforeGraph.command({ encode() {} });
	assert.throws(
		() => beforeGraph.compile().execute({ beforeSubmit: (async () => {}) as unknown as never }),
		/FrameGraph\.beforeSubmit callback must complete synchronously/,
	);
	assert.equal(submitCount, 0);

	const afterGraph = new FrameGraph(device).beginFrame();
	afterGraph.command({ encode() {} });
	assert.throws(
		() => afterGraph.compile().execute({ afterSubmit: (async () => {}) as unknown as never }),
		/FrameGraph\.afterSubmit callback must complete synchronously/,
	);
	assert.equal(submitCount, 1);
});

test('execute rejects custom thenables at synchronous callback boundaries', () => {
	const thenable = { then() {} };
	const graph = new FrameGraph(mockDevice()).beginFrame();
	graph.command({ encode: (() => thenable) as unknown as never });

	assert.throws(() => graph.compile().execute(), /FrameGraph\.command encode callback must complete synchronously/);
});

test('execute consumes rejected asynchronous callback results', async () => {
	let unhandled = false;
	const onUnhandledRejection = () => {
		unhandled = true;
	};
	process.once('unhandledRejection', onUnhandledRejection);
	try {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		graph.command({
			encode: (async () => {
				throw new Error('late callback failure');
			}) as unknown as never,
		});
		assert.throws(() => graph.compile().execute(), /FrameGraph\.command encode callback must complete synchronously/);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(unhandled, false);
	}
	finally {
		process.removeListener('unhandledRejection', onUnhandledRejection);
	}
});

test('execute validates frameIndex before allocating or executing', () => {
	let encoderCount = 0;
	let resourceCount = 0;
	let callbackCount = 0;
	const baseDevice = mockDevice();
	const device = {
		...baseDevice,
		createCommandEncoder() {
			encoderCount++;
			return mockCommandEncoder();
		},
		createBuffer(desc: GPUBufferDescriptor) {
			resourceCount++;
			return baseDevice.createBuffer(desc);
		},
	} as unknown as GPUDevice;
	const graph = new FrameGraph(device).beginFrame();
	const output = graph.createBuffer({ size: 4 });
	graph.command({
		uses: [graph.use(output, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		encode() { callbackCount++; },
	});
	graph.markOutput(output);
	const compiled = graph.compile();

	for (const frameIndex of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(
			() => compiled.execute({ frameIndex }),
			/CompiledFrame\.execute\(\) frameIndex must be a non-negative safe integer/,
			String(frameIndex),
		);
	}
	assert.equal(encoderCount, 0);
	assert.equal(resourceCount, 0);
	assert.equal(callbackCount, 0);

	assert.doesNotThrow(() => compiled.execute({ frameIndex: Number.MAX_SAFE_INTEGER }));
});
