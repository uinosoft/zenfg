import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BufferAccess,
	FrameGraph,
	TextureAccess,
	type FrameGraphCompilationReport,
} from '../src/index.ts';

import {
	textureUsage,
	bufferUsage,
	texture,
	buffer,
	mockCommandEncoder,
	mockDevice,
} from './testUtils.ts';

test('compile orders retained producer before present root and culls unused nodes', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'scene-color', format: 'rgba8unorm', size: [1, 1] });
	const unused = graph.createTexture({ label: 'unused', format: 'rgba8unorm', size: [1, 1] });
	const declaredOnly = graph.importBuffer(buffer('declared-only', bufferUsage.STORAGE), { label: 'declared-only', exposedSize: 64, exposedUsage: bufferUsage.STORAGE });
	const backbuffer = graph.importSwapchainTexture(texture('backbuffer', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'backbuffer', exposedUsage: textureUsage.RENDER_ATTACHMENT });

	graph.render({
		label: 'scene',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'unused',
		colorAttachments: [{ target: unused, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'present',
		uses: [graph.use(color, TextureAccess.Sampled)],
		colorAttachments: [{ target: backbuffer, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markPresent(backbuffer);

	const compiled = graph.compile({ report: true }).compilationReport;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['scene', 'present']);
	assert.deepEqual(compiled.culledNodes.map((node) => node.label), ['unused']);
	assert.equal(compiled.resources.some((resource) => resource.id === declaredOnly.id), false);
});

test('compile rejects transient texture and buffer consumers recorded before producers', () => {
	const textureGraph = new FrameGraph(mockDevice()).beginFrame();
	const color = textureGraph.createTexture({ label: 'scene-color', format: 'rgba8unorm', size: [1, 1] });
	const colorRead = textureGraph.use(color, TextureAccess.Sampled);
	textureGraph.command({ label: 'texture-consumer', sideEffect: true, uses: [colorRead] });
	textureGraph.render({
		label: 'texture-producer',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	assert.throws(() => textureGraph.compile(), /read before it is produced/);

	const bufferGraph = new FrameGraph(mockDevice()).beginFrame();
	const data = bufferGraph.createBuffer({ label: 'data', size: 16 });
	const dataRead = bufferGraph.use(data, BufferAccess.StorageRead);
	bufferGraph.command({ label: 'buffer-consumer', sideEffect: true, uses: [dataRead] });
	const dataWrite = bufferGraph.use(data, BufferAccess.StorageWrite, { contents: 'overwrite' });
	bufferGraph.command({ label: 'buffer-producer', sideEffect: false, uses: [dataWrite] });
	assert.throws(() => bufferGraph.compile(), /read before it is produced/);
});

test('imported resources default to defined contents and can opt into undefined contents', () => {
	const defined = new FrameGraph(mockDevice()).beginFrame();
	const definedBuffer = defined.importBuffer(buffer('history'), { exposedUsage: bufferUsage.STORAGE });
	defined.command({ sideEffect: true, uses: [defined.use(definedBuffer, BufferAccess.StorageRead)] });
	assert.doesNotThrow(() => defined.compile());

	const undefinedGraph = new FrameGraph(mockDevice()).beginFrame();
	const undefinedBuffer = undefinedGraph.importBuffer(buffer('empty-history'), {
		exposedUsage: bufferUsage.STORAGE,
		initialContents: 'undefined',
	});
	undefinedGraph.command({ sideEffect: true, uses: [undefinedGraph.use(undefinedBuffer, BufferAccess.StorageRead)] });
	assert.throws(() => undefinedGraph.compile(), /undefined initial contents.*read before it is produced/);
});

test('persistent state retains imported producers and rejects transient resources', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const history = graph.importTexture(texture('history', textureUsage.RENDER_ATTACHMENT), {
		exposedUsage: textureUsage.RENDER_ATTACHMENT,
		initialContents: 'undefined',
	});
	graph.render({
		label: 'history-producer',
		colorAttachments: [{ target: history, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markPersistentState(history);
	const report = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(report.nodes.map((node) => node.label), ['history-producer']);
	assert.ok(report.roots.some((root) => root.reason === 'persistent-state' && root.resourceId === history.id));

	const invalid = new FrameGraph(mockDevice()).beginFrame();
	const transient = invalid.createBuffer({ size: 4 });
	assert.throws(() => invalid.markPersistentState(transient), /only be marked on an imported resource/);
});

test('access declaration order does not change read-write resource semantics', () => {
	const capture = (writeFirst: boolean) => {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const data = graph.createBuffer({ label: 'data', size: 16 });
		graph.command({
			label: 'producer',
			sideEffect: false,
			uses: [graph.use(data, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		});
		const read = { resource: data, access: BufferAccess.StorageRead } as const;
		const write = { resource: data, access: BufferAccess.StorageWrite } as const;
		const readUse = graph.use(read.resource, read.access);
		const writeUse = graph.use(write.resource, write.access, { contents: 'overwrite' });
		graph.command({
			label: 'read-write',
			sideEffect: true,
			uses: writeFirst ? [writeUse, readUse] : [readUse, writeUse],
		});
		const compiled = graph.compile({ report: true }).compilationReport;
		return {
			nodes: compiled.nodes.map((node) => ({
				label: node.label,
				modes: compiled.accesses.filter((access) => access.nodeId === node.id).map((access) => access.mode),
			})),
			edges: compiled.dependencies.map((edge) => ({
				from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
				to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
				kind: edge.kind,
			})),
		};
	};

	assert.deepEqual(capture(true), capture(false));
	assert.deepEqual(capture(true).nodes[1].modes, ['read', 'write']);

	const invalid = new FrameGraph(mockDevice()).beginFrame();
	const transient = invalid.createBuffer({ label: 'transient', size: 16 });
	invalid.command({
		sideEffect: true,
		uses: [invalid.use(transient, BufferAccess.StorageWrite, { contents: 'overwrite' }), invalid.use(transient, BufferAccess.StorageRead)],
	});
	assert.throws(() => invalid.compile({ report: true }).compilationReport, /read before it is produced/);

	const invalidTexture = new FrameGraph(mockDevice()).beginFrame();
	const transientTexture = invalidTexture.createTexture({ label: 'transient-texture', format: 'rgba8unorm', size: [1, 1] });
	const textureWrite = invalidTexture.use(transientTexture, TextureAccess.StorageWrite, { contents: 'overwrite' });
	const textureRead = invalidTexture.use(transientTexture, TextureAccess.StorageRead);
	invalidTexture.command({
		sideEffect: true,
		uses: [textureWrite, textureRead],
	});
	assert.throws(() => invalidTexture.compile({ report: true }).compilationReport, /read before it is produced/);
});

test('compile lets a later texture overwrite replace an unused previous producer', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });

	graph.render({
		label: 'first',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'second',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(color);

	const report = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(report.nodes.map((node) => node.label), ['second']);
	assert.deepEqual(report.culledNodes.map((node) => node.label), ['first']);
	assert.deepEqual(report.roots, [{ reason: 'output', resourceId: color.id }]);
});

test('compile allows independent producers for different texture array layers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const shadowDepth = graph.createTexture({ label: 'shadow-depth', format: 'depth24plus', size: [1024, 1024, 4] });

	for (let layer = 0; layer < 4; layer++) {
		const layerView = graph.createTextureView(shadowDepth, { dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1, aspect: 'depth-only' });
		graph.render({
			label: `cascade-${layer}`,
			depthStencilAttachment: {
				target: layerView,
				depthLoadOp: 'clear',
				depthStoreOp: 'store',
				depthClearValue: 1,
			},
		});
	}
	graph.markOutput(shadowDepth);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['cascade-0', 'cascade-1', 'cascade-2', 'cascade-3']);
	assert.deepEqual(debug.dependencies, []);
	assert.deepEqual(
		debug.accesses.map((access) => access.textureRegion),
		[0, 1, 2, 3].map((layer) => ({
			baseMipLevel: 0,
			mipLevelCount: 1,
			baseArrayLayer: layer,
			arrayLayerCount: 1,
			aspect: 'depth-only',
		})),
	);
});

test('compile tracks independent 3d attachment slices and orders a loaded slice version', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const volume = graph.createTexture({
		label: 'volume',
		format: 'rgba8unorm',
		size: [8, 8, 3],
		dimension: '3d',
	});
	graph.render({
		label: 'slice-0-first',
		colorAttachments: [{
			target: volume,
			depthSlice: 0,
			loadOp: 'clear',
			storeOp: 'store',
		}],
	});
	graph.render({
		label: 'slice-1',
		colorAttachments: [{
			target: volume,
			depthSlice: 1,
			loadOp: 'clear',
			storeOp: 'store',
		}],
	});
	graph.render({
		label: 'slice-0-second',
		colorAttachments: [{
			target: volume,
			depthSlice: 0,
			loadOp: 'load',
			storeOp: 'store',
		}],
	});
	graph.markOutput(volume);

	const report = graph.compile({ report: true }).compilationReport;
	const labelsById = new Map(report.nodes.map((node) => [node.id, node.label]));

	assert.deepEqual(report.nodes.map((node) => node.label), [
		'slice-0-first',
		'slice-1',
		'slice-0-second',
	]);
	assert.deepEqual(report.dependencies.map((edge) => [
		labelsById.get(edge.fromNodeId),
		labelsById.get(edge.toNodeId),
	]), [['slice-0-first', 'slice-0-second']]);
	assert.deepEqual(report.accesses.map((access) => access.textureRegion), [
		{ baseMipLevel: 0, mipLevelCount: 1, baseDepthSlice: 0, depthSliceCount: 1, aspect: 'all' },
		{ baseMipLevel: 0, mipLevelCount: 1, baseDepthSlice: 1, depthSliceCount: 1, aspect: 'all' },
		{ baseMipLevel: 0, mipLevelCount: 1, baseDepthSlice: 0, depthSliceCount: 1, aspect: 'all' },
	]);
	assert.equal(report.accesses.at(-1)?.mode, 'write');
	assert.equal(report.accesses.at(-1)?.contents, 'preserve');
});

test('compile expands a multi-mip 3d sampled view into exact per-mip depth regions', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const volume = graph.createTexture({
		label: 'volume-mips',
		format: 'rgba8unorm',
		size: [8, 8, 4],
		dimension: '3d',
		mipLevelCount: 3,
	});
	for (let mip = 0; mip < 3; mip++) {
		const mipView = graph.createTextureView(volume, {
			dimension: '3d',
			baseMipLevel: mip,
			mipLevelCount: 1,
		});
		const depth = Math.max(1, 4 >> mip);
		for (let depthSlice = 0; depthSlice < depth; depthSlice++) {
			graph.render({
				label: `mip-${mip}-slice-${depthSlice}`,
				colorAttachments: [{
					target: mipView,
					depthSlice,
					loadOp: 'clear',
					storeOp: 'store',
				}],
			});
		}
	}
	graph.command({
		label: 'sample-volume-mips',
		sideEffect: true,
		uses: [graph.use(volume, TextureAccess.Sampled)],
	});

	const report = graph.compile({ report: true }).compilationReport;

	assert.deepEqual(
		report.accesses
			.filter((access) => access.access === TextureAccess.Sampled)
			.map((access) => access.textureRegion),
		[
			{ baseMipLevel: 0, mipLevelCount: 1, baseDepthSlice: 0, depthSliceCount: 4, aspect: 'all' },
			{ baseMipLevel: 1, mipLevelCount: 1, baseDepthSlice: 0, depthSliceCount: 2, aspect: 'all' },
			{ baseMipLevel: 2, mipLevelCount: 1, baseDepthSlice: 0, depthSliceCount: 1, aspect: 'all' },
		],
	);
});

test('compile connects a full texture reader to all overlapping layer producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const shadowDepth = graph.createTexture({ label: 'shadow-depth', format: 'depth24plus', size: [1024, 1024, 2] });
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });

	for (let layer = 0; layer < 2; layer++) {
		const layerView = graph.createTextureView(shadowDepth, { dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1, aspect: 'depth-only' });
		graph.render({
			label: `cascade-${layer}`,
			depthStencilAttachment: {
				target: layerView,
				depthLoadOp: 'clear',
				depthStoreOp: 'store',
				depthClearValue: 1,
			},
		});
	}
	graph.render({
		label: 'opaque',
		uses: [graph.use(shadowDepth, TextureAccess.Sampled)],
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(color);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const edges = debug.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	}));

	assert.deepEqual(edges, [
		{ from: 'cascade-0', to: 'opaque', resource: 'shadow-depth' },
		{ from: 'cascade-1', to: 'opaque', resource: 'shadow-depth' },
	]);
});

test('compile avoids false dependencies for non-overlapping mip attachment producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const bloom = graph.createTexture({ label: 'bloom-chain', format: 'rgba16float', size: [64, 64], mipLevelCount: 3 });

	for (let mip = 0; mip < 3; mip++) {
		const mipView = graph.createTextureView(bloom, { baseMipLevel: mip, mipLevelCount: 1 });
		graph.render({
			label: `bloom-mip-${mip}`,
			colorAttachments: [{
				target: mipView,
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
	}
	graph.markOutput(bloom);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['bloom-mip-0', 'bloom-mip-1', 'bloom-mip-2']);
	assert.deepEqual(debug.dependencies, []);
	assert.deepEqual(
		debug.accesses.map((access) => access.textureRegion),
		[0, 1, 2].map((mip) => ({
			baseMipLevel: mip,
			mipLevelCount: 1,
			baseArrayLayer: 0,
			arrayLayerCount: 1,
			aspect: 'all',
		})),
	);
});

test('compile connects a full mip-chain reader to all overlapping mip producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const bloom = graph.createTexture({ label: 'bloom-chain', format: 'rgba16float', size: [64, 64], mipLevelCount: 3 });
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });

	for (let mip = 0; mip < 3; mip++) {
		const mipView = graph.createTextureView(bloom, { baseMipLevel: mip, mipLevelCount: 1 });
		graph.render({
			label: `bloom-mip-${mip}`,
			colorAttachments: [{
				target: mipView,
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
	}
	graph.render({
		label: 'bloom-composite',
		uses: [graph.use(bloom, TextureAccess.Sampled)],
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(color);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const edges = debug.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	}));

	assert.deepEqual(edges, [
		{ from: 'bloom-mip-0', to: 'bloom-composite', resource: 'bloom-chain' },
		{ from: 'bloom-mip-1', to: 'bloom-composite', resource: 'bloom-chain' },
		{ from: 'bloom-mip-2', to: 'bloom-composite', resource: 'bloom-chain' },
	]);
});

test('compile connects ranged sampled reads only to overlapping mip producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const bloom = graph.createTexture({ label: 'bloom-chain', format: 'rgba16float', size: [64, 64], mipLevelCount: 3 });
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });

	for (let mip = 0; mip < 3; mip++) {
		const mipView = graph.createTextureView(bloom, { baseMipLevel: mip, mipLevelCount: 1 });
		graph.render({
			label: `bloom-mip-${mip}`,
			colorAttachments: [{
				target: mipView,
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
	}
	const sampledMip = graph.createTextureView(bloom, { baseMipLevel: 1, mipLevelCount: 1 });
	graph.render({
		label: 'bloom-read-mip-1',
		uses: [graph.use(sampledMip, TextureAccess.Sampled)],
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markOutput(color);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const edges = debug.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	}));

	assert.deepEqual(edges, [
		{ from: 'bloom-mip-1', to: 'bloom-read-mip-1', resource: 'bloom-chain' },
	]);
	assert.deepEqual(
		debug.accesses.find((access) => access.nodeId === compiled.nodes.find((node) => node.label === 'bloom-read-mip-1')?.id && access.mode === 'read')?.textureRegion,
		{
			baseMipLevel: 1,
			mipLevelCount: 1,
			baseArrayLayer: 0,
			arrayLayerCount: 1,
			aspect: 'all',
		},
	);
});

test('compile orders a texture load-store pass after the previous texture producer', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });

	graph.render({
		label: 'background',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'main',
		colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
	});
	graph.markOutput(color);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['background', 'main']);
	assert.deepEqual(
		compiled.accesses
			.filter((access) => access.nodeId === compiled.nodes.find((node) => node.label === 'main')?.id)
			.map((access) => ({ access: access.access, mode: access.mode, contents: access.contents, producesValue: access.producesValue })),
		[
			{ access: TextureAccess.ColorAttachmentWrite, mode: 'write', contents: 'preserve', producesValue: true },
		],
	);
	assert.deepEqual(debug.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	})), [{
		from: 'background',
		to: 'main',
		resource: 'color',
	}]);
});

test('attachment load and store operations infer one normalized write access', () => {
	for (const scenario of [
		{ loadOp: 'load', storeOp: 'store', contents: 'preserve', producesValue: true },
		{ loadOp: 'clear', storeOp: 'store', contents: 'overwrite', producesValue: true },
		{ loadOp: 'load', storeOp: 'discard', contents: 'preserve', producesValue: false },
		{ loadOp: 'clear', storeOp: 'discard', contents: 'overwrite', producesValue: false },
	] as const) {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const target = graph.importTexture(texture(`target-${scenario.loadOp}-${scenario.storeOp}`, textureUsage.RENDER_ATTACHMENT), {
			exposedUsage: textureUsage.RENDER_ATTACHMENT,
		});
		graph.render({
			label: `${scenario.loadOp}-${scenario.storeOp}`,
			sideEffect: true,
			colorAttachments: [{
				target,
				loadOp: scenario.loadOp,
				storeOp: scenario.storeOp,
			}],
		});

		const accesses = graph.compile({ report: true }).compilationReport.accesses;
		assert.equal(accesses.length, 1);
		const access = accesses[0];
		assert.equal(access?.mode, 'write');
		if (access?.mode === 'write') {
			assert.equal(access.access, TextureAccess.ColorAttachmentWrite);
			assert.equal(access.contents, scenario.contents);
			assert.equal(access.producesValue, scenario.producesValue);
		}
	}
});

test('explicit texture preserve retains the previous value without a physical read access', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	const overwrite = graph.use(color, TextureAccess.StorageWrite, { contents: 'overwrite' });
	graph.command({ label: 'overwrite', sideEffect: false, uses: [overwrite] });
	const preserve = graph.use(color, TextureAccess.StorageWrite, { contents: 'preserve' });
	graph.command({ label: 'preserve', sideEffect: false, uses: [preserve] });
	graph.markOutput(color);

	const report = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(report.nodes.map((node) => node.label), ['overwrite', 'preserve']);
	assert.deepEqual(report.dependencies.map((edge) => edge.kind), ['value']);
	assert.deepEqual(
		report.accesses.map((access) => ({ access: access.access, mode: access.mode, contents: access.contents })),
		[
			{ access: TextureAccess.StorageWrite, mode: 'write', contents: 'overwrite' },
			{ access: TextureAccess.StorageWrite, mode: 'write', contents: 'preserve' },
		],
	);
});

test('preserve requires initialized transient contents but can consume imported initial values', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const textureTarget = graph.createTexture({ label: 'texture-target', format: 'rgba8unorm', size: [1, 1] });
		const preserveTexture = graph.use(textureTarget, TextureAccess.StorageWrite, { contents: 'preserve' });
		graph.command({ sideEffect: true, uses: [preserveTexture] });
		assert.throws(() => graph.compile(), /preserves contents before it is produced/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const bufferTarget = graph.createBuffer({ label: 'buffer-target', size: 16 });
		const preserveBuffer = graph.use(bufferTarget, BufferAccess.StorageWrite, { contents: 'preserve' });
		graph.command({ sideEffect: true, uses: [preserveBuffer] });
		assert.throws(() => graph.compile(), /preserves contents before it is produced/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const importedTexture = graph.importTexture(texture('imported-texture', textureUsage.STORAGE_BINDING), {
			label: 'imported-texture',
			exposedUsage: textureUsage.STORAGE_BINDING,
		});
		const importedBuffer = graph.importBuffer(buffer('imported-buffer', bufferUsage.STORAGE), {
			label: 'imported-buffer',
			exposedSize: 16,
			exposedUsage: bufferUsage.STORAGE,
		});
		const preserveTexture = graph.use(importedTexture, TextureAccess.StorageWrite, { contents: 'preserve' });
		const preserveBuffer = graph.use(importedBuffer, BufferAccess.StorageWrite, { contents: 'preserve' });
		graph.command({ sideEffect: true, uses: [preserveTexture, preserveBuffer] });
		assert.doesNotThrow(() => graph.compile());
	}
});

test('a later transient preserve write cannot initialize an earlier read', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.createTexture({ label: 'target', format: 'rgba8unorm', size: [1, 1] });
	const read = graph.use(target, TextureAccess.Sampled);
	graph.command({ label: 'reader', sideEffect: true, uses: [read] });
	const preserve = graph.use(target, TextureAccess.StorageWrite, { contents: 'preserve' });
	graph.command({ label: 'preserve', sideEffect: true, uses: [preserve] });

	assert.throws(() => graph.compile(), /read before it is produced/);
});

test('compile preserves an intermediate texture read before a later load-store continuation', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	const middleOutput = graph.createTexture({ label: 'middle-output', format: 'rgba8unorm', size: [1, 1] });

	graph.render({
		label: 'background',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'middle-reader',
		uses: [graph.use(color, TextureAccess.Sampled)],
		colorAttachments: [{ target: middleOutput, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'continuation',
		colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
	});
	graph.markOutput(middleOutput);
	graph.markOutput(color);

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), [
		'background',
		'middle-reader',
		'continuation',
	]);
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	})), [
		{ from: 'background', to: 'middle-reader', kind: 'value', resource: 'color' },
		{ from: 'background', to: 'continuation', kind: 'value', resource: 'color' },
		{ from: 'middle-reader', to: 'continuation', kind: 'ordering', resource: 'color' },
	]);
});

test('texture ordering hazards do not retain an otherwise unused continuation or reader', () => {
	const compile = (root: 'reader' | 'continuation') => {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
		const middleOutput = graph.createTexture({ label: 'middle-output', format: 'rgba8unorm', size: [1, 1] });
		graph.render({
			label: 'background',
			colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'middle-reader',
			uses: [graph.use(color, TextureAccess.Sampled)],
			colorAttachments: [{ target: middleOutput, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'continuation',
			colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
		});
		graph.markOutput(root === 'reader' ? middleOutput : color);
		return graph.compile({ report: true }).compilationReport;
	};

	const readerRoot = compile('reader');
	assert.deepEqual(readerRoot.nodes.map((node) => node.label), ['background', 'middle-reader']);
	assert.deepEqual(readerRoot.culledNodes.map((node) => node.label), ['continuation']);

	const continuationRoot = compile('continuation');
	assert.deepEqual(continuationRoot.nodes.map((node) => node.label), ['background', 'continuation']);
	assert.deepEqual(continuationRoot.culledNodes.map((node) => node.label), ['middle-reader']);
});

test('a texture read targets the preceding overwrite before a later preserve continuation', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	const output = graph.createTexture({ label: 'output', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'background',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'reader',
		uses: [graph.use(color, TextureAccess.Sampled)],
		colorAttachments: [{ target: output, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'continuation',
		colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
	});
	graph.markOutput(output);
	graph.markOutput(color);

	const report = graph.compile({ report: true }).compilationReport;
	const labelsById = new Map(report.nodes.map((node) => [node.id, node.label]));
	assert.deepEqual(report.nodes.map((node) => node.label), ['background', 'reader', 'continuation']);
	assert.deepEqual(report.dependencies.map((edge) => ({
		from: labelsById.get(edge.fromNodeId),
		to: labelsById.get(edge.toNodeId),
		kind: edge.kind,
	})), [
		{ from: 'background', to: 'reader', kind: 'value' },
		{ from: 'background', to: 'continuation', kind: 'value' },
		{ from: 'reader', to: 'continuation', kind: 'ordering' },
	]);
});

test('compile connects a texture read to preceding disjoint subresource producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const mipChain = graph.createTexture({
		label: 'mip-chain',
		format: 'rgba8unorm',
		size: [2, 2],
		mipLevelCount: 2,
	});
	for (let mip = 0; mip < 2; mip++) {
		const mipView = graph.createTextureView(mipChain, { baseMipLevel: mip, mipLevelCount: 1 });
		graph.render({
			label: `mip-${mip}`,
			colorAttachments: [{
				target: mipView,
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
	}
	graph.command({
		label: 'reader',
		sideEffect: true,
		uses: [graph.use(mipChain, TextureAccess.Sampled)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), ['mip-0', 'mip-1', 'reader']);
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
	})), [
		{ from: 'mip-0', to: 'reader', kind: 'value' },
		{ from: 'mip-1', to: 'reader', kind: 'value' },
	]);
});

test('partial texture continuation preserves writers for untouched subresources', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const textureWithMips = graph.createTexture({
		label: 'mip-chain',
		format: 'rgba8unorm',
		size: [4, 4],
		mipLevelCount: 3,
	});
	const mipViews = Array.from({ length: 3 }, (_, mip) => graph.createTextureView(textureWithMips, {
		baseMipLevel: mip,
		mipLevelCount: 1,
	}));
	const writeMipUses = mipViews.map((resource) => graph.use(resource, TextureAccess.StorageWrite, { contents: 'overwrite' }));
	graph.command({
		label: 'write-all-mips',
		sideEffect: false,
		uses: writeMipUses,
	});
	graph.render({
		label: 'continue-mip-1',
		colorAttachments: [{
			target: graph.createTextureView(textureWithMips, { baseMipLevel: 1, mipLevelCount: 1 }),
			loadOp: 'load',
			storeOp: 'store',
		}],
	});
	graph.command({
		label: 'read-all-mips',
		sideEffect: true,
		uses: [graph.use(textureWithMips, TextureAccess.Sampled)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), [
		'write-all-mips',
		'continue-mip-1',
		'read-all-mips',
	]);
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
	})), [
		{ from: 'write-all-mips', to: 'continue-mip-1', kind: 'value' },
		{ from: 'write-all-mips', to: 'read-all-mips', kind: 'value' },
		{ from: 'continue-mip-1', to: 'read-all-mips', kind: 'value' },
	]);
});

test('intermediate texture readers only order later writers for overlapping subresources', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const mipChain = graph.createTexture({
		label: 'mip-chain',
		format: 'rgba8unorm',
		size: [2, 2],
		mipLevelCount: 2,
	});
	for (let mip = 0; mip < 2; mip++) {
		const mipView = graph.createTextureView(mipChain, { baseMipLevel: mip, mipLevelCount: 1 });
		graph.render({
			label: `write-mip-${mip}`,
			colorAttachments: [{
				target: mipView,
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
	}
	const mip0View = graph.createTextureView(mipChain, { baseMipLevel: 0, mipLevelCount: 1 });
	graph.command({
		label: 'read-mip-0',
		sideEffect: true,
		uses: [graph.use(mip0View, TextureAccess.Sampled)],
	});
	graph.render({
		label: 'continue-mip-1',
		colorAttachments: [{
			target: graph.createTextureView(mipChain, { baseMipLevel: 1, mipLevelCount: 1 }),
			loadOp: 'load',
			storeOp: 'store',
		}],
	});
	graph.markOutput(mipChain);

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
	})), [
		{ from: 'write-mip-0', to: 'read-mip-0', kind: 'value' },
		{ from: 'write-mip-1', to: 'continue-mip-1', kind: 'value' },
	]);
});

test('depth texture readers stay before later depth load-store continuations', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const depth = graph.createTexture({ label: 'depth', format: 'depth32float', size: [1, 1] });
	graph.render({
		label: 'depth-background',
		depthStencilAttachment: {
			target: depth,
			depthLoadOp: 'clear',
			depthStoreOp: 'store',
			depthClearValue: 0,
		},
	});
	graph.command({
		label: 'depth-reader',
		sideEffect: true,
		uses: [graph.use(depth, TextureAccess.DepthRead)],
	});
	graph.render({
		label: 'depth-continuation',
		depthStencilAttachment: {
			target: depth,
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		},
	});
	graph.markOutput(depth);

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), [
		'depth-background',
		'depth-reader',
		'depth-continuation',
	]);
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
	})), [
		{ from: 'depth-background', to: 'depth-reader', kind: 'value' },
		{ from: 'depth-background', to: 'depth-continuation', kind: 'value' },
		{ from: 'depth-reader', to: 'depth-continuation', kind: 'ordering' },
	]);
});

test('texture creation rejects combined depth-stencil formats', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	assert.throws(() => graph.createTexture({
		label: 'depth-stencil-destination',
		format: 'depth24plus-stencil8',
		size: [1, 1],
	}), /does not support stencil/);
});

test('discarded attachment writes do not produce a marked output texture value', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'discarded', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'discard',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'discard' }],
	});
	graph.markOutput(color);

	assert.deepEqual(graph.compile({ report: true }).compilationReport.nodes, []);
});

test('compile rejects reading color and depth attachment values after discard', () => {
	const colorGraph = new FrameGraph(mockDevice()).beginFrame();
	const color = colorGraph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	colorGraph.render({
		label: 'color-store',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	colorGraph.render({
		label: 'color-discard',
		sideEffect: true,
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'discard' }],
	});
	colorGraph.command({
		label: 'color-read',
		sideEffect: true,
		uses: [colorGraph.use(color, TextureAccess.Sampled)],
	});
	assert.throws(() => colorGraph.compile({ report: true }).compilationReport, /read after its value was discarded/);

	const depthGraph = new FrameGraph(mockDevice()).beginFrame();
	const depth = depthGraph.createTexture({ label: 'depth', format: 'depth32float', size: [1, 1] });
	depthGraph.render({
		label: 'depth-store',
		depthStencilAttachment: {
			target: depth,
			depthLoadOp: 'clear',
			depthStoreOp: 'store',
			depthClearValue: 0,
		},
	});
	depthGraph.render({
		label: 'depth-discard',
		sideEffect: true,
		depthStencilAttachment: {
			target: depth,
			depthLoadOp: 'load',
			depthStoreOp: 'discard',
		},
	});
	depthGraph.command({
		label: 'depth-read',
		sideEffect: true,
		uses: [depthGraph.use(depth, TextureAccess.DepthRead)],
	});
	assert.throws(() => depthGraph.compile({ report: true }).compilationReport, /read after its value was discarded/);
});

test('compile allows a clear-store write to restore a discarded texture value', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'old-store',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'discard',
		sideEffect: true,
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'discard' }],
	});
	graph.render({
		label: 'new-store',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		label: 'reader',
		sideEffect: true,
		uses: [graph.use(color, TextureAccess.Sampled)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), ['discard', 'new-store', 'reader']);
	assert.deepEqual(compiled.culledNodes.map((node) => node.label), ['old-store']);
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
	})), [
		{ from: 'discard', to: 'new-store', kind: 'ordering' },
		{ from: 'new-store', to: 'reader', kind: 'value' },
	]);
});

test('compile rejects a load-store continuation after discard', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'discard',
		sideEffect: true,
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'discard' }],
	});
	graph.render({
		label: 'load-store',
		sideEffect: true,
		colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
	});

	assert.throws(() => graph.compile({ report: true }).compilationReport, /preserves contents after its value was discarded/);
});

test('discard invalidates only the selected mip and array layer', () => {
	const compileRead = (readDiscardedView: boolean) => {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const texture = graph.createTexture({
			label: 'mip-layers',
			format: 'rgba8unorm',
			size: [2, 2, 2],
			mipLevelCount: 2,
		});
		const discarded = graph.createTextureView(texture, {
			dimension: '2d',
			baseMipLevel: 1,
			mipLevelCount: 1,
			baseArrayLayer: 0,
			arrayLayerCount: 1,
		});
		const preserved = graph.createTextureView(texture, {
			dimension: '2d',
			baseMipLevel: 1,
			mipLevelCount: 1,
			baseArrayLayer: 1,
			arrayLayerCount: 1,
		});
		graph.render({
			label: 'store-discarded-range',
			colorAttachments: [{ target: discarded, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'store-preserved-range',
			colorAttachments: [{ target: preserved, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'discard-selected-range',
			sideEffect: true,
			colorAttachments: [{ target: discarded, loadOp: 'clear', storeOp: 'discard' }],
		});
		graph.command({
			label: 'reader',
			sideEffect: true,
			uses: [graph.use(readDiscardedView ? discarded : preserved, TextureAccess.Sampled)],
		});
		return graph.compile({ report: true }).compilationReport;
	};

	assert.throws(() => compileRead(true), /read after its value was discarded/);
	assert.deepEqual(compileRead(false).nodes.map((node) => node.label), [
		'store-preserved-range',
		'discard-selected-range',
		'reader',
	]);
});

test('discard invalidates only the selected 3d attachment slice', () => {
	const compileLoad = (depthSlice: number) => {
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const volume = graph.createTexture({
			label: 'volume',
			format: 'rgba8unorm',
			size: [2, 2, 2],
			dimension: '3d',
		});
		for (let slice = 0; slice < 2; slice++) {
			graph.render({
				label: `store-slice-${slice}`,
				colorAttachments: [{
					target: volume,
					depthSlice: slice,
					loadOp: 'clear',
					storeOp: 'store',
				}],
			});
		}
		graph.render({
			label: 'discard-slice-0',
			sideEffect: true,
			colorAttachments: [{
				target: volume,
				depthSlice: 0,
				loadOp: 'clear',
				storeOp: 'discard',
			}],
		});
		graph.render({
			label: `load-slice-${depthSlice}`,
			sideEffect: true,
			colorAttachments: [{
				target: volume,
				depthSlice,
				loadOp: 'load',
				storeOp: 'store',
			}],
		});
		return graph.compile({ report: true }).compilationReport;
	};

	assert.throws(() => compileLoad(0), /discarded/);
	assert.deepEqual(compileLoad(1).nodes.map((node) => node.label), [
		'store-slice-1',
		'discard-slice-0',
		'load-slice-1',
	]);
});

test('discard keeps WAR and WAW ordering without retaining an unused previous writer', () => {
	const retainedGraph = new FrameGraph(mockDevice()).beginFrame();
	const retainedColor = retainedGraph.createTexture({ label: 'retained-color', format: 'rgba8unorm', size: [1, 1] });
	retainedGraph.render({
		label: 'writer',
		sideEffect: true,
		colorAttachments: [{ target: retainedColor, loadOp: 'clear', storeOp: 'store' }],
	});
	retainedGraph.command({
		label: 'reader',
		sideEffect: true,
		uses: [retainedGraph.use(retainedColor, TextureAccess.Sampled)],
	});
	retainedGraph.render({
		label: 'discard',
		sideEffect: true,
		colorAttachments: [{ target: retainedColor, loadOp: 'clear', storeOp: 'discard' }],
	});

	const retained = retainedGraph.compile({ report: true }).compilationReport;
	assert.deepEqual(retained.dependencies.map((edge) => ({
		from: retained.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: retained.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
	})), [
		{ from: 'writer', to: 'reader', kind: 'value' },
		{ from: 'writer', to: 'discard', kind: 'ordering' },
		{ from: 'reader', to: 'discard', kind: 'ordering' },
	]);

	const culledGraph = new FrameGraph(mockDevice()).beginFrame();
	const culledColor = culledGraph.createTexture({ label: 'culled-color', format: 'rgba8unorm', size: [1, 1] });
	culledGraph.render({
		label: 'unused-writer',
		colorAttachments: [{ target: culledColor, loadOp: 'clear', storeOp: 'store' }],
	});
	culledGraph.render({
		label: 'root-discard',
		sideEffect: true,
		colorAttachments: [{ target: culledColor, loadOp: 'clear', storeOp: 'discard' }],
	});

	const culled = culledGraph.compile({ report: true }).compilationReport;
	assert.deepEqual(culled.nodes.map((node) => node.label), ['root-discard']);
	assert.deepEqual(culled.culledNodes.map((node) => node.label), ['unused-writer']);
});

test('discard prevents marking an earlier stored texture value as output', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'store',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'discard',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'discard' }],
	});
	graph.markOutput(color);

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes, []);
	assert.deepEqual(compiled.culledNodes.map((node) => node.label), ['store', 'discard']);
});

test('discarded values remain invalid until a later producer is recorded', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'discard',
		sideEffect: true,
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'discard' }],
	});
	graph.command({
		label: 'reader',
		sideEffect: true,
		uses: [graph.use(color, TextureAccess.Sampled)],
	});
	graph.render({
		label: 'later-producer',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});

	assert.throws(() => graph.compile({ report: true }).compilationReport, /read after its value was discarded/);
});

test('a texture reader stays ahead of a later discard after its producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });
	const gate = graph.createTexture({ label: 'gate', format: 'rgba8unorm', size: [1, 1] });
	graph.render({
		label: 'color-producer',
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'gate-producer',
		colorAttachments: [{ target: gate, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.command({
		label: 'reader',
		sideEffect: true,
		uses: [graph.use(color, TextureAccess.Sampled), graph.use(gate, TextureAccess.Sampled)],
	});
	graph.render({
		label: 'discard',
		sideEffect: true,
		colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'discard' }],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), [
		'color-producer',
		'gate-producer',
		'reader',
		'discard',
	]);
	assert.equal(compiled.dependencies.some((edge) => (
		compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label === 'reader'
		&& compiled.nodes.find((node) => node.id === edge.toNodeId)?.label === 'discard'
		&& edge.kind === 'ordering'
	)), true);
});

test('compile rejects reading an imported texture after discard', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importTexture(texture('imported', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'imported', exposedUsage: textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING });
	graph.render({
		label: 'discard',
		sideEffect: true,
		colorAttachments: [{ target: imported, loadOp: 'clear', storeOp: 'discard' }],
	});
	graph.command({
		label: 'reader',
		sideEffect: true,
		uses: [graph.use(imported, TextureAccess.Sampled)],
	});

	assert.throws(() => graph.compile({ report: true }).compilationReport, /read after its value was discarded/);
});

test('compile rejects reading a discarded MSAA source after resolve', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const colorAttachment = graph.createTexture({ label: 'scene-color-msaa', format: 'rgba16float', size: [4, 4], sampleCount: 4 });
	const color = graph.createTexture({ label: 'scene-color', format: 'rgba16float', size: [4, 4] });
	graph.render({
		label: 'scene.clear',
		colorAttachments: [{ target: colorAttachment, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'scene.resolve',
		colorAttachments: [{
			target: colorAttachment,
			resolveTarget: color,
			loadOp: 'load',
			storeOp: 'discard',
		}],
	});
	graph.command({
		label: 'scene.read-msaa',
		sideEffect: true,
		uses: [graph.use(colorAttachment, TextureAccess.Sampled)],
	});
	graph.markOutput(color);

	assert.throws(() => graph.compile({ report: true }).compilationReport, /read after its value was discarded/);
});

test('compile orders an imported initial-value reader before a later graph writer', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importTexture(texture('imported', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'imported', exposedUsage: textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING });
	const backbuffer = graph.importSwapchainTexture(texture('backbuffer', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'backbuffer', exposedUsage: textureUsage.RENDER_ATTACHMENT });

	graph.render({
		label: 'consumer',
		uses: [graph.use(imported, TextureAccess.Sampled)],
		colorAttachments: [{ target: backbuffer, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'producer',
		colorAttachments: [{ target: imported, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markPresent(backbuffer);
	graph.markOutput(imported);

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), ['consumer', 'producer']);
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	})), [{
		from: 'consumer',
		to: 'producer',
		kind: 'ordering',
		resource: 'imported',
	}]);
});

test('compile orders an imported buffer initial-value reader before a later graph writer', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importBuffer(buffer('imported-buffer', bufferUsage.STORAGE), {
		label: 'imported-buffer',
		exposedSize: 16,
		exposedUsage: bufferUsage.STORAGE,
	});
	const read = graph.use(imported, BufferAccess.StorageRead);
	graph.command({ label: 'consumer', sideEffect: true, uses: [read] });
	const write = graph.use(imported, BufferAccess.StorageWrite, { contents: 'overwrite' });
	graph.command({ label: 'producer', sideEffect: false, uses: [write] });
	graph.markOutput(imported);

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), ['consumer', 'producer']);
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		kind: edge.kind,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	})), [{
		from: 'consumer',
		to: 'producer',
		kind: 'ordering',
		resource: 'imported-buffer',
	}]);
});

test('a later imported texture writer is culled when only the initial-value reader is rooted', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const imported = graph.importTexture(texture('imported', undefined, { format: 'rgba8unorm', size: [1, 1] }), { label: 'imported', exposedUsage: textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING });
	graph.command({
		label: 'consumer',
		sideEffect: true,
		uses: [graph.use(imported, TextureAccess.Sampled)],
	});
	graph.render({
		label: 'producer',
		colorAttachments: [{ target: imported, loadOp: 'clear', storeOp: 'store' }],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), ['consumer']);
	assert.deepEqual(compiled.culledNodes.map((node) => node.label), ['producer']);
});

test('compile rejects load from unproduced transient texture', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const color = graph.createTexture({ label: 'color', format: 'rgba8unorm', size: [1, 1] });

	graph.render({
		label: 'load-color',
		colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
	});
	graph.markOutput(color);

	assert.throws(() => graph.compile({ report: true }).compilationReport, /before it is produced/);
});

test('compile orders an app-owned no-draw resolve pass after the MSAA producer', () => {
	const captured: GPURenderPassDescriptor[] = [];
	const commandEncoder = mockCommandEncoder({
		beginRenderPass(desc: GPURenderPassDescriptor) {
			captured.push(desc);
			return { end() {} };
		},
	});
	const graph = new FrameGraph(mockDevice(commandEncoder)).beginFrame();
	const colorAttachment = graph.createTexture({ label: 'scene-color-msaa', format: 'rgba16float', size: [4, 4], sampleCount: 4 });
	const color = graph.createTexture({ label: 'scene-color', format: 'rgba16float', size: [4, 4] });

	graph.render({
		label: 'scene.clear',
		colorAttachments: [{ target: colorAttachment, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.render({
		label: 'scene.resolve',
		colorAttachments: [{
			target: colorAttachment,
			resolveTarget: color,
			loadOp: 'load',
			storeOp: 'discard',
		}],
	});
	graph.markOutput(color);

	const compiled = graph.compile({ report: true });
	assert.deepEqual(compiled.compilationReport.nodes.map((node) => node.label), ['scene.clear', 'scene.resolve']);
	compiled.execute();
	const resolve = captured.find((desc) => desc.label === 'scene.resolve')?.colorAttachments[0];
	assert.equal(resolve?.loadOp, 'load');
	assert.equal(resolve?.storeOp, 'discard');
	assert.notEqual(resolve?.resolveTarget, undefined);
});

test('compile treats a stored MSAA attachment with a resolve target as a producer', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const colorAttachment = graph.createTexture({ label: 'scene-color-msaa', format: 'rgba16float', size: [4, 4], sampleCount: 4 });
	const color = graph.createTexture({ label: 'scene-color', format: 'rgba16float', size: [4, 4] });

	graph.render({
		label: 'scene.render-and-resolve',
		colorAttachments: [{
			target: colorAttachment,
			resolveTarget: color,
			loadOp: 'clear',
			storeOp: 'store',
		}],
	});
	graph.command({
		label: 'scene.read-msaa',
		sideEffect: true,
		uses: [graph.use(colorAttachment, TextureAccess.Sampled)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), [
		'scene.render-and-resolve',
		'scene.read-msaa',
	]);
	assert.deepEqual(compiled.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	})), [{
		from: 'scene.render-and-resolve',
		to: 'scene.read-msaa',
		resource: 'scene-color-msaa',
	}]);
});

test('compile retains a resolve pass when its stored MSAA attachment is marked as output', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const colorAttachment = graph.createTexture({ label: 'scene-color-msaa', format: 'rgba16float', size: [4, 4], sampleCount: 4 });
	const color = graph.createTexture({ label: 'scene-color', format: 'rgba16float', size: [4, 4] });

	graph.render({
		label: 'scene.render-and-resolve',
		colorAttachments: [{
			target: colorAttachment,
			resolveTarget: color,
			loadOp: 'clear',
			storeOp: 'store',
		}],
	});
	graph.markOutput(colorAttachment);

	assert.deepEqual(graph.compile({ report: true }).compilationReport.nodes.map((node) => node.label), ['scene.render-and-resolve']);
});

test('copy node derives copy usage without inferring CPU mapping capability', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 64, exposedUsage: bufferUsage.COPY_SRC });
	const destination = graph.createBuffer({ label: 'destination', size: 64 });

	graph.copy({
		label: 'copy',
		operations: [{ type: 'buffer-to-buffer', source, destination, size: 64 }],
	});
	graph.markOutput(destination);

	const compiled = graph.compile({ report: true }).compilationReport;
	const destinationInfo = compiled.resources.find((resource) => resource.id === destination.id);

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['copy']);
	assert.equal((destinationInfo?.usage ?? 0) & bufferUsage.COPY_DST, bufferUsage.COPY_DST);
	assert.equal((destinationInfo?.usage ?? 0) & bufferUsage.MAP_READ, 0);
});

test('copy node tracks texture subresource ranges', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const source = graph.importTexture({
		...texture('source', textureUsage.COPY_SRC),
		width: 8,
		height: 8,
		depthOrArrayLayers: 2,
		mipLevelCount: 3,
	} as GPUTexture, { label: 'source', exposedUsage: textureUsage.COPY_SRC });
	const destination = graph.createTexture({ label: 'destination', format: 'rgba8unorm', size: [8, 8, 2], mipLevelCount: 3 });

	graph.copy({
		label: 'copy-mip-layer',
		operations: [{
			type: 'texture-to-texture',
			source,
			destination,
			sourceMipLevel: 1,
			destinationMipLevel: 2,
			sourceOrigin: [0, 0, 1],
			destinationOrigin: [0, 0, 1],
			copySize: [2, 2, 1],
		}],
	});
	graph.markOutput(destination);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;

	assert.deepEqual(
		debug.accesses.map((access) => access.textureRegion),
		[
			{ baseMipLevel: 1, mipLevelCount: 1, baseArrayLayer: 1, arrayLayerCount: 1, aspect: 'all' },
			{ baseMipLevel: 2, mipLevelCount: 1, baseArrayLayer: 1, arrayLayerCount: 1, aspect: 'all' },
		],
	);
});

test('copy and clear inference reports exact overwrite or conservative texture preserve', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), {
			exposedSize: 16,
			exposedUsage: bufferUsage.COPY_SRC,
		});
		const copied = graph.createBuffer({ label: 'copied', size: 16 });
		const cleared = graph.createBuffer({ label: 'cleared', size: 16 });
		graph.copy({ label: 'copy-buffer', sideEffect: true, operations: [{ type: 'buffer-to-buffer', source, destination: copied, sourceOffset: 4, destinationOffset: 8, size: 4 }] });
		graph.clearBuffer({ label: 'clear-buffer', sideEffect: true, operations: [{ target: cleared, offset: 4, size: 8 }] });
		const writes = graph.compile({ report: true }).compilationReport.accesses.filter((access) => access.mode === 'write');
		assert.deepEqual(writes.map((access) => ({
			access: access.access,
			contents: access.contents,
			range: access.bufferRange,
		})), [
			{ access: BufferAccess.CopyDst, contents: 'overwrite', range: { offset: 8, size: 4 } },
			{ access: BufferAccess.CopyDst, contents: 'overwrite', range: { offset: 4, size: 8 } },
		]);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const source = graph.importTexture(texture('source', textureUsage.COPY_SRC, { format: 'rgba8unorm', size: [4, 4] }), {
			exposedUsage: textureUsage.COPY_SRC,
		});
		const fullDestination = graph.createTexture({ label: 'full-destination', format: 'rgba8unorm', size: [4, 4] });
		const partialDestination = graph.importTexture(texture('partial-destination', textureUsage.COPY_DST, { format: 'rgba8unorm', size: [4, 4] }), {
			exposedUsage: textureUsage.COPY_DST,
		});
		graph.copy({
			label: 'full-copy',
			sideEffect: true,
			operations: [{ type: 'texture-to-texture', source, destination: fullDestination, copySize: [4, 4] }],
		});
		graph.copy({
			label: 'partial-copy',
			sideEffect: true,
			operations: [{ type: 'texture-to-texture', source, destination: partialDestination, copySize: [2, 2] }],
		});
		const report = graph.compile({ report: true }).compilationReport;
		const labelsById = new Map(report.nodes.map((node) => [node.id, node.label]));
		assert.deepEqual(
			report.accesses
				.filter((access) => access.mode === 'write')
				.map((access) => ({ node: labelsById.get(access.nodeId), contents: access.contents })),
			[
				{ node: 'full-copy', contents: 'overwrite' },
				{ node: 'partial-copy', contents: 'preserve' },
			],
		);
	}
});

test('clear buffer node orders mutable buffer writes before compute and indirect reads', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const args = graph.createBuffer({ label: 'indirect-args', size: 64 });

	graph.clearBuffer({
		label: 'clear-args',
		operations: [{ target: args, size: 64 }],
	});
	graph.compute({
		label: 'visibility',
		uses: [graph.use(args, BufferAccess.StorageRead), graph.use(args, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.command({
		label: 'draw',
		sideEffect: true,
		uses: [graph.use(args, BufferAccess.Indirect)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const clearNode = compiled.nodes.find((node) => node.label === 'clear-args')!;
	const visibilityNode = compiled.nodes.find((node) => node.label === 'visibility')!;
	const drawNode = compiled.nodes.find((node) => node.label === 'draw')!;
	const argsInfo = compiled.resources.find((resource) => resource.id === args.id);

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['clear-args', 'visibility', 'draw']);
	assert.deepEqual(debug.dependencies, [
		{ fromNodeId: clearNode.id, toNodeId: visibilityNode.id, resourceId: args.id, kind: 'value' },
		{ fromNodeId: visibilityNode.id, toNodeId: drawNode.id, resourceId: args.id, kind: 'value' },
	]);
	assert.equal((argsInfo?.usage ?? 0) & bufferUsage.COPY_DST, bufferUsage.COPY_DST);
	assert.equal((argsInfo?.usage ?? 0) & bufferUsage.STORAGE, bufferUsage.STORAGE);
	assert.equal((argsInfo?.usage ?? 0) & bufferUsage.INDIRECT, bufferUsage.INDIRECT);
});

test('buffer access dependency analysis uses declared ranges', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.importBuffer(buffer('target', bufferUsage.STORAGE), { label: 'target', exposedSize: 64, exposedUsage: bufferUsage.STORAGE });

	graph.command({
		label: 'write-low',
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 4 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'read-high',
		uses: [graph.use(target, BufferAccess.StorageRead, { range: { offset: 8, size: 4 } })],
	});
	graph.command({
		label: 'read-low',
		uses: [graph.use(target, BufferAccess.StorageRead, { range: { offset: 2, size: 4 } })],
	});
	graph.command({
		label: 'write-high',
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 8, size: 4 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'read-all',
		uses: [graph.use(target, BufferAccess.StorageRead)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const nodeId = (label: string) => compiled.nodes.find((node) => node.label === label)!.id;
	const edges = debug.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
		kind: edge.kind,
	}));

	assert.deepEqual(edges, [
		{ from: 'write-low', to: 'read-low', resource: 'target', kind: 'value' },
		{ from: 'read-high', to: 'write-high', resource: 'target', kind: 'ordering' },
		{ from: 'write-low', to: 'read-all', resource: 'target', kind: 'value' },
		{ from: 'write-high', to: 'read-all', resource: 'target', kind: 'value' },
	]);
	assert.deepEqual(
		debug.accesses
			.filter((access) => access.resourceId === target.id)
			.map((access) => ({
				node: compiled.nodes.find((candidate) => candidate.id === access.nodeId)?.label,
				mode: access.mode,
				bufferRange: access.bufferRange,
			})),
		[
			{ node: 'write-low', mode: 'write', bufferRange: { offset: 0, size: 4 } },
			{ node: 'read-high', mode: 'read', bufferRange: { offset: 8, size: 4 } },
			{ node: 'read-low', mode: 'read', bufferRange: { offset: 2, size: 4 } },
			{ node: 'write-high', mode: 'write', bufferRange: { offset: 8, size: 4 } },
			{ node: 'read-all', mode: 'read', bufferRange: { offset: 0, size: 64 } },
		],
	);
	assert.equal(nodeId('read-high') < nodeId('write-high'), true);
});

test('buffer preserve consumes only previous writers intersecting its declared range', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.createBuffer({ label: 'target', size: 16 });
	const lowWrite = graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 8 }, contents: 'overwrite' });
	graph.command({ label: 'low-write', sideEffect: false, uses: [lowWrite] });
	const highWrite = graph.use(target, BufferAccess.StorageWrite, { range: { offset: 8, size: 8 }, contents: 'overwrite' });
	graph.command({ label: 'high-write', sideEffect: false, uses: [highWrite] });
	const preserveLow = graph.use(target, BufferAccess.StorageWrite, {
		range: { offset: 2, size: 4 },
		contents: 'preserve',
	});
	graph.command({ label: 'preserve-low', sideEffect: true, uses: [preserveLow] });

	const report = graph.compile({ report: true }).compilationReport;
	const labelsById = new Map(report.nodes.map((node) => [node.id, node.label]));
	assert.deepEqual(report.nodes.map((node) => node.label), ['low-write', 'preserve-low']);
	assert.deepEqual(report.culledNodes.map((node) => node.label), ['high-write']);
	assert.deepEqual(report.dependencies.map((edge) => ({
		from: labelsById.get(edge.fromNodeId),
		to: labelsById.get(edge.toNodeId),
		kind: edge.kind,
	})), [{ from: 'low-write', to: 'preserve-low', kind: 'value' }]);
});

test('partially overwritten buffer ranges only retain the latest writer for covered reads', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.createBuffer({ label: 'target', size: 1024 });

	graph.command({
		label: 'A',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 1024 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'B',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 256, size: 256 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'C',
		sideEffect: true,
		uses: [graph.use(target, BufferAccess.StorageRead, { range: { offset: 256, size: 256 } })],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const nodeLabel = (nodeId: number) => [...compiled.nodes, ...compiled.culledNodes].find((node) => node.id === nodeId)?.label;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['B', 'C']);
	assert.deepEqual(compiled.culledNodes.map((node) => node.label), ['A']);
	assert.deepEqual(
		debug.dependencies
			.filter((edge) => edge.kind === 'value')
			.map((edge) => ({ from: nodeLabel(edge.fromNodeId), to: nodeLabel(edge.toNodeId) })),
		[{ from: 'B', to: 'C' }],
	);
});

test('full buffer reads depend on all writers left visible after a partial overwrite', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.createBuffer({ label: 'target', size: 1024 });

	graph.command({
		label: 'A',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 1024 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'B',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 256, size: 256 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'C',
		sideEffect: true,
		uses: [graph.use(target, BufferAccess.StorageRead)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const nodeLabel = (nodeId: number) => compiled.nodes.find((node) => node.id === nodeId)?.label;

	assert.deepEqual(
		debug.dependencies
			.filter((edge) => edge.kind === 'value')
			.map((edge) => ({ from: nodeLabel(edge.fromNodeId), to: nodeLabel(edge.toNodeId) })),
		[
			{ from: 'A', to: 'C' },
			{ from: 'B', to: 'C' },
		],
	);
});

test('nested partial buffer overwrites preserve each visible writer', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.createBuffer({ label: 'target', size: 1024 });

	graph.command({
		label: 'A',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 1024 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'B',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 256, size: 512 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'C',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 384, size: 128 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'D',
		sideEffect: true,
		uses: [graph.use(target, BufferAccess.StorageRead)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const nodeLabel = (nodeId: number) => compiled.nodes.find((node) => node.id === nodeId)?.label;

	assert.deepEqual(
		debug.dependencies
			.filter((edge) => edge.kind === 'value')
			.map((edge) => ({ from: nodeLabel(edge.fromNodeId), to: nodeLabel(edge.toNodeId) })),
		[
			{ from: 'A', to: 'D' },
			{ from: 'B', to: 'D' },
			{ from: 'C', to: 'D' },
		],
	);
});

test('partially overwritten pending buffer readers keep ordering for uncovered bytes', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const gate = graph.createBuffer({ label: 'gate', size: 4 });
	const target = graph.importBuffer({
		...buffer('target', bufferUsage.STORAGE),
		size: 1024,
	}, { label: 'target', exposedSize: 1024, exposedUsage: bufferUsage.STORAGE });

	graph.command({
		label: 'P',
		sideEffect: false,
		uses: [graph.use(gate, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.command({
		label: 'R',
		sideEffect: true,
		uses: [graph.use(gate, BufferAccess.StorageRead), graph.use(target, BufferAccess.StorageRead, { range: { offset: 0, size: 512 } })],
	});
	graph.command({
		label: 'W1',
		sideEffect: true,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 256, size: 512 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'W2',
		sideEffect: true,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 256 }, contents: 'overwrite' })],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const nodeLabel = (nodeId: number) => compiled.nodes.find((node) => node.id === nodeId)?.label;
	const nodeOrder = (label: string) => compiled.nodes.findIndex((node) => node.label === label);

	assert.deepEqual(
		debug.dependencies
			.filter((edge) => edge.kind === 'ordering' && edge.resourceId === target.id)
			.map((edge) => ({ from: nodeLabel(edge.fromNodeId), to: nodeLabel(edge.toNodeId) })),
		[
			{ from: 'R', to: 'W1' },
			{ from: 'R', to: 'W2' },
		],
	);
	assert.equal(nodeOrder('R') < nodeOrder('W1'), true);
	assert.equal(nodeOrder('R') < nodeOrder('W2'), true);
});

test('buffer ordering hazards do not retain overwritten pure readers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.importBuffer(buffer('target', bufferUsage.STORAGE), { label: 'target', exposedSize: 64, exposedUsage: bufferUsage.STORAGE });

	graph.command({
		label: 'pure-reader',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageRead)],
	});
	graph.command({
		label: 'writer',
		uses: [graph.use(target, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.markOutput(target);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const writerNode = compiled.nodes.find((node) => node.label === 'writer')!;
	const culledReader = compiled.culledNodes.find((node) => node.label === 'pure-reader')!;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['writer']);
	assert.ok(culledReader);
	assert.equal(debug.dependencies.some((edge) => edge.fromNodeId === culledReader.id && edge.toNodeId === writerNode.id), false);
});

test('marked buffer output retains only final fully-overwriting ranged writer when no later reads need earlier value', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.createBuffer({
		label: 'target',
		size: 64,
		usage: bufferUsage.STORAGE,
	});

	graph.command({
		label: 'old-writer',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 16 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'final-writer',
		sideEffect: false,
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 16 }, contents: 'overwrite' })],
	});
	graph.markOutput(target);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const finalWriter = compiled.nodes.find((node) => node.label === 'final-writer')!;
	const culledOldWriter = compiled.culledNodes.find((node) => node.label === 'old-writer')!;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['final-writer']);
	assert.ok(culledOldWriter);
	assert.equal(debug.dependencies.some((edge) => edge.fromNodeId === culledOldWriter.id && edge.toNodeId === finalWriter.id), false);
});

test('compile rejects transient buffer reads that are not fully covered by producers', () => {
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const target = graph.createBuffer({ label: 'target', size: 64 });

		graph.command({
			label: 'write-low',
			uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 4 }, contents: 'overwrite' })],
		});
		graph.command({
			label: 'read-partial-gap',
			sideEffect: true,
			uses: [graph.use(target, BufferAccess.StorageRead, { range: { offset: 2, size: 8 } })],
		});

		assert.throws(() => graph.compile({ report: true }).compilationReport, /read before it is produced/);
	}
	{
		const graph = new FrameGraph(mockDevice()).beginFrame();
		const target = graph.createBuffer({ label: 'target', size: 64 });

		graph.command({
			label: 'write-low',
			uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 4 }, contents: 'overwrite' })],
		});
		graph.command({
			label: 'read-all',
			sideEffect: true,
			uses: [graph.use(target, BufferAccess.StorageRead)],
		});

		assert.throws(() => graph.compile({ report: true }).compilationReport, /read before it is produced/);
	}
});

test('compile allows transient buffer reads covered by multiple non-overlapping producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.createBuffer({ label: 'target', size: 64 });

	graph.command({
		label: 'write-low',
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 4 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'write-high',
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 4, size: 4 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'read-both',
		sideEffect: true,
		uses: [graph.use(target, BufferAccess.StorageRead, { range: { offset: 0, size: 8 } })],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const edges = debug.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	}));

	assert.deepEqual(edges, [
		{ from: 'write-low', to: 'read-both', resource: 'target' },
		{ from: 'write-high', to: 'read-both', resource: 'target' },
	]);
});

test('compile does not require imported buffer reads to be covered by graph producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const target = graph.importBuffer(buffer('target', bufferUsage.STORAGE), { label: 'target', exposedSize: 64, exposedUsage: bufferUsage.STORAGE });

	graph.command({
		label: 'write-low',
		uses: [graph.use(target, BufferAccess.StorageWrite, { range: { offset: 0, size: 4 }, contents: 'overwrite' })],
	});
	graph.command({
		label: 'read-partial-gap',
		sideEffect: true,
		uses: [graph.use(target, BufferAccess.StorageRead, { range: { offset: 2, size: 8 } })],
	});

	assert.deepEqual(graph.compile({ report: true }).compilationReport.nodes.map((node) => node.label), ['write-low', 'read-partial-gap']);
});

test('debug dependency edges preserve multiple resource causes for the same node pair', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const first = graph.createBuffer({ label: 'first', size: 64 });
	const second = graph.createBuffer({ label: 'second', size: 64 });

	graph.command({
		label: 'producer',
		uses: [
			graph.use(first, BufferAccess.StorageWrite, { contents: 'overwrite' }),
			graph.use(second, BufferAccess.StorageWrite, { contents: 'overwrite' }),
		],
	});
	graph.command({
		label: 'consumer',
		sideEffect: true,
		uses: [graph.use(first, BufferAccess.StorageRead), graph.use(second, BufferAccess.StorageRead)],
	});

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;
	const edges = debug.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
	}));

	assert.deepEqual(edges, [
		{ from: 'producer', to: 'consumer', resource: 'first' },
		{ from: 'producer', to: 'consumer', resource: 'second' },
	]);
});

test('buffer roots retain the last writer and preceding mutable buffer dependencies', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const readback = graph.importBuffer(
		buffer('readback', bufferUsage.COPY_DST | bufferUsage.MAP_READ),
		{ label: 'readback' },
	);
	const source = graph.importBuffer(buffer('source', bufferUsage.COPY_SRC), { label: 'source', exposedSize: 64, exposedUsage: bufferUsage.COPY_SRC });

	graph.clearBuffer({
		label: 'clear',
		operations: [{ target: readback }],
	});
	graph.copy({
		label: 'copy',
		operations: [{ type: 'buffer-to-buffer', source, destination: readback, size: 16 }],
	});
	graph.markReadback(readback);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['clear', 'copy']);
	assert.deepEqual(debug.dependencies.map((edge) => ({
		from: compiled.nodes.find((node) => node.id === edge.fromNodeId)?.label,
		to: compiled.nodes.find((node) => node.id === edge.toNodeId)?.label,
		resource: compiled.resources.find((resource) => resource.id === edge.resourceId)?.label,
		kind: edge.kind,
	})), [{ from: 'clear', to: 'copy', resource: 'readback', kind: 'ordering' }]);
	assert.deepEqual(
		debug.accesses
			.filter((access) => access.resourceId === readback.id || access.resourceId === source.id)
			.map((access) => ({
				resource: compiled.resources.find((resource) => resource.id === access.resourceId)?.label,
				access: access.access,
				mode: access.mode,
				bufferRange: access.bufferRange,
			})),
		[
			{ resource: 'readback', access: BufferAccess.CopyDst, mode: 'write', bufferRange: { offset: 0, size: 64 } },
			{ resource: 'source', access: BufferAccess.CopySrc, mode: 'read', bufferRange: { offset: 0, size: 16 } },
			{ resource: 'readback', access: BufferAccess.CopyDst, mode: 'write', bufferRange: { offset: 0, size: 16 } },
		],
	);
});

test('explicit readback and debug capture roots retain their producers', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const readback = graph.importBuffer(
		buffer('readback', bufferUsage.COPY_DST | bufferUsage.MAP_READ),
		{ label: 'readback' },
	);
	const debugTexture = graph.createTexture({ label: 'debug-texture', format: 'rgba8unorm', size: [1, 1] });

	graph.compute({
		label: 'produce-readback',
		uses: [graph.use(readback, BufferAccess.CopyDst, { contents: 'overwrite' })],
	});
	graph.render({
		label: 'produce-debug',
		colorAttachments: [{ target: debugTexture, loadOp: 'clear', storeOp: 'store' }],
	});
	graph.markReadback(readback);
	graph.markDebugCapture(debugTexture);

	const compiled = graph.compile({ report: true }).compilationReport;
	const debug = compiled;

	assert.deepEqual(compiled.nodes.map((node) => node.label), ['produce-readback', 'produce-debug']);
	assert.deepEqual(
		debug.roots.map((root) => ({ reason: root.reason, resource: compiled.resources.find((resource) => resource.id === root.resourceId)?.label })),
		[
			{ reason: 'readback', resource: 'readback' },
			{ reason: 'debug-capture', resource: 'debug-texture' },
		],
	);
});

test('compile keeps retained nodes on their recorded side of external submission boundaries', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const token = graph.createBuffer({ label: 'token', size: 4 });

	graph.command({
		label: 'producer',
		uses: [graph.use(token, BufferAccess.StorageWrite, { contents: 'overwrite' })],
	});
	graph.command({
		label: 'dependent-before-boundary',
		uses: [graph.use(token, BufferAccess.StorageRead)],
	});
	graph.externalSubmission({
		label: 'external',
		submit() {},
	});
	graph.command({ label: 'after-boundary', encode() {} });

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.nodes.map((node) => node.label), [
		'producer',
		'dependent-before-boundary',
		'external',
		'after-boundary',
	]);
	assert.deepEqual(compiled.executionSegments.map((segment) => ({
		kind: segment.kind,
		nodes: segment.nodeIds.map((nodeId) => compiled.nodes.find((node) => node.id === nodeId)?.label),
	})), [
		{ kind: 'frame-graph', nodes: ['producer', 'dependent-before-boundary'] },
		{ kind: 'external-submission', nodes: ['external'] },
		{ kind: 'frame-graph', nodes: ['after-boundary'] },
	]);
});

test('compile rejects a transient consumer recorded before its producer across an external submission boundary', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const futureOutput = graph.createTexture({
		label: 'future-output',
		format: 'rgba8unorm',
		size: [1, 1],
	});
	graph.command({
		label: 'recorded-before',
		uses: [graph.use(futureOutput, TextureAccess.Sampled)],
	});
	graph.externalSubmission({ label: 'external', submit() {} });
	graph.command({
		label: 'recorded-after',
		uses: [graph.use(futureOutput, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' })],
	});

	assert.throws(
		() => graph.compile({ report: true }).compilationReport,
		/read before it is produced/,
	);
});

test('culled external submissions do not split retained FrameGraph work', () => {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	graph.command({ label: 'before', encode() {} });
	graph.externalSubmission({ label: 'culled-external', sideEffect: false, submit() {} });
	graph.command({ label: 'after', encode() {} });

	const compiled = graph.compile({ report: true }).compilationReport;
	assert.deepEqual(compiled.culledNodes.map((node) => node.label), ['culled-external']);
	assert.deepEqual(compiled.executionSegments.map((segment) => ({ kind: segment.kind, nodeIds: segment.nodeIds })), [{
		kind: 'frame-graph',
		nodeIds: compiled.nodes.map((node) => node.id),
	}]);
});

type LayerSegment = {
	readonly baseArrayLayer: number;
	readonly arrayLayerCount: number;
};

type BufferOracleOperation = {
	readonly kind: 'read' | 'overwrite' | 'preserve';
	readonly offset: number;
	readonly size: number;
};

type TextureOracleOperation = {
	readonly kind: 'read' | 'overwrite' | 'preserve' | 'read-overwrite' | 'discard';
	readonly baseMipLevel: number;
	readonly mipLevelCount: number;
	readonly baseArrayLayer: number;
	readonly arrayLayerCount: number;
};

type DependencyRandom = () => number;

const DEPENDENCY_PROPERTY_SEEDS = [0x5eed1234, 0x00c0ffee, 0x9e3779b9] as const;

function createDependencyRandom(seed: number): DependencyRandom {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ value >>> 15, value | 1);
		value ^= value + Math.imul(value ^ value >>> 7, value | 61);
		return ((value ^ value >>> 14) >>> 0) / 0x100000000;
	};
}

function randomDependencyInteger(
	random: DependencyRandom,
	minimum: number,
	maximum: number,
): number {
	return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function randomLayerPartition(random: DependencyRandom, layerCount: number): LayerSegment[] {
	const segments: LayerSegment[] = [];
	let baseArrayLayer = 0;
	while (baseArrayLayer < layerCount) {
		const arrayLayerCount = randomDependencyInteger(random, 1, layerCount - baseArrayLayer);
		segments.push({ baseArrayLayer, arrayLayerCount });
		baseArrayLayer += arrayLayerCount;
	}
	return segments;
}

function compileLayerProducerCoverage(
	segments: readonly LayerSegment[],
): {
	readonly producerLabels: readonly (string | number)[];
	readonly dependencySources: readonly (string | number)[];
} {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	const layerCount = segments.reduce(
		(maximum, segment) => Math.max(maximum, segment.baseArrayLayer + segment.arrayLayerCount),
		0,
	);
	const target = graph.createTexture({
		label: 'layered-target',
		format: 'rgba8unorm',
		size: [1, 1, layerCount],
	});
	const readerUse = graph.use(target, TextureAccess.Sampled);
	const addReader = () => graph.command({ label: 'reader', sideEffect: true, uses: [readerUse] });
	const producerLabels = segments.map((_, index) => `producer-${index}`);
	const addProducers = () => {
		for (const [index, segment] of segments.entries()) {
			const view = graph.createTextureView(target, {
				dimension: '2d-array',
				baseArrayLayer: segment.baseArrayLayer,
				arrayLayerCount: segment.arrayLayerCount,
			});
			graph.command({
				label: producerLabels[index],
				sideEffect: false,
				uses: [graph.use(view, TextureAccess.StorageWrite, { contents: 'overwrite' })],
			});
		}
	};

	addProducers();
	addReader();

	const compiled = graph.compile({ report: true }).compilationReport;
	const labelsById = new Map(compiled.nodes.map((node) => [node.id, node.label ?? node.id]));
	const readerId = compiled.nodes.find((node) => node.label === 'reader')!.id;
	return {
		producerLabels,
		dependencySources: compiled.dependencies
			.filter((edge) => edge.resourceId === target.id && edge.toNodeId === readerId && edge.kind === 'value')
			.map((edge) => labelsById.get(edge.fromNodeId)!)
			.sort(),
	};
}

function dependencyEdgeKeys(
	compiled: FrameGraphCompilationReport,
	resourceId: number,
): string[] {
	const labelsById = new Map(compiled.nodes.map((node) => [node.id, node.label ?? node.id]));
	return compiled.dependencies
		.filter((edge) => edge.resourceId === resourceId)
		.map((edge) => `${labelsById.get(edge.fromNodeId)}->${labelsById.get(edge.toNodeId)}:${edge.kind}`)
		.sort();
}

function addOracleEdge(
	edges: Set<string>,
	from: string | undefined,
	to: string,
	kind: 'value' | 'ordering',
): void {
	if (from !== undefined && from !== to) {
		const prefix = `${from}->${to}:`;
		if (kind === 'value') {
			edges.delete(`${prefix}ordering`);
			edges.add(`${prefix}value`);
		}
		else if (!edges.has(`${prefix}value`)) {
			edges.add(`${prefix}ordering`);
		}
	}
}

test('segmented texture producers provide the same reader coverage as a whole producer', () => {
	const layerCount = 8;
	for (const seed of DEPENDENCY_PROPERTY_SEEDS) {
		const random = createDependencyRandom(seed);
		for (let iteration = 0; iteration < 20; iteration++) {
			const segments = randomLayerPartition(random, layerCount);
			const context = `seed=${seed} iteration=${iteration} segments=${JSON.stringify(segments)}`;
			const whole = compileLayerProducerCoverage([{
				baseArrayLayer: 0,
				arrayLayerCount: layerCount,
			}]);
			const segmented = compileLayerProducerCoverage(segments);

			assert.deepEqual(whole.dependencySources, whole.producerLabels, `${context}: whole`);
			assert.deepEqual(
				segmented.dependencySources,
				[...segmented.producerLabels].sort(),
				`${context}: segmented`,
			);
		}
	}
});

test('segmented texture producer coverage preserves gaps and permits overlapping overwrites', () => {
	const incomplete = new FrameGraph(mockDevice()).beginFrame();
	const incompleteTarget = incomplete.createTexture({
		label: 'incomplete-target',
		format: 'rgba8unorm',
		size: [1, 1, 8],
	});
	for (const segment of [
		{ baseArrayLayer: 0, arrayLayerCount: 3 },
		{ baseArrayLayer: 4, arrayLayerCount: 4 },
	]) {
		const view = incomplete.createTextureView(incompleteTarget, {
			dimension: '2d-array',
			...segment,
		});
		incomplete.command({
			sideEffect: false,
			uses: [incomplete.use(view, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		});
	}
	incomplete.command({
		label: 'reader',
		uses: [incomplete.use(incompleteTarget, TextureAccess.Sampled)],
	});
	assert.throws(
		() => incomplete.compile({ report: true }).compilationReport,
		/read before it is produced for the full declared range/,
	);

	const overlapping = new FrameGraph(mockDevice()).beginFrame();
	const overlappingTarget = overlapping.createTexture({
		label: 'overlapping-target',
		format: 'rgba8unorm',
		size: [1, 1, 8],
	});
	for (const [index, segment] of [
		{ baseArrayLayer: 0, arrayLayerCount: 5 },
		{ baseArrayLayer: 4, arrayLayerCount: 4 },
	].entries()) {
		const view = overlapping.createTextureView(overlappingTarget, {
			dimension: '2d-array',
			...segment,
		});
		overlapping.command({
			label: `writer-${index}`,
			sideEffect: false,
			uses: [overlapping.use(view, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		});
	}
	overlapping.markOutput(overlappingTarget);
	assert.deepEqual(
		overlapping.compile({ report: true }).compilationReport.nodes.map((node) => node.label),
		['writer-0', 'writer-1'],
	);

});

test('fixed-seed buffer graphs match a byte-level dependency oracle', () => {
	for (const seed of DEPENDENCY_PROPERTY_SEEDS) {
		const random = createDependencyRandom(seed);
		for (let iteration = 0; iteration < 30; iteration++) {
			const byteLength = randomDependencyInteger(random, 8, 16);
			const operations: BufferOracleOperation[] = [{
				kind: 'overwrite',
				offset: 0,
				size: byteLength,
			}];
			for (let operationIndex = 1; operationIndex < 12; operationIndex++) {
				const offset = randomDependencyInteger(random, 0, byteLength - 1);
				const kindRoll = random();
				operations.push({
					kind: kindRoll < 0.4 ? 'read' : kindRoll < 0.7 ? 'overwrite' : 'preserve',
					offset,
					size: randomDependencyInteger(random, 1, byteLength - offset),
				});
			}

			const graph = new FrameGraph(mockDevice()).beginFrame();
			const target = graph.createBuffer({ label: 'oracle-buffer', size: byteLength });
			const lastWriter = Array<string | undefined>(byteLength).fill(undefined);
			const pendingReaders = Array.from({ length: byteLength }, () => new Set<string>());
			const expectedEdges = new Set<string>();
			for (const [operationIndex, operation] of operations.entries()) {
				const label = `node-${operationIndex}`;
				graph.command({
					label,
					sideEffect: true,
					uses: [
						operation.kind === 'read'
						? graph.use(target, BufferAccess.StorageRead, { range: { offset: operation.offset, size: operation.size } })
						: graph.use(target, BufferAccess.StorageWrite, {
							range: { offset: operation.offset, size: operation.size },
							contents: operation.kind,
						}),
					],
				});

				for (let byte = operation.offset; byte < operation.offset + operation.size; byte++) {
					if (operation.kind === 'read') {
						addOracleEdge(expectedEdges, lastWriter[byte], label, 'value');
						pendingReaders[byte]!.add(label);
						continue;
					}
					addOracleEdge(expectedEdges, lastWriter[byte], label, operation.kind === 'preserve' ? 'value' : 'ordering');
					for (const reader of pendingReaders[byte]!) {
						addOracleEdge(expectedEdges, reader, label, 'ordering');
					}
					lastWriter[byte] = label;
					pendingReaders[byte]!.clear();
				}
			}

			const context = `seed=${seed} iteration=${iteration} operations=${JSON.stringify(operations)}`;
			assert.deepEqual(
				dependencyEdgeKeys(graph.compile({ report: true }).compilationReport, target.id),
				[...expectedEdges].sort(),
				context,
			);
		}
	}
});

test('fixed-seed texture graphs match a subresource-cell dependency oracle', () => {
	const mipLevelCount = 3;
	const arrayLayerCount = 4;
	for (const seed of DEPENDENCY_PROPERTY_SEEDS) {
		const random = createDependencyRandom(seed);
		for (let iteration = 0; iteration < 30; iteration++) {
			const graph = new FrameGraph(mockDevice()).beginFrame();
			const target = graph.createTexture({
				label: 'oracle-texture',
				format: 'rgba8unorm',
				size: [4, 4, arrayLayerCount],
				mipLevelCount,
			});
			const lastWriter = Array.from(
				{ length: mipLevelCount },
				() => Array<string | undefined>(arrayLayerCount).fill(undefined),
			);
			const pendingReaders = Array.from(
				{ length: mipLevelCount },
				() => Array.from({ length: arrayLayerCount }, () => new Set<string>()),
			);
			const valid = Array.from(
				{ length: mipLevelCount },
				() => Array<boolean>(arrayLayerCount).fill(true),
			);
			const expectedEdges = new Set<string>();
			const operations: TextureOracleOperation[] = [];

			for (let mip = 0; mip < mipLevelCount; mip++) {
				const label = `initial-mip-${mip}`;
				const view = graph.createTextureView(target, {
					dimension: '2d-array',
					baseMipLevel: mip,
					mipLevelCount: 1,
					baseArrayLayer: 0,
					arrayLayerCount,
				});
				graph.command({
					label,
					sideEffect: true,
					uses: [graph.use(view, TextureAccess.StorageWrite, { contents: 'overwrite' })],
				});
				lastWriter[mip]!.fill(label);
			}

			for (let operationIndex = 0; operationIndex < 10; operationIndex++) {
				const baseMipLevel = randomDependencyInteger(random, 0, mipLevelCount - 1);
				const baseArrayLayer = randomDependencyInteger(random, 0, arrayLayerCount - 1);
				const kindRoll = random();
				const requestedKind: TextureOracleOperation['kind'] = kindRoll < 0.3
					? 'read'
					: kindRoll < 0.5 ? 'overwrite'
						: kindRoll < 0.68 ? 'preserve'
							: kindRoll < 0.84 ? 'read-overwrite' : 'discard';
				const requestedDiscard = requestedKind === 'discard';
				const requestedRead = requestedKind === 'read';
				const mipRangeCount = requestedRead
					? randomDependencyInteger(random, 1, mipLevelCount - baseMipLevel)
					: 1;
				const layerRangeCount = requestedDiscard
					? 1
					: randomDependencyInteger(random, 1, arrayLayerCount - baseArrayLayer);
				const rangeIsValid = Array.from({ length: mipRangeCount }, (_, mipOffset) => (
					Array.from({ length: layerRangeCount }, (_, layerOffset) => (
						valid[baseMipLevel + mipOffset]![baseArrayLayer + layerOffset]
					)).every(Boolean)
				)).every(Boolean);
				const kind = (requestedKind === 'read' || requestedKind === 'preserve' || requestedKind === 'read-overwrite') && !rangeIsValid
					? 'overwrite'
					: requestedKind;
				const operationMipCount = kind === 'overwrite' && requestedKind !== 'overwrite'
					? 1
					: mipRangeCount;
				const operation: TextureOracleOperation = {
					kind,
					baseMipLevel,
					mipLevelCount: operationMipCount,
					baseArrayLayer,
					arrayLayerCount: layerRangeCount,
				};
				operations.push(operation);
				const label = `node-${operationIndex}`;
				const view = graph.createTextureView(target, {
					dimension: kind === 'discard' ? '2d' : '2d-array',
					baseMipLevel: operation.baseMipLevel,
					mipLevelCount: operation.mipLevelCount,
					baseArrayLayer: operation.baseArrayLayer,
					arrayLayerCount: operation.arrayLayerCount,
				});
				if (operation.kind === 'discard') {
					graph.render({
						label,
						sideEffect: true,
						colorAttachments: [{ target: view, loadOp: 'clear', storeOp: 'discard' }],
					});
				}
				else {
					const operationUses = operation.kind === 'read'
						? [graph.use(view, TextureAccess.Sampled)]
						: operation.kind === 'read-overwrite'
							? [
								graph.use(view, TextureAccess.StorageRead),
								graph.use(view, TextureAccess.StorageWrite, { contents: 'overwrite' }),
							]
							: [graph.use(view, TextureAccess.StorageWrite, { contents: operation.kind })];
					graph.command({
						label,
						sideEffect: true,
						uses: operationUses,
					});
				}

				for (
					let mip = operation.baseMipLevel;
					mip < operation.baseMipLevel + operation.mipLevelCount;
					mip++
				) {
					for (
						let layer = operation.baseArrayLayer;
						layer < operation.baseArrayLayer + operation.arrayLayerCount;
						layer++
					) {
						if (operation.kind === 'read' || operation.kind === 'preserve' || operation.kind === 'read-overwrite') {
							addOracleEdge(expectedEdges, lastWriter[mip]![layer], label, 'value');
						}
						if (operation.kind === 'read' || operation.kind === 'read-overwrite') {
							pendingReaders[mip]![layer]!.add(label);
						}
						if (operation.kind !== 'read') {
							if (operation.kind === 'overwrite' || operation.kind === 'discard') {
								addOracleEdge(expectedEdges, lastWriter[mip]![layer], label, 'ordering');
							}
							for (const reader of pendingReaders[mip]![layer]!) {
								addOracleEdge(expectedEdges, reader, label, 'ordering');
							}
							lastWriter[mip]![layer] = label;
							valid[mip]![layer] = operation.kind !== 'discard';
							pendingReaders[mip]![layer]!.clear();
						}
					}
				}
			}

			const context = `seed=${seed} iteration=${iteration} operations=${JSON.stringify(operations)}`;
			assert.deepEqual(
				dependencyEdgeKeys(graph.compile({ report: true }).compilationReport, target.id),
				[...expectedEdges].sort(),
				context,
			);
		}
	}
});
