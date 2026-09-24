import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAME_GRAPH_ERROR_CODES,
	FrameGraphError,
	FrameGraph,
	BufferAccess,
	TextureAccess,
} from '../src/index.ts';
import { mockDevice } from './testUtils.ts';

test('FrameGraphError exposes stable diagnostic fields and preserves its cause', () => {
	const cause = new Error('underlying failure');
	const error = new FrameGraphError(
		FRAME_GRAPH_ERROR_CODES.ReadBeforeWrite,
		'read before write',
		{
			phase: 'compile',
			nodeId: 7,
			resourceId: 3,
			context: { range: { offset: 4, size: 8 } },
			cause,
		},
	);

	assert.ok(error instanceof Error);
	assert.ok(error instanceof FrameGraphError);
	assert.equal(error.name, 'FrameGraphError');
	assert.equal(error.code, 'FG1001');
	assert.equal(error.phase, 'compile');
	assert.equal(error.nodeId, 7);
	assert.equal(error.resourceId, 3);
	assert.deepEqual(error.context, { range: { offset: 4, size: 8 } });
	assert.equal(error.cause, cause);
});


test('recording validation reports descriptor and use failures with stable metadata', () => {
	const recorder = new FrameGraph(mockDevice()).beginFrame();
	assert.throws(
		() => recorder.createTexture({ format: 'rgba8unorm', size: [1, 1], sampleCount: 2 }),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG1102'
			&& error.phase === 'record'
			&& error.nodeId === undefined
			&& error.resourceId === undefined,
	);
	const buffer = recorder.createBuffer({ size: 16 });
	assert.throws(
		() => recorder.use(buffer, BufferAccess.StorageWrite, { contents: 'invalid' as 'overwrite' }),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG1109'
			&& error.phase === 'record'
			&& error.resourceId === buffer.id,
	);
	const texture = recorder.createTexture({ format: 'rgba8unorm', size: [1, 1] });
	recorder.createTextureView(texture);
	recorder.createTextureView(texture);
	const secondView = recorder.createTextureView(texture);
	assert.notEqual(secondView.id, texture.id);
	assert.throws(
		() => recorder.use(secondView, TextureAccess.StorageWrite, { contents: 'invalid' as 'overwrite' }),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG1109'
			&& error.resourceId === texture.id,
	);
	assert.throws(
		() => recorder.use(buffer, BufferAccess.StorageRead, null as never),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG2013'
			&& error.phase === 'record'
			&& error.resourceId === buffer.id,
	);
});

test('compilation reports format-category and copy validation with node context', () => {
	const formatGraph = new FrameGraph(mockDevice()).beginFrame();
	const depth = formatGraph.createTexture({ format: 'depth24plus', size: [1, 1] });
	formatGraph.command({
		sideEffect: true,
		uses: [formatGraph.use(depth, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' })],
	});
	assert.throws(
		() => formatGraph.compile(),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG1108'
			&& error.phase === 'compile'
			&& error.nodeId === 1
			&& error.resourceId === depth.id,
	);

	const alignmentGraph = new FrameGraph(mockDevice()).beginFrame();
	const source = alignmentGraph.createBuffer({ size: 16 });
	const destination = alignmentGraph.createBuffer({ size: 16 });
	alignmentGraph.copy({
		operations: [{ type: 'buffer-to-buffer', source, destination, sourceOffset: 1, size: 4 }],
	});
	assert.throws(
		() => alignmentGraph.compile(),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG1106'
			&& error.phase === 'compile'
			&& error.nodeId === 1
			&& error.context?.sourceResourceId === source.id
			&& error.context?.destinationResourceId === destination.id,
	);

	const rangeGraph = new FrameGraph(mockDevice()).beginFrame();
	const rangeSource = rangeGraph.createBuffer({ size: 8 });
	const rangeDestination = rangeGraph.createBuffer({ size: 16 });
	rangeGraph.copy({
		operations: [{ type: 'buffer-to-buffer', source: rangeSource, destination: rangeDestination, size: 16 }],
	});
	assert.throws(
		() => rangeGraph.compile(),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG1103'
			&& error.phase === 'compile'
			&& error.nodeId === 1
			&& error.resourceId === rangeSource.id,
	);
});

test('execution option errors are structured while callback errors keep their identity', () => {
	const recorder = new FrameGraph(mockDevice()).beginFrame();
	const callbackError = new Error('callback failed');
	recorder.command({ sideEffect: true, encode() { throw callbackError; } });
	const compiled = recorder.compile();
	assert.throws(
		() => compiled.execute({ frameIndex: -1 }),
		(error) => error instanceof FrameGraphError
			&& error.code === 'FG2013'
			&& error.phase === 'execute',
	);
	assert.throws(() => compiled.execute(), (error) => error === callbackError);
});
