import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_VERSION,
	decodeFrameGraphSnapshot,
	parseFrameGraphSnapshot,
	stringifyFrameGraphSnapshot,
	validateFrameGraphSnapshot,
	type FrameGraphSnapshot,
} from '../src/index.ts';

const schema = readJson('../schema/frame-graph-snapshot-v1.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema as any);
const validFixtureNames = [
	'minimal.fgsnapshot.json',
	'full-webgpu.fgsnapshot.json',
	'aliasing.fgsnapshot.json',
	'timing-unavailable.fgsnapshot.json',
	'stable-keys.fgsnapshot.json',
	'legacy-v0.expected.fgsnapshot.json',
	'legacy-t3d-v1.expected.fgsnapshot.json',
] as const;

test('accepts every V1 golden fixture with both the runtime validator and published schema', () => {
	for (const name of validFixtureNames) {
		const fixture = readJson(`../fixtures/${name}`);
		assert.deepEqual(validateFrameGraphSnapshot(fixture), [], name);
		assert.equal(validateSchema(fixture), true, `${name}: ${ajv.errorsText(validateSchema.errors)}`);
		const decoded = decodeFrameGraphSnapshot(fixture);
		assert.equal(decoded.ok, true, name);
		if (decoded.ok) {
			assert.equal(decoded.source, 'v1');
			assert.equal(decoded.migrated, false);
		}
	}
});

test('accepts the Rust producer golden snapshot', () => {
	const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'crates/zenfg/tests/fixtures/snapshot-v1.json'), 'utf8'));
	assert.deepEqual(validateFrameGraphSnapshot(fixture), []);
	assert.equal(validateSchema(fixture), true, ajv.errorsText(validateSchema.errors));
	const decoded = decodeFrameGraphSnapshot(fixture);
	assert.equal(decoded.ok, true);
});

test('pretty and compact encoding round-trip through canonical V1', () => {
	const fixture = decodeFixture('full-webgpu.fgsnapshot.json');
	const compact = stringifyFrameGraphSnapshot(fixture);
	const pretty = stringifyFrameGraphSnapshot(fixture, { pretty: true });
	assert.equal(compact.includes('\n'), false);
	assert.equal(pretty.includes('\n  "format"'), true);
	for (const json of [compact, pretty]) {
		const decoded = parseFrameGraphSnapshot(json);
		assert.equal(decoded.ok, true);
		if (decoded.ok) assert.deepEqual(decoded.snapshot, fixture);
	}
});

test('preserves every stableKey field through decode and JSON re-encoding', () => {
	const fixture = readJson('../fixtures/stable-keys.fgsnapshot.json');
	const decoded = decodeFrameGraphSnapshot(fixture);
	assert.equal(decoded.ok, true);
	if (!decoded.ok) return;
	assert.deepEqual(decoded.snapshot, fixture);
	assert.deepEqual(JSON.parse(stringifyFrameGraphSnapshot(decoded.snapshot)), fixture);
	assert.deepEqual([
		decoded.snapshot.graph.groups[0]?.stableKey,
		decoded.snapshot.graph.nodes[0]?.stableKey,
		decoded.snapshot.graph.resources[0]?.stableKey,
		decoded.snapshot.graph.textureViews[0]?.stableKey,
	], ['group/main', 'node/sample', 'resource/input', 'view/input']);
});

test('migrates Legacy V0 and only re-exports canonical V1', () => {
	const legacy = readJson('../fixtures/legacy-v0.json');
	const decoded = decodeFrameGraphSnapshot(legacy);
	assert.equal(decoded.ok, true);
	if (!decoded.ok) return;
	assert.equal(decoded.source, 'legacy-v0');
	assert.equal(decoded.migrated, true);
	assert.ok(decoded.issues.some((issue) => issue.code === 'legacy-v0-migrated'));
	assert.equal(decoded.snapshot.format, FRAME_GRAPH_SNAPSHOT_FORMAT);
	assert.deepEqual(decoded.snapshot.version, FRAME_GRAPH_SNAPSHOT_VERSION);
	assert.deepEqual(decoded.snapshot.graph.nodes.map((node) => [node.id, node.compileState.status]), [
		['node:1', 'retained'],
		['node:2', 'culled'],
	]);
	assert.equal(decoded.snapshot.graph.resources[0]?.origin, 'surface');
	assert.deepEqual(decoded.snapshot.graph.resources[1]?.usageFlags, ['copy-src', 'copy-dst', 'storage']);
	assert.equal(decoded.snapshot.graph.nodes[0]?.recordingOrder, undefined);
	assert.equal(decoded.snapshot.graph.textureViews.length, 0);
	assert.deepEqual(decoded.snapshot.capture.migration, {
		sourceFormat: 'legacy-v0',
		unavailableFacts: ['graph.textureViews', 'graph.nodes.recordingOrder', 'graph.accesses.regions'],
	});
	assert.deepEqual(decoded.snapshot, readJson('../fixtures/legacy-v0.expected.fgsnapshot.json'));

	const exported = stringifyFrameGraphSnapshot(decoded.snapshot);
	const reparsed = JSON.parse(exported) as Record<string, unknown>;
	assert.equal(reparsed.format, FRAME_GRAPH_SNAPSHOT_FORMAT);
	assert.equal('compilation' in reparsed, false);
	const redecoded = decodeFrameGraphSnapshot(reparsed);
	assert.equal(redecoded.ok, true);
	if (redecoded.ok) {
		assert.equal(redecoded.source, 'v1');
		assert.equal(redecoded.migrated, false);
		assert.deepEqual(redecoded.snapshot.capture.migration, decoded.snapshot.capture.migration);
	}
});

test('migrates the t3d V1 candidate and preserves unknown imported initial contents', () => {
	const decoded = decodeFrameGraphSnapshot(readJson('../fixtures/legacy-t3d-v1.json'));
	assert.equal(decoded.ok, true);
	if (!decoded.ok) return;
	assert.equal(decoded.source, 't3d-v1');
	assert.equal(decoded.migrated, true);
	assert.equal(decoded.snapshot.format, FRAME_GRAPH_SNAPSHOT_FORMAT);
	assert.deepEqual(decoded.snapshot.capture.migration, { sourceFormat: 't3d-v1', unavailableFacts: [] });
	for (const resource of decoded.snapshot.graph.resources) {
		if (resource.origin === 'imported') assert.equal(resource.initialContents, undefined);
		else assert.equal(resource.initialContents, 'undefined');
	}
	assert.ok(decoded.issues.some((issue) => issue.code === 't3d-v1-migrated'));
});

test('matches the canonical t3d V1 migration value exactly', () => {
	const input = readJson('../fixtures/legacy-t3d-v1-canonical.json');
	const expected = readJson('../fixtures/legacy-t3d-v1.expected.fgsnapshot.json');
	const decoded = decodeFrameGraphSnapshot(input);
	assert.equal(decoded.ok, true);
	if (!decoded.ok) return;
	assert.deepEqual(decoded.snapshot, expected);
	assert.deepEqual(JSON.parse(stringifyFrameGraphSnapshot(decoded.snapshot)), expected);
	const imported = decoded.snapshot.graph.resources.find((resource) => resource.origin === 'imported');
	assert.equal(imported?.initialContents, undefined);
	assert.equal(imported?.stableKey, 'resource/input');
	assert.deepEqual(decoded.snapshot.extensions['dev.t3d-next.fixture'], { preserved: true });
});

test('reports stable parse, format, and version failures', () => {
	const malformed = parseFrameGraphSnapshot('{');
	assert.equal(malformed.ok, false);
	if (!malformed.ok) assert.deepEqual(malformed.issues.map((issue) => [issue.code, issue.path]), [['invalid-json', '']]);

	const wrongFormat = decodeFrameGraphSnapshot({ format: 'other', version: { major: 1, minor: 0 } });
	assert.equal(wrongFormat.ok, false);
	if (!wrongFormat.ok) assert.deepEqual(wrongFormat.issues.map((issue) => [issue.code, issue.path]), [['unsupported-format', '/format']]);

	for (const version of [{ major: 2, minor: 0 }, { major: 1, minor: 1 }]) {
		const future = clone(readJson('../fixtures/minimal.fgsnapshot.json')) as any;
		future.version = version;
		const result = decodeFrameGraphSnapshot(future);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.issues[0]?.code, 'unsupported-version');
	}
});

test('recognizes any unversioned Legacy marker before reporting accumulated source issues', () => {
	for (const marker of ['compilation', 'gpuTiming', 'resourcePool'] as const) {
		const result = decodeFrameGraphSnapshot({ [marker]: {} });
		assert.equal(result.ok, false, marker);
		if (!result.ok) {
			assert.equal(result.issues.some((issue) => issue.code === 'unsupported-format'), false, marker);
			assert.ok(result.issues.length >= 2, `${marker}: ${JSON.stringify(result.issues)}`);
			assert.ok(result.issues.every((issue) => issue.code.startsWith('legacy-')), marker);
		}
	}
});

test('rejects duplicate IDs, dangling and wrong-kind references, and group cycles', () => {
	const wrongPrefix: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	wrongPrefix.graph.nodes[0]!.id = 'resource:not-a-node';
	assertIssue(wrongPrefix, 'invalid-id', '/graph/nodes/0/id');

	const duplicate: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	duplicate.graph.nodes[1]!.id = duplicate.graph.nodes[0]!.id;
	assertIssue(duplicate, 'duplicate-id', '/graph/nodes/1/id');

	const dangling: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	dangling.graph.accesses[0]!.resourceId = 'resource:missing';
	assertIssue(dangling, 'missing-reference', '/graph/accesses/0/resourceId');

	const wrongKind: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	wrongKind.graph.accesses[3]!.access = 'texture-sampled';
	assertIssue(wrongKind, 'invalid-access-mode', '/graph/accesses/3/mode');

	const cycle: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	cycle.graph.groups[0]!.parentId = 'group:postfx';
	assertIssue(cycle, 'group-cycle', '/graph/groups/0/parentId');
});

test('rejects invalid integers, non-finite timing and extension values', () => {
	const unsafe: any = clone(decodeFixture('minimal.fgsnapshot.json'));
	unsafe.capture.frameIndex = Number.MAX_SAFE_INTEGER + 1;
	assertIssue(unsafe, 'invalid-integer', '/capture/frameIndex');

	const timing: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	if (timing.timings.gpu.status === 'available') timing.timings.gpu.frameSpanMicros = Number.POSITIVE_INFINITY;
	assertIssue(timing, 'invalid-number', '/timings/gpu/frameSpanMicros');

	const extension = clone(decodeFixture('minimal.fgsnapshot.json'));
	(extension.extensions as Record<string, unknown>)['invalid'] = { value: Number.NaN };
	const issues = validateFrameGraphSnapshot(extension);
	assert.ok(issues.some((issue) => issue.code === 'invalid-extension-name' && issue.path === '/extensions/invalid'));
	assert.ok(issues.some((issue) => issue.code === 'invalid-json-value' && issue.path === '/extensions/invalid/value'));
});

test('rejects cyclic and non-JSON programmatic extension values without overflowing', () => {
	const cyclic: any = {};
	cyclic.self = cyclic;
	const snapshot: any = clone(decodeFixture('minimal.fgsnapshot.json'));
	snapshot.extensions['dev.t3d.cyclic'] = cyclic;
	assertIssue(snapshot, 'invalid-json-value', '/extensions/dev.t3d.cyclic/self');
	assert.throws(() => stringifyFrameGraphSnapshot(snapshot), (error: unknown) => (
		error instanceof Error && error.name === 'FrameGraphSnapshotValidationError'
	));

	for (const value of [undefined, 1n, () => undefined, Symbol('x'), new Date()]) {
		const invalid: any = clone(decodeFixture('minimal.fgsnapshot.json'));
		invalid.extensions['dev.t3d.invalid'] = value;
		assertIssue(invalid, 'invalid-json-value', '/extensions/dev.t3d.invalid');
	}
	const sparse: any[] = [];
	sparse.length = 1;
	const invalidSparse: any = clone(decodeFixture('minimal.fgsnapshot.json'));
	invalidSparse.extensions['dev.t3d.sparse'] = sparse;
	assertIssue(invalidSparse, 'invalid-json-value', '/extensions/dev.t3d.sparse/0');
});

test('enforces access, ordering, segment, dependency, lifetime, and migration semantics', () => {
	const accessMode: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	accessMode.graph.accesses[0].access = 'texture-sampled';
	assertIssue(accessMode, 'invalid-access-mode', '/graph/accesses/0/mode');

	const missingRegion: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	delete missingRegion.graph.accesses[0].textureRegion;
	assertIssue(missingRegion, 'invalid-access-range', '/graph/accesses/0/textureRegion');

	const executionGap: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	executionGap.graph.nodes.find((node: any) => node.compileState.status === 'retained').compileState.executionOrder = 9;
	assertIssue(executionGap, 'invalid-execution-order', '/graph/nodes/0/compileState/executionOrder');

	const segmentSequence: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	[segmentSequence.graph.segments[0].nodeIds, segmentSequence.graph.segments[2].nodeIds] = [segmentSequence.graph.segments[2].nodeIds, segmentSequence.graph.segments[0].nodeIds];
	assertIssue(segmentSequence, 'invalid-segment-sequence', '/graph/segments');

	const segmentKind: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	segmentKind.graph.segments[0].kind = 'external-submission';
	assertIssue(segmentKind, 'invalid-segment-kind', '/graph/segments/0/nodeIds/0');

	const dependency: any = clone(decodeFixture('full-webgpu.fgsnapshot.json'));
	dependency.graph.dependencies.push(clone(dependency.graph.dependencies[0]));
	assertIssue(dependency, 'duplicate-dependency', '/graph/dependencies/1');

	const lifetime: any = clone(decodeFixture('aliasing.fgsnapshot.json'));
	lifetime.graph.resources[0].lifetime.lastUse = 20;
	assertIssue(lifetime, 'invalid-lifetime', '/graph/resources/0/lifetime');

	const migration: any = clone(decodeFixture('legacy-v0.expected.fgsnapshot.json'));
	migration.graph.textureViews.push({ id: 'view:x', resourceId: 'resource:1', format: 'rgba8unorm', dimension: '2d', aspect: 'all', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1, swizzle: 'rgba' });
	assertIssue(migration, 'invalid-migration-availability', '/graph/textureViews');
});

test('schema and runtime validator agree on structural invalid fixtures', () => {
	const invalidValues: unknown[] = [];
	const missingFormat = clone(decodeFixture('minimal.fgsnapshot.json')) as any;
	delete missingFormat.format;
	invalidValues.push(missingFormat);
	const negativeFrame: any = clone(decodeFixture('minimal.fgsnapshot.json'));
	negativeFrame.capture.frameIndex = -1;
	invalidValues.push(negativeFrame);
	const badNodeKind = clone(decodeFixture('timing-unavailable.fgsnapshot.json')) as any;
	badNodeKind.graph.nodes[0].kind = 'unknown';
	invalidValues.push(badNodeKind);
	const extraProperty = clone(decodeFixture('minimal.fgsnapshot.json')) as any;
	extraProperty.extra = true;
	invalidValues.push(extraProperty);
	const wrongPrefix = clone(decodeFixture('full-webgpu.fgsnapshot.json')) as any;
	wrongPrefix.graph.textureViews[0].id = 'node:not-a-view';
	invalidValues.push(wrongPrefix);
	const emptyGroupLabel = clone(decodeFixture('full-webgpu.fgsnapshot.json')) as any;
	emptyGroupLabel.graph.groups[0].label = '';
	invalidValues.push(emptyGroupLabel);
	const emptyViewFormat = clone(decodeFixture('full-webgpu.fgsnapshot.json')) as any;
	emptyViewFormat.graph.textureViews[0].format = '';
	invalidValues.push(emptyViewFormat);
	const zeroViewCount = clone(decodeFixture('full-webgpu.fgsnapshot.json')) as any;
	zeroViewCount.graph.textureViews[0].mipLevelCount = 0;
	invalidValues.push(zeroViewCount);
	const zeroTextureCount = clone(decodeFixture('full-webgpu.fgsnapshot.json')) as any;
	zeroTextureCount.graph.resources[0].descriptor.mipLevelCount = 0;
	invalidValues.push(zeroTextureCount);
	const negativeTiming = clone(decodeFixture('full-webgpu.fgsnapshot.json')) as any;
	negativeTiming.timings.gpu.frameSpanMicros = -1;
	invalidValues.push(negativeTiming);
	const emptyUnavailableReason = clone(decodeFixture('minimal.fgsnapshot.json')) as any;
	emptyUnavailableReason.timings.gpu.reason = '';
	invalidValues.push(emptyUnavailableReason);
	const emptyDiagnosticCode = clone(decodeFixture('minimal.fgsnapshot.json')) as any;
	emptyDiagnosticCode.diagnostics = [{ severity: 'warning', code: '', message: 'message' }];
	invalidValues.push(emptyDiagnosticCode);
	const emptyCulledReason = clone(decodeFixture('full-webgpu.fgsnapshot.json')) as any;
	emptyCulledReason.graph.nodes.find((node: any) => node.compileState.status === 'culled').compileState.reason = '';
	invalidValues.push(emptyCulledReason);
	const bothRootTargets = clone(decodeFixture('full-webgpu.fgsnapshot.json')) as any;
	bothRootTargets.graph.roots[0].nodeId = 'node:present';
	invalidValues.push(bothRootTargets);

	for (const value of invalidValues) {
		assert.ok(validateFrameGraphSnapshot(value).length > 0);
		assert.equal(validateSchema(value), false);
	}
});

test('matches the published structural and semantic conformance manifest', () => {
	type ManifestCase = {
		readonly id: string;
		readonly file: string;
		readonly input: 'v1' | 'legacy-v0' | 't3d-v1' | 'json-text' | 'validator';
		readonly schemaValid: boolean | 'not-applicable';
		readonly runtimeValid: boolean;
		readonly canonical?: string;
		readonly issues?: readonly { readonly code: string; readonly path: string; readonly message: string }[];
	};
	const conformanceRoot = resolve(process.cwd(), 'packages/snapshot/conformance');
	type IssueCodeGroups = Readonly<Record<'validator' | 'codec' | 'legacy' | 'migrationWarnings' | 'typescriptOnly', readonly string[]>>;
	const manifest = JSON.parse(readFileSync(resolve(conformanceRoot, 'manifest.json'), 'utf8')) as {
		readonly requiredIssueCodes: IssueCodeGroups;
		readonly cases: readonly ManifestCase[];
	};
	const coveredCodes = new Set<string>();
	for (const entry of manifest.cases) {
		const text = readFileSync(resolve(conformanceRoot, entry.file), 'utf8');
		const value = entry.input === 'json-text' ? undefined : JSON.parse(text);
		if (typeof entry.schemaValid === 'boolean') {
			assert.equal(validateSchema(value), entry.schemaValid, `${entry.id}: ${ajv.errorsText(validateSchema.errors)}`);
		}
		const result = entry.input === 'validator'
			? undefined
			: entry.input === 'json-text'
				? parseFrameGraphSnapshot(text)
				: decodeFrameGraphSnapshot(value);
		const actualIssues = entry.input === 'validator'
			? validateFrameGraphSnapshot(value)
			: result!.issues;
		const runtimeValid = entry.input === 'validator' ? actualIssues.length === 0 : result!.ok;
		assert.equal(runtimeValid, entry.runtimeValid, entry.id);
		if (result?.ok && entry.canonical) {
			assert.deepEqual(result.snapshot, JSON.parse(readFileSync(resolve(conformanceRoot, entry.canonical), 'utf8')), entry.id);
		}
		const actual = sortIssues(actualIssues);
		const expected = sortIssues(entry.issues ?? []);
		assert.deepEqual(actual, expected, entry.id);
		for (const issue of expected) coveredCodes.add(issue.code);
	}
	for (const group of ['validator', 'codec', 'legacy', 'migrationWarnings'] as const) {
		for (const code of manifest.requiredIssueCodes[group]) {
			assert.equal(coveredCodes.has(code), true, `Conformance corpus does not cover ${group} issue code ${code}.`);
		}
	}
});

test('rejects malformed Legacy IDs, lists, pool values, timings, and usage bits before conversion', () => {
	const base: any = readJson('../fixtures/legacy-v0.json');
	const mutations: readonly [string, (value: any) => void][] = [
		['legacy-number', (value) => { value.compilation.dependencies = [{ fromNodeId: null, toNodeId: 1, resourceId: 1, kind: 'value' }]; }],
		['legacy-number', (value) => { value.compilation.roots = [{ reason: 'side-effect', nodeId: null }]; }],
		['legacy-number', (value) => { value.compilation.executionSegments[0].nodeIds = [null]; }],
		['legacy-number', (value) => { value.compilation.allocations[0].compatibilityClassId = null; }],
		['legacy-number', (value) => { value.resourcePool.acquireCount = -1; }],
		['legacy-number', (value) => { value.gpuTiming = { status: 'available', frameIndex: 4, frameDurationMicros: -1, nodes: [] }; }],
		['legacy-unknown-usage', (value) => { value.compilation.resources[0].usage = 0x20; }],
		['legacy-number', (value) => { value.compilation.resources[0].descriptor = { format: 'rgba8unorm', size: { width: 0, height: 1, depthOrArrayLayers: 1 }, dimension: '2d', mipLevelCount: 1, sampleCount: 1, viewFormats: [] }; }],
		['legacy-texture-region', (value) => { value.compilation.accesses[0].textureRegion = { baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1, baseDepthSlice: 0, depthSliceCount: 1, aspect: 'all' }; }],
	];
	for (const [code, mutate] of mutations) {
		const value = clone(base);
		mutate(value);
		const result = decodeFrameGraphSnapshot(value);
		assert.equal(result.ok, false, code);
		if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === code), JSON.stringify(result.issues));
	}
});

function decodeFixture(name: string): FrameGraphSnapshot {
	const result = decodeFrameGraphSnapshot(readJson(`../fixtures/${name}`));
	if (!result.ok) throw new Error(JSON.stringify(result.issues));
	return result.snapshot;
}

function readJson(relativePath: string): unknown {
	return JSON.parse(readFileSync(resolve(
		process.cwd(),
		'packages/snapshot/tests',
		relativePath,
	), 'utf8'));
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function assertIssue(value: unknown, code: string, path: string): void {
	const issues = validateFrameGraphSnapshot(value);
	assert.ok(issues.some((issue) => issue.code === code && issue.path === path), JSON.stringify(issues, null, 2));
}

function sortIssues(issues: readonly { readonly code: string; readonly path: string; readonly message: string }[]) {
	return issues
		.map(({ code, path, message }) => ({ code, path, message }))
		.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}
