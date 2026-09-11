import { exampleTagLabels } from '../src/exampleTags.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';
import { findPublicExample, publicExamples } from '../src/catalog/catalog.ts';
import { defaultExampleId, parsePlaygroundRoute, routeSearch } from '../src/routing.ts';
import { orderedSourceFiles } from '../src/sourceView.ts';

test('playground routes default missing and invalid values safely', () => {
	assert.deepEqual(parsePlaygroundRoute('?panel=none'), { exampleId: defaultExampleId, panel: 'inspector' });
	assert.deepEqual(parsePlaygroundRoute(''), {
		exampleId: defaultExampleId,
		panel: 'inspector',
	});
	assert.deepEqual(parsePlaygroundRoute('?example=interactive-background&panel=inspector'), {
		exampleId: 'interactive-background',
		panel: 'inspector',
	});
	assert.deepEqual(parsePlaygroundRoute('?example=three-interop&panel=code'), {
		exampleId: 'three-interop',
		panel: 'code',
	});
	assert.deepEqual(parsePlaygroundRoute('?example=missing&panel=unexpected'), {
		exampleId: 'missing',
		panel: 'inspector',
	});
});

test('playground panel controls are mutually exclusive and serializable', () => {
	assert.equal(routeSearch({ exampleId: 'interactive-background', panel: 'inspector' }), '?example=interactive-background&panel=inspector');
});

test('the production catalog is explicit, grouped, and keeps canonical sources first', () => {
	assert.equal(findPublicExample('interactive-background')?.title, 'Interactive FrameGraph Background');
	assert.equal(findPublicExample('three-interop')?.title, 'Three.js Co-rendering');
	assert.equal(findPublicExample('three-interop')?.hasControls, true);
	assert.equal(findPublicExample('babylon-interop')?.title, 'Babylon.js Co-rendering');
	assert.equal(findPublicExample('babylon-interop')?.hasControls, true);
	assert.equal(findPublicExample('babylon-lite-interop')?.title, 'Babylon Lite Co-rendering');
	assert.equal(findPublicExample('babylon-lite-interop')?.hasControls, false);
	assert.deepEqual(parsePlaygroundRoute('?example=babylon-lite-interop&panel=code'), { exampleId: 'babylon-lite-interop', panel: 'code' });
	assert.deepEqual(findPublicExample('babylon-lite-interop')?.sourceFiles.map(file => file.label), ['main.ts', 'graph.ts', 'bridge.ts', 'resolve.ts', 'scene.ts', 'present.ts', 'host.ts', 'babylonLiteInterop.ts']);
	assert.deepEqual(parsePlaygroundRoute('?example=babylon-interop&panel=code'), { exampleId: 'babylon-interop', panel: 'code' });
	assert.deepEqual(findPublicExample('babylon-interop')?.sourceFiles.map(file => file.label), ['main.ts', 'graph.ts', 'bridge.ts', 'resolve.ts', 'scene.ts', 'present.ts', 'host.ts', 'babylonInterop.ts']);
	assert.equal(findPublicExample('missing'), undefined);
	assert.equal(new Set(publicExamples.map((example) => example.id)).size, publicExamples.length);
	assert.deepEqual(
		publicExamples.map((example) => [example.id, example.group]),
		[
			['interactive-background', 'Showcases'],
			['reference-renderer', 'Showcases'],
			['three-interop', 'Showcases'],
			['babylon-interop', 'Showcases'],
			['babylon-lite-interop', 'Showcases'],
			['typegpu-slime-mold', 'Showcases'],
			['typegpu-monocular-light-injection', 'Showcases'],
			['particles4all-framegraph', 'Showcases'],
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
		publicExamples.filter((example) => example.group === '@zenfg/webgpu basics').map((example) => [example.sourceFiles[0]?.path, example.sourceFiles[0]?.role]),
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
		assert.ok(['live', 'ready'].includes(example.readyState));
		assert.ok(example.tags.length > 0);
		assert.equal(new Set(example.tags).size, example.tags.length);
		for (const tag of example.tags) assert.ok(exampleTagLabels[tag]);
		assert.equal(new Set(example.sourceFiles.map((file) => file.id)).size, example.sourceFiles.length);
		assert.ok(example.sourceFiles.every((file) => file.language === (file.path.endsWith('.js') ? 'javascript' : 'typescript')));
		if (example.hasControls) assert.equal(example.group, 'Showcases');
	}
	assert.deepEqual(
		findPublicExample('typegpu-slime-mold')?.sourceFiles.map((file) => file.path),
		[
			'apps/site/examples/typegpu-slime-mold/src/main.ts',
			'apps/site/examples/typegpu-slime-mold/src/slimeMold.ts',
			'apps/site/examples/typegpu-slime-mold/src/types.ts',
			'apps/site/examples/typegpu-slime-mold/src/host.ts',
			'apps/site/playground/src/catalog/typeGpuSlimeMold.ts',
		],
	);
	assert.deepEqual(
		findPublicExample('three-interop')?.sourceFiles.map((file) => file.path),
		[
			'apps/site/examples/three-interop/src/main.ts',
			'apps/site/examples/three-interop/src/graph.ts',
			'apps/site/examples/three-interop/src/bridge.ts',
			'apps/site/examples/three-interop/src/scene.ts',
			'apps/site/examples/three-interop/src/present.ts',
			'apps/site/examples/three-interop/src/host.ts',
			'apps/site/playground/src/catalog/threeInterop.ts',
		],
	);
	assert.ok(publicExamples
		.filter((example) => example.group === '@zenfg/webgpu basics')
		.every((example) => !example.hasControls));
});

test('every example declares a real reading entry with a source introduction', () => {
	assert.equal(publicExamples.length, 16);
	for (const example of publicExamples) {
		const ordered = orderedSourceFiles(example);
		assert.equal(ordered[0]!.id, example.entrySourceId);
		assert.equal(example.sourceFiles[0]!.id, example.entrySourceId);
		const entry = ordered[0]!;
		assert.equal(entry.path.endsWith('/main.ts'), example.group === 'Showcases');
		for (const file of ordered) {
			assert.ok(readFileSync(resolve(file.path), 'utf8').length > 0, file.path);
		}
		const source = readFileSync(resolve(entry.path), 'utf8');
		const introduction = source.slice(0, source.indexOf('*/') + 2);
		assert.ok(introduction.startsWith('/**'), entry.path);
		for (const heading of ['Source:', 'Demonstrates:', 'Flow:', 'Read next:']) {
			assert.ok(introduction.includes(heading), `${entry.path}: ${heading}`);
		}
		if (example.group === 'Showcases') {
			for (const operation of ['beginFrame(', 'markPresent(', '.compile(', '.execute(']) {
				assert.ok(source.includes(operation), `${entry.path}: real frame execution`);
			}
		}
	}
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
		const source = readFileSync(resolve('apps/site/playground/src/catalog/webgpu', file), 'utf8');
		assert.doesNotMatch(source, /recorder\.(?:create|import|use|render|compute|copy|clearBuffer|command|externalSubmission|mark)/u);
		assert.match(source, new RegExp(`recipe\\.${previewFunction}\\b`, 'u'), `${file} preview`);
		assert.match(source, new RegExp(`recipe\\.${captureFunction}\\b`, 'u'), `${file} capture`);
	}
});
