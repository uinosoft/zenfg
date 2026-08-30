import type { FrameGraphSnapshot } from '@zenfg/snapshot';

import { createFrameGraphSnapshot } from '../src/snapshot.ts';
import {
	BufferAccess,
	FrameGraph,
	TextureAccess,
	type FrameGraphCompilationReport,
} from '../src/index.ts';
import { mockDevice } from './testUtils.ts';

export const CROSS_LANGUAGE_PRODUCER_CASES = [
	'linear-dependency',
	'overwrite-culling',
	'preserve-discard',
	'buffer-range',
	'texture-subresource',
	'external-submission',
	'aliasing',
] as const;

export type CrossLanguageProducerCase = typeof CROSS_LANGUAGE_PRODUCER_CASES[number];

const CASE_BUILDERS: Record<CrossLanguageProducerCase, () => FrameGraphCompilationReport> = {
	'linear-dependency': linearDependency,
	'overwrite-culling': overwriteCulling,
	'preserve-discard': preserveDiscard,
	'buffer-range': bufferRange,
	'texture-subresource': textureSubresource,
	'external-submission': externalSubmission,
	'aliasing': aliasing,
};

/** Produces the runtime-derived TypeScript half of the cross-language corpus. */
export function createTypeScriptProducerSnapshots(): ReadonlyMap<CrossLanguageProducerCase, FrameGraphSnapshot> {
	const snapshots = new Map<CrossLanguageProducerCase, FrameGraphSnapshot>();
	for (const name of CROSS_LANGUAGE_PRODUCER_CASES) {
		const snapshot = createFrameGraphSnapshot({
			compilation: CASE_BUILDERS[name](),
			gpuTiming: { status: 'unavailable', frameIndex: 0, reason: 'unsupported' },
			resourcePool: {
				acquireCount: 0,
				reuseCount: 0,
				createdCount: 0,
				retainedCount: 0,
				estimatedRetainedBytes: 0,
			},
			capturedAt: '2026-08-30T00:00:00.000Z',
			producerVersion: '0.1.0-cross-language',
			runtime: { implementation: 'cross-language-test', backend: 'mock' },
		});
		snapshots.set(name, snapshot);
	}
	return snapshots;
}

function compile(record: (graph: ReturnType<FrameGraph['beginFrame']>) => void): FrameGraphCompilationReport {
	const graph = new FrameGraph(mockDevice()).beginFrame();
	record(graph);
	return graph.compile({ report: true }).compilationReport;
}

function linearDependency(): FrameGraphCompilationReport {
	return compile((graph) => {
		graph.pushDebugGroup('linear.group');
		const input = graph.createBuffer({ label: 'linear.input', size: 64 });
		const output = graph.createBuffer({ label: 'linear.output', size: 64 });
		graph.pushDebugGroup('linear.work');
		graph.command({
			label: 'linear.write',
			sideEffect: false,
			uses: [graph.use(input, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		});
		graph.command({
			label: 'linear.transform',
			sideEffect: false,
			uses: [
				graph.use(input, BufferAccess.StorageRead),
				graph.use(output, BufferAccess.StorageWrite, { contents: 'overwrite' }),
			],
		});
		graph.popDebugGroup();
		graph.markOutput(output);
		graph.popDebugGroup();
	});
}

function overwriteCulling(): FrameGraphCompilationReport {
	return compile((graph) => {
		const value = graph.createBuffer({ label: 'overwrite.value', size: 64 });
		graph.command({
			label: 'overwrite.dead-write',
			sideEffect: false,
			uses: [graph.use(value, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		});
		graph.command({
			label: 'overwrite.live-write',
			sideEffect: false,
			uses: [graph.use(value, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		});
		graph.command({
			label: 'overwrite.consume',
			sideEffect: true,
			uses: [graph.use(value, BufferAccess.StorageRead)],
		});
	});
}

function preserveDiscard(): FrameGraphCompilationReport {
	return compile((graph) => {
		const texture = graph.createTexture({
			label: 'preserve-discard.texture',
			format: 'rgba8unorm',
			size: [8, 8],
			mipLevelCount: 2,
		});
		const mip0 = graph.createTextureView(texture, {
			label: 'preserve-discard.mip-0',
			baseMipLevel: 0,
			mipLevelCount: 1,
		});
		const mip1 = graph.createTextureView(texture, {
			label: 'preserve-discard.mip-1',
			baseMipLevel: 1,
			mipLevelCount: 1,
		});
		graph.render({
			label: 'preserve.seed',
			colorAttachments: [{ target: mip0, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'preserve.load',
			sideEffect: true,
			colorAttachments: [{ target: mip0, loadOp: 'load', storeOp: 'store' }],
		});
		graph.render({
			label: 'discard.seed',
			sideEffect: false,
			colorAttachments: [{ target: mip1, loadOp: 'clear', storeOp: 'store' }],
		});
		graph.render({
			label: 'discard.overwrite-discard',
			sideEffect: true,
			colorAttachments: [{ target: mip1, loadOp: 'clear', storeOp: 'discard' }],
		});
	});
}

function bufferRange(): FrameGraphCompilationReport {
	return compile((graph) => {
		const ranged = graph.createBuffer({ label: 'range.buffer', size: 64 });
		graph.command({
			label: 'range.write-left',
			sideEffect: false,
			uses: [graph.use(ranged, BufferAccess.StorageWrite, { range: { offset: 0, size: 8 }, contents: 'overwrite' })],
		});
		graph.command({
			label: 'range.write-right',
			sideEffect: false,
			uses: [graph.use(ranged, BufferAccess.StorageWrite, { range: { offset: 8, size: 8 }, contents: 'overwrite' })],
		});
		graph.command({
			label: 'range.read-crossing',
			sideEffect: true,
			uses: [graph.use(ranged, BufferAccess.StorageRead, { range: { offset: 4, size: 8 } })],
		});
	});
}

function textureSubresource(): FrameGraphCompilationReport {
	return compile((graph) => {
		const texture = graph.createTexture({
			label: 'subresource.texture',
			format: 'rgba8unorm',
			size: [8, 8, 2],
			mipLevelCount: 2,
		});
		const nonOverlap = graph.createTextureView(texture, {
			label: 'subresource.other-mip-0-layer-0',
			baseMipLevel: 0,
			mipLevelCount: 1,
			baseArrayLayer: 0,
			arrayLayerCount: 1,
		});
		const target = graph.createTextureView(texture, {
			label: 'subresource.target-mip-1-layer-1',
			baseMipLevel: 1,
			mipLevelCount: 1,
			baseArrayLayer: 1,
			arrayLayerCount: 1,
		});
		graph.command({
			label: 'subresource.dead-non-overlap',
			sideEffect: false,
			uses: [graph.use(nonOverlap, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		});
		graph.command({
			label: 'subresource.write-target',
			sideEffect: false,
			uses: [graph.use(target, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		});
		graph.command({
			label: 'subresource.read-target',
			sideEffect: true,
			uses: [graph.use(target, TextureAccess.StorageRead)],
		});
	});
}

function externalSubmission(): FrameGraphCompilationReport {
	return compile((graph) => {
		const value = graph.createBuffer({ label: 'external.value', size: 64 });
		graph.command({
			label: 'external.before',
			sideEffect: false,
			uses: [graph.use(value, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		});
		graph.externalSubmission({
			label: 'external.submit',
			sideEffect: false,
			uses: [graph.use(value, BufferAccess.StorageWrite, { contents: 'preserve' })],
			submit() {},
		});
		graph.command({
			label: 'external.after',
			sideEffect: true,
			uses: [graph.use(value, BufferAccess.StorageRead)],
		});
	});
}

function aliasing(): FrameGraphCompilationReport {
	return compile((graph) => {
		const first = graph.createBuffer({ label: 'alias.first', size: 64 });
		const second = graph.createBuffer({ label: 'alias.second', size: 64 });
		const overlap = graph.createBuffer({ label: 'alias.overlap', size: 64 });
		graph.command({
			label: 'alias.write-first',
			sideEffect: false,
			uses: [
				graph.use(first, BufferAccess.StorageWrite, { contents: 'overwrite' }),
				graph.use(overlap, BufferAccess.StorageWrite, { contents: 'overwrite' }),
			],
		});
		graph.command({
			label: 'alias.consume-first',
			sideEffect: false,
			uses: [
				graph.use(first, BufferAccess.StorageRead),
				graph.use(overlap, BufferAccess.StorageWrite, { contents: 'preserve' }),
			],
		});
		graph.command({
			label: 'alias.write-second',
			sideEffect: false,
			uses: [
				graph.use(overlap, BufferAccess.StorageRead),
				graph.use(second, BufferAccess.StorageWrite, { contents: 'overwrite' }),
			],
		});
		graph.command({
			label: 'alias.consume-second',
			sideEffect: true,
			uses: [
				graph.use(second, BufferAccess.StorageRead),
				graph.use(overlap, BufferAccess.StorageRead),
			],
		});
	});
}
