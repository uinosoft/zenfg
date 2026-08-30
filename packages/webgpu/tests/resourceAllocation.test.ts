import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BufferAccess,
	FrameGraph,
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
	internalCompiledPlan,
	allocationResourceLabels,
} from './testUtils.ts';

function executeCompiled(graph: FrameGraphRecorder, options: CompiledFrameExecuteOptions = {}): void {
	graph.compile().execute(options);
}

test('transient resources with explicit usage allocate with the declared usage', () => {
	const device = mockDevice();
	const runtime = new FrameGraph(device);
	const graph = runtime.beginFrame();
	const readback = graph.createBuffer({
		label: 'readback',
		size: 64,
		usage: bufferUsage.COPY_DST | bufferUsage.MAP_READ,
	});
	let resolvedUsage = 0;

	const readbackWriteUse = graph.use(readback, BufferAccess.CopyDst, { contents: 'overwrite' });
	graph.compute({
		label: 'produce-readback',
		uses: [readbackWriteUse],
		encode(ctx) {
			resolvedUsage = ctx.unwrap(readbackWriteUse).usage;
		},
	});
	graph.markOutput(readback);

	executeCompiled(graph);

	assert.equal(resolvedUsage, bufferUsage.COPY_DST | bufferUsage.MAP_READ);
});

test('compile reports zero inferred usage for culled-only transient resources', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'culled-color', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'culled-render',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const colorInfo = compiledResource(compiled, color);

	assert.deepEqual(compiled.culledNodes.map((node) => node.label), ['culled-render']);
	assert.equal(colorInfo.usage, 0);
	assert.equal(colorInfo.lifetime, undefined);
	assert.equal(colorInfo.physicalAllocationId, undefined);
	assert.deepEqual(compiled.allocations, []);
});

test('compile does not reuse physical allocation for incompatible transient textures', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const first = graph.createTexture({ label: 'first', format: 'rgba8unorm', size: [1, 1] });
	const token = graph.createBuffer({ label: 'token', size: 4 });
	const second = graph.createTexture({ label: 'second', format: 'rgba16float', size: [1, 1] });

	graph.render({
		label: 'write-first',
		colorAttachments: [{ target: first, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.compute({
		label: 'consume-first',
		uses: [graph.use(first, TextureAccess.Sampled), graph.use(token, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.render({
		label: 'write-second',
		uses: [graph.use(token, BufferAccess.StorageRead)],
		colorAttachments: [{ target: second, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		label: 'consume-second',
		sideEffect: true,
		uses: [graph.use(second, TextureAccess.Sampled)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const firstInfo = compiled.resources.find((resource) => resource.id === first.id);
	const secondInfo = compiled.resources.find((resource) => resource.id === second.id);

	assert.notEqual(firstInfo?.physicalAllocationId, secondInfo?.physicalAllocationId);
});

test('compile reuses PostFX AO transient textures when lifetimes do not overlap', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const sceneColor = graph.importTexture(texture('scene-color', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'scene-color', exposedUsage: textureUsage.TEXTURE_BINDING });
	const aoRaw = graph.createTexture({ label: 'postfx.ao-raw', format: 'rgba8unorm', size: [1024, 1024] });
	const aoBlurH = graph.createTexture({ label: 'postfx.ao-blur-h', format: 'rgba8unorm', size: [1024, 1024] });
	const aoBlurred = graph.createTexture({ label: 'postfx.ao-blurred', format: 'rgba8unorm', size: [1024, 1024] });

	graph.render({
		label: 'postfx.ao-raw',
		uses: [graph.use(sceneColor, TextureAccess.Sampled)],
		colorAttachments: [{ target: aoRaw, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'postfx.ao-blur-h',
		uses: [graph.use(aoRaw, TextureAccess.Sampled)],
		colorAttachments: [{ target: aoBlurH, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'postfx.ao-blur-v',
		uses: [graph.use(aoBlurH, TextureAccess.Sampled)],
		colorAttachments: [{ target: aoBlurred, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		label: 'consume-ao',
		sideEffect: true,
		uses: [graph.use(aoBlurred, TextureAccess.Sampled)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const rawInfo = compiledResource(compiled, aoRaw);
	const blurHInfo = compiledResource(compiled, aoBlurH);
	const blurredInfo = compiledResource(compiled, aoBlurred);

	assert.equal(rawInfo.physicalAllocationId, blurredInfo.physicalAllocationId);
	assert.notEqual(rawInfo.physicalAllocationId, blurHInfo.physicalAllocationId);
	assert.equal(compiledResource(compiled, aoRaw).lifetime?.lastUse, compiledResource(compiled, aoBlurH).lifetime?.firstUse);
	assert.ok((compiledResource(compiled, aoRaw).lifetime?.lastUse ?? 0) < (compiledResource(compiled, aoBlurred).lifetime?.firstUse ?? 0));
});

test('compile keeps Bloom and AO transient buckets isolated by descriptor while reusing compatible lifetimes', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const sceneColor = graph.importTexture(texture('scene-color', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'scene-color', exposedUsage: textureUsage.TEXTURE_BINDING });
		const aoRaw = graph.createTexture({ label: 'postfx.ao-raw', format: 'rgba8unorm', size: [1024, 1024] });
		const aoBlurH = graph.createTexture({ label: 'postfx.ao-blur-h', format: 'rgba8unorm', size: [1024, 1024] });
		const aoBlurred = graph.createTexture({ label: 'postfx.ao-blurred', format: 'rgba8unorm', size: [1024, 1024] });
		const bloomDown = graph.createTexture({ label: 'postfx.bloom-down-chain', format: 'rgba16float', size: [1024, 1024], mipLevelCount: 4 });
		const bloomDownMip0 = graph.createTextureView(bloomDown, { baseMipLevel: 0, mipLevelCount: 1 });

		graph.render({
			label: 'ao-raw',
			uses: [graph.use(sceneColor, TextureAccess.Sampled)],
			colorAttachments: [{ target: aoRaw, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'ao-blur-h',
			uses: [graph.use(aoRaw, TextureAccess.Sampled)],
			colorAttachments: [{ target: aoBlurH, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'ao-blurred',
			uses: [graph.use(aoBlurH, TextureAccess.Sampled)],
			colorAttachments: [{ target: aoBlurred, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'bloom-down',
			uses: [graph.use(aoBlurred, TextureAccess.Sampled)],
			colorAttachments: [{ target: bloomDownMip0, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.command({ label: 'consume-bloom', sideEffect: true, uses: [graph.use(bloomDownMip0, TextureAccess.Sampled)] });

		const compiled = graph.compile({ report: true }).compilationReport;
		const aoRawInfo = compiledResource(compiled, aoRaw);
		const aoBlurredInfo = compiledResource(compiled, aoBlurred);
		const bloomDownInfo = compiledResource(compiled, bloomDown);

		assert.equal(aoRawInfo.physicalAllocationId, aoBlurredInfo.physicalAllocationId);
		assert.notEqual(aoRawInfo.physicalAllocationId, bloomDownInfo.physicalAllocationId);
		assert.deepEqual(allocationResourceLabels(compiled, aoRawInfo.physicalAllocationId), new Set(['postfx.ao-raw', 'postfx.ao-blurred']));
		assert.deepEqual(allocationResourceLabels(compiled, bloomDownInfo.physicalAllocationId), new Set(['postfx.bloom-down-chain']));
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const sceneColor = graph.importTexture(texture('scene-color', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'scene-color', exposedUsage: textureUsage.TEXTURE_BINDING });
		const bloomDown = graph.createTexture({ label: 'postfx.bloom-down-chain', format: 'rgba16float', size: [1024, 1024], mipLevelCount: 4 });
		const bloomUp = graph.createTexture({ label: 'postfx.bloom-up-chain', format: 'rgba16float', size: [1024, 1024], mipLevelCount: 4 });
		const bloomDownMip0 = graph.createTextureView(bloomDown, { baseMipLevel: 0, mipLevelCount: 1 });
		const bloomUpMip0 = graph.createTextureView(bloomUp, { baseMipLevel: 0, mipLevelCount: 1 });

		graph.render({
			label: 'bloom-down',
			uses: [graph.use(sceneColor, TextureAccess.Sampled)],
			colorAttachments: [{ target: bloomDownMip0, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'bloom-up',
			uses: [graph.use(bloomDownMip0, TextureAccess.Sampled)],
			colorAttachments: [{ target: bloomUpMip0, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.command({ label: 'consume-bloom', sideEffect: true, uses: [graph.use(bloomUpMip0, TextureAccess.Sampled)] });

		const compiled = graph.compile({ report: true }).compilationReport;
		const bloomDownInfo = compiledResource(compiled, bloomDown);
		const bloomUpInfo = compiledResource(compiled, bloomUp);

		assert.notEqual(bloomDownInfo.physicalAllocationId, bloomUpInfo.physicalAllocationId);
		assert.deepEqual(allocationResourceLabels(compiled, bloomDownInfo.physicalAllocationId), new Set(['postfx.bloom-down-chain']));
		assert.deepEqual(allocationResourceLabels(compiled, bloomUpInfo.physicalAllocationId), new Set(['postfx.bloom-up-chain']));
	}
});

test('compile keeps MBOIT and directional shadow transient allocations separated by descriptor', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const background = graph.importTexture(texture('background', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'background', exposedUsage: textureUsage.TEXTURE_BINDING });
	const shadowDepth = graph.createTexture({
		label: 'mesh.directional-shadow.depth',
		format: 'depth32float',
		size: [2048, 2048, 4],
		usage: textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING,
	});
	const mboitMoments = graph.createTexture({ label: 'mesh.mboit.moments', format: 'rgba16float', size: [1024, 1024], sampleCount: 4 });
	const mboitOpacity = graph.createTexture({ label: 'mesh.mboit.opacity', format: 'r16float', size: [1024, 1024], sampleCount: 4 });
	const mboitShadedColor = graph.createTexture({ label: 'mesh.mboit.shaded-color', format: 'rgba16float', size: [1024, 1024], sampleCount: 4 });

	graph.render({
		label: 'shadow-cascade',
		depthStencilAttachment: { target: shadowDepth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
	});
	graph.render({
		label: 'mboit-accumulate',
		uses: [graph.use(background, TextureAccess.Sampled)],
		colorAttachments: [
			{ target: mboitMoments, loadOp: 'clear', storeOp: 'store' },
			{ target: mboitOpacity, loadOp: 'clear', storeOp: 'store' },
		],
	});
	graph.render({
		label: 'mboit-compose',
		uses: [
			graph.use(shadowDepth, TextureAccess.DepthRead),
			graph.use(mboitMoments, TextureAccess.Sampled),
			graph.use(mboitOpacity, TextureAccess.Sampled),
		],
		colorAttachments: [{ target: mboitShadedColor, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		label: 'consume-transparent',
		sideEffect: true,
		uses: [graph.use(mboitShadedColor, TextureAccess.Sampled)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const shadowInfo = compiledResource(compiled, shadowDepth);
	const momentsInfo = compiledResource(compiled, mboitMoments);
	const opacityInfo = compiledResource(compiled, mboitOpacity);
	const shadedInfo = compiledResource(compiled, mboitShadedColor);

	assert.notEqual(momentsInfo.physicalAllocationId, shadedInfo.physicalAllocationId);
	assert.notEqual(shadowInfo.physicalAllocationId, momentsInfo.physicalAllocationId);
	assert.notEqual(opacityInfo.physicalAllocationId, momentsInfo.physicalAllocationId);
	assert.notEqual(opacityInfo.physicalAllocationId, shadowInfo.physicalAllocationId);
	assert.deepEqual(allocationResourceLabels(compiled, momentsInfo.physicalAllocationId), new Set(['mesh.mboit.moments']));
	assert.deepEqual(allocationResourceLabels(compiled, shadedInfo.physicalAllocationId), new Set(['mesh.mboit.shaded-color']));
	assert.deepEqual(allocationResourceLabels(compiled, shadowInfo.physicalAllocationId), new Set(['mesh.directional-shadow.depth']));
});

test('compile reuses physical allocation only when lifetime boundary is non-overlapping', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const first = graph.createTexture({ label: 'first', format: 'rgba16float', size: [64, 64] });
		const token = graph.createBuffer({ label: 'token', size: 4 });
		const second = graph.createTexture({ label: 'second', format: 'rgba16float', size: [64, 64] });

		graph.render({ label: 'write-first', colorAttachments: [{ target: first, loadOp: 'clear', storeOp: 'store' }] });
		graph.compute({
			label: 'consume-first',
			uses: [graph.use(first, TextureAccess.Sampled), graph.use(token, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		});
		graph.render({
			label: 'write-second',
			uses: [graph.use(token, BufferAccess.StorageRead)],
			colorAttachments: [{ target: second, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.command({ label: 'consume-second', sideEffect: true, uses: [graph.use(second, TextureAccess.Sampled)] });

		const compiled = graph.compile({ report: true }).compilationReport;
		const firstInfo = compiledResource(compiled, first);
		const secondInfo = compiledResource(compiled, second);
		assert.ok((firstInfo.lifetime?.lastUse ?? 0) < (secondInfo.lifetime?.firstUse ?? 0));
		assert.equal(firstInfo.physicalAllocationId, secondInfo.physicalAllocationId);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const first = graph.createTexture({ label: 'first', format: 'rgba16float', size: [64, 64] });
		const second = graph.createTexture({ label: 'second', format: 'rgba16float', size: [64, 64] });

		graph.render({ label: 'write-first', colorAttachments: [{ target: first, loadOp: 'clear', storeOp: 'store' }] });
		graph.render({ label: 'write-second', colorAttachments: [{ target: second, loadOp: 'clear', storeOp: 'store' }] });
		graph.command({
			label: 'consume-overlap',
			sideEffect: true,
			uses: [graph.use(first, TextureAccess.Sampled), graph.use(second, TextureAccess.Sampled)],
		});

		const compiled = graph.compile({ report: true }).compilationReport;
		const firstInfo = compiledResource(compiled, first);
		const secondInfo = compiledResource(compiled, second);
		assert.ok((firstInfo.lifetime?.lastUse ?? 0) >= (secondInfo.lifetime?.firstUse ?? 0));
		assert.notEqual(firstInfo.physicalAllocationId, secondInfo.physicalAllocationId);
	}
});

test('compile preserves first-fit allocation choice when multiple compatible allocations are reusable', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const first = graph.createBuffer({ label: 'first', size: 16 });
	const second = graph.createBuffer({ label: 'second', size: 16 });
	const third = graph.createBuffer({ label: 'third', size: 16 });

	graph.command({
		label: 'write-first',
		sideEffect: true,
		uses: [graph.use(first, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.command({
		label: 'write-second',
		sideEffect: true,
		uses: [graph.use(second, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.command({
		label: 'read-first',
		sideEffect: true,
		uses: [graph.use(first, BufferAccess.StorageRead)],
	});
	graph.command({
		label: 'read-second',
		sideEffect: true,
		uses: [graph.use(second, BufferAccess.StorageRead)],
	});
	graph.command({
		label: 'write-third',
		sideEffect: true,
		uses: [graph.use(third, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const firstInfo = compiledResource(compiled, first);
	const secondInfo = compiledResource(compiled, second);
	const thirdInfo = compiledResource(compiled, third);

	assert.notEqual(firstInfo.physicalAllocationId, secondInfo.physicalAllocationId);
	assert.equal(thirdInfo.physicalAllocationId, firstInfo.physicalAllocationId);
	assert.deepEqual(
		allocationResourceLabels(compiled, thirdInfo.physicalAllocationId),
		new Set(['first', 'third']),
	);
});

test('stable recording order drives retained lifetimes and transient reuse', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const first = graph.createBuffer({ label: 'first', size: 16 });
	const second = graph.createBuffer({ label: 'second', size: 16 });

	const firstWrite = graph.use(first, BufferAccess.StorageWrite, { contents: 'overwrite' });
	graph.command({ label: 'first-write', sideEffect: false, uses: [firstWrite] });
	const firstRead = graph.use(first, BufferAccess.StorageRead);
	graph.command({ label: 'first-read', uses: [firstRead] });
	const secondWrite = graph.use(second, BufferAccess.StorageWrite, { contents: 'overwrite' });
	graph.command({ label: 'second-write', sideEffect: false, uses: [secondWrite] });
	graph.markOutput(second);

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), ['first-write', 'first-read', 'second-write']);
	const firstInfo = compiledResource(compiled, first);
	const secondInfo = compiledResource(compiled, second);
	assert.deepEqual(firstInfo.lifetime, { firstUse: 0, lastUse: 1 });
	assert.deepEqual(secondInfo.lifetime, { firstUse: 2, lastUse: 2 });
	assert.equal(firstInfo.physicalAllocationId, secondInfo.physicalAllocationId);
});

test('compile separates transient texture pool keys by descriptor dimensions used by real effects', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const source = graph.importTexture(texture('source', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'source', exposedUsage: textureUsage.TEXTURE_BINDING });
	const base = graph.createTexture({ label: 'base', format: 'rgba16float', size: [128, 128] });
	const differentFormat = graph.createTexture({ label: 'different-format', format: 'rgba8unorm', size: [128, 128] });
	const differentSize = graph.createTexture({ label: 'different-size', format: 'rgba16float', size: [64, 128] });
	const differentDimension = graph.createTexture({ label: 'different-dimension', format: 'rgba16float', size: [128, 128, 4], dimension: '3d' });
	const differentSampleCount = graph.createTexture({ label: 'different-sample-count', format: 'rgba16float', size: [128, 128], sampleCount: 4 });
	const differentMipLevelCount = graph.createTexture({ label: 'different-mip-level-count', format: 'rgba16float', size: [128, 128], mipLevelCount: 4 });
	const differentUsage = graph.createTexture({ label: 'different-usage', format: 'rgba16float', size: [128, 128], usage: textureUsage.RENDER_ATTACHMENT });

	for (const target of [base, differentFormat, differentSize, differentDimension, differentSampleCount, differentMipLevelCount]) {
		graph.render({
			label: `write-${target.label}`,
			uses: [graph.use(source, TextureAccess.Sampled)],
			colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store', ...(target === differentDimension ? { depthSlice: 0 } : {}) }],
		});
		graph.markOutput(target);
	}
	graph.render({
		label: `write-${differentUsage.label}`,
		uses: [graph.use(source, TextureAccess.Sampled)],
		colorAttachments: [{ target: differentUsage, loadOp: 'clear', storeOp: 'store' }],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const baseClass = debug.allocations.find((allocation) => allocation.id === compiledResource(compiled, base).physicalAllocationId)?.compatibilityClassId;
	assert.ok(baseClass);
	for (const handle of [differentFormat, differentSize, differentDimension, differentSampleCount, differentMipLevelCount, differentUsage]) {
		const compatibilityClass = debug.allocations.find((allocation) => allocation.id === compiledResource(compiled, handle).physicalAllocationId)?.compatibilityClassId;
		assert.notEqual(compatibilityClass, baseClass, `${handle.label} should use a distinct compatibility class`);
	}
});

test('execute allocates one physical texture for non-overlapping compatible transients', () => {
	const device = mockDevice();
	const runtime = new FrameGraph(device);
	const graph = runtime.beginFrame();
	const first = graph.createTexture({ label: 'first', format: 'rgba8unorm', size: [1, 1] });
	const token = graph.createBuffer({ label: 'token', size: 4 });
	const second = graph.createTexture({ label: 'second', format: 'rgba8unorm', size: [1, 1] });

	graph.render({
		label: 'write-first',
		colorAttachments: [{ target: first, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.compute({
		label: 'consume-first',
		uses: [graph.use(first, TextureAccess.Sampled), graph.use(token, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.render({
		label: 'write-second',
		uses: [graph.use(token, BufferAccess.StorageRead)],
		colorAttachments: [{ target: second, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		label: 'consume-second',
		sideEffect: true,
		uses: [graph.use(second, TextureAccess.Sampled)],
	});

	executeCompiled(graph);

	const pool = runtime.getResourcePoolStats();
	assert.equal(pool.acquireCount, 2);
	assert.equal(pool.createdCount, 2);
	assert.equal(pool.retainedCount, 2);
});

test('execute reuses the cached compiled plan and allocation map', () => {
	const device = mockDevice();
	const graph = new FrameGraph(device).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'render',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(color);

	const compiled = graph.compile({ report: true });
	const cachedPlan = internalCompiledPlan(graph);
	assert.ok(cachedPlan);
	assert.equal(cachedPlan.physicalAllocations.size, 1);

	compiled.execute();
	compiled.execute();

	assert.equal(internalCompiledPlan(graph), cachedPlan);
	assert.equal(internalCompiledPlan(graph)?.physicalAllocations, cachedPlan.physicalAllocations);
});

test('independent recordings preserve released transient resources in the runtime pool', () => {
	const createdLabels: string[] = [];
	const createdUsages: GPUTextureUsageFlags[] = [];
	const commandEncoder = mockCommandEncoder();
	const device = {
		createCommandEncoder() {
			return commandEncoder;
		},
		createTexture(desc: GPUTextureDescriptor) {
			const label = `pooled-${createdLabels.length}`;
			createdLabels.push(label);
			createdUsages.push(desc.usage);
			return {
				...texture(label, desc.usage),
				_desc: desc,
			} as unknown as GPUTexture;
		},
		createBuffer(desc: GPUBufferDescriptor) {
			return {
				...buffer(`buffer-${desc.size}`, desc.usage),
				_desc: desc,
			} as unknown as GPUBuffer;
		},
		queue: {
			submit() {},
		},
	} as unknown as GPUDevice;
	const runtime = new FrameGraph(device);

	function executeFrame(label: string, withCulledSample = false) {
		const graph = runtime.beginFrame();
		const color = graph.createTexture({ label, format: 'rgba8unorm', size: [1, 1] });
		graph.render({
			label,
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
		});
		if (withCulledSample) {
			graph.command({
				label: `${label}-culled-sample`,
				sideEffect: false,
				uses: [graph.use(color, TextureAccess.Sampled)],
			});
		}
		graph.markOutput(color);
		executeCompiled(graph);
		return graph;
	}

	const firstGraph = executeFrame('first', true);
	const firstPlan = internalCompiledPlan(firstGraph);
	assert.ok(firstPlan);
	const secondGraph = executeFrame('second');
	const secondPlan = internalCompiledPlan(secondGraph);
	assert.ok(secondPlan);

	assert.notEqual(secondPlan, firstPlan);
	assert.equal(createdLabels.length, 1);
	assert.deepEqual(createdUsages, [textureUsage.RENDER_ATTACHMENT]);
	assert.deepEqual(runtime.getResourcePoolStats(), {
		acquireCount: 2,
		reuseCount: 1,
		createdCount: 1,
		retainedCount: 1,
		estimatedRetainedBytes: 4,
	});
});

test('pooled transient buffers allocate the bucket size used by the pool key', () => {
	const createdSizes: number[] = [];
	const commandEncoder = mockCommandEncoder();
	const device = {
		createCommandEncoder() {
			return commandEncoder;
		},
		createTexture(desc: GPUTextureDescriptor) {
			return {
				...texture(`texture-${createdSizes.length}`, desc.usage),
				_desc: desc,
			} as unknown as GPUTexture;
		},
		createBuffer(desc: GPUBufferDescriptor) {
			createdSizes.push(desc.size);
			return {
				...buffer(`buffer-${desc.size}`, desc.usage),
				size: desc.size,
				_desc: desc,
			} as unknown as GPUBuffer;
		},
		queue: {
			submit() {},
		},
	} as unknown as GPUDevice;
	const runtime = new FrameGraph(device);

	function executeBufferFrame(label: string, size: number): number {
		const graph = runtime.beginFrame();
		const target = graph.createBuffer({ label, size });
		let resolvedSize = 0;
		const targetWriteUse = graph.use(target, BufferAccess.StorageWrite, { contents: 'overwrite' });
		graph.compute({
			label,
			uses: [targetWriteUse],
			encode(ctx) {
				resolvedSize = ctx.unwrap(targetWriteUse).size;
			},
		});
		graph.markOutput(target);
		executeCompiled(graph);
		return resolvedSize;
	}

	const first = executeBufferFrame('small', 33);
	const second = executeBufferFrame('large', 64);

	assert.equal(first, 64);
	assert.equal(second, 64);
	assert.deepEqual(createdSizes, [64]);
	assert.deepEqual(runtime.getResourcePoolStats(), {
		acquireCount: 2,
		reuseCount: 1,
		createdCount: 1,
		retainedCount: 1,
		estimatedRetainedBytes: 64,
	});
});

test('destroy clears retained resource pool stats while preserving cumulative counters', () => {
	const device = mockDevice();
	const runtime = new FrameGraph(device);
	const graph = runtime.beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'color',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(color);

	executeCompiled(graph);
	const beforeDestroy = runtime.getResourcePoolStats();
	runtime.destroy();

	assert.equal(beforeDestroy.retainedCount, 1);
	assert.throws(() => runtime.getResourcePoolStats(), /destroyed/);
});

test('clearResourcePool destroys retained resources while preserving cumulative counters', () => {
	const destroyed: string[] = [];
	const commandEncoder = mockCommandEncoder();
	let textureCount = 0;
	const device = {
		createCommandEncoder() {
			return commandEncoder;
		},
		createTexture(desc: GPUTextureDescriptor) {
			const label = `pooled-${textureCount++}`;
			return {
				...texture(label, desc.usage),
				destroy() {
					destroyed.push(label);
				},
				_desc: desc,
			} as unknown as GPUTexture;
		},
		createBuffer(desc: GPUBufferDescriptor) {
			return {
				...buffer(`buffer-${desc.size}`, desc.usage),
				_desc: desc,
			} as unknown as GPUBuffer;
		},
		queue: {
			submit() {},
		},
	} as unknown as GPUDevice;
	const runtime = new FrameGraph(device);
	const graph = runtime.beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'color',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(color);

	executeCompiled(graph);
	const beforeClear = runtime.getResourcePoolStats();
	runtime.clearResourcePool();
	const afterClear = runtime.getResourcePoolStats();

	assert.deepEqual(destroyed, ['pooled-0']);
	assert.equal(beforeClear.retainedCount, 1);
	assert.equal(afterClear.acquireCount, 1);
	assert.equal(afterClear.reuseCount, 0);
	assert.equal(afterClear.createdCount, 1);
	assert.equal(afterClear.retainedCount, 0);
	assert.equal(afterClear.estimatedRetainedBytes, 0);
});

test('transient resources are released after submit for the next frame', () => {
	const createdLabels: string[] = [];
	const commandEncoder = mockCommandEncoder();
	const device = {
		createCommandEncoder() {
			return commandEncoder;
		},
		createTexture(desc: GPUTextureDescriptor) {
			const label = `pooled-${createdLabels.length}`;
			createdLabels.push(label);
			return {
				...texture(label, desc.usage),
				_desc: desc,
			} as unknown as GPUTexture;
		},
		createBuffer(desc: GPUBufferDescriptor) {
			return {
				...buffer(`buffer-${desc.size}`, desc.usage),
				_desc: desc,
			} as unknown as GPUBuffer;
		},
		queue: {
			submit() {},
		},
	} as unknown as GPUDevice;
	const runtime = new FrameGraph(device);

	function executeFrame(label: string): void {
		const graph = runtime.beginFrame();
		const color = graph.createTexture({ label, format: 'rgba8unorm', size: [1, 1] });
		graph.render({
			label,
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.markOutput(color);
		executeCompiled(graph);
	}

	executeFrame('first');
	executeFrame('second');
	executeFrame('third');

	assert.equal(createdLabels.length, 1);
});

test('transient resources are released when afterSubmit throws', () => {
	const createdLabels: string[] = [];
	const commandEncoder = mockCommandEncoder();
	const device = {
		createCommandEncoder() {
			return commandEncoder;
		},
		createTexture(desc: GPUTextureDescriptor) {
			const label = `pooled-${createdLabels.length}`;
			createdLabels.push(label);
			return {
				...texture(label, desc.usage),
				_desc: desc,
			} as unknown as GPUTexture;
		},
		createBuffer(desc: GPUBufferDescriptor) {
			return {
				...buffer(`buffer-${desc.size}`, desc.usage),
				_desc: desc,
			} as unknown as GPUBuffer;
		},
		queue: {
			submit() {},
		},
	} as unknown as GPUDevice;
	const runtime = new FrameGraph(device);

	function recordFrame(label: string) {
		const graph = runtime.beginFrame();
		const color = graph.createTexture({ label, format: 'rgba8unorm', size: [1, 1] });
		graph.render({
			label,
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.markOutput(color);
		return graph;
	}

	const first = recordFrame('first');
	assert.throws(
		() => executeCompiled(first, {
			afterSubmit() {
				throw new Error('after-submit failed');
			},
		}),
		/after-submit failed/,
	);

	executeCompiled(recordFrame('second'));

	assert.equal(createdLabels.length, 1);
});
