import {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_VERSION,
} from './format.ts';
import type {
	FrameGraphSnapshot,
	FrameGraphSnapshotAccess,
	FrameGraphSnapshotBufferRange,
	FrameGraphSnapshotBufferUsageFlag,
	FrameGraphSnapshotIssue,
	FrameGraphSnapshotNode,
	FrameGraphSnapshotResource,
	FrameGraphSnapshotTextureRegion,
	FrameGraphSnapshotTextureUsageFlag,
	FrameGraphSnapshotUnavailableFact,
} from './types.ts';

type UnknownRecord = Record<string, unknown>;
type Issues = FrameGraphSnapshotIssue[];

export type LegacyMigrationResult =
	| {
		readonly ok: true;
		readonly snapshot: FrameGraphSnapshot;
		readonly issues: readonly FrameGraphSnapshotIssue[];
	}
	| {
		readonly ok: false;
		readonly issues: readonly FrameGraphSnapshotIssue[];
	};

const NODE_KINDS = ['render', 'compute', 'copy', 'clear-buffer', 'command', 'external-submission'] as const;
const RESOURCE_KINDS = ['texture', 'buffer'] as const;
const RESOURCE_ORIGINS = ['transient', 'imported', 'swapchain', 'surface'] as const;
const ACCESS_KINDS = [
	'texture-sampled',
	'texture-storage-read',
	'texture-storage-write',
	'texture-color-attachment-write',
	'texture-depth-read',
	'texture-depth-write',
	'texture-copy-src',
	'texture-copy-dst',
	'buffer-uniform',
	'buffer-storage-read',
	'buffer-storage-write',
	'buffer-vertex',
	'buffer-index',
	'buffer-indirect',
	'buffer-copy-src',
	'buffer-copy-dst',
] as const;
const ROOT_REASONS = ['present', 'output', 'readback', 'side-effect', 'debug-capture'] as const;
const TEXTURE_USAGE_FLAGS: readonly [number, FrameGraphSnapshotTextureUsageFlag][] = [
	[0x01, 'copy-src'],
	[0x02, 'copy-dst'],
	[0x04, 'texture-binding'],
	[0x08, 'storage-binding'],
	[0x10, 'render-attachment'],
];
const BUFFER_USAGE_FLAGS: readonly [number, FrameGraphSnapshotBufferUsageFlag][] = [
	[0x0001, 'map-read'],
	[0x0002, 'map-write'],
	[0x0004, 'copy-src'],
	[0x0008, 'copy-dst'],
	[0x0010, 'index'],
	[0x0020, 'vertex'],
	[0x0040, 'uniform'],
	[0x0080, 'storage'],
	[0x0100, 'indirect'],
	[0x0200, 'query-resolve'],
];

export function isLegacyFrameGraphCapture(value: unknown): boolean {
	const capture = asRecord(value);
	return Boolean(
		capture
		&& capture.format === undefined
		&& ['compilation', 'gpuTiming', 'resourcePool'].some((name) => Object.hasOwn(capture, name)),
	);
}

export function migrateLegacyFrameGraphCapture(value: unknown): LegacyMigrationResult {
	const errors: Issues = [];
	const capture = asRecord(value);
	const compilation = requiredRecord(capture?.compilation, '/compilation', errors);
	const gpuTiming = requiredRecord(capture?.gpuTiming, '/gpuTiming', errors);
	const resourcePool = requiredRecord(capture?.resourcePool, '/resourcePool', errors);
	if (!capture || !compilation || !gpuTiming || !resourcePool) return { ok: false, issues: errors };

	const retained = recordArray(compilation.nodes, '/compilation/nodes', errors);
	const culled = recordArray(compilation.culledNodes, '/compilation/culledNodes', errors);
	const resources = recordArray(compilation.resources, '/compilation/resources', errors);
	const groupsAvailable = Object.hasOwn(compilation, 'debugGroups');
	const groups = groupsAvailable ? recordArray(compilation.debugGroups, '/compilation/debugGroups', errors) : [];
	const accesses = recordArray(compilation.accesses, '/compilation/accesses', errors);
	const dependencies = recordArray(compilation.dependencies, '/compilation/dependencies', errors);
	const roots = recordArray(compilation.roots, '/compilation/roots', errors);
	const allocations = recordArray(compilation.allocations, '/compilation/allocations', errors);
	const segments = recordArray(compilation.executionSegments, '/compilation/executionSegments', errors);

	const executionOrder = new Map<number, number>();
	for (let index = 0; index < retained.length; index++) {
		const id = requiredSafeInteger(retained[index].id, `/compilation/nodes/${index}/id`, errors);
		if (id !== undefined) executionOrder.set(id, index);
	}

	const nodes: FrameGraphSnapshotNode[] = [...retained, ...culled].flatMap((node, index) => {
		const retainedNode = index < retained.length;
		const sourceIndex = retainedNode ? index : index - retained.length;
		const path = retainedNode ? `/compilation/nodes/${sourceIndex}` : `/compilation/culledNodes/${sourceIndex}`;
		const id = requiredSafeInteger(node.id, `${path}/id`, errors);
		const kind = requiredEnum(node.kind, NODE_KINDS, `${path}/kind`, errors);
		const sideEffect = requiredBoolean(node.sideEffect, `${path}/sideEffect`, errors);
		const label = optionalString(node.label, `${path}/label`, errors);
		const debugGroupId = optionalSafeInteger(node.debugGroupId, `${path}/debugGroupId`, errors);
		const reason = retainedNode ? undefined : optionalNonEmptyString(node.reason, `${path}/reason`, errors);
		if (id === undefined || kind === undefined || sideEffect === undefined) return [];
		const order = executionOrder.get(id);
		return [{
			id: nodeId(id),
			kind,
			label,
			sideEffect,
			groupId: groupsAvailable && debugGroupId !== undefined ? groupId(debugGroupId) : undefined,
			compileState: order === undefined
				? { status: 'culled', reason: reason ?? 'not-reachable-from-root' }
				: { status: 'retained', executionOrder: order },
		}];
	});

	const mappedResources: FrameGraphSnapshotResource[] = resources.flatMap((resource, index): FrameGraphSnapshotResource[] => {
		const path = `/compilation/resources/${index}`;
		const id = requiredSafeInteger(resource.id, `${path}/id`, errors);
		const kind = requiredEnum(resource.kind, RESOURCE_KINDS, `${path}/kind`, errors);
		const origin = requiredEnum(resource.origin, RESOURCE_ORIGINS, `${path}/origin`, errors);
		const usage = requiredUint32(resource.usage, `${path}/usage`, errors);
		const label = optionalString(resource.label, `${path}/label`, errors);
		const debugGroupId = optionalSafeInteger(resource.debugGroupId, `${path}/debugGroupId`, errors);
		const allocation = optionalSafeInteger(resource.physicalAllocationId, `${path}/physicalAllocationId`, errors);
		const estimatedByteSize = optionalSafeInteger(resource.estimatedByteSize, `${path}/estimatedByteSize`, errors);
		const lifetime = migrateLifetime(resource.lifetime, `${path}/lifetime`, errors);
		if (id === undefined || kind === undefined || origin === undefined || usage === undefined) return [];
		const descriptor = migrateDescriptor(kind, resource.descriptor, `${path}/descriptor`, errors);
		const common = {
			id: resourceId(id),
			label,
			origin: origin === 'swapchain' ? 'surface' as const : origin,
			initialContents: origin === 'transient' || origin === 'swapchain' ? 'undefined' as const : undefined,
			groupId: groupsAvailable && debugGroupId !== undefined ? groupId(debugGroupId) : undefined,
			lifetime,
			allocationId: allocation === undefined ? undefined : allocationId(allocation),
			estimatedByteSize,
		};
		return kind === 'texture'
			? [{ ...common, kind, descriptor: descriptor?.kind === 'texture' ? descriptor : undefined, usageFlags: decodeUsageFlags(kind, usage, `${path}/usage`, errors) }]
			: [{ ...common, kind, descriptor: descriptor?.kind === 'buffer' ? descriptor : undefined, usageFlags: decodeUsageFlags(kind, usage, `${path}/usage`, errors) }];
	});

	const mappedAccesses: FrameGraphSnapshotAccess[] = accesses.flatMap((access, index): FrameGraphSnapshotAccess[] => {
		const path = `/compilation/accesses/${index}`;
		const id = requiredSafeInteger(access.id, `${path}/id`, errors);
		const node = requiredSafeInteger(access.nodeId, `${path}/nodeId`, errors);
		const resource = requiredSafeInteger(access.resourceId, `${path}/resourceId`, errors);
		const accessKind = requiredEnum(access.access, ACCESS_KINDS, `${path}/access`, errors);
		const mode = requiredEnum(access.mode, ['read', 'write'] as const, `${path}/mode`, errors);
		const producesValue = requiredBoolean(access.producesValue, `${path}/producesValue`, errors);
		optionalSafeInteger(access.textureViewId, `${path}/textureViewId`, errors);
		const textureRegion = migrateTextureRegion(access.textureRegion, `${path}/textureRegion`, errors);
		const bufferRange = migrateBufferRange(access.bufferRange, `${path}/bufferRange`, errors);
		if (id === undefined || node === undefined || resource === undefined || accessKind === undefined || mode === undefined || producesValue === undefined) return [];
		const common = {
			id: accessId(id),
			nodeId: nodeId(node),
			resourceId: resourceId(resource),
			access: accessKind,
			textureRegion,
			bufferRange,
		};
		if (mode === 'read') {
			if (access.contents !== undefined) errors.push(issue('legacy-access-contents', `${path}/contents`, 'Legacy read access cannot declare contents.'));
			if (producesValue !== false) errors.push(issue('legacy-access-value', `${path}/producesValue`, 'Legacy read access must set producesValue to false.'));
			return [{ ...common, mode, producesValue: false }];
		}
		const contents = requiredEnum(access.contents, ['overwrite', 'preserve'] as const, `${path}/contents`, errors);
		return contents === undefined ? [] : [{ ...common, mode, contents, producesValue }];
	});

	const mappedGroups = groups.flatMap((group, index) => {
		const path = `/compilation/debugGroups/${index}`;
		const id = requiredSafeInteger(group.id, `${path}/id`, errors);
		const parentId = optionalSafeInteger(group.parentId, `${path}/parentId`, errors);
		const label = requiredNonEmptyString(group.label, `${path}/label`, errors);
		return id === undefined || label === undefined ? [] : [{ id: groupId(id), parentId: parentId === undefined ? undefined : groupId(parentId), label }];
	});
	const mappedDependencies = dependencies.flatMap((dependency, index) => {
		const path = `/compilation/dependencies/${index}`;
		const from = requiredSafeInteger(dependency.fromNodeId, `${path}/fromNodeId`, errors);
		const to = requiredSafeInteger(dependency.toNodeId, `${path}/toNodeId`, errors);
		const resource = requiredSafeInteger(dependency.resourceId, `${path}/resourceId`, errors);
		const kind = requiredEnum(dependency.kind, ['value', 'ordering'] as const, `${path}/kind`, errors);
		return from === undefined || to === undefined || resource === undefined || kind === undefined ? [] : [{ fromNodeId: nodeId(from), toNodeId: nodeId(to), resourceId: resourceId(resource), kind }];
	});
	const mappedRoots = roots.flatMap((root, index) => {
		const path = `/compilation/roots/${index}`;
		const reason = requiredEnum(root.reason, ROOT_REASONS, `${path}/reason`, errors);
		const node = optionalSafeInteger(root.nodeId, `${path}/nodeId`, errors);
		const resource = optionalSafeInteger(root.resourceId, `${path}/resourceId`, errors);
		if ((node === undefined) === (resource === undefined)) errors.push(issue('legacy-root', path, 'Legacy root must reference exactly one node or resource.'));
		return reason === undefined || (node === undefined) === (resource === undefined) ? [] : [{ reason, nodeId: node === undefined ? undefined : nodeId(node), resourceId: resource === undefined ? undefined : resourceId(resource) }];
	});
	const mappedAllocations = allocations.flatMap((allocation, index) => {
		const path = `/compilation/allocations/${index}`;
		const id = requiredSafeInteger(allocation.id, `${path}/id`, errors);
		const kind = requiredEnum(allocation.kind, RESOURCE_KINDS, `${path}/kind`, errors);
		const compatibility = requiredSafeInteger(allocation.compatibilityClassId, `${path}/compatibilityClassId`, errors);
		const estimatedByteSize = optionalSafeInteger(allocation.estimatedByteSize, `${path}/estimatedByteSize`, errors);
		return id === undefined || kind === undefined || compatibility === undefined ? [] : [{ id: allocationId(id), kind, compatibilityClassId: compatibilityClassId(compatibility), estimatedByteSize }];
	});
	const mappedSegments = segments.flatMap((segment, index) => {
		const path = `/compilation/executionSegments/${index}`;
		const order = requiredSafeInteger(segment.index, `${path}/index`, errors);
		const kind = requiredEnum(segment.kind, ['frame-graph', 'external-submission'] as const, `${path}/kind`, errors);
		const ids = safeIntegerArray(segment.nodeIds, `${path}/nodeIds`, errors);
		return order === undefined || kind === undefined || ids === undefined ? [] : [{ id: segmentId(order), order, kind, nodeIds: ids.map(nodeId) }];
	});

	const frameIndex = requiredSafeInteger(gpuTiming.frameIndex, '/gpuTiming/frameIndex', errors);
	const timingStatus = requiredEnum(gpuTiming.status, ['available', 'unavailable'] as const, '/gpuTiming/status', errors);
	let gpu: FrameGraphSnapshot['timings']['gpu'] | undefined;
	if (timingStatus === 'available') {
		const frameSpanMicros = requiredFiniteNumber(gpuTiming.frameDurationMicros, '/gpuTiming/frameDurationMicros', errors);
		const timingNodes = recordArray(gpuTiming.nodes, '/gpuTiming/nodes', errors).flatMap((timing, index) => {
			const path = `/gpuTiming/nodes/${index}`;
			const node = requiredSafeInteger(timing.nodeId, `${path}/nodeId`, errors);
			const durationMicros = requiredFiniteNumber(timing.durationMicros, `${path}/durationMicros`, errors);
			if (timing.kind !== undefined) requiredNonEmptyString(timing.kind, `${path}/kind`, errors);
			return node === undefined || durationMicros === undefined ? [] : [{ nodeId: nodeId(node), durationMicros }];
		});
		if (frameSpanMicros !== undefined) gpu = { status: 'available', frameSpanMicros, nodes: timingNodes };
	} else if (timingStatus === 'unavailable') {
		const reason = requiredNonEmptyString(gpuTiming.reason, '/gpuTiming/reason', errors);
		if (reason !== undefined) gpu = { status: 'unavailable', reason };
	}

	const acquireCount = requiredSafeInteger(resourcePool.acquireCount, '/resourcePool/acquireCount', errors);
	const reuseCount = requiredSafeInteger(resourcePool.reuseCount, '/resourcePool/reuseCount', errors);
	const createdCount = requiredSafeInteger(resourcePool.createdCount, '/resourcePool/createdCount', errors);
	const retainedCount = requiredSafeInteger(resourcePool.retainedCount, '/resourcePool/retainedCount', errors);
	const estimatedRetainedBytes = optionalSafeInteger(resourcePool.estimatedRetainedBytes, '/resourcePool/estimatedRetainedBytes', errors);

	if (frameIndex === undefined || !gpu || acquireCount === undefined || reuseCount === undefined || createdCount === undefined || retainedCount === undefined || errors.length > 0) {
		return { ok: false, issues: errors };
	}

	const unavailableFacts: FrameGraphSnapshotUnavailableFact[] = [
		'graph.textureViews',
		'graph.nodes.recordingOrder',
	];
	if (!groupsAvailable) unavailableFacts.unshift('graph.groups');
	if (mappedAccesses.some((access) => access.access.startsWith('texture-') ? !access.textureRegion : !access.bufferRange)) {
		unavailableFacts.push('graph.accesses.regions');
	}

	const snapshot: FrameGraphSnapshot = {
		format: FRAME_GRAPH_SNAPSHOT_FORMAT,
		version: FRAME_GRAPH_SNAPSHOT_VERSION,
		producer: { name: 'legacy-unversioned' },
		capture: {
			frameIndex,
			migration: { sourceFormat: 'legacy-v0', unavailableFacts },
		},
		graph: {
			groups: mappedGroups,
			nodes,
			resources: mappedResources,
			textureViews: [],
			accesses: mappedAccesses,
			dependencies: mappedDependencies,
			roots: mappedRoots,
			segments: mappedSegments,
		},
		memory: {
			allocationReport: { status: 'available', allocations: mappedAllocations },
			poolReport: { status: 'available', acquireCount, reuseCount, createdCount, retainedCount, estimatedRetainedBytes },
		},
		timings: { gpu },
		diagnostics: [],
		extensions: {},
	};
	return {
		ok: true,
		snapshot,
		issues: [{
			severity: 'warning',
			code: 'legacy-v0-migrated',
			path: '',
			message: 'The unversioned debug capture was migrated to FrameGraph Snapshot 1.0.',
		}],
	};
}

function migrateDescriptor(kind: 'texture' | 'buffer', value: unknown, path: string, errors: Issues): FrameGraphSnapshotResource['descriptor'] | undefined {
	if (value === undefined) return undefined;
	const descriptor = requiredRecord(value, path, errors);
	if (!descriptor) return undefined;
	if (kind === 'buffer') {
		const size = requiredSafeInteger(descriptor.size, `${path}/size`, errors);
		return size === undefined ? undefined : { kind, size };
	}
	const format = requiredNonEmptyString(descriptor.format, `${path}/format`, errors);
	const size = requiredRecord(descriptor.size, `${path}/size`, errors);
	const width = requiredPositiveSafeInteger(size?.width, `${path}/size/width`, errors);
	const height = requiredPositiveSafeInteger(size?.height, `${path}/size/height`, errors);
	const depthOrArrayLayers = requiredPositiveSafeInteger(size?.depthOrArrayLayers, `${path}/size/depthOrArrayLayers`, errors);
	const dimension = requiredNonEmptyString(descriptor.dimension, `${path}/dimension`, errors);
	const mipLevelCount = requiredPositiveSafeInteger(descriptor.mipLevelCount, `${path}/mipLevelCount`, errors);
	const sampleCount = requiredPositiveSafeInteger(descriptor.sampleCount, `${path}/sampleCount`, errors);
	const viewFormats = nonEmptyStringArray(descriptor.viewFormats, `${path}/viewFormats`, errors);
	if (format === undefined || width === undefined || height === undefined || depthOrArrayLayers === undefined || dimension === undefined || mipLevelCount === undefined || sampleCount === undefined || viewFormats === undefined) return undefined;
	return { kind, format, size: { width, height, depthOrArrayLayers }, dimension, mipLevelCount, sampleCount, viewFormats };
}

function migrateLifetime(value: unknown, path: string, errors: Issues) {
	if (value === undefined) return undefined;
	const lifetime = requiredRecord(value, path, errors);
	if (!lifetime) return undefined;
	const firstUse = requiredSafeInteger(lifetime.firstUse, `${path}/firstUse`, errors);
	const lastUse = requiredSafeInteger(lifetime.lastUse, `${path}/lastUse`, errors);
	return firstUse === undefined || lastUse === undefined ? undefined : { firstUse, lastUse };
}

function migrateTextureRegion(value: unknown, path: string, errors: Issues): FrameGraphSnapshotTextureRegion | undefined {
	if (value === undefined) return undefined;
	const region = requiredRecord(value, path, errors);
	if (!region) return undefined;
	const baseMipLevel = requiredSafeInteger(region.baseMipLevel, `${path}/baseMipLevel`, errors);
	const mipLevelCount = requiredPositiveSafeInteger(region.mipLevelCount, `${path}/mipLevelCount`, errors);
	const aspect = requiredNonEmptyString(region.aspect, `${path}/aspect`, errors);
	const baseArrayLayer = optionalSafeInteger(region.baseArrayLayer, `${path}/baseArrayLayer`, errors);
	const arrayLayerCount = optionalPositiveSafeInteger(region.arrayLayerCount, `${path}/arrayLayerCount`, errors);
	const baseDepthSlice = optionalSafeInteger(region.baseDepthSlice, `${path}/baseDepthSlice`, errors);
	const depthSliceCount = optionalPositiveSafeInteger(region.depthSliceCount, `${path}/depthSliceCount`, errors);
	const arrayPresent = region.baseArrayLayer !== undefined || region.arrayLayerCount !== undefined;
	const depthPresent = region.baseDepthSlice !== undefined || region.depthSliceCount !== undefined;
	if (arrayPresent === depthPresent || (arrayPresent && (baseArrayLayer === undefined || arrayLayerCount === undefined)) || (depthPresent && (baseDepthSlice === undefined || depthSliceCount === undefined))) {
		errors.push(issue('legacy-texture-region', path, 'Legacy texture region must contain exactly one complete array-layer or depth-slice interval.'));
	}
	if (baseMipLevel === undefined || mipLevelCount === undefined || aspect === undefined || arrayPresent === depthPresent) return undefined;
	return { baseMipLevel, mipLevelCount, aspect, baseArrayLayer, arrayLayerCount, baseDepthSlice, depthSliceCount };
}

function migrateBufferRange(value: unknown, path: string, errors: Issues): FrameGraphSnapshotBufferRange | undefined {
	if (value === undefined) return undefined;
	const range = requiredRecord(value, path, errors);
	if (!range) return undefined;
	const offset = requiredSafeInteger(range.offset, `${path}/offset`, errors);
	const size = optionalSafeInteger(range.size, `${path}/size`, errors);
	return offset === undefined ? undefined : { offset, size };
}

function decodeUsageFlags(kind: 'texture', usage: number, path: string, errors: Issues): FrameGraphSnapshotTextureUsageFlag[];
function decodeUsageFlags(kind: 'buffer', usage: number, path: string, errors: Issues): FrameGraphSnapshotBufferUsageFlag[];
function decodeUsageFlags(kind: 'texture' | 'buffer', usage: number, path: string, errors: Issues): string[] {
	const definitions = kind === 'texture' ? TEXTURE_USAGE_FLAGS : BUFFER_USAGE_FLAGS;
	let known = 0;
	const flags: string[] = [];
	for (const [bit, flag] of definitions) {
		known |= bit;
		if ((usage & bit) !== 0) flags.push(flag);
	}
	const unknown = (usage & ~known) >>> 0;
	if (unknown !== 0) errors.push(issue('legacy-unknown-usage', path, `Legacy ${kind} usage contains unknown bits 0x${unknown.toString(16)}.`));
	return flags;
}

function recordArray(value: unknown, path: string, errors: Issues): UnknownRecord[] {
	if (!Array.isArray(value)) {
		errors.push(issue('legacy-structure', path, 'Expected an array.'));
		return [];
	}
	return value.flatMap((entry, index) => {
		const record = asRecord(entry);
		if (!record) errors.push(issue('legacy-structure', `${path}/${index}`, 'Expected an object.'));
		return record ? [record] : [];
	});
}

function safeIntegerArray(value: unknown, path: string, errors: Issues): number[] | undefined {
	if (!Array.isArray(value)) {
		errors.push(issue('legacy-structure', path, 'Expected an array.'));
		return undefined;
	}
	const result: number[] = [];
	value.forEach((entry, index) => {
		const parsed = requiredSafeInteger(entry, `${path}/${index}`, errors);
		if (parsed !== undefined) result.push(parsed);
	});
	return result;
}

function nonEmptyStringArray(value: unknown, path: string, errors: Issues): string[] | undefined {
	if (!Array.isArray(value)) {
		errors.push(issue('legacy-structure', path, 'Expected an array.'));
		return undefined;
	}
	const result: string[] = [];
	value.forEach((entry, index) => {
		const parsed = requiredNonEmptyString(entry, `${path}/${index}`, errors);
		if (parsed !== undefined) result.push(parsed);
	});
	return result;
}

function asRecord(value: unknown): UnknownRecord | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function requiredRecord(value: unknown, path: string, errors: Issues): UnknownRecord | undefined {
	const result = asRecord(value);
	if (!result) errors.push(issue('legacy-structure', path, 'Expected an object.'));
	return result;
}

function requiredSafeInteger(value: unknown, path: string, errors: Issues): number | undefined {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		errors.push(issue('legacy-number', path, 'Expected a non-negative safe integer.'));
		return undefined;
	}
	return value as number;
}

function requiredUint32(value: unknown, path: string, errors: Issues): number | undefined {
	const result = requiredSafeInteger(value, path, errors);
	if (result !== undefined && result > 0xffff_ffff) {
		errors.push(issue('legacy-number', path, 'Expected an unsigned 32-bit integer.'));
		return undefined;
	}
	return result;
}

function requiredPositiveSafeInteger(value: unknown, path: string, errors: Issues): number | undefined {
	const result = requiredSafeInteger(value, path, errors);
	if (result === 0) errors.push(issue('legacy-number', path, 'Expected a positive safe integer.'));
	return result === 0 ? undefined : result;
}

function optionalSafeInteger(value: unknown, path: string, errors: Issues): number | undefined {
	return value === undefined ? undefined : requiredSafeInteger(value, path, errors);
}

function optionalPositiveSafeInteger(value: unknown, path: string, errors: Issues): number | undefined {
	return value === undefined ? undefined : requiredPositiveSafeInteger(value, path, errors);
}

function requiredFiniteNumber(value: unknown, path: string, errors: Issues): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		errors.push(issue('legacy-number', path, 'Expected a finite non-negative number.'));
		return undefined;
	}
	return value;
}

function requiredNonEmptyString(value: unknown, path: string, errors: Issues): string | undefined {
	if (typeof value !== 'string' || value.length === 0) {
		errors.push(issue('legacy-string', path, 'Expected a non-empty string.'));
		return undefined;
	}
	return value;
}

function optionalString(value: unknown, path: string, errors: Issues): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string') {
		errors.push(issue('legacy-string', path, 'Expected a string.'));
		return undefined;
	}
	return value;
}

function optionalNonEmptyString(value: unknown, path: string, errors: Issues): string | undefined {
	return value === undefined ? undefined : requiredNonEmptyString(value, path, errors);
}

function requiredBoolean(value: unknown, path: string, errors: Issues): boolean | undefined {
	if (typeof value !== 'boolean') {
		errors.push(issue('legacy-boolean', path, 'Expected a boolean.'));
		return undefined;
	}
	return value;
}

function requiredEnum<const T extends readonly string[]>(value: unknown, allowed: T, path: string, errors: Issues): T[number] | undefined {
	if (typeof value !== 'string' || !allowed.includes(value)) {
		errors.push(issue('legacy-enum', path, `Expected one of: ${allowed.join(', ')}.`));
		return undefined;
	}
	return value as T[number];
}

function issue(code: string, path: string, message: string): FrameGraphSnapshotIssue {
	return { severity: 'error', code, path, message };
}

const nodeId = (id: number) => `node:${id}`;
const resourceId = (id: number) => `resource:${id}`;
const groupId = (id: number) => `group:${id}`;
const accessId = (id: number) => `access:${id}`;
const allocationId = (id: number) => `allocation:${id}`;
const compatibilityClassId = (id: number) => `compatibility:${id}`;
const segmentId = (id: number) => `segment:${id}`;
