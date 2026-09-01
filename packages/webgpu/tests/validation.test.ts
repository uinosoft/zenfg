import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BufferAccess,
	FrameGraph,
	TextureAccess,
	type FrameGraphRecorder,
	type RenderDepthStencilAttachmentDesc,
} from '../src/index.ts';

import {
	textureUsage,
	bufferUsage,
	texture,
	buffer,
	mockDevice,
} from './testUtils.ts';

test('compiled nodes derive modes for every public texture and buffer access', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const allTextureUsage = textureUsage.COPY_SRC
		| textureUsage.COPY_DST
		| textureUsage.TEXTURE_BINDING
		| textureUsage.STORAGE_BINDING
		| textureUsage.RENDER_ATTACHMENT;
	const color = graph.importTexture(texture('color', allTextureUsage, { format: 'rgba8unorm', size: [1, 1] }), { label: 'color', exposedUsage: allTextureUsage });
	const depthTexture = texture('depth', textureUsage.RENDER_ATTACHMENT) as GPUTexture & { format: GPUTextureFormat };
	depthTexture.format = 'depth24plus';
	const depth = graph.importTexture(depthTexture, { label: 'depth', exposedUsage: textureUsage.RENDER_ATTACHMENT });
	const allBufferUsage = bufferUsage.MAP_READ
		| bufferUsage.COPY_SRC
		| bufferUsage.COPY_DST
		| bufferUsage.INDEX
		| bufferUsage.VERTEX
		| bufferUsage.UNIFORM
		| bufferUsage.STORAGE
		| bufferUsage.INDIRECT;
	const data = graph.importBuffer(buffer('data', allBufferUsage), { label: 'data', exposedSize: 64, exposedUsage: allBufferUsage });

	graph.command({
		label: 'all-accesses',
		sideEffect: true,
		uses: [
			graph.use(color, TextureAccess.Sampled),
			graph.use(color, TextureAccess.StorageRead),
			graph.use(color, TextureAccess.StorageWrite, { contents: 'overwrite' }),
			graph.use(color, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' }),
			graph.use(depth, TextureAccess.DepthRead),
			graph.use(depth, TextureAccess.DepthWrite, { contents: 'overwrite' }),
			graph.use(color, TextureAccess.CopySrc),
			graph.use(color, TextureAccess.CopyDst, { contents: 'overwrite' }),
			graph.use(data, BufferAccess.Uniform),
			graph.use(data, BufferAccess.StorageRead),
			graph.use(data, BufferAccess.StorageWrite, { contents: 'overwrite' }),
			graph.use(data, BufferAccess.Vertex),
			graph.use(data, BufferAccess.Index),
			graph.use(data, BufferAccess.Indirect),
			graph.use(data, BufferAccess.CopySrc),
			graph.use(data, BufferAccess.CopyDst, { contents: 'overwrite' }),
		],
	});

	const modes = Object.fromEntries(graph.compile({ report: true }).compilationReport.accesses.map((access) => [access.access, access.mode]));
	assert.deepEqual(modes, {
		[TextureAccess.Sampled]: 'read',
		[TextureAccess.StorageRead]: 'read',
		[TextureAccess.StorageWrite]: 'write',
		[TextureAccess.ColorAttachmentWrite]: 'write',
		[TextureAccess.DepthRead]: 'read',
		[TextureAccess.DepthWrite]: 'write',
		[TextureAccess.CopySrc]: 'read',
		[TextureAccess.CopyDst]: 'write',
		[BufferAccess.Uniform]: 'read',
		[BufferAccess.StorageRead]: 'read',
		[BufferAccess.StorageWrite]: 'write',
		[BufferAccess.Vertex]: 'read',
		[BufferAccess.Index]: 'read',
		[BufferAccess.Indirect]: 'read',
		[BufferAccess.CopySrc]: 'read',
		[BufferAccess.CopyDst]: 'write',
	});
});

test('compile rejects imported resources without required WebGPU usage', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importTexture(texture('asset', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [1, 1] }), { label: 'asset', exposedUsage: textureUsage.COPY_SRC });

	graph.command({
		label: 'sample-imported',
		sideEffect: true,
		uses: [graph.use(imported, TextureAccess.Sampled)],
	});

	assert.throws(
		() => graph.compile({ report: true }).compilationReport,
		(error) => error instanceof Error
			&& error.message.includes('Resource "asset" declared usage 0x1 is missing required WebGPU usage 0x4')
			&& error.message.includes('Required usage: 0x4'),
	);
});

test('compile ignores usage requirements from culled imported-resource accesses', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importTexture(texture('asset', textureUsage.RENDER_ATTACHMENT, { format: 'rgba8unorm', size: [1, 1] }), { label: 'asset', exposedUsage: textureUsage.RENDER_ATTACHMENT });

	graph.render({
		label: 'retained-write',
		sideEffect: true,
		colorAttachments: [{ target: imported, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		label: 'culled-sample',
		sideEffect: false,
		uses: [graph.use(imported, TextureAccess.Sampled)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const importedInfo = compiled.resources.find((resource) => resource.id === imported.id);

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['retained-write']);
	assert.deepEqual(compiled.culledNodes.map((node) => node.label), ['culled-sample']);
	assert.equal(importedInfo?.usage, textureUsage.RENDER_ATTACHMENT);
});

test('compile ignores usage requirements from culled explicit transient accesses', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const transient = graph.createTexture({
			label: 'transient-texture',
			format: 'rgba8unorm',
			size: [1, 1],
			usage: textureUsage.RENDER_ATTACHMENT,
		});
		graph.render({
			label: 'retained-write',
			sideEffect: true,
			colorAttachments: [{ target: transient, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.command({
			label: 'culled-sample',
			sideEffect: false,
			uses: [graph.use(transient, TextureAccess.Sampled)],
		});

		const compiled = graph.compile({ report: true }).compilationReport;
		assert.equal(
			compiled.resources.find((resource) => resource.id === transient.id)?.usage,
			textureUsage.RENDER_ATTACHMENT,
		);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const transient = graph.createBuffer({
			label: 'transient-buffer',
			size: 64,
			usage: bufferUsage.STORAGE,
		});
		graph.command({
			label: 'retained-write',
			sideEffect: true,
			uses: [graph.use(transient, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		});
		graph.command({
			label: 'culled-uniform-read',
			sideEffect: false,
			uses: [graph.use(transient, BufferAccess.Uniform)],
		});

		const compiled = graph.compile({ report: true }).compilationReport;
		assert.equal(
			compiled.resources.find((resource) => resource.id === transient.id)?.usage,
			bufferUsage.STORAGE,
		);
	}
});

test('compile rejects transient resources whose explicit usage omits required WebGPU usage', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const transient = graph.createBuffer({
		label: 'transient',
		size: 64,
		usage: bufferUsage.STORAGE,
	});

	graph.command({
		label: 'write-transient',
		uses: [graph.use(transient, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});

	graph.command({
		label: 'read-transient',
		sideEffect: true,
		uses: [graph.use(transient, BufferAccess.Uniform)],
	});

	assert.throws(
		() => graph.compile({ report: true }).compilationReport,
		(error) => error instanceof Error
			&& error.message.includes('Resource "transient" declared usage 0x80 is missing required WebGPU usage 0x40')
			&& error.message.includes('Required usage: 0xc0'),
	);
});

test('compile preserves imported-resource diagnostics when declared usage is zero', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importTexture(texture('asset', 0, { format: 'rgba8unorm', size: [1, 1] }), { label: 'asset', exposedUsage: 0 });

	graph.command({
		label: 'sample-imported',
		sideEffect: true,
		uses: [graph.use(imported, TextureAccess.Sampled)],
	});

	assert.throws(
		() => graph.compile({ report: true }).compilationReport,
		(error) => error instanceof Error
			&& error.message.includes('Imported resource "asset" declared usage 0x0 is missing required WebGPU usage 0x4')
			&& error.message.includes('Required usage: 0x4'),
	);
});

test('raw render attachments default to one mip and one array layer', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.createTexture({ label: 'attachment', format: 'rgba16float', size: [64, 64, 4], mipLevelCount: 3 });
	graph.render({
		label: 'raw-default',
		colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(target);

	assert.deepEqual(graph.compile({ report: true }).compilationReport.accesses.map((access) => access.textureRegion), [{
		baseMipLevel: 0,
		mipLevelCount: 1,
		baseArrayLayer: 0,
		arrayLayerCount: 1,
		aspect: 'all',
	}]);
});

test('compile allows disjoint mip feedback and rejects overlapping mip feedback', () => {
	for (const scenario of [
		{ name: 'disjoint mips', attachmentMip: 1, shouldCompile: true },
		{ name: 'overlapping mip', attachmentMip: 0, shouldCompile: false },
	] as const) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const bloom = graph.createTexture({ label: 'bloom-chain', format: 'rgba16float', size: [64, 64], mipLevelCount: 2 });
		const mip0 = graph.createTextureView(bloom, { baseMipLevel: 0, mipLevelCount: 1 });
		const attachmentMip = graph.createTextureView(bloom, { baseMipLevel: scenario.attachmentMip, mipLevelCount: 1 });
		graph.render({
			label: 'produce-mip-0',
			colorAttachments: [{ target: mip0, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'mip-feedback',
			uses: [graph.use(mip0, TextureAccess.Sampled)],
			colorAttachments: [{ target: attachmentMip, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.markOutput(bloom);

		if (scenario.shouldCompile) {
			assert.deepEqual(graph.compile({ report: true }).compilationReport.nodes.map((node) => node.label), ['produce-mip-0', 'mip-feedback'], scenario.name);
		}
		else {
			assert.throws(() => graph.compile({ report: true }).compilationReport, /overlapping texture accesses/, scenario.name);
		}
	}
});

test('compile rejects an explicit multi-mip render attachment view', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const bloom = graph.createTexture({ label: 'bloom-chain', format: 'rgba16float', size: [64, 64], mipLevelCount: 4 });
	const sampled = graph.createTextureView(bloom, { baseMipLevel: 2, mipLevelCount: 1 });
	const attachment = graph.createTextureView(bloom, { baseMipLevel: 1 });

	graph.render({
		label: 'mip-feedback-normalized',
		uses: [graph.use(sampled, TextureAccess.Sampled)],
		colorAttachments: [{
			target: attachment,
			loadOp: 'clear',
			storeOp: 'store',
		}],
	});
	graph.markOutput(bloom);

	assert.throws(() => graph.compile({ report: true }).compilationReport, /single-mip/);
});

test('compile validates ordinary texture access subresource bounds', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const bloom = graph.createTexture({ label: 'bloom-chain', format: 'rgba16float', size: [64, 64], mipLevelCount: 2 });
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	const invalidView = graph.createTextureView(bloom, { baseMipLevel: 2, mipLevelCount: 1 });

	graph.render({
		label: 'out-of-bounds-read',
		uses: [graph.use(invalidView, TextureAccess.Sampled)],
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(color);

	assert.throws(() => graph.compile({ report: true }).compilationReport, /exceeds declared mip levels/);
});

test('compile rejects sampled and storage reads overlapping writable attachments', () => {
	for (const access of [TextureAccess.Sampled, TextureAccess.StorageRead] as const) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({
			label: 'color',
			format: 'rgba8unorm',
			size: [1, 1],
			usage: textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING | textureUsage.STORAGE_BINDING,
		});
		const invalidFeedbackUse = graph.use(color, access);
		graph.render({
			label: 'invalid-feedback',
			uses: [invalidFeedbackUse],
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.markOutput(color);

		assert.throws(
			() => graph.compile({ report: true }).compilationReport,
			(error) => error instanceof Error
				&& error.message.includes('Render pass "invalid-feedback" has overlapping texture accesses for "color"')
				&& error.message.includes(`${access} (read) conflicts with texture-color-attachment-write (write)`)
				&& error.message.includes('WebGPU does not allow simultaneous read/write'),
			access,
		);
	}
});

test('compile allows depth attachment load-store as a same-pass continuation', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const depthTexture = texture('depth', textureUsage.RENDER_ATTACHMENT) as GPUTexture & { format: GPUTextureFormat };
	depthTexture.format = 'depth24plus';
	const depth = graph.importTexture(depthTexture, { label: 'depth', exposedUsage: textureUsage.RENDER_ATTACHMENT });

	graph.render({
		label: 'depth-load-store',
		depthStencilAttachment: {
			target: depth,
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		},
	});
	graph.markOutput(depth);

	assert.deepEqual(graph.compile({ report: true }).compilationReport.nodes.map((node) => node.label), ['depth-load-store']);
});

test('compile normalizes depth attachment omitted aspect to depth-only', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const depth = graph.createTexture({ label: 'depth', format: 'depth24plus', size: [1, 1] });

	graph.render({
		label: 'depth-clear',
		depthStencilAttachment: {
			target: depth,
			depthLoadOp: 'clear',
			depthStoreOp: 'store',
			depthClearValue: 0,
		},
	});
	graph.markOutput(depth);

	const debug = graph.compile({ report: true }).compilationReport;

	assert.deepEqual(debug.accesses.map((access) => access.textureRegion), [{
		baseMipLevel: 0,
		mipLevelCount: 1,
		baseArrayLayer: 0,
		arrayLayerCount: 1,
		aspect: 'depth-only',
	}]);
});

test('compile validates depth attachment load, store, and clear state', () => {
	const compileInvalidDepthAttachment = (
		label: string,
		attachment: Omit<RenderDepthStencilAttachmentDesc, 'target'> | Record<string, unknown>,
	): void => {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const depth = graph.createTexture({ label: 'depth', format: 'depth24plus', size: [1, 1] });
		graph.render({
			label,
			depthStencilAttachment: {
				target: depth,
				...attachment,
			} as unknown as RenderDepthStencilAttachmentDesc,
		});
		graph.markOutput(depth);
		graph.compile({ report: true }).compilationReport;
	};

	assert.throws(
		() => compileInvalidDepthAttachment('missing-clear-value', {
			depthLoadOp: 'clear',
			depthStoreOp: 'store',
		}),
		/Render node "missing-clear-value" cleared depth attachment "depth" must provide depthClearValue/,
	);
	for (const [label, depthClearValue] of [
		['nan-clear-value', Number.NaN],
		['negative-clear-value', -0.01],
		['large-clear-value', 1.01],
	] as const) {
		assert.throws(
			() => compileInvalidDepthAttachment(label, {
				depthLoadOp: 'clear',
				depthStoreOp: 'store',
				depthClearValue,
			}),
			new RegExp(`Render node "${label}" cleared depth attachment "depth" depthClearValue must be between 0 and 1`),
		);
	}
	assert.throws(
		() => compileInvalidDepthAttachment('missing-load-op', {
			depthStoreOp: 'store',
		}),
		/Render node "missing-load-op" writable depth attachment "depth" must provide depthLoadOp and depthStoreOp/,
	);
	assert.throws(
		() => compileInvalidDepthAttachment('missing-store-op', {
			depthLoadOp: 'load',
		}),
		/Render node "missing-store-op" writable depth attachment "depth" must provide depthLoadOp and depthStoreOp/,
	);
	assert.throws(
		() => compileInvalidDepthAttachment('read-only-with-ops', {
			depthReadOnly: true,
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		}),
		/Render node "read-only-with-ops" read-only depth attachment "depth" must not provide depthLoadOp or depthStoreOp/,
	);
});

test('compile validates render attachment view subresource bounds', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1, 1] });
	const invalidView = graph.createTextureView(color, { baseArrayLayer: 1, arrayLayerCount: 1 });

	graph.render({
		label: 'out-of-bounds',
		colorAttachments: [{
			target: invalidView,
			loadOp: 'clear',
			storeOp: 'store',
		}],
	});
	graph.markOutput(color);

	assert.throws(() => graph.compile({ report: true }).compilationReport, /exceeds declared array layers/);
});

test('getTextureDesc returns the declared texture descriptor', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({
		label: 'color',
		format: 'rgba16float',
		size: [64, 32],
		sampleCount: 4,
	});

	assert.deepEqual(graph.getTextureDesc(color), {
		label: 'color',
		format: 'rgba16float',
		size: [64, 32],
		sampleCount: 4,
	});
	assert.throws(
		() => graph.getTextureDesc({ ...color, id: 999 }),
		/does not belong/,
	);
});

test('getBufferDesc returns the snapshotted transient buffer descriptor', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const descriptor = {
		label: 'data',
		size: 64,
		usage: bufferUsage.STORAGE,
	};
	const data = graph.createBuffer(descriptor);
	const inferredUsage = graph.createBuffer({ label: 'inferred-usage', size: 16 });
	descriptor.label = 'changed';
	descriptor.size = 128;
	descriptor.usage = bufferUsage.COPY_DST;

	assert.deepEqual(graph.getBufferDesc(data), {
		label: 'data',
		size: 64,
		usage: bufferUsage.STORAGE,
	});
	assert.deepEqual(graph.getBufferDesc(inferredUsage), {
		label: 'inferred-usage',
		size: 16,
	});
	assert.throws(
		() => graph.getBufferDesc({ ...data, id: 999 }),
		/does not belong/,
	);
});

test('descriptor getters return defensive snapshots', () => {
	let physicalBufferDescriptor: GPUBufferDescriptor | undefined;
	const baseDevice = mockDevice();
	const device = {
		...baseDevice,
		createBuffer(desc: GPUBufferDescriptor) {
			physicalBufferDescriptor = desc;
			return baseDevice.createBuffer(desc);
		},
	} as GPUDevice;
	const graph = new FrameGraph(device).beginFrame();
	const data = graph.createBuffer({ label: 'data', size: 64 });
	const bufferDesc = graph.getBufferDesc(data) as unknown as { size: number };
	bufferDesc.size = 128;

	assert.equal(graph.getBufferDesc(data).size, 64);
	graph.command({
		label: 'write-data',
		sideEffect: true,
		uses: [graph.use(data, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	const bufferCompiled = graph.compile({ report: true });
	const bufferReport = bufferCompiled.compilationReport.resources.find((resource) => resource.id === data.id);
	assert.equal(bufferReport?.kind, 'buffer');
	assert.equal(bufferReport?.descriptor.size, 64);
	bufferCompiled.execute();
	assert.equal(physicalBufferDescriptor?.size, 64);

	let physicalTextureDescriptor: GPUTextureDescriptor | undefined;
	let physicalViewDescriptor: GPUTextureViewDescriptor | undefined;
	const textureBaseDevice = mockDevice();
	const textureDevice = {
		...textureBaseDevice,
		createTexture(desc: GPUTextureDescriptor) {
			physicalTextureDescriptor = desc;
			const physical = textureBaseDevice.createTexture(desc);
			return {
				...physical,
				createView(viewDesc: GPUTextureViewDescriptor = {}) {
					physicalViewDescriptor = viewDesc;
					return physical.createView(viewDesc);
				},
			} as GPUTexture;
		},
	} as GPUDevice;
	const textureGraph = new FrameGraph(textureDevice).beginFrame();
	const color = textureGraph.createTexture({
		label: 'color',
		format: 'rgba8unorm',
		viewFormats: ['rgba8unorm-srgb'],
		size: { width: 4, height: 4, depthOrArrayLayers: 1 },
		mipLevelCount: 2,
	});
	const view = textureGraph.createTextureView(color, { baseMipLevel: 1, mipLevelCount: 1 });
	const textureDesc = textureGraph.getTextureDesc(color) as unknown as {
		size: { width: number };
		viewFormats: GPUTextureFormat[];
	};
	textureDesc.size.width = 8;
	textureDesc.viewFormats.length = 0;
	const viewDesc = textureGraph.getTextureViewDesc(view) as unknown as { baseMipLevel: number };
	viewDesc.baseMipLevel = 0;

	assert.equal((textureGraph.getTextureDesc(color).size as GPUExtent3DDict).width, 4);
	assert.deepEqual(textureGraph.getTextureDesc(color).viewFormats, ['rgba8unorm-srgb']);
	assert.equal(textureGraph.getTextureViewDesc(view).baseMipLevel, 1);
	textureGraph.render({
		label: 'write-color',
		colorAttachments: [{ target: view, loadOp: 'clear', storeOp: 'store' }],
	});
	const sampled = textureGraph.use(view, TextureAccess.Sampled);
	textureGraph.command({
		label: 'read-color',
		sideEffect: true,
		uses: [sampled],
		encode(ctx) {
			ctx.unwrap(sampled);
		},
	});
	textureGraph.markOutput(color);
	const textureCompiled = textureGraph.compile({ report: true });
	const textureReport = textureCompiled.compilationReport.resources.find((resource) => resource.id === color.id);
	const viewReport = textureCompiled.compilationReport.textureViews.find((entry) => entry.id === view.id);
	assert.equal(textureReport?.kind, 'texture');
	if (textureReport?.kind === 'texture') {
		assert.equal(textureReport.descriptor.size.width, 4);
		assert.deepEqual(textureReport.descriptor.viewFormats, ['rgba8unorm-srgb']);
	}
	assert.equal(viewReport?.baseMipLevel, 1);
	textureCompiled.execute();
	assert.equal((physicalTextureDescriptor?.size as GPUExtent3DDict).width, 4);
	assert.deepEqual(physicalTextureDescriptor?.viewFormats, ['rgba8unorm-srgb']);
	assert.equal(physicalViewDescriptor?.baseMipLevel, 1);
});

test('transient textures snapshot viewFormats through compilation and allocation', () => {
	let physicalDescriptor: GPUTextureDescriptor | undefined;
	const baseDevice = mockDevice();
	const device = {
		...baseDevice,
		createTexture(desc: GPUTextureDescriptor) {
			physicalDescriptor = desc;
			return baseDevice.createTexture(desc);
		},
	} as GPUDevice;
	const graph = new FrameGraph(device).beginFrame();
	const viewFormats: GPUTextureFormat[] = ['rgba8unorm-srgb'];
	const color = graph.createTexture({
		label: 'linear-color',
		format: 'rgba8unorm',
		viewFormats,
		size: [1, 1],
	});
	const srgb = graph.createTextureView(color, { format: 'rgba8unorm-srgb' });

	assert.deepEqual(graph.getTextureDesc(color).viewFormats, ['rgba8unorm-srgb']);
	graph.render({
		label: 'produce-linear-color',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	const sampled = graph.use(srgb, TextureAccess.Sampled);
	graph.command({ label: 'consume-srgb-view', sideEffect: true, uses: [sampled] });
	const compiled = graph.compile();
	viewFormats.length = 0;

	compiled.execute();

	assert.deepEqual(physicalDescriptor?.viewFormats, ['rgba8unorm-srgb']);
});

test('createTextureView exposes normalized WebGPU-style defaults', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const textureHandle = graph.createTexture({
		label: 'array-mips',
		format: 'rgba8unorm',
		size: [16, 16, 4],
		mipLevelCount: 3,
	});
	const view = graph.createTextureView(textureHandle, {
		label: 'remaining',
		baseMipLevel: 1,
		baseArrayLayer: 1,
	});

	assert.deepEqual(graph.getTextureViewDesc(view), {
		texture: textureHandle,
		label: 'remaining',
		format: 'rgba8unorm',
		dimension: '2d-array',
		aspect: 'all',
		baseMipLevel: 1,
		mipLevelCount: 2,
		baseArrayLayer: 1,
		arrayLayerCount: 3,
		swizzle: 'rgba',
	});
});

test('compile accepts explicit cube and cube-array sampling views', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const physical = {
		...texture('cube-array', textureUsage.TEXTURE_BINDING),
		width: 16,
		height: 16,
		depthOrArrayLayers: 12,
	} as GPUTexture;
	const cubeTexture = graph.importTexture(physical, { label: 'cube-array', exposedUsage: textureUsage.TEXTURE_BINDING });
	const cube = graph.createTextureView(cubeTexture, {
		label: 'second-cube',
		dimension: 'cube',
		baseArrayLayer: 6,
		arrayLayerCount: 6,
	});
	const cubeArray = graph.createTextureView(cubeTexture, {
		label: 'all-cubes',
		dimension: 'cube-array',
		arrayLayerCount: 12,
	});
	graph.command({
		label: 'sample-cubes',
		sideEffect: true,
		uses: [graph.use(cube, TextureAccess.Sampled), graph.use(cubeArray, TextureAccess.Sampled)],
	});

	const report = graph.compile({ report: true }).compilationReport;

	assert.deepEqual(report.textureViews, [
		{
			id: cube.id,
			resourceId: cubeTexture.id,
			label: 'second-cube',
			format: 'rgba8unorm',
			dimension: 'cube',
			aspect: 'all',
			baseMipLevel: 0,
			mipLevelCount: 1,
			baseArrayLayer: 6,
			arrayLayerCount: 6,
			swizzle: 'rgba',
		},
		{
			id: cubeArray.id,
			resourceId: cubeTexture.id,
			label: 'all-cubes',
			format: 'rgba8unorm',
			dimension: 'cube-array',
			aspect: 'all',
			baseMipLevel: 0,
			mipLevelCount: 1,
			baseArrayLayer: 0,
			arrayLayerCount: 12,
			swizzle: 'rgba',
		},
	]);
	assert.deepEqual(
		report.accesses.map((access) => ({
			textureViewId: access.textureViewId,
			textureRegion: access.textureRegion,
		})),
		[
			{
				textureViewId: cube.id,
				textureRegion: {
					baseMipLevel: 0,
					mipLevelCount: 1,
					baseArrayLayer: 6,
					arrayLayerCount: 6,
					aspect: 'all',
				},
			},
			{
				textureViewId: cubeArray.id,
				textureRegion: {
					baseMipLevel: 0,
					mipLevelCount: 1,
					baseArrayLayer: 0,
					arrayLayerCount: 12,
					aspect: 'all',
				},
			},
		],
	);
});

test('compile rejects 1d, cube, and cube-array render attachment views', () => {
	for (const scenario of [
		{
			label: '1d',
			createTarget(graph: FrameGraphRecorder) {
				return graph.createTexture({
					label: 'line',
					format: 'rgba8unorm',
					size: [16, 1, 1],
					dimension: '1d',
				});
			},
		},
		{
			label: 'cube',
			createTarget(graph: FrameGraphRecorder) {
				const textureHandle = graph.createTexture({
					label: 'cube',
					format: 'rgba8unorm',
					size: [16, 16, 6],
				});
				return graph.createTextureView(textureHandle, {
					dimension: 'cube',
					arrayLayerCount: 6,
				});
			},
		},
		{
			label: 'cube-array',
			createTarget(graph: FrameGraphRecorder) {
				const textureHandle = graph.createTexture({
					label: 'cube-array',
					format: 'rgba8unorm',
					size: [16, 16, 12],
				});
				return graph.createTextureView(textureHandle, {
					dimension: 'cube-array',
					arrayLayerCount: 12,
				});
			},
		},
	] as const) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const target = scenario.createTarget(graph);
		graph.render({
			label: scenario.label,
			sideEffect: true,
			colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store' }],
		});

		assert.throws(
			() => graph.compile(),
			/incompatible view dimension|single-mip, single-layer/,
			scenario.label,
		);
	}
});

test('compile validates alternate texture view formats against viewFormats', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const imported = graph.importTexture(texture('linear', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'linear', viewFormats: ['rgba8unorm-srgb'], exposedUsage: textureUsage.TEXTURE_BINDING });
		const srgb = graph.createTextureView(imported, { format: 'rgba8unorm-srgb' });
		graph.command({
			sideEffect: true,
			uses: [graph.use(srgb, TextureAccess.Sampled)],
		});
		assert.doesNotThrow(() => graph.compile());
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const imported = graph.importTexture(texture('linear', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'linear', exposedUsage: textureUsage.TEXTURE_BINDING });
		const srgb = graph.createTextureView(imported, { format: 'rgba8unorm-srgb' });
		graph.command({
			sideEffect: true,
			uses: [graph.use(srgb, TextureAccess.Sampled)],
		});
		assert.throws(() => graph.compile(), /was not declared in viewFormats/);
	}
	assert.throws(
		() => new FrameGraph(mockDevice()).beginFrame().createTexture({
			format: 'rgba8unorm',
			viewFormats: ['rgba16float'],
			size: [1, 1],
		}),
		/not compatible/,
	);
});

test('compile validates view aspect, swizzle, and storage dimension', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.importTexture(texture('color', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'color', exposedUsage: textureUsage.TEXTURE_BINDING });
		const view = graph.createTextureView(color, { aspect: 'depth-only' });
		graph.command({
			sideEffect: true,
			uses: [graph.use(view, TextureAccess.Sampled)],
		});
		assert.throws(() => graph.compile(), /depth-only aspect with non-depth format/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.importTexture(texture('color', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'color', exposedUsage: textureUsage.TEXTURE_BINDING });
		const malformed = graph.createTextureView(color, { swizzle: 'rgb' });
		graph.command({
			sideEffect: true,
			uses: [graph.use(malformed, TextureAccess.Sampled)],
		});
		assert.throws(() => graph.compile(), /invalid component swizzle/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.importTexture(texture('color', textureUsage.TEXTURE_BINDING, { format: 'rgba8unorm', size: [1, 1] }), { label: 'color', exposedUsage: textureUsage.TEXTURE_BINDING });
		const swizzled = graph.createTextureView(color, { swizzle: 'bgra' });
		graph.command({
			sideEffect: true,
			uses: [graph.use(swizzled, TextureAccess.Sampled)],
		});
		assert.throws(() => graph.compile(), /without the "texture-component-swizzle" device feature/);
	}
	{
		const device = {
			...mockDevice(),
			features: new Set<GPUFeatureName>([
				'texture-component-swizzle' as GPUFeatureName,
			]),
		} as unknown as GPUDevice;
		const graph = new FrameGraph(device).beginFrame();
		const color = graph.createTexture({
			label: 'swizzled-attachment',
			format: 'rgba8unorm',
			size: [1, 1],
		});
		const swizzled = graph.createTextureView(color, { swizzle: 'bgra' });
		graph.render({
			sideEffect: true,
			colorAttachments: [{
				target: swizzled,
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		assert.throws(() => graph.compile(), /attachment views cannot use component swizzle/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const storage = graph.importTexture(texture('storage-cube', textureUsage.STORAGE_BINDING, { format: 'rgba8unorm', size: [4, 4, 6] }), { label: 'storage-cube', exposedUsage: textureUsage.STORAGE_BINDING });
		const cube = graph.createTextureView(storage, {
			dimension: 'cube',
			arrayLayerCount: 6,
		});
		graph.command({
			sideEffect: true,
			uses: [graph.use(cube, TextureAccess.StorageRead)],
		});
		assert.throws(() => graph.compile(), /cannot use "cube" dimension/);
	}
});

test('compile validates 3d color attachment depth slices and reports them separately from array layers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const volume = graph.createTexture({
		label: 'volume',
		format: 'rgba8unorm',
		size: [8, 8, 4],
		dimension: '3d',
	});
	graph.render({
		label: 'slice-2',
		colorAttachments: [{ target: volume, depthSlice: 2, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(volume);

	assert.deepEqual(graph.compile({ report: true }).compilationReport.accesses[0]?.textureRegion, {
		baseMipLevel: 0,
		mipLevelCount: 1,
		baseDepthSlice: 2,
		depthSliceCount: 1,
		aspect: 'all',
	});

	for (const depthSlice of [undefined, 4] as const) {
		const invalid = new FrameGraph(mockDevice()).beginFrame();
		const target = invalid.createTexture({
			label: 'invalid-volume',
			format: 'rgba8unorm',
			size: [8, 8, 4],
			dimension: '3d',
		});
		invalid.render({
			colorAttachments: [{
				target,
				...(depthSlice === undefined ? {} : { depthSlice }),
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		invalid.markOutput(target);
		assert.throws(
			() => invalid.compile(),
			depthSlice === undefined ? /requires depthSlice/ : /exceeds declared depth slices/,
		);
	}
});

test('compile rejects 3d resolve targets', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const source = graph.createTexture({
		label: 'source',
		format: 'rgba8unorm',
		size: [8, 8],
		sampleCount: 4,
	});
	const volume = graph.createTexture({
		label: 'volume',
		format: 'rgba8unorm',
		size: [8, 8, 4],
		dimension: '3d',
	});
	const volumeView = graph.createTextureView(volume, {
		dimension: '3d',
		mipLevelCount: 1,
	});
	graph.render({
		colorAttachments: [{
			target: source,
			resolveTarget: volumeView,
			loadOp: 'clear',
			storeOp: 'discard',
		}],
	});
	graph.markOutput(volume);

	assert.throws(() => graph.compile(), /resolve target.*2d or 2d-array view/);
});

test('compile rejects ordinary buffer access ranges outside the descriptor', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.importBuffer(buffer('target', bufferUsage.STORAGE), {
		label: 'target',
		exposedSize: 16,
		exposedUsage: bufferUsage.STORAGE,
	});

	graph.command({
		label: 'invalid',
		uses: [graph.use(target, BufferAccess.StorageRead, { range: { offset: 12, size: 8 } })],
	});

	assert.throws(() => graph.compile({ report: true }).compilationReport, /Buffer access range exceeds buffer/);
});

test('markReadback requires caller-owned imported staging buffers', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const readback = graph.createBuffer({
			label: 'readback',
			size: 64,
			usage: bufferUsage.COPY_DST | bufferUsage.MAP_READ,
		});

		assert.throws(() => graph.markReadback(readback), /must be caller-owned and registered with importBuffer\(\)/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const readback = graph.importBuffer(buffer('readback', bufferUsage.COPY_DST));

		assert.throws(() => graph.markReadback(readback), /must declare GPUBufferUsage\.MAP_READ/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const readback = graph.importBuffer(buffer('readback', bufferUsage.MAP_READ));

		assert.throws(() => graph.markReadback(readback), /must declare GPUBufferUsage\.COPY_DST/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const readback = graph.importBuffer(buffer(
			'readback',
			bufferUsage.COPY_DST | bufferUsage.MAP_READ | bufferUsage.STORAGE,
		));

		assert.throws(() => graph.markReadback(readback), /usage must only combine MAP_READ with COPY_DST/);
	}
});

test('compile rejects incompatible render attachments and resolve targets', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
		const resolve = graph.createTexture({ label: 'resolve', format: 'rgba8unorm', size: [1, 1] });
		graph.render({
			label: 'resolve',
			colorAttachments: [{ target: color, resolveTarget: resolve, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.markOutput(resolve);

		assert.throws(() => graph.compile({ report: true }).compilationReport, /resolve source must be multisampled/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1], sampleCount: 4 });
		const resolve = graph.createTexture({ label: 'resolve', format: 'rgba16float', size: [1, 1] });
		graph.render({
			label: 'resolve',
			colorAttachments: [{ target: color, resolveTarget: resolve, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.markOutput(resolve);

		assert.throws(() => graph.compile({ report: true }).compilationReport, /resolve target format must match/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const depth = graph.createTexture({ label: 'depth', format: 'rgba8unorm', size: [1, 1] });
		graph.render({
			label: 'depth',
			depthStencilAttachment: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
		});
		graph.markOutput(depth);

		assert.throws(() => graph.compile({ report: true }).compilationReport, /requires a pure depth format/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		assert.throws(
			() => graph.createTexture({ label: 'depth-stencil', format: 'depth24plus-stencil8', size: [1, 1] }),
			/does not support stencil/,
		);
	}
});

test('compile rejects render attachment collection extent and sample count mismatches', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const first = graph.createTexture({ label: 'first-color', format: 'rgba8unorm', size: [4, 4] });
		const second = graph.createTexture({ label: 'second-color', format: 'rgba8unorm', size: [8, 8] });
		graph.render({
			label: 'mrt-extent',
			colorAttachments: [
				{ target: first, loadOp: 'clear', storeOp: 'store' },
				{ target: second, loadOp: 'clear', storeOp: 'store' },
			],
		});
		graph.markOutput(first);

		assert.throws(
			() => graph.compile({ report: true }).compilationReport,
			(error) => error instanceof Error
				&& error.message.includes('Render node "mrt-extent" attachment "second-color" mip 0 render extent 8x8')
				&& error.message.includes('attachment "first-color" mip 0 render extent 4x4'),
		);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const first = graph.createTexture({ label: 'msaa-color', format: 'rgba8unorm', size: [4, 4], sampleCount: 4 });
		const second = graph.createTexture({ label: 'single-color', format: 'rgba8unorm', size: [4, 4] });
		graph.render({
			label: 'mrt-samples',
			colorAttachments: [
				{ target: first, loadOp: 'clear', storeOp: 'store' },
				{ target: second, loadOp: 'clear', storeOp: 'store' },
			],
		});
		graph.markOutput(first);

		assert.throws(
			() => graph.compile({ report: true }).compilationReport,
			/Render node "mrt-samples" attachment "single-color" sampleCount 1 does not match attachment "msaa-color" sampleCount 4/,
		);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [4, 4] });
		const depth = graph.createTexture({ label: 'depth', format: 'depth32float', size: [8, 8] });
		graph.render({
			label: 'color-depth-extent',
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
			depthStencilAttachment: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
		});
		graph.markOutput(color);

		assert.throws(
			() => graph.compile({ report: true }).compilationReport,
			/Render node "color-depth-extent" attachment "depth" mip 0 render extent 8x8 does not match attachment "color" mip 0 render extent 4x4/,
		);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [4, 4], sampleCount: 4 });
		const depth = graph.createTexture({ label: 'depth', format: 'depth32float', size: [4, 4] });
		graph.render({
			label: 'color-depth-samples',
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
			depthStencilAttachment: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
		});
		graph.markOutput(color);

		assert.throws(
			() => graph.compile({ report: true }).compilationReport,
			/Render node "color-depth-samples" attachment "depth" sampleCount 1 does not match attachment "color" sampleCount 4/,
		);
	}
});

test('compile compares render attachment extents at the selected mip level', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const mipColor = graph.createTexture({ label: 'mip-color', format: 'rgba8unorm', size: [8, 8], mipLevelCount: 2 });
	const baseColor = graph.createTexture({ label: 'base-color', format: 'rgba8unorm', size: [4, 4] });
	const mipColorView = graph.createTextureView(mipColor, { baseMipLevel: 1, mipLevelCount: 1 });
	graph.render({
		label: 'matching-mip-extents',
		colorAttachments: [
			{
				target: mipColorView,
				loadOp: 'clear',
				storeOp: 'store',
			},
			{ target: baseColor, loadOp: 'clear', storeOp: 'store' },
		],
	});
	graph.markOutput(baseColor);

	assert.doesNotThrow(() => graph.compile({ report: true }).compilationReport);
});

test('compile compares resolve source and target extents at their selected mip levels', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({ label: 'msaa-color', format: 'rgba8unorm', size: [4, 4], sampleCount: 4 });
		const resolve = graph.createTexture({ label: 'resolve-color', format: 'rgba8unorm', size: [8, 8], mipLevelCount: 2 });
		const resolveView = graph.createTextureView(resolve, { baseMipLevel: 1, mipLevelCount: 1 });
		graph.render({
			label: 'matching-resolve-mip',
			colorAttachments: [{
				target: color,
				resolveTarget: resolveView,
				loadOp: 'clear',
				storeOp: 'discard',
			}],
		});
		graph.markOutput(resolve);

		assert.doesNotThrow(() => graph.compile({ report: true }).compilationReport);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({ label: 'msaa-color', format: 'rgba8unorm', size: [8, 8], sampleCount: 4 });
		const resolve = graph.createTexture({ label: 'resolve-color', format: 'rgba8unorm', size: [8, 8], mipLevelCount: 2 });
		const resolveView = graph.createTextureView(resolve, { baseMipLevel: 1, mipLevelCount: 1 });
		graph.render({
			label: 'mismatched-resolve-mip',
			colorAttachments: [{
				target: color,
				resolveTarget: resolveView,
				loadOp: 'clear',
				storeOp: 'discard',
			}],
		});
		graph.markOutput(resolve);

		assert.throws(
			() => graph.compile({ report: true }).compilationReport,
			(error) => error instanceof Error
				&& error.message.includes('Render node "mismatched-resolve-mip" resolve target "resolve-color" render extent mismatch')
				&& error.message.includes('color attachment "msaa-color" mip 0 is 8x8')
				&& error.message.includes('resolve target mip 1 is 4x4'),
		);
	}
});

test('compile rejects texture access formats outside declared capabilities', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({ label: 'color', format: 'depth24plus', size: [1, 1] });
		graph.render({
			label: 'color-pass',
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.markOutput(color);

		assert.throws(() => graph.compile({ report: true }).compilationReport, /color-pass.*color.*renderable color format.*depth24plus/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const compressed = graph.createTexture({ label: 'compressed', format: 'bc1-rgba-unorm', size: [4, 4] });
		graph.command({
			sideEffect: true,
			uses: [graph.use(compressed, TextureAccess.Sampled)],
		});

		assert.throws(() => graph.compile({ report: true }).compilationReport, /compressed.*Sampled access.*sampleable format.*bc1-rgba-unorm/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const depth = graph.createTexture({ label: 'depth', format: 'depth32float', size: [1, 1] });
		graph.command({
			sideEffect: true,
			uses: [graph.use(depth, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		});

		assert.throws(() => graph.compile({ report: true }).compilationReport, /depth.*storage-write access.*storage-capable format.*depth32float/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const srgb = graph.createTexture({ label: 'srgb-storage', format: 'rgba8unorm-srgb', size: [1, 1] });
		graph.command({
			sideEffect: true,
			uses: [graph.use(srgb, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		});

		assert.throws(() => graph.compile({ report: true }).compilationReport, /srgb-storage.*storage-write access.*storage-capable format.*rgba8unorm-srgb/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const bgra = graph.createTexture({ label: 'bgra-storage', format: 'bgra8unorm', size: [1, 1] });
		graph.command({
			sideEffect: true,
			uses: [graph.use(bgra, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		});

		assert.throws(() => graph.compile({ report: true }).compilationReport, /bgra-storage.*storage-write access.*storage-capable format.*bgra8unorm/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const featureGatedColor = graph.createTexture({ label: 'rg11b10ufloat-color', format: 'rg11b10ufloat', size: [1, 1] });
		graph.render({
			label: 'feature-gated-color-pass',
			colorAttachments: [{ target: featureGatedColor, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.markOutput(featureGatedColor);

		assert.throws(() => graph.compile({ report: true }).compilationReport, /rg11b10ufloat-color.*renderable color format.*rg11b10ufloat/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const storage = graph.createTexture({ label: 'storage-ok', format: 'rgba8unorm', size: [1, 1] });
		graph.command({
			sideEffect: true,
			uses: [graph.use(storage, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		});

		assert.doesNotThrow(() => graph.compile({ report: true }).compilationReport);
	}
});

test('compile rejects invalid copy ranges and buffer-texture layout', () => {
	const cases: Array<{
		readonly name: string;
		readonly expected: RegExp;
		readonly createGraph: () => FrameGraphRecorder;
	}> = [
		{
			name: 'buffer range exceeds source size',
			expected: /copy range exceeds buffer/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 64, exposedUsage: bufferUsage.COPY_SRC });
				const destination = graph.createBuffer({ label: 'destination', size: 64 });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'buffer-to-buffer', source, destination, sourceOffset: 32, size: 40 }],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'buffer offsets require 4-byte alignment',
			expected: /4-byte aligned/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 64, exposedUsage: bufferUsage.COPY_SRC });
				const destination = graph.createBuffer({ label: 'destination', size: 64 });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'buffer-to-buffer', source, destination, sourceOffset: 2, size: 16 }],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'same-buffer copy ranges must not overlap',
			expected: /must not overlap/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const shared = graph.importBuffer(buffer('shared', bufferUsage.COPY_SRC | bufferUsage.COPY_DST), { label: 'shared', exposedSize: 64, exposedUsage: bufferUsage.COPY_SRC | bufferUsage.COPY_DST });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'buffer-to-buffer', source: shared, destination: shared, sourceOffset: 0, destinationOffset: 16, size: 32 }],
				});
				graph.markOutput(shared);

				return graph;
			},
		},
		{
			name: 'texture origin and extent exceed bounds',
			expected: /copy range exceeds texture/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [4, 4] }), { label: 'source', exposedUsage: textureUsage.COPY_SRC });
				const destination = graph.createTexture({ label: 'destination', format: 'rgba8unorm', size: [4, 4] });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'texture-to-texture', source, destination, sourceOrigin: [3, 0], copySize: [2, 1] }],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'texture mip extent exceeds bounds',
			expected: /copy range exceeds texture/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [4, 4], mipLevelCount: 2 }), { label: 'source', exposedUsage: textureUsage.COPY_SRC });
				const destination = graph.createTexture({ label: 'destination', format: 'rgba8unorm', size: [4, 4], mipLevelCount: 2 });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'texture-to-texture', source, destination, sourceMipLevel: 1, destinationMipLevel: 1, copySize: [3, 1] }],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: '3d texture mip depth exceeds bounds',
			expected: /copy range exceeds texture/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [8, 8, 8], dimension: '3d', mipLevelCount: 2 }), { label: 'source', exposedUsage: textureUsage.COPY_SRC });
				const destination = graph.createTexture({
					label: 'destination',
					format: 'rgba8unorm',
					size: [8, 8, 8],
					dimension: '3d',
					mipLevelCount: 2,
				});
				graph.copy({
					label: 'copy',
					operations: [{
						type: 'texture-to-texture',
						source,
						destination,
						sourceMipLevel: 1,
						destinationMipLevel: 1,
						sourceOrigin: [0, 0, 3],
						destinationOrigin: [0, 0, 3],
						copySize: [1, 1, 2],
					}],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'texture aspect must match format',
			expected: /copy aspect "depth-only" is not valid/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [4, 4] }), { label: 'source', exposedUsage: textureUsage.COPY_SRC });
				const destination = graph.createTexture({ label: 'destination', format: 'rgba8unorm', size: [4, 4] });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'texture-to-texture', source, destination, sourceAspect: 'depth-only', copySize: [1, 1] }],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'texture formats must be copy-compatible',
			expected: /not copy-compatible/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [4, 4] }), { label: 'source', exposedUsage: textureUsage.COPY_SRC });
				const destination = graph.createTexture({ label: 'destination', format: 'rgba16float', size: [4, 4] });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'texture-to-texture', source, destination, copySize: [1, 1] }],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'same-texture subresources must not overlap',
			expected: /subresources must be disjoint/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const shared = graph.importTexture(texture('shared', textureUsage.COPY_SRC | textureUsage.COPY_DST, { format: 'rgba8unorm', size: [4, 4] }), { label: 'shared', exposedUsage: textureUsage.COPY_SRC | textureUsage.COPY_DST });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'texture-to-texture', source: shared, destination: shared, sourceOrigin: [0, 0], destinationOrigin: [2, 2], copySize: [1, 1] }],
				});
				graph.markOutput(shared);

				return graph;
			},
		},
		{
			name: 'compressed texture origin aligns to blocks',
			expected: /origin .* texel blocks/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.createTexture({ label: 'source', format: 'bc1-rgba-unorm', size: [8, 8] });
				const destination = graph.createTexture({ label: 'destination', format: 'bc1-rgba-unorm', size: [8, 8] });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'texture-to-texture', source, destination, sourceOrigin: [2, 0], copySize: [4, 4] }],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'compressed texture size aligns to blocks',
			expected: /size .* texel blocks/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.createTexture({ label: 'source', format: 'bc1-rgba-unorm', size: [8, 8] });
				const destination = graph.createTexture({ label: 'destination', format: 'bc1-rgba-unorm', size: [8, 8] });
				graph.copy({
					label: 'copy',
					operations: [{ type: 'texture-to-texture', source, destination, copySize: [6, 4] }],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'bytesPerRow requires 256-byte alignment',
			expected: /bytesPerRow must be 256-byte aligned/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 2048, exposedUsage: bufferUsage.COPY_SRC });
				const destination = graph.createTexture({ label: 'destination', format: 'rgba8unorm', size: [4, 4] });
				graph.copy({
					label: 'copy',
					operations: [{
						type: 'buffer-to-texture',
						source,
						destination,
						sourceLayout: { bytesPerRow: 128 },
						copySize: [4, 4],
					}],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'buffer offset aligns to texel block size',
			expected: /offset must align/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 2048, exposedUsage: bufferUsage.COPY_SRC });
				const destination = graph.createTexture({ label: 'destination', format: 'rgba16float', size: [1, 1] });
				graph.copy({
					label: 'copy',
					operations: [{
						type: 'buffer-to-texture',
						source,
						destination,
						sourceLayout: { offset: 4 },
						copySize: [1, 1],
					}],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'buffer-to-texture layout fits source buffer',
			expected: /layout exceeds buffer/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 3, exposedUsage: bufferUsage.COPY_SRC });
				const destination = graph.createTexture({ label: 'destination', format: 'rgba8unorm', size: [1, 1] });
				graph.copy({
					label: 'copy',
					operations: [{
						type: 'buffer-to-texture',
						source,
						destination,
						sourceLayout: {},
						copySize: [1, 1],
					}],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
		{
			name: 'texture-to-buffer layout fits destination buffer',
			expected: /layout exceeds buffer/,
			createGraph() {
				const graph = new FrameGraph(mockDevice()).beginFrame();
				const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba16float', size: [1, 1] }), { label: 'source', exposedUsage: textureUsage.COPY_SRC });
				const destination = graph.createBuffer({ label: 'destination', size: 7 });
				graph.copy({
					label: 'copy',
					operations: [{
						type: 'texture-to-buffer',
						source,
						destination,
						destinationLayout: {},
						copySize: [1, 1],
					}],
				});
				graph.markOutput(destination);

				return graph;
			},
		},
	];

	for (const scenario of cases) {
		assert.throws(() => scenario.createGraph().compile({ report: true }).compilationReport, scenario.expected, scenario.name);
	}
});

test('compile uses mip-specific depth for 3d copies without shrinking 2d array layers', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const sourceTexture = {
			...texture('source-3d', textureUsage.COPY_SRC),
			width: 8,
			height: 8,
			depthOrArrayLayers: 8,
			mipLevelCount: 2,
			dimension: '3d',
		} as GPUTexture;
		const source = graph.importTexture(sourceTexture, { label: 'source-3d', exposedUsage: textureUsage.COPY_SRC });
		const destinationTexture = {
			...texture('destination-3d', textureUsage.COPY_DST),
			width: 8,
			height: 8,
			depthOrArrayLayers: 8,
			mipLevelCount: 2,
			dimension: '3d',
		} as GPUTexture;
		const destination = graph.importTexture(destinationTexture, {
			label: 'destination-3d',
			exposedUsage: textureUsage.COPY_DST,
		});
		graph.copy({
			label: 'copy-3d',
			operations: [{
				type: 'texture-to-texture',
				source,
				destination,
				sourceMipLevel: 1,
				destinationMipLevel: 1,
				sourceOrigin: [0, 0, 2],
				destinationOrigin: [0, 0, 2],
				copySize: [1, 1, 2],
			}],
		});
		graph.markOutput(destination);

		assert.doesNotThrow(() => graph.compile({ report: true }).compilationReport);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const sourceTexture = {
			...texture('source-array', textureUsage.COPY_SRC),
			width: 8,
			height: 8,
			depthOrArrayLayers: 8,
			mipLevelCount: 2,
		} as GPUTexture;
		const source = graph.importTexture(sourceTexture, { label: 'source-array', exposedUsage: textureUsage.COPY_SRC });
		const destinationTexture = {
			...texture('destination-array', textureUsage.COPY_DST),
			width: 8,
			height: 8,
			depthOrArrayLayers: 8,
			mipLevelCount: 2,
		} as GPUTexture;
		const destination = graph.importTexture(destinationTexture, {
			label: 'destination-array',
			exposedUsage: textureUsage.COPY_DST,
		});
		graph.copy({
			label: 'copy-array',
			operations: [{
				type: 'texture-to-texture',
				source,
				destination,
				sourceMipLevel: 1,
				destinationMipLevel: 1,
				sourceOrigin: [0, 0, 6],
				destinationOrigin: [0, 0, 6],
				copySize: [1, 1, 2],
			}],
		});
		graph.markOutput(destination);

		assert.doesNotThrow(() => graph.compile({ report: true }).compilationReport);
	}
});

test('compile treats different z ranges of one 3d mip as aliased copy subresources', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const physical = {
		...texture('volume', textureUsage.COPY_SRC | textureUsage.COPY_DST),
		width: 4,
		height: 4,
		depthOrArrayLayers: 4,
		dimension: '3d',
	} as GPUTexture;
	const volume = graph.importTexture(physical, { label: 'volume', exposedUsage: textureUsage.COPY_SRC | textureUsage.COPY_DST });
	graph.copy({
		label: 'copy-between-slices',
		operations: [{
			type: 'texture-to-texture',
			source: volume,
			destination: volume,
			sourceOrigin: [0, 0, 0],
			destinationOrigin: [0, 0, 1],
			copySize: [1, 1, 1],
		}],
	});
	graph.markOutput(volume);

	assert.throws(() => graph.compile(), /subresources must be disjoint/);
});

test('compile permits texture-to-texture copy formats that only differ by srgb suffix', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const source = graph.createTexture({ label: 'source', format: 'rgba8unorm-srgb', size: [4, 4] });
	const destination = graph.createTexture({ label: 'destination', format: 'rgba8unorm', size: [4, 4] });

	graph.render({
		label: 'write-source',
		colorAttachments: [{ target: source, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.copy({
		label: 'copy',
		operations: [{ type: 'texture-to-texture', source, destination, copySize: [4, 4] }],
	});
	graph.markOutput(destination);

	assert.doesNotThrow(() => graph.compile({ report: true }).compilationReport);
});

test('imports texture metadata from the native object and snapshots import options', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const viewFormats: GPUTextureFormat[] = ['rgba8unorm-srgb'];
	const imported = graph.importTexture(texture(
		'native-asset',
		textureUsage.TEXTURE_BINDING | textureUsage.COPY_SRC,
		{
			format: 'rgba8unorm',
			size: [8, 4, 2],
			mipLevelCount: 3,
			sampleCount: 1,
			dimension: '2d',
		},
	), { viewFormats });
	viewFormats.length = 0;

	assert.deepEqual(graph.getTextureDesc(imported), {
		label: 'native-asset',
		format: 'rgba8unorm',
		viewFormats: ['rgba8unorm-srgb'],
		size: [8, 4, 2],
		dimension: '2d',
		mipLevelCount: 3,
		sampleCount: 1,
		usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_SRC,
	});
});

test('swapchain import materializes native texture metadata without a caller descriptor', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importSwapchainTexture(texture(
		'native-canvas',
		textureUsage.RENDER_ATTACHMENT,
		{ format: 'bgra8unorm', size: [32, 24] },
	));

	assert.deepEqual(graph.getTextureDesc(imported), {
		label: 'native-canvas',
		format: 'bgra8unorm',
		viewFormats: undefined,
		size: [32, 24, 1],
		dimension: '2d',
		mipLevelCount: 1,
		sampleCount: 1,
		usage: textureUsage.RENDER_ATTACHMENT,
	});
});

test('swapchain import rejects initial contents at runtime', () => {
	const initialContents = { initialContents: 'defined' } as any;
	const explicitUndefined = { initialContents: undefined } as any;
	const invalidOptions = [null, [], 'options'] as any[];

	for (const options of [initialContents, explicitUndefined]) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		assert.throws(
			() => graph.importSwapchainTexture(texture('native-canvas', textureUsage.RENDER_ATTACHMENT), options),
			/importSwapchainTexture\(\) does not accept initialContents; swapchain contents are always undefined\./,
		);
	}
	for (const options of invalidOptions) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		assert.throws(
			() => graph.importSwapchainTexture(texture('native-canvas', textureUsage.RENDER_ATTACHMENT), options),
			/FrameGraph\.importSwapchainTexture\(\) options must be an object\./,
		);
	}

	const graph = new FrameGraph(mockDevice()).beginFrame();
	assert.doesNotThrow(() => graph.importSwapchainTexture(
		texture('native-canvas', textureUsage.RENDER_ATTACHMENT),
		{ label: 'backbuffer', exposedUsage: textureUsage.RENDER_ATTACHMENT },
	));
});

test('rejects duplicate native texture imports within one recording', () => {
	const native = texture('shared-texture', textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING);

	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		graph.importTexture(native, { label: 'first-texture' });
		assert.throws(
			() => graph.importTexture(native, { label: 'second-texture' }),
			(error) => error instanceof Error
				&& error.message.includes('FrameGraph.importTexture()')
				&& error.message.includes('GPUTexture "shared-texture"')
				&& error.message.includes('FrameGraph.importTexture() as texture "first-texture"')
				&& error.message.includes('existing TextureHandle'),
		);
	}

	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		graph.importSwapchainTexture(native, { label: 'first-swapchain' });
		assert.throws(
			() => graph.importSwapchainTexture(native, { label: 'second-swapchain' }),
			/already imported by FrameGraph\.importSwapchainTexture\(\) as texture "first-swapchain"/,
		);
	}
});

test('texture and swapchain imports share one native identity registry', () => {
	const native = texture('shared-canvas', textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING);

	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		graph.importTexture(native, { label: 'regular' });
		assert.throws(
			() => graph.importSwapchainTexture(native, { label: 'swapchain' }),
			/already imported by FrameGraph\.importTexture\(\) as texture "regular"/,
		);
	}

	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		graph.importSwapchainTexture(native, { label: 'swapchain' });
		assert.throws(
			() => graph.importTexture(native, { label: 'regular' }),
			/already imported by FrameGraph\.importSwapchainTexture\(\) as texture "swapchain"/,
		);
	}
});

test('rejects duplicate native buffer imports within one recording', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const native = buffer('shared-buffer', bufferUsage.STORAGE);
	graph.importBuffer(native, { label: 'first-buffer' });

	assert.throws(
		() => graph.importBuffer(native, { label: 'second-buffer' }),
		(error) => error instanceof Error
			&& error.message.includes('FrameGraph.importBuffer()')
			&& error.message.includes('GPUBuffer "shared-buffer"')
			&& error.message.includes('already imported as buffer "first-buffer"')
			&& error.message.includes('existing BufferHandle'),
	);
});

test('native import identity is object-based and independent between recordings', () => {
	const runtime = new FrameGraph(mockDevice());
	const firstRecorder = runtime.beginFrame();
	const firstNative = texture('matching-texture', textureUsage.TEXTURE_BINDING);
	const secondNative = texture('matching-texture', textureUsage.TEXTURE_BINDING);
	const first = firstRecorder.importTexture(firstNative);
	const independent = firstRecorder.importTexture(secondNative);
	assert.notEqual(first, independent);

	const secondRecorder = runtime.beginFrame();
	const next = secondRecorder.importTexture(firstNative);
	assert.notEqual(first, next);
	assert.throws(() => secondRecorder.getTextureDesc(first), /does not belong/);

	const nativeBuffer = buffer('reset-buffer', bufferUsage.STORAGE);
	const bufferFirst = secondRecorder.importBuffer(nativeBuffer);
	const thirdRecorder = runtime.beginFrame();
	const bufferNext = thirdRecorder.importBuffer(nativeBuffer);
	assert.notEqual(bufferFirst, bufferNext);
	assert.throws(() => thirdRecorder.getBufferDesc(bufferFirst), /does not belong/);
	assert.throws(() => thirdRecorder.markOutput(bufferFirst), /does not belong/);
});

test('failed native import validation does not reserve the native identity', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const nativeTexture = texture('retry-texture', textureUsage.TEXTURE_BINDING);
	assert.throws(
		() => graph.importTexture(nativeTexture, {
			viewFormats: ['rgba8unorm-srgb', 'rgba8unorm-srgb'],
		}),
		/duplicate format/,
	);
	assert.doesNotThrow(() => graph.importTexture(nativeTexture));

	const nativeBuffer = buffer('retry-buffer', bufferUsage.STORAGE);
	assert.throws(
		() => graph.importBuffer(nativeBuffer, { exposedSize: Number.NaN }),
		/must be a non-negative safe integer/,
	);
	assert.doesNotThrow(() => graph.importBuffer(nativeBuffer));
});

test('imports buffer metadata from the native object and supports logical narrowing', () => {
	const native = buffer(
		'native-buffer',
		bufferUsage.STORAGE | bufferUsage.COPY_SRC,
		96,
	);
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const imported = graph.importBuffer(native);
		assert.equal(imported.label, 'native-buffer');
		assert.deepEqual(graph.getBufferDesc(imported), {
			label: 'native-buffer',
			size: 96,
			usage: bufferUsage.STORAGE | bufferUsage.COPY_SRC,
		});
		graph.command({
			label: 'read-full-native-buffer',
			sideEffect: true,
			uses: [graph.use(imported, BufferAccess.StorageRead, { range: { offset: 0, size: 96 } })],
		});

		const report = graph.compile({ report: true }).compilationReport;
		assert.equal(
			report.resources.find((resource) => resource.id === imported.id)?.usage,
			bufferUsage.STORAGE | bufferUsage.COPY_SRC,
		);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const imported = graph.importBuffer(native, {
			label: 'logical-buffer',
			exposedSize: 32,
			exposedUsage: bufferUsage.STORAGE,
		});
		assert.equal(imported.label, 'logical-buffer');
		assert.deepEqual(graph.getBufferDesc(imported), {
			label: 'logical-buffer',
			size: 32,
			usage: bufferUsage.STORAGE,
		});
		graph.command({
			label: 'read-logical-prefix',
			sideEffect: true,
			uses: [graph.use(imported, BufferAccess.StorageRead, { range: { offset: 0, size: 32 } })],
		});

		assert.doesNotThrow(() => graph.compile({ report: true }).compilationReport);
	}
});

test('compile rejects imported exposed bounds against native resource fields with access context', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const imported = graph.importTexture(texture('asset', textureUsage.TEXTURE_BINDING), {
			label: 'asset',
			exposedUsage: textureUsage.COPY_SRC,
		});
		graph.command({ label: 'copy-from-asset', sideEffect: true, uses: [graph.use(imported, TextureAccess.CopySrc)] });

		assert.throws(
			() => graph.compile({ report: true }).compilationReport,
			(error) => error instanceof Error
				&& error.message.includes('Imported texture "asset" descriptor mismatch for usage')
				&& error.message.includes('exposed usage 0x1, actual GPU texture usage 0x4, missing 0x1')
				&& error.message.includes('node "copy-from-asset" read access "texture-copy-src"'),
		);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const imported = graph.importBuffer(buffer('asset', bufferUsage.COPY_SRC), { label: 'asset', exposedSize: 128, exposedUsage: bufferUsage.COPY_SRC });
		graph.command({ label: 'copy-from-asset', sideEffect: true, uses: [graph.use(imported, BufferAccess.CopySrc)] });

		assert.throws(
			() => graph.compile({ report: true }).compilationReport,
			(error) => error instanceof Error
				&& error.message.includes('Imported buffer "asset" descriptor mismatch for size')
				&& error.message.includes('expected at least 128 bytes, actual GPU buffer size 64 bytes')
				&& error.message.includes('node "copy-from-asset" read access "buffer-copy-src"'),
		);
	}
});

test('compile reports render resolve descriptor mismatches with node and resource context', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'msaa-color', format: 'rgba8unorm', size: [2, 2], sampleCount: 4 });
	const resolve = graph.createTexture({ label: 'resolve-color', format: 'rgba16float', size: [2, 2] });

	graph.render({
		label: 'resolve-pass',
		colorAttachments: [{ target: color, resolveTarget: resolve, loadOp: 'clear', storeOp: 'discard' }],
	});
	graph.markOutput(resolve);

	assert.throws(
		() => graph.compile({ report: true }).compilationReport,
		(error) => error instanceof Error
			&& error.message.includes('Render node "resolve-pass" resolve target "resolve-color" format mismatch')
			&& error.message.includes('color attachment "msaa-color" is "rgba8unorm"')
			&& error.message.includes('resolve target is "rgba16float"')
			&& error.message.includes('WebGPU resolve target format must match'),
	);
});

test('compile reports copy layout diagnostics with concrete WebGPU boundary values', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 64, exposedUsage: bufferUsage.COPY_SRC });
	const destination = graph.createTexture({ label: 'destination', format: 'rgba8unorm', size: [2, 2] });
	graph.copy({
		label: 'upload-texture',
		operations: [{
			type: 'buffer-to-texture',
			source,
			destination,
			sourceLayout: { bytesPerRow: 4 },
			copySize: [2, 2],
		}],
	});
	graph.markOutput(destination);

	assert.throws(
		() => graph.compile({ report: true }).compilationReport,
			(error) => error instanceof Error
				&& error.message.includes('Copy node "upload-texture" buffer-texture copy bytesPerRow must be 256-byte aligned; actual bytesPerRow 4'),
	);
});

test('compile permits sampled access on multisampled textures for explicit multisample shader paths', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1], sampleCount: 4 });

	graph.render({
		label: 'write-color',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		sideEffect: true,
		uses: [graph.use(color, TextureAccess.Sampled)],
	});

	assert.doesNotThrow(() => graph.compile({ report: true }).compilationReport);
});

test('compile rejects copy access on multisampled textures', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1], sampleCount: 4 });
	const copyTarget = graph.createTexture({ label: 'copy-target', format: 'rgba8unorm', size: [1, 1] });

	graph.render({
		label: 'write-color',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.copy({
		label: 'copy',
		operations: [{ type: 'texture-to-texture', source: color, destination: copyTarget, copySize: [1, 1] }],
	});
	graph.markOutput(copyTarget);

	assert.throws(() => graph.compile({ report: true }).compilationReport, /requires a single-sampled texture/);
});

test('compile still validates access declarations on culled nodes', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1], sampleCount: 4 });

	graph.command({
		label: 'culled-copy',
		sideEffect: false,
		uses: [graph.use(color, TextureAccess.CopySrc)],
	});

	assert.throws(() => graph.compile({ report: true }).compilationReport, /requires a single-sampled texture/);
});

test('resource handles reject colliding graph-local ids from another FrameGraph recording', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const localTexture = graph.createTexture({ label: 'local-texture', format: 'rgba8unorm', size: [1, 1] });
	const localBuffer = graph.createBuffer({ label: 'local-buffer', size: 16 });
	const foreignGraph = new FrameGraph(mockDevice()).beginFrame();
	const foreignTexture = foreignGraph.createTexture({ label: 'foreign-texture', format: 'rgba8unorm', size: [1, 1] });
	const foreignBuffer = foreignGraph.createBuffer({ label: 'foreign-buffer', size: 16 });

	assert.equal(localTexture.id, foreignTexture.id);
	assert.equal(localBuffer.id, foreignBuffer.id);
	assert.notEqual(localTexture, foreignTexture);
	assert.notEqual(localBuffer, foreignBuffer);

	assert.throws(
		() => graph.use(foreignTexture, TextureAccess.Sampled),
		/Texture handle "foreign-texture" does not belong to the current FrameGraph recording/,
	);
	assert.throws(
		() => graph.use(foreignBuffer, BufferAccess.StorageRead),
		/Buffer handle "foreign-buffer" does not belong to the current FrameGraph recording/,
	);
});

test('resource-use tokens are reusable across nodes but cannot be duplicated within one node', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const data = graph.importBuffer(buffer('shared-use', bufferUsage.STORAGE), {
		label: 'shared-use',
		exposedSize: 64,
		exposedUsage: bufferUsage.STORAGE,
	});
	const read = graph.use(data, BufferAccess.StorageRead);

	graph.command({ label: 'first-consumer', uses: [read] });
	graph.command({ label: 'second-consumer', uses: [read] });
	assert.throws(
		() => graph.command({ label: 'duplicate-consumer', uses: [read, read] }),
		/cannot declare the same resource use token more than once/,
	);

	const report = graph.compile({ report: true }).compilationReport;
	assert.equal(report.accesses.filter((access) => access.access === BufferAccess.StorageRead).length, 2);
});

test('resource-use tokens cannot cross FrameGraph recordings', () => {
	const runtime = new FrameGraph(mockDevice());
	const first = runtime.beginFrame();
	const data = first.importBuffer(buffer('foreign-use', bufferUsage.STORAGE), {
		label: 'foreign-use',
		exposedSize: 64,
		exposedUsage: bufferUsage.STORAGE,
	});
	const foreignRead = first.use(data, BufferAccess.StorageRead);
	const second = runtime.beginFrame();

	assert.throws(
		() => second.command({ label: 'foreign-consumer', uses: [foreignRead] }),
		/Resource use does not belong to the current FrameGraph recording/,
	);
});

test('texture view handles reject colliding graph-local ids from another FrameGraph recording', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const localTexture = graph.createTexture({ format: 'rgba8unorm', size: [1, 1] });
	const localView = graph.createTextureView(localTexture, { label: 'local-view' });
	const foreignGraph = new FrameGraph(mockDevice()).beginFrame();
	const foreignTexture = foreignGraph.createTexture({ format: 'rgba8unorm', size: [1, 1] });
	const foreignView = foreignGraph.createTextureView(foreignTexture, { label: 'foreign-view' });

	assert.equal(localView.id, foreignView.id);
	assert.notEqual(localView, foreignView);
	assert.throws(
		() => graph.getTextureViewDesc(foreignView),
		/Texture view handle "foreign-view" does not belong to the current FrameGraph recording/,
	);
});

test('resource-kind-prefixed access values reject cross-kind runtime shapes', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.importTexture(texture('asset', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'asset', exposedUsage: textureUsage.TEXTURE_BINDING });
	const colorView = graph.createTextureView(color);
	const data = graph.importBuffer(buffer('data'), { label: 'data', exposedSize: 64, exposedUsage: bufferUsage.STORAGE | bufferUsage.COPY_SRC | bufferUsage.COPY_DST });

	for (const access of [BufferAccess.Vertex, BufferAccess.StorageRead, BufferAccess.CopySrc]) {
		assert.throws(
			() => graph.use(color, access as never),
			/Texture cannot use BufferAccess/,
		);
		assert.throws(
			() => graph.use(colorView, access as never),
			/Texture cannot use BufferAccess/,
		);
	}
	for (const access of [TextureAccess.Sampled, TextureAccess.StorageRead, TextureAccess.CopySrc]) {
		assert.throws(
			() => graph.use(data, access as never),
			/Buffer resources cannot use TextureAccess/,
		);
	}
});

test('use rejects invalid options and requires explicit write contents at runtime', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.importTexture(texture('color', textureUsage.STORAGE_BINDING), {
		label: 'color',
		exposedUsage: textureUsage.STORAGE_BINDING,
	});
	const data = graph.importBuffer(buffer('data'), {
		label: 'data',
		exposedSize: 64,
		exposedUsage: bufferUsage.STORAGE,
	});

	assert.throws(
		() => (graph as unknown as { use(...args: unknown[]): unknown }).use(color, TextureAccess.Sampled, { contents: 'preserve' }),
		/does not accept option "contents" for this read access/,
	);
	assert.throws(
		() => graph.use(color, TextureAccess.StorageWrite, { contents: 'invalid' } as never),
		/write contents must be "overwrite" or "preserve"/,
	);
	assert.throws(
		() => graph.use(color, TextureAccess.StorageWrite, { range: { offset: 0, size: 1 } } as never),
		/does not accept option "range" for this write access/,
	);
	assert.throws(
		() => graph.use(data, BufferAccess.StorageRead, { offset: 0, size: 4 } as never),
		/does not accept option "offset" for this read access/,
	);
	assert.throws(
		() => graph.use(data, BufferAccess.StorageRead, { range: null } as never),
		/buffer range must be an object/,
	);
	assert.throws(
		() => graph.use(data, BufferAccess.StorageWrite, undefined as never),
		/requires explicit contents/,
	);
	assert.throws(
		() => graph.use(data, BufferAccess.StorageWrite, {} as never),
		/requires explicit contents/,
	);

	const write = graph.use(data, BufferAccess.StorageWrite, { contents: 'overwrite' });
	graph.command({ label: 'write', sideEffect: true, uses: [write] });
	const report = graph.compile({ report: true }).compilationReport;
	const access = report.accesses[0];
	assert.equal(access?.mode, 'write');
	if (access?.mode === 'write') {
		assert.equal(access.contents, 'overwrite');
		assert.equal(access.producesValue, true);
	}
});
