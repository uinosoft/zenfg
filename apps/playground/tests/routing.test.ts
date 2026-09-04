import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';
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

test('the production catalog is explicit, grouped, and keeps canonical sources first', () => {
	assert.equal(findPublicExample('interactive-background')?.title, 'Interactive FrameGraph Background');
	assert.equal(findPublicExample('missing'), undefined);
	assert.equal(new Set(publicExamples.map((example) => example.id)).size, publicExamples.length);
	assert.deepEqual(
		publicExamples.map((example) => [example.id, example.group]),
		[
			['interactive-background', 'Showcases'],
			['typegpu-slime-mold', 'Showcases'],
			['minimal-frame', '@zenfg/webgpu basics'],
			['transient-to-present', '@zenfg/webgpu basics'],
			['imported-resource', '@zenfg/webgpu basics'],
			['persistent-state', '@zenfg/webgpu basics'],
			['external-submission', '@zenfg/webgpu basics'],
			['snapshot-export', '@zenfg/webgpu basics'],
			['gpu-timing', '@zenfg/webgpu basics'],
			['compute-output', '@zenfg/webgpu basics'],
		],
	);
	assert.deepEqual(
		publicExamples.slice(2).map((example) => [example.sourceFiles[0]?.path, example.sourceFiles[0]?.role]),
		[
			['packages/webgpu/examples/minimal-frame.ts', 'recipe'],
			['packages/webgpu/examples/transient-to-present.ts', 'recipe'],
			['packages/webgpu/examples/imported-resource.ts', 'recipe'],
			['packages/webgpu/examples/persistent-state.ts', 'recipe'],
			['packages/webgpu/examples/external-submission.ts', 'recipe'],
			['packages/webgpu/examples/snapshot-export.ts', 'recipe'],
			['packages/webgpu/examples/gpu-timing.ts', 'recipe'],
			['packages/webgpu/examples/compute-output.ts', 'recipe'],
		],
	);
	for (const example of publicExamples) {
		assert.ok(example.readyMessage.length > 0);
		assert.ok(example.footerHint.length > 0);
		assert.equal(new Set(example.sourceFiles.map((file) => file.id)).size, example.sourceFiles.length);
		assert.ok(example.sourceFiles.every((file) => file.language === 'typescript'));
		if (example.hasControls) assert.equal(example.group, 'Showcases');
	}
	assert.deepEqual(
		findPublicExample('typegpu-slime-mold')?.sourceFiles.map((file) => file.path),
		[
			'examples/typegpu-slime-mold/src/slimeMold.ts',
			'examples/typegpu-slime-mold/src/startTypeGpuSlimeMold.ts',
			'apps/playground/src/catalog/typeGpuSlimeMold.ts',
		],
	);
	assert.ok(publicExamples
		.filter((example) => example.group === '@zenfg/webgpu basics')
		.every((example) => !example.hasControls));
});

test('package adapters call recipes instead of redeclaring FrameGraph nodes', () => {
	const adapterFiles = [
		['minimalFrame.ts', 'renderMinimalFrame', 'recordMinimalFrame'],
		['transientToPresent.ts', 'renderTransientToPresent', 'recordTransientToPresent'],
		['importedResource.ts', 'renderWithImportedUniform', 'recordImportedUniformFrame'],
		['persistentState.ts', 'updatePersistentState', 'recordPersistentStateUpdate'],
		['externalSubmission.ts', 'renderExternalSubmission', 'recordExternalSubmission'],
		['snapshotExport.ts', 'captureSnapshotJson', 'captureSnapshotJson'],
		['gpuTiming.ts', 'measureClearPass', 'recordTimedClearPass'],
		['computeOutput.ts', 'computeOutput', 'recordComputeOutput'],
	] as const;
	for (const [file, previewFunction, captureFunction] of adapterFiles) {
		const source = readFileSync(resolve('apps/playground/src/catalog/webgpu', file), 'utf8');
		assert.doesNotMatch(source, /recorder\.(?:create|import|use|render|compute|copy|clearBuffer|command|externalSubmission|mark)/u);
		assert.match(source, new RegExp(`recipe\\.${previewFunction}\\b`, 'u'), `${file} preview`);
		assert.match(source, new RegExp(`recipe\\.${captureFunction}\\b`, 'u'), `${file} capture`);
	}
});
