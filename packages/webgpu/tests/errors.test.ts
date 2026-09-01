import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAME_GRAPH_ERROR_CODES,
	FrameGraphError,
} from '../src/index.ts';

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
