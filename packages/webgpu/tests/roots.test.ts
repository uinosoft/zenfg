import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameGraph, FrameGraphError, BufferAccess, TextureAccess } from '../src/index.ts';
import { mockDevice, buffer, bufferUsage, texture, textureUsage } from './testUtils.ts';
import { createFrameFlowVisualFixture } from './frameFlowVisualFixture.ts';

test('dense Frame Flow fixture exports real retained producers and initial-only root sources', () => {
	const snapshot = createFrameFlowVisualFixture();
	assert.equal(snapshot.graph.nodes.length, 27);
	const history = snapshot.graph.roots.find((root) => root.reason === 'persistent-state')!;
	assert.equal(history.resolution?.producerNodeIds.length, 2);
	assert.equal(history.resolution?.usesInitialContents, true);
	assert.equal(snapshot.graph.roots.filter((root) => root.resolution?.producerNodeIds.length === 0).length, 2);
});

test('buffer roots resolve mixed initial contents, multiple producers, distinct ranges and duplicates', () => {
	const frame = new FrameGraph(mockDevice()).beginFrame();
	const history = frame.importBuffer(buffer('history', bufferUsage.STORAGE), { exposedSize: 32, exposedUsage: bufferUsage.STORAGE });
	for (const offset of [0, 8]) frame.command({ label: `write-${offset}`, sideEffect: false,
		uses: [frame.use(history, BufferAccess.StorageWrite, { contents: 'overwrite', range: { offset, size: 8 } })] });
	frame.markOutput(history);
	frame.markOutput(history, { offset: 0, size: 32 });
	frame.markOutput(history, { offset: 0, size: 16 });
	frame.markOutput(history, { offset: 16 });
	frame.markDebugCapture(history, { offset: 8, size: 8 });
	const report = frame.compile({ report: true }).compilationReport;
	assert.equal(report.roots.length, 4);
	assert.deepEqual(report.roots.map((root) => root.resolution), [
		{ producerNodeIds: [1, 2], usesInitialContents: true },
		{ producerNodeIds: [1, 2], usesInitialContents: false },
		{ producerNodeIds: [], usesInitialContents: true },
		{ producerNodeIds: [2], usesInitialContents: false },
	]);
});

test('initial-only roots retain resources without inventing passes', () => {
	const frame = new FrameGraph(mockDevice()).beginFrame();
	const readback = frame.importBuffer(buffer('readback', bufferUsage.MAP_READ | bufferUsage.COPY_DST), { exposedSize: 16 });
	frame.markReadback(readback, { offset: 4, size: 8 });
	const report = frame.compile({ report: true }).compilationReport;
	assert.equal(report.nodes.length, 0);
	assert.equal(report.resources.length, 1);
	assert.deepEqual(report.roots[0]?.range, { kind: 'buffer', offset: 4, size: 8 });
	assert.deepEqual(report.roots[0]?.resolution, { producerNodeIds: [], usesInitialContents: true });
});

test('root coverage is enforced with or without reports, while unselected gaps are allowed', () => {
	for (const report of [false, true]) {
		const frame = new FrameGraph(mockDevice()).beginFrame();
		const target = frame.createBuffer({ size: 16 });
		frame.clearBuffer({ operations: [{ target, size: 8 }] });
		frame.markOutput(target);
		assert.throws(() => report ? frame.compile({ report: true }) : frame.compile(), (error) => error instanceof FrameGraphError && error.code === 'FG1004');
	}
	const frame = new FrameGraph(mockDevice()).beginFrame();
	const target = frame.createBuffer({ size: 16 });
	frame.clearBuffer({ operations: [{ target, size: 8 }] });
	frame.markOutput(target, { offset: 0, size: 8 });
	assert.doesNotThrow(() => frame.compile());
});

test('root ranges reject empty, unsafe and out-of-bounds declarations without changing empty accesses', () => {
	const frame = new FrameGraph(mockDevice()).beginFrame();
	const target = frame.createBuffer({ size: 16 });
	for (const range of [{ offset: 0, size: 0 }, { offset: 16 }, { offset: -1, size: 1 }, { offset: 8, size: 9 }, { offset: 0, size: NaN }]) {
		assert.throws(() => frame.markOutput(target, range), (error) => error instanceof FrameGraphError && error.code === 'FG1103');
	}
	assert.doesNotThrow(() => frame.use(target, BufferAccess.StorageRead, { range: { offset: 0, size: 0 } }));
});

test('texture roots select normalized views and distinguish initial from stored and discarded regions', () => {
	const frame = new FrameGraph(mockDevice()).beginFrame();
	const target = frame.importTexture(texture('history', textureUsage.RENDER_ATTACHMENT, { format: 'rgba8unorm', size: [8, 8, 2], mipLevelCount: 2 }), { exposedUsage: textureUsage.RENDER_ATTACHMENT });
	const written = frame.createTextureView(target, { baseMipLevel: 1, mipLevelCount: 1, baseArrayLayer: 1, arrayLayerCount: 1 });
	const same = frame.createTextureView(target, { baseMipLevel: 1, mipLevelCount: 1, baseArrayLayer: 1, arrayLayerCount: 1 });
	frame.render({ colorAttachments: [{ target: written, loadOp: 'clear', storeOp: 'store' }] });
	frame.markPersistentState(written);
	frame.markPersistentState(same);
	frame.markOutput(target);
	const report = frame.compile({ report: true }).compilationReport;
	assert.equal(report.roots.length, 2);
	assert.deepEqual(report.roots.map((root) => root.resolution?.usesInitialContents), [false, true]);
	assert.deepEqual(report.roots[0]?.range, { kind: 'texture', regions: [{ baseMipLevel: 1, mipLevelCount: 1, baseArrayLayer: 1, arrayLayerCount: 1, aspect: 'all' }] });
});

test('3d root normalization uses per-mip depth counts and retains all selected mip producers', () => {
	const frame = new FrameGraph(mockDevice()).beginFrame();
	const volume = frame.createTexture({ size: [8, 8, 4], dimension: '3d', mipLevelCount: 3, format: 'rgba8unorm' });
	for (const baseMipLevel of [1, 2]) {
		const view = frame.createTextureView(volume, { baseMipLevel, mipLevelCount: 1 });
		frame.command({ sideEffect: false, uses: [frame.use(view, TextureAccess.StorageWrite, { contents: 'overwrite' })] });
	}
	frame.markOutput(frame.createTextureView(volume, { baseMipLevel: 1 }));
	const root = frame.compile({ report: true }).compilationReport.roots[0]!;
	assert.deepEqual(root.range, { kind: 'texture', regions: [
		{ baseMipLevel: 1, mipLevelCount: 1, baseDepthSlice: 0, depthSliceCount: 2, aspect: 'all' },
		{ baseMipLevel: 2, mipLevelCount: 1, baseDepthSlice: 0, depthSliceCount: 1, aspect: 'all' },
	] });
	assert.deepEqual(root.resolution?.producerNodeIds, [1, 2]);
});

test('texture root views reject invalid ranges and absent aspects even when never accessed', () => {
	const frame = new FrameGraph(mockDevice()).beginFrame();
	const target = frame.importTexture(texture('color'), {});
	assert.throws(() => frame.markOutput(frame.createTextureView(target, { baseMipLevel: 1, mipLevelCount: 1 })), /mip/);
	assert.throws(() => frame.markOutput(frame.createTextureView(target, { aspect: 'depth-only' })), /aspect/);
	assert.throws(() => frame.markOutput(frame.createTextureView(target, { dimension: '3d' })), /dimension/);
	assert.throws(() => frame.markOutput(frame.createTextureView(target, { format: 'r32float' })), /format/);
});
