import assert from 'node:assert/strict';
import test from 'node:test';
import { findPublicExample, publicExamples } from '../src/catalog/catalog.ts';
import { defaultExampleId, parsePlaygroundRoute, routeSearch, toggledPanel } from '../src/routing.ts';

test('playground routes default missing and invalid values safely', () => {
	assert.deepEqual(parsePlaygroundRoute(''), {
		exampleId: defaultExampleId,
		panel: 'none',
	});
	assert.deepEqual(parsePlaygroundRoute('?example=interactive-background&panel=inspector'), {
		exampleId: 'interactive-background',
		panel: 'inspector',
	});
	assert.deepEqual(parsePlaygroundRoute('?example=missing&panel=unexpected'), {
		exampleId: 'missing',
		panel: 'none',
	});
});

test('playground panel controls are mutually exclusive and serializable', () => {
	assert.equal(toggledPanel('none', 'code'), 'code');
	assert.equal(toggledPanel('code', 'code'), 'none');
	assert.equal(toggledPanel('code', 'inspector'), 'inspector');
	assert.equal(toggledPanel('inspector', 'none'), 'none');
	assert.equal(routeSearch({ exampleId: 'interactive-background', panel: 'inspector' }), '?example=interactive-background&panel=inspector');
});

test('the production catalog has unique ids and exact TypeScript source loaders', () => {
	assert.equal(findPublicExample('interactive-background')?.title, 'Interactive FrameGraph Background');
	assert.equal(findPublicExample('missing'), undefined);
	assert.equal(new Set(publicExamples.map((example) => example.id)).size, publicExamples.length);
	assert.deepEqual(
		publicExamples.flatMap((example) => example.sourceFiles.map((file) => [file.path, file.language])),
		[
			['examples/interactive-background/src/background.ts', 'typescript'],
			['examples/interactive-background/src/backgroundShaders.ts', 'typescript'],
		],
	);
});
