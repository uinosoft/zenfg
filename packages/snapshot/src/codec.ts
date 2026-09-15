import {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH,
	FRAME_GRAPH_SNAPSHOT_VERSION,
	LEGACY_CANDIDATE_FRAME_GRAPH_SNAPSHOT_FORMAT,
} from './format.ts';
import {
	isLegacyFrameGraphCapture,
	migrateLegacyFrameGraphCapture,
} from './legacy.ts';
import type {
	FrameGraphSnapshot,
	FrameGraphSnapshotDecodeResult,
	FrameGraphSnapshotIssue,
	FrameGraphSnapshotStringifyOptions,
} from './types.ts';
import {
	cloneGeneratedSnapshotJsonValue,
	cloneSnapshotJsonValue,
	validateSnapshotV1,
	type SnapshotJsonCloneResult,
} from './validator.ts';

/**
 * Error thrown when a value cannot be serialized as a valid Snapshot 1.2
 * document.
 *
 * Decode and parse failures are returned as {@link FrameGraphSnapshotIssue}
 * values instead; this error is reserved for producer-side serialization.
 */
export class FrameGraphSnapshotValidationError extends Error {
	constructor(
		/** All validation failures that prevented serialization. */
		readonly issues: readonly FrameGraphSnapshotIssue[],
	) {
		super(issues.map((issue) => `${issue.path || '/'}: ${issue.message}`).join('\n'));
		this.name = 'FrameGraphSnapshotValidationError';
	}
}

/**
 * Validates an unknown value against the canonical Snapshot 1.2 semantic model.
 *
 * @remarks This first creates an independent JSON-safe clone by inspecting own
 * property descriptors, so getters and `toJSON` hooks are never invoked. It
 * then performs structural and cross-reference checks without migrating legacy
 * formats. Extension object/array nesting is limited by
 * {@link FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH}. An empty array means valid.
 */
export function validateFrameGraphSnapshot(value: unknown): readonly FrameGraphSnapshotIssue[] {
	const cloned = cloneSnapshotJsonValue(value);
	return cloned.ok ? validateSnapshotV1(cloned.value) : cloned.issues;
}

/**
 * Finalizes a producer-owned Snapshot draft into a canonical Snapshot 1.2 value.
 *
 * @remarks Object properties whose value is `undefined` are omitted to support
 * producer drafts assembled from optional fields. The result is detached from
 * the draft and has passed JSON-safety and semantic validation. All JSON
 * objects in the result have null prototypes; arrays remain ordinary arrays.
 * Use `Object.hasOwn(object, key)` to test for own fields.
 * @throws {@link FrameGraphSnapshotValidationError} when the draft cannot be
 * finalized as a valid Snapshot 1.2 document.
 */
export function finalizeFrameGraphSnapshot(draft: unknown): FrameGraphSnapshot {
	const cloned = canonicalizeGeneratedSnapshot(draft);
	if (!cloned.ok) throw new FrameGraphSnapshotValidationError(cloned.issues);
	return cloned.value as FrameGraphSnapshot;
}

/**
 * Decodes an already-parsed value into a canonical Snapshot 1.2 document.
 *
 * @remarks Snapshot 1.1 is strictly validated before upgrading. Supported
 * Legacy V0 and Legacy Candidate V1 captures are migrated
 * before validation. Successful results identify the source format and carry
 * migration warnings; unsupported, malformed, or semantically invalid values
 * return `{ ok: false, issues }` and do not throw. Decoding and migration do
 * not mutate the input value. Returned JSON objects (including extensions)
 * have null prototypes; arrays use the current realm's Array prototype. Use
 * `Object.hasOwn(object, key)` instead of inherited object methods.
 * Input properties are inspected through data
 * descriptors, so getters and `toJSON` hooks are never invoked. Extension
 * object/array nesting is limited by
 * {@link FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH}.
 *
 * @example
 * ```ts
 * const result = decodeFrameGraphSnapshot(untrustedValue);
 * if (result.ok) console.log(result.snapshot.graph.nodes.length);
 * else console.error(result.issues);
 * ```
 */
export function decodeFrameGraphSnapshot(value: unknown): FrameGraphSnapshotDecodeResult {
	const cloned = cloneSnapshotJsonValue(value);
	if (!cloned.ok) return { ok: false, issues: cloned.issues };
	const safeValue = cloned.value;
	if (isLegacyFrameGraphCapture(safeValue)) {
		const migrated = migrateLegacyFrameGraphCapture(safeValue);
		if (!migrated.ok) return migrated;
		const canonical = canonicalizeGeneratedSnapshot(migrated.snapshot);
		if (!canonical.ok) return { ok: false, issues: canonical.issues };
		return {
			ok: true,
			snapshot: canonical.value as FrameGraphSnapshot,
			source: 'legacy-v0',
			migrated: true,
			issues: migrated.issues,
		};
	}
	const root = asRecord(safeValue);
	if (root?.format === LEGACY_CANDIDATE_FRAME_GRAPH_SNAPSHOT_FORMAT) {
		return migrateLegacyCandidateV1(root);
	}
	if (!root || root.format !== FRAME_GRAPH_SNAPSHOT_FORMAT) {
		return failure('unsupported-format', '/format', `Expected FrameGraph Snapshot format "${FRAME_GRAPH_SNAPSHOT_FORMAT}".`);
	}
	const version = asRecord(root.version);
	if (version?.major === 1 && version.minor === 1) {
		const issues = validateSnapshotV1(safeValue, 1);
		if (issues.length) return { ok: false, issues };
		const capture = asRecord(root.capture)!;
		const upgraded = { ...root, version: FRAME_GRAPH_SNAPSHOT_VERSION,
			capture: { ...capture, migration: capture.migration ?? { sourceFormat: 'snapshot-v1.1', unavailableFacts: [] } },
			timings: { ...asRecord(root.timings), cpu: { status: 'unavailable', reason: 'not-collected' } } };
		const canonical = canonicalizeGeneratedSnapshot(upgraded);
		if (!canonical.ok) return { ok: false, issues: canonical.issues };
		return { ok: true, snapshot: canonical.value as FrameGraphSnapshot, source: 'snapshot-v1.1', migrated: true,
			issues: [{ severity: 'warning', code: 'snapshot-v1.1-migrated', path: '', message: 'Snapshot 1.1 was migrated to ZenFG Snapshot 1.2; CPU timing was not collected.' }] };
	}
	if (
		!version
		|| version.major !== FRAME_GRAPH_SNAPSHOT_VERSION.major
		|| version.minor !== FRAME_GRAPH_SNAPSHOT_VERSION.minor
	) {
		const actual = version ? `${describeVersionComponent(version.major)}.${describeVersionComponent(version.minor)}` : 'missing';
		return failure(
			'unsupported-version',
			'/version',
			`Snapshot version ${actual} is not supported; this Viewer supports 1.2.`,
		);
	}
	const issues = validateSnapshotV1(safeValue);
	if (issues.length > 0) return { ok: false, issues };
	return {
		ok: true,
		snapshot: safeValue as FrameGraphSnapshot,
		source: 'v1',
		migrated: false,
		issues: [],
	};
}

function migrateLegacyCandidateV1(value: Record<string, unknown>): FrameGraphSnapshotDecodeResult {
	const version = asRecord(value.version);
	if (!version || version.major !== 1 || version.minor !== 0) {
		const actual = version ? `${describeVersionComponent(version.major)}.${describeVersionComponent(version.minor)}` : 'missing';
		return failure('unsupported-version', '/version', `Snapshot version ${actual} is not supported; this Viewer supports 1.2.`);
	}
	const candidate: Record<string, unknown> = {
		__proto__: null,
		...value,
		format: FRAME_GRAPH_SNAPSHOT_FORMAT,
		version: { major: 1, minor: 1 },
	};
	const capture = asRecord(value.capture);
	const graph = asRecord(value.graph);
	if (!capture || !graph || !Array.isArray(graph.resources)) {
		const cloned = cloneGeneratedSnapshotJsonValue(candidate);
		return { ok: false, issues: cloned.ok ? validateSnapshotV1(cloned.value, 1) : cloned.issues };
	}
	candidate.capture = {
		...capture,
		migration: { sourceFormat: 'legacy-candidate-v1', unavailableFacts: Array.isArray(graph.roots) && graph.roots.some((root) => asRecord(root)?.resourceId !== undefined) ? ['graph.roots.range', 'graph.roots.resolution'] : [] },
	};
	const resources = Array.from(graph.resources, (entry) => {
		const resource = asRecord(entry);
		if (!resource) return entry;
		const migratedResource: Record<string, unknown> = { __proto__: null, ...resource };
		if (resource.origin === 'transient' || resource.origin === 'surface') {
			migratedResource.initialContents = 'undefined';
		} else if (resource.origin === 'imported') {
			delete migratedResource.initialContents;
		}
		return migratedResource;
	});
	candidate.graph = { ...graph, resources };
	const canonical = canonicalizeGeneratedSnapshot(candidate, 1);
	if (!canonical.ok) return { ok: false, issues: canonical.issues };
	const canonicalRecord = asRecord(canonical.value)!;
	canonicalRecord.version = FRAME_GRAPH_SNAPSHOT_VERSION;
	canonicalRecord.timings = { ...asRecord(canonicalRecord.timings), cpu: { status: 'unavailable', reason: 'not-collected' } };
	const upgraded = canonicalizeGeneratedSnapshot(canonicalRecord);
	if (!upgraded.ok) return { ok: false, issues: upgraded.issues };
	return {
		ok: true,
		snapshot: upgraded.value as FrameGraphSnapshot,
		source: 'legacy-candidate-v1',
		migrated: true,
		issues: [{
			severity: 'warning',
			code: 'legacy-candidate-v1-migrated',
			path: '',
			message: 'Legacy Candidate V1 was migrated to ZenFG Snapshot 1.2.',
		}],
	};
}

/**
 * Parses JSON text and then applies the same migration and validation pipeline
 * as {@link decodeFrameGraphSnapshot}.
 *
 * @remarks Invalid JSON is represented by an `invalid-json` issue. This
 * function does not throw for document or validation errors.
 */
export function parseFrameGraphSnapshot(text: string): FrameGraphSnapshotDecodeResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	}
	catch {
		return failure(
			'invalid-json',
			'',
			'Invalid JSON.',
		);
	}
	return decodeFrameGraphSnapshot(value);
}

/**
 * Validates and serializes a canonical Snapshot 1.2 document.
 *
 * @remarks The input is cloned through own data-property descriptors before
 * validation and serialization, so getters and `toJSON` hooks are never
 * invoked. Extension object/array nesting is limited by
 * {@link FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH}.
 * @param snapshot - Producer-owned snapshot to validate before serialization.
 * @param options - Formatting options. Omitted options produce compact JSON.
 * @returns Canonical JSON text without mutating `snapshot`.
 * @throws {@link FrameGraphSnapshotValidationError} when JSON-safety or
 * semantic validation fails.
 */
export function stringifyFrameGraphSnapshot(
	snapshot: FrameGraphSnapshot,
	options: FrameGraphSnapshotStringifyOptions = {},
): string {
	const cloned = cloneSnapshotJsonValue(snapshot);
	if (!cloned.ok) throw new FrameGraphSnapshotValidationError(cloned.issues);
	const issues = validateSnapshotV1(cloned.value);
	if (issues.length > 0) throw new FrameGraphSnapshotValidationError(issues);
	shadowInheritedToJsonHooks(cloned.value);
	return JSON.stringify(cloned.value, null, options.pretty ? 2 : undefined);
}

function shadowInheritedToJsonHooks(value: unknown): void {
	if (typeof value !== 'object' || value === null) return;
	const stack: object[] = [value];
	while (stack.length > 0) {
		const container = stack.pop()!;
		const isArray = Array.isArray(container);
		const keys = Reflect.ownKeys(container);
		let ownsToJson = false;
		for (const key of keys) {
			if (key === 'toJSON') ownsToJson = true;
			if (typeof key === 'symbol' || (isArray && key === 'length')) continue;
			const descriptor = Object.getOwnPropertyDescriptor(container, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
			const child = descriptor.value;
			if (typeof child === 'object' && child !== null) stack.push(child);
		}
		if (!ownsToJson) {
			Object.defineProperty(container, 'toJSON', {
				value: undefined,
				enumerable: false,
				configurable: true,
				writable: true,
			});
		}
	}
}

// Generated drafts can contain ordinary objects and omitted optional fields.
// Re-clone before semantic reads so migration never restores inherited fields.
function canonicalizeGeneratedSnapshot(value: unknown, minor: 1 | 2 = 2): SnapshotJsonCloneResult {
	const cloned = cloneGeneratedSnapshotJsonValue(value);
	if (!cloned.ok) return cloned;
	const issues = validateSnapshotV1(cloned.value, minor);
	return issues.length > 0 ? { ok: false, issues } : cloned;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

// Invalid version containers must not invoke conversion hooks (or require an
// Object prototype) just to produce a structured unsupported-version issue.
function describeVersionComponent(value: unknown): string {
	if (typeof value === 'object' && value !== null) return Array.isArray(value) ? '[array]' : '[object]';
	return String(value);
}

function failure(code: string, path: string, message: string): FrameGraphSnapshotDecodeResult {
	return {
		ok: false,
		issues: [{ severity: 'error', code, path, message }],
	};
}
