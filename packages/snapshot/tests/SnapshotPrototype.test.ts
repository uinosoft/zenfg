import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
	decodeFrameGraphSnapshot,
	finalizeFrameGraphSnapshot,
	FrameGraphSnapshotValidationError,
	parseFrameGraphSnapshot,
	stringifyFrameGraphSnapshot,
	validateFrameGraphSnapshot,
	type FrameGraphSnapshot,
	type FrameGraphSnapshotIssue,
} from '../src/index.ts';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(readFixture('../schema/frame-graph-snapshot-v1.schema.json'));
const formats = [
	'minimal.fgsnapshot.json',
	'../tests/fixtures/snapshot-1.1.json',
	'legacy-v0.json',
	'legacy-candidate-v1-canonical.json',
] as const;

// The Node test runner isolates this file in its own process. Keep prototype
// mutations synchronous and restore the original descriptor even on failure.
function withInherited(key: string, descriptor: PropertyDescriptor, check: () => void): void {
	const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
	try {
		Object.defineProperty(Object.prototype, key, { ...descriptor, configurable: true });
		check();
	} finally {
		if (original) Object.defineProperty(Object.prototype, key, original);
		else Reflect.deleteProperty(Object.prototype, key);
	}
}

function readFixture(name: string): any {
	return JSON.parse(readFileSync(resolve(process.cwd(), 'packages/snapshot/fixtures', name), 'utf8'));
}

function assertContainers(value: unknown): void {
	if (value === null || typeof value !== 'object') return;
	assert.equal(Object.getPrototypeOf(value), Array.isArray(value) ? Array.prototype : null);
	for (const child of Object.values(value)) assertContainers(child);
}

function hasMissing(issues: readonly FrameGraphSnapshotIssue[], path: string): boolean {
	return issues.some((issue) => issue.code === 'missing-property' && issue.path === path);
}

function assertRejected(value: FrameGraphSnapshot, path: string): void {
	assert.equal(hasMissing(validateFrameGraphSnapshot(value), path), true);
	for (const result of [decodeFrameGraphSnapshot(value), parseFrameGraphSnapshot(JSON.stringify(value))]) {
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(hasMissing(result.issues, path), true, JSON.stringify(result.issues));
	}
	for (const operation of [finalizeFrameGraphSnapshot, stringifyFrameGraphSnapshot]) {
		assert.throws(() => operation(value), (error: unknown) =>
			error instanceof FrameGraphSnapshotValidationError && hasMissing(error.issues, path));
	}
}

test('inherited required values and getters cannot satisfy Snapshot fields', { concurrency: false }, () => {
	for (const [key, path, container] of [
		['frameIndex', '/capture/frameIndex', 'capture'],
		['cpu', '/timings/cpu', 'timings'],
		['capture', '/capture', undefined],
	] as const) {
		const input = readFixture('minimal.fgsnapshot.json');
		const target = container === undefined ? input : input[container];
		const inherited = target[key];
		delete target[key];
		withInherited(key, { value: inherited }, () => assertRejected(input, path));
		let calls = 0;
		withInherited(key, { get() { calls++; throw new Error('inherited required getter'); } }, () => {
			assertRejected(input, path);
			assert.equal(calls, 0);
		});
	}
});

test('missing optional fields ignore inherited values and getters in every public operation', { concurrency: false }, () => {
	const input = readFixture('minimal.fgsnapshot.json');
	delete input.capture.capturedAt;
	const before = JSON.stringify(input);
	for (const getter of [false, true]) {
		let calls = 0;
		withInherited('capturedAt', getter
			? { get() { calls++; throw new Error('inherited optional getter'); } }
			: { value: 'inherited timestamp' }, () => {
			assert.deepEqual(validateFrameGraphSnapshot(input), []);
			const decoded = decodeFrameGraphSnapshot(input);
			const parsed = parseFrameGraphSnapshot(before);
			assert.equal(decoded.ok, true);
			assert.equal(parsed.ok, true);
			if (!decoded.ok || !parsed.ok) return;
			for (const snapshot of [decoded.snapshot, parsed.snapshot, finalizeFrameGraphSnapshot(input)]) {
				assert.equal(Object.hasOwn(snapshot.capture, 'capturedAt'), false);
				assert.equal(snapshot.capture.capturedAt, undefined);
				assertContainers(snapshot);
				assert.equal(stringifyFrameGraphSnapshot(snapshot), before);
			}
			assert.equal(stringifyFrameGraphSnapshot(input), before);
			assert.equal(calls, 0);
		});
	}
	assert.equal(JSON.stringify(input), before);
});

test('every migration and finalization returns detached null-prototype JSON objects', () => {
	for (const name of formats) {
		const input = readFixture(name);
		const before = JSON.stringify(input);
		const decoded = decodeFrameGraphSnapshot(input);
		assert.equal(decoded.ok, true, name);
		if (!decoded.ok) continue;
		assertContainers(decoded.snapshot);
		assertContainers(finalizeFrameGraphSnapshot(decoded.snapshot));
		const encoded = stringifyFrameGraphSnapshot(decoded.snapshot);
		const wire = JSON.parse(encoded);
		assert.equal(validateSchema(wire), true, ajv.errorsText(validateSchema.errors));
		const reparsed = parseFrameGraphSnapshot(encoded);
		assert.equal(reparsed.ok, true);
		if (reparsed.ok) assert.deepEqual(reparsed.snapshot, decoded.snapshot);
		assert.equal(JSON.stringify(input), before);
		input.producer = { name: 'changed after decoding' };
		assert.equal(stringifyFrameGraphSnapshot(decoded.snapshot), encoded);
	}
});

test('migration intermediate objects cannot restore inherited optional fields', { concurrency: false }, () => {
	for (const name of formats.slice(1)) {
		const input = readFixture(name);
		if (input.capture) delete input.capture.capturedAt;
		const before = JSON.stringify(input);
		for (const key of ['capturedAt', 'initialContents', 'groupId', 'migration']) {
			let calls = 0;
			let encoded: string | undefined;
			withInherited(key, { get() { calls++; throw new Error('inherited migration getter'); } }, () => {
				const result = decodeFrameGraphSnapshot(input);
				assert.equal(result.ok, true, name + ': ' + key);
				if (result.ok) {
					assertContainers(result.snapshot);
					encoded = stringifyFrameGraphSnapshot(result.snapshot);
				}
				assert.equal(calls, 0, key);
			});
			assert.ok(encoded);
			assert.equal(validateSchema(JSON.parse(encoded)), true);
		}
		assert.equal(JSON.stringify(input), before);
	}
});

test('legacy required fields cannot be supplied by the prototype', { concurrency: false }, () => {
	for (const name of formats.slice(1)) {
		const input = readFixture(name);
		const capture = name === 'legacy-v0.json' ? input.gpuTiming : input.capture;
		delete capture.frameIndex;
		withInherited('frameIndex', { value: 77 }, () => {
			const result = decodeFrameGraphSnapshot(input);
			assert.equal(result.ok, false, name);
			if (!result.ok) assert.ok(result.issues.some((issue) => issue.path.endsWith('/frameIndex')));
		});
	}
	const malformed = readFixture('legacy-candidate-v1-canonical.json');
	delete malformed.capture;
	withInherited('capture', { value: { frameIndex: 77 } }, () => {
		const result = decodeFrameGraphSnapshot(malformed);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(hasMissing(result.issues, '/capture'), true);
	});
});

test('extension prototype-related keys remain own JSON data', () => {
	const input = readFixture('minimal.fgsnapshot.json');
	const extension = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"ok":true}},"hasOwnProperty":"data","nested":[{"toJSON":"data"}]}');
	input.extensions['dev.zenfg.prototype'] = extension;
	const result = decodeFrameGraphSnapshot(input);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assertContainers(result.snapshot);
	const output = result.snapshot.extensions['dev.zenfg.prototype'] as Record<string, unknown>;
	assert.equal(Object.hasOwn(output, '__proto__'), true);
	assert.equal(output.polluted, undefined);
	assert.deepEqual(JSON.parse(stringifyFrameGraphSnapshot(result.snapshot)), input);
	assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});


test('malformed version containers return structured errors without coercion hooks', { concurrency: false }, () => {
	for (const name of ['minimal.fgsnapshot.json', 'legacy-candidate-v1-canonical.json']) {
		for (const field of ['major', 'minor']) {
			for (const invalid of [{}, { toString: null, valueOf: null }, [{}]]) {
				const input = readFixture(name);
				input.version[field] = invalid;
				const text = JSON.stringify(input);
				let calls = 0;
				withInherited('toString', { value() { calls++; throw new Error('version coercion hook'); } }, () => {
					for (const result of [decodeFrameGraphSnapshot(input), parseFrameGraphSnapshot(text)]) {
						assert.equal(result.ok, false);
						if (!result.ok) assert.ok(result.issues.some((issue) =>
							issue.code === 'unsupported-version' && issue.path === '/version'));
					}
					assert.equal(calls, 0);
				});
			}
		}
	}
});


test('inherited descriptor value cannot disguise accessor properties as JSON data', { concurrency: false }, () => {
	for (const array of [false, true]) {
		const input = readFixture('minimal.fgsnapshot.json');
		const target = array ? [0] : input.capture;
		const key = array ? '0' : 'frameIndex';
		const path = array ? '/extensions/dev.zenfg.descriptor/0' : '/capture/frameIndex';
		if (array) input.extensions['dev.zenfg.descriptor'] = target;
		let calls = 0;
		Object.defineProperty(target, key, {
			enumerable: true,
			configurable: true,
			get() { calls++; return 0; },
		});
		withInherited('value', { value: 77 }, () => {
			const containsIssue = (issues: readonly FrameGraphSnapshotIssue[]) =>
				issues.some((issue) => issue.code === 'invalid-json-value' && issue.path === path);
			assert.equal(containsIssue(validateFrameGraphSnapshot(input)), true);
			const decoded = decodeFrameGraphSnapshot(input);
			assert.equal(decoded.ok, false);
			if (!decoded.ok) assert.equal(containsIssue(decoded.issues), true);
			for (const operation of [finalizeFrameGraphSnapshot, stringifyFrameGraphSnapshot]) {
				assert.throws(() => operation(input), (error: unknown) =>
					error instanceof FrameGraphSnapshotValidationError && containsIssue(error.issues));
			}
			assert.equal(calls, 0);
		});
	}
});

