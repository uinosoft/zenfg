import {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_VERSION,
	T3D_FRAME_GRAPH_SNAPSHOT_FORMAT,
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
import { validateSnapshotV1 } from './validator.ts';

export class FrameGraphSnapshotValidationError extends Error {
	constructor(readonly issues: readonly FrameGraphSnapshotIssue[]) {
		super(issues.map((issue) => `${issue.path || '/'}: ${issue.message}`).join('\n'));
		this.name = 'FrameGraphSnapshotValidationError';
	}
}

export function validateFrameGraphSnapshot(value: unknown): readonly FrameGraphSnapshotIssue[] {
	return validateSnapshotV1(value);
}

export function decodeFrameGraphSnapshot(value: unknown): FrameGraphSnapshotDecodeResult {
	if (isLegacyFrameGraphCapture(value)) {
		const migrated = migrateLegacyFrameGraphCapture(value);
		if (!migrated.ok) return migrated;
		const validationIssues = validateSnapshotV1(migrated.snapshot);
		if (validationIssues.length > 0) return { ok: false, issues: validationIssues };
		return {
			ok: true,
			snapshot: canonicalClone(migrated.snapshot),
			source: 'legacy-v0',
			migrated: true,
			issues: migrated.issues,
		};
	}
	const root = asRecord(value);
	if (root?.format === T3D_FRAME_GRAPH_SNAPSHOT_FORMAT) {
		return migrateT3dV1(root);
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
	const issues = validateSnapshotV1(value);
	if (issues.length > 0) return { ok: false, issues };
	return {
		ok: true,
		snapshot: canonicalClone(value as FrameGraphSnapshot),
		source: 'v1',
		migrated: false,
		issues: [],
	};
}

function migrateT3dV1(value: Record<string, unknown>): FrameGraphSnapshotDecodeResult {
	const version = asRecord(value.version);
	if (!version || version.major !== 1 || version.minor !== 0) {
		const actual = version ? `${String(version.major)}.${String(version.minor)}` : 'missing';
		return failure('unsupported-version', '/version', `Snapshot version ${actual} is not supported; this Viewer supports 1.0.`);
	}
	const candidate = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
	candidate.format = FRAME_GRAPH_SNAPSHOT_FORMAT;
	const capture = asRecord(candidate.capture);
	const graph = asRecord(candidate.graph);
	if (!capture || !graph || !Array.isArray(graph.resources)) {
		const issues = validateSnapshotV1(candidate);
		return { ok: false, issues };
	}
	capture.migration = { sourceFormat: 't3d-v1', unavailableFacts: [] };
	for (const entry of graph.resources) {
		const resource = asRecord(entry);
		if (!resource) continue;
		if (resource.origin === 'transient' || resource.origin === 'surface') {
			resource.initialContents = 'undefined';
		} else if (resource.origin === 'imported') {
			delete resource.initialContents;
		}
	}
	const issues = validateSnapshotV1(candidate);
	if (issues.length > 0) return { ok: false, issues };
	return {
		ok: true,
		snapshot: canonicalClone(candidate as FrameGraphSnapshot),
		source: 't3d-v1',
		migrated: true,
		issues: [{
			severity: 'warning',
			code: 't3d-v1-migrated',
			path: '',
			message: 'The t3d V1 candidate was migrated to ZenFG Snapshot 1.0.',
		}],
	};
}

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

export function stringifyFrameGraphSnapshot(
	snapshot: FrameGraphSnapshot,
	options: FrameGraphSnapshotStringifyOptions = {},
): string {
	const issues = validateSnapshotV1(snapshot);
	if (issues.length > 0) throw new FrameGraphSnapshotValidationError(issues);
	return JSON.stringify(snapshot, null, options.pretty ? 2 : undefined);
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

function canonicalClone(snapshot: FrameGraphSnapshot): FrameGraphSnapshot {
	return JSON.parse(JSON.stringify(snapshot)) as FrameGraphSnapshot;
}
