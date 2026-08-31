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
} from './validator.ts';

/**
 * Error thrown when a value cannot be serialized as a valid Snapshot 1.0
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
 * Validates an unknown value against the canonical Snapshot 1.0 semantic model.
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
 * Finalizes a producer-owned Snapshot draft into a canonical Snapshot 1.0 value.
 *
 * @remarks Object properties whose value is `undefined` are omitted to support
 * producer drafts assembled from optional fields. The result is detached from
 * the draft and has passed JSON-safety and semantic validation.
 * @throws {@link FrameGraphSnapshotValidationError} when the draft cannot be
 * finalized as a valid Snapshot 1.0 document.
 */
export function finalizeFrameGraphSnapshot(draft: unknown): FrameGraphSnapshot {
	const cloned = cloneGeneratedSnapshotJsonValue(draft);
	if (!cloned.ok) throw new FrameGraphSnapshotValidationError(cloned.issues);
	const issues = validateSnapshotV1(cloned.value);
	if (issues.length > 0) throw new FrameGraphSnapshotValidationError(issues);
	return cloned.value as FrameGraphSnapshot;
}

/**
 * Decodes an already-parsed value into a canonical Snapshot 1.0 document.
 *
 * @remarks Supported Legacy V0 and Legacy Candidate V1 captures are migrated
 * before validation. Successful results identify the source format and carry
 * migration warnings; unsupported, malformed, or semantically invalid values
 * return `{ ok: false, issues }` and do not throw. Decoding and migration do
 * not mutate the input value. Input properties are inspected through data
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
		const canonical = cloneGeneratedSnapshotJsonValue(migrated.snapshot);
		if (!canonical.ok) return { ok: false, issues: canonical.issues };
		const validationIssues = validateSnapshotV1(canonical.value);
		if (validationIssues.length > 0) return { ok: false, issues: validationIssues };
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
	if (
		!version
		|| version.major !== FRAME_GRAPH_SNAPSHOT_VERSION.major
		|| version.minor !== FRAME_GRAPH_SNAPSHOT_VERSION.minor
	) {
		const actual = version ? `${String(version.major)}.${String(version.minor)}` : 'missing';
		return failure(
			'unsupported-version',
			'/version',
			`Snapshot version ${actual} is not supported; this Viewer supports 1.0.`,
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
		const actual = version ? `${String(version.major)}.${String(version.minor)}` : 'missing';
		return failure('unsupported-version', '/version', `Snapshot version ${actual} is not supported; this Viewer supports 1.0.`);
	}
	const candidate: Record<string, unknown> = {
		...value,
		format: FRAME_GRAPH_SNAPSHOT_FORMAT,
	};
	const capture = asRecord(value.capture);
	const graph = asRecord(value.graph);
	if (!capture || !graph || !Array.isArray(graph.resources)) {
		const issues = validateSnapshotV1(candidate);
		return { ok: false, issues };
	}
	candidate.capture = {
		...capture,
		migration: { sourceFormat: 'legacy-candidate-v1', unavailableFacts: [] },
	};
	const resources = Array.from(graph.resources, (entry) => {
		const resource = asRecord(entry);
		if (!resource) return entry;
		const migratedResource = { ...resource };
		if (resource.origin === 'transient' || resource.origin === 'surface') {
			migratedResource.initialContents = 'undefined';
		} else if (resource.origin === 'imported') {
			delete migratedResource.initialContents;
		}
		return migratedResource;
	});
	candidate.graph = { ...graph, resources };
	const issues = validateSnapshotV1(candidate);
	if (issues.length > 0) return { ok: false, issues };
	return {
		ok: true,
		snapshot: candidate as FrameGraphSnapshot,
		source: 'legacy-candidate-v1',
		migrated: true,
		issues: [{
			severity: 'warning',
			code: 'legacy-candidate-v1-migrated',
			path: '',
			message: 'Legacy Candidate V1 was migrated to ZenFG Snapshot 1.0.',
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
 * Validates and serializes a canonical Snapshot 1.0 document.
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
			if (!descriptor || !('value' in descriptor)) continue;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function failure(code: string, path: string, message: string): FrameGraphSnapshotDecodeResult {
	return {
		ok: false,
		issues: [{ severity: 'error', code, path, message }],
	};
}
