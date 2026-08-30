import assert from 'node:assert/strict';
import test from 'node:test';

import { validateFrameGraphSnapshot } from '@zenfg/snapshot';

import { createFrameGraphSnapshot } from '../src/snapshot.ts';
import { FrameGraph, TextureAccess } from '../src/index.ts';
import { mockDevice, texture, textureUsage } from './testUtils.ts';

test('maps a compilation report into canonical prefixed Snapshot V1 data', () => {
	const recorder = new FrameGraph(mockDevice()).beginFrame();
	const source = recorder.createTexture({
		label: 'source',
		format: 'rgba8unorm',
		size: [8, 4, 1],
	});
	const sourceView = recorder.createTextureView(source, {
		label: 'source-view',
		baseMipLevel: 0,
		mipLevelCount: 1,
	});
	const backbuffer = recorder.importSwapchainTexture(
		texture('backbuffer', textureUsage.RENDER_ATTACHMENT),
		{ label: 'backbuffer' },
	);
	recorder.render({
		label: 'source-pass',
		colorAttachments: [{
			target: sourceView,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
	});
	recorder.render({
		label: 'present',
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
		uses: [recorder.use(source, TextureAccess.Sampled)],
	});
	recorder.markPresent(backbuffer);
	const compilation = recorder.compile({ report: true }).compilationReport;

	const snapshot = createFrameGraphSnapshot({
		compilation,
		gpuTiming: { status: 'unavailable', frameIndex: 7, reason: 'unsupported' },
		resourcePool: {
			acquireCount: 1,
			reuseCount: 0,
			createdCount: 1,
			retainedCount: 1,
			estimatedRetainedBytes: 128,
		},
		capturedAt: '2026-08-28T00:00:00.000Z',
		producerVersion: '0.0.0-test',
		runtime: { implementation: 'node-test', backend: 'mock' },
	});

	assert.deepEqual(validateFrameGraphSnapshot(snapshot), []);
	assert.equal(snapshot.capture.frameIndex, 7);
	assert.equal(snapshot.capture.capturedAt, '2026-08-28T00:00:00.000Z');
	assert.equal(snapshot.capture.migration, undefined);
	assert.deepEqual(snapshot.producer.runtime, {
		graphicsApi: 'webgpu',
		implementation: 'node-test',
		backend: 'mock',
	});
	assert.deepEqual(snapshot.graph.nodes.map((node) => node.id), ['node:1', 'node:2']);
	assert.deepEqual(snapshot.graph.nodes.map((node) => node.recordingOrder), [0, 1]);
	assert.deepEqual(snapshot.graph.nodes.map((node) => node.compileState), [
		{ status: 'retained', executionOrder: 0 },
		{ status: 'retained', executionOrder: 1 },
	]);
	assert.ok(snapshot.graph.resources.some((resource) => resource.origin === 'surface'));
	assert.ok(snapshot.graph.resources.every((resource) => resource.usageFlags.every((flag) => typeof flag === 'string')));
	assert.deepEqual(snapshot.graph.textureViews.map((view) => [view.id, view.resourceId, view.label]), [
		[`view:${sourceView.id}`, `resource:${source.id}`, 'source-view'],
	]);
	assert.equal(snapshot.timings.gpu.status, 'unavailable');
	assert.ok(snapshot.graph.accesses.every((access) => access.access.startsWith('texture-')
		? access.textureRegion !== undefined && access.bufferRange === undefined
		: access.bufferRange !== undefined && access.textureRegion === undefined));
	assert.deepEqual(snapshot.graph.segments.flatMap((segment) => segment.nodeIds), snapshot.graph.nodes
		.filter((node) => node.compileState.status === 'retained')
		.sort((a, b) => a.compileState.status === 'retained' && b.compileState.status === 'retained'
			? a.compileState.executionOrder - b.compileState.executionOrder
			: 0)
		.map((node) => node.id));
	assert.ok(snapshot.graph.resources.every((resource) => resource.initialContents !== undefined));
	assert.deepEqual(createFrameGraphSnapshot({
		compilation,
		gpuTiming: { status: 'unavailable', frameIndex: 7, reason: 'unsupported' },
		resourcePool: {
			acquireCount: 1,
			reuseCount: 0,
			createdCount: 1,
			retainedCount: 1,
			estimatedRetainedBytes: 128,
		},
		capturedAt: '2026-08-28T00:00:00.000Z',
		producerVersion: '0.0.0-test',
		runtime: { implementation: 'node-test', backend: 'mock' },
	}), snapshot, 'the same producer inputs must encode deterministically');
});

test('maps GPU timing and rejects unknown WebGPU usage bits', () => {
	const recorder = new FrameGraph(mockDevice()).beginFrame();
	const target = recorder.createTexture({ label: 'target', format: 'rgba8unorm', size: [1, 1] });
	recorder.render({
		label: 'render',
		sideEffect: true,
		colorAttachments: [{
			target,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
	});
	const compilation = recorder.compile({ report: true }).compilationReport;
	const nodeId = compilation.nodes[0]!.id;
	const snapshot = createFrameGraphSnapshot({
		compilation,
		gpuTiming: {
			status: 'available',
			frameIndex: 3,
			frameDurationMicros: 12.5,
			nodes: [{ nodeId, kind: 'render', durationMicros: 10 }],
		},
		resourcePool: {
			acquireCount: 0,
			reuseCount: 0,
			createdCount: 0,
			retainedCount: 0,
			estimatedRetainedBytes: 0,
		},
	});
	assert.deepEqual(snapshot.timings.gpu, {
		status: 'available',
		frameSpanMicros: 12.5,
		nodes: [{ nodeId: `node:${nodeId}`, durationMicros: 10 }],
	});

	const invalidCompilation = {
		...compilation,
		resources: compilation.resources.map((resource, index) => index === 0
			? { ...resource, usage: resource.usage | 0x20 }
			: resource),
	};
	assert.throws(() => createFrameGraphSnapshot({
		compilation: invalidCompilation,
		gpuTiming: { status: 'unavailable', frameIndex: 3, reason: 'unsupported' },
		resourcePool: { acquireCount: 0, reuseCount: 0, createdCount: 0, retainedCount: 0, estimatedRetainedBytes: 0 },
	}), /unknown bits 0x20/);
});
