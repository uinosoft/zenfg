import {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH,
	FRAME_GRAPH_SNAPSHOT_VERSION,
} from './format.ts';
import type {
	FrameGraphSnapshot,
	FrameGraphSnapshotAccessKind,
	FrameGraphSnapshotIssue,
} from './types.ts';

type UnknownRecord = Record<string, unknown>;
type Issues = FrameGraphSnapshotIssue[];

export type SnapshotJsonCloneResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly issues: readonly FrameGraphSnapshotIssue[] };

interface JsonPathNode {
	readonly parent: JsonPathNode | undefined;
	readonly token: string;
}

type JsonCloneContainer = UnknownRecord | unknown[];

type JsonCloneFrame =
	| {
		readonly kind: 'visit';
		readonly source: unknown;
		readonly path: JsonPathNode | undefined;
		readonly parent: JsonCloneContainer | undefined;
		readonly key: string | number | undefined;
	}
	| { readonly kind: 'leave'; readonly source: object };

interface JsonCloneChild {
	readonly source: unknown;
	readonly path: JsonPathNode;
	readonly key: string | number;
}

const NODE_KINDS = ['render', 'compute', 'copy', 'clear-buffer', 'command', 'external-submission'] as const;
const ORIGINS = ['transient', 'imported', 'surface'] as const;
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
const TEXTURE_USAGE = ['copy-src', 'copy-dst', 'texture-binding', 'storage-binding', 'render-attachment'] as const;
const BUFFER_USAGE = ['map-read', 'map-write', 'copy-src', 'copy-dst', 'index', 'vertex', 'uniform', 'storage', 'indirect', 'query-resolve'] as const;
const ROOT_REASONS = ['present', 'output', 'readback', 'side-effect', 'debug-capture', 'persistent-state'] as const;
const UNAVAILABLE_FACTS = [
	'graph.groups',
	'graph.textureViews',
	'graph.nodes.recordingOrder',
	'graph.accesses.regions',
] as const;
const READ_ACCESS_KINDS = new Set<FrameGraphSnapshotAccessKind>([
	'texture-sampled',
	'texture-storage-read',
	'texture-depth-read',
	'texture-copy-src',
	'buffer-uniform',
	'buffer-storage-read',
	'buffer-vertex',
	'buffer-index',
	'buffer-indirect',
	'buffer-copy-src',
]);
const WRITE_ACCESS_KINDS = new Set<FrameGraphSnapshotAccessKind>([
	'texture-storage-write',
	'texture-color-attachment-write',
	'texture-depth-write',
	'texture-copy-dst',
	'buffer-storage-write',
	'buffer-copy-dst',
]);
const ENTITY_ID_PATTERN = /^[a-z][a-z0-9-]*:.+$/;
type EntityPrefix = 'group' | 'node' | 'resource' | 'view' | 'access' | 'segment' | 'allocation' | 'compatibility';

/**
 * Creates an independent JSON-safe clone without reading properties through
 * getters or invoking `toJSON` hooks. Ordinary JSON containers from another
 * JavaScript realm are accepted and cloned into the current realm.
 *
 * @internal
 */
export function cloneSnapshotJsonValue(value: unknown): SnapshotJsonCloneResult {
	return cloneJsonValue(value, false);
}

/** @internal Canonicalizes trusted migration output without invoking hooks. */
export function cloneGeneratedSnapshotJsonValue(value: unknown): SnapshotJsonCloneResult {
	return cloneJsonValue(value, true);
}

function cloneJsonValue(
	value: unknown,
	omitUndefinedObjectProperties: boolean,
): SnapshotJsonCloneResult {
	const issues: Issues = [];
	const ancestors = new Set<object>();
	const stack: JsonCloneFrame[] = [{
		kind: 'visit',
		source: value,
		path: undefined,
		parent: undefined,
		key: undefined,
	}];
	let root: unknown;

	while (stack.length > 0) {
		const frame = stack.pop()!;
		if (frame.kind === 'leave') {
			ancestors.delete(frame.source);
			continue;
		}

		const { source, path, parent, key } = frame;
		if (source === null || typeof source === 'string' || typeof source === 'boolean') {
			if (assignJsonCloneValue(parent, key, source)) root = source;
			continue;
		}
		if (typeof source === 'number') {
			if (!Number.isFinite(source)) {
				issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON numbers must be finite.'));
				continue;
			}
			const clonedNumber = Object.is(source, -0) ? 0 : source;
			if (assignJsonCloneValue(parent, key, clonedNumber)) root = clonedNumber;
			continue;
		}
		if (typeof source !== 'object') {
			issues.push(issue('invalid-json-value', renderJsonPath(path), 'Expected a JSON value.'));
			continue;
		}

		let isArray: boolean;
		let prototype: object | null;
		try {
			isArray = Array.isArray(source);
			prototype = Object.getPrototypeOf(source) as object | null;
		} catch {
			issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON value properties could not be inspected safely.'));
			continue;
		}
		if (isArray ? !isPlainArrayPrototype(prototype) : !isPlainObjectPrototype(prototype)) {
			issues.push(issue('invalid-json-value', renderJsonPath(path), isArray
				? 'JSON arrays must be plain arrays.'
				: 'JSON objects must be plain objects.'));
			continue;
		}
		if (ancestors.has(source)) {
			issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON values cannot contain cycles.'));
			continue;
		}

		let ownKeys: readonly PropertyKey[];
		try {
			ownKeys = Reflect.ownKeys(source);
		} catch {
			issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON value properties could not be inspected safely.'));
			continue;
		}

		let children: JsonCloneChild[];
		let clone: JsonCloneContainer;
		if (isArray) {
			const inspected = inspectJsonArray(source as unknown[], path, ownKeys, issues);
			if (!inspected) continue;
			children = inspected;
			clone = [];
		} else {
			children = inspectJsonObject(
				source as object,
				path,
				ownKeys,
				issues,
				omitUndefinedObjectProperties,
			);
			clone = {};
		}

		if (assignJsonCloneValue(parent, key, clone)) root = clone;
		ancestors.add(source);
		stack.push({ kind: 'leave', source });
		for (let index = children.length - 1; index >= 0; index--) {
			const child = children[index];
			stack.push({
				kind: 'visit',
				source: child.source,
				path: child.path,
				parent: clone,
				key: child.key,
			});
		}
	}

	return issues.length > 0 ? { ok: false, issues } : { ok: true, value: root };
}

function inspectJsonObject(
	source: object,
	path: JsonPathNode | undefined,
	ownKeys: readonly PropertyKey[],
	issues: Issues,
	omitUndefinedProperties: boolean,
): JsonCloneChild[] {
	const children: JsonCloneChild[] = [];
	let symbolIssueReported = false;
	for (const key of ownKeys) {
		if (typeof key === 'symbol') {
			if (!symbolIssueReported) {
				issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON objects cannot contain symbol-keyed properties.'));
				symbolIssueReported = true;
			}
			continue;
		}
		const stringKey = String(key);
		const childPath = appendJsonPath(path, stringKey);
		const descriptor = inspectJsonProperty(source, stringKey, childPath, issues);
		if (!descriptor) continue;
		if (!descriptor.enumerable) {
			issues.push(issue('invalid-json-value', renderJsonPath(childPath), 'JSON objects cannot contain non-enumerable properties.'));
			continue;
		}
		if (!('value' in descriptor)) {
			issues.push(issue('invalid-json-value', renderJsonPath(childPath), 'JSON values cannot contain accessor properties.'));
			continue;
		}
		if (omitUndefinedProperties && descriptor.value === undefined) continue;
		children.push({ source: descriptor.value, path: childPath, key: stringKey });
	}
	return children;
}

function inspectJsonArray(
	source: unknown[],
	path: JsonPathNode | undefined,
	ownKeys: readonly PropertyKey[],
	issues: Issues,
): JsonCloneChild[] | undefined {
	let lengthDescriptor: PropertyDescriptor | undefined;
	try {
		lengthDescriptor = Object.getOwnPropertyDescriptor(source, 'length');
	} catch {
		issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON value properties could not be inspected safely.'));
		return undefined;
	}
	if (!lengthDescriptor || !('value' in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
		issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON value properties could not be inspected safely.'));
		return undefined;
	}
	const length = lengthDescriptor.value as number;
	const indexed: { readonly index: number; readonly child: JsonCloneChild }[] = [];
	const presentIndices: number[] = [];
	let symbolIssueReported = false;
	for (const key of ownKeys) {
		if (key === 'length') continue;
		if (typeof key === 'symbol') {
			if (!symbolIssueReported) {
				issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON arrays cannot contain symbol-keyed properties.'));
				symbolIssueReported = true;
			}
			continue;
		}
		const stringKey = String(key);
		const childPath = appendJsonPath(path, stringKey);
		const index = arrayIndex(stringKey);
		if (index === undefined || index >= length) {
			issues.push(issue('invalid-json-value', renderJsonPath(childPath), 'JSON arrays cannot contain non-index properties.'));
			continue;
		}
		presentIndices.push(index);
		const descriptor = inspectJsonProperty(source, stringKey, childPath, issues);
		if (!descriptor) continue;
		if (!descriptor.enumerable) {
			issues.push(issue('invalid-json-value', renderJsonPath(childPath), 'JSON array elements must be enumerable data properties.'));
			continue;
		}
		if (!('value' in descriptor)) {
			issues.push(issue('invalid-json-value', renderJsonPath(childPath), 'JSON values cannot contain accessor properties.'));
			continue;
		}
		indexed.push({
			index,
			child: { source: descriptor.value, path: childPath, key: index },
		});
	}
	indexed.sort((left, right) => left.index - right.index);
	presentIndices.sort((left, right) => left - right);
	for (let expected = 0; expected < length; expected++) {
		if (presentIndices[expected] !== expected) {
			issues.push(issue('invalid-json-value', renderJsonPath(appendJsonPath(path, String(expected))), 'JSON arrays cannot contain holes.'));
			break;
		}
	}
	return indexed.map(({ child }) => child);
}

function inspectJsonProperty(
	source: object,
	key: string,
	path: JsonPathNode,
	issues: Issues,
): PropertyDescriptor | undefined {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor) return descriptor;
	} catch {
		// Report the same stable reflection failure below.
	}
	issues.push(issue('invalid-json-value', renderJsonPath(path), 'JSON value properties could not be inspected safely.'));
	return undefined;
}

function assignJsonCloneValue(
	parent: JsonCloneContainer | undefined,
	key: string | number | undefined,
	value: unknown,
): boolean {
	if (parent === undefined) return true;
	Object.defineProperty(parent, key!, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
	return false;
}

function arrayIndex(key: string): number | undefined {
	if (!/^(0|[1-9]\d*)$/.test(key)) return undefined;
	const value = Number(key);
	return Number.isSafeInteger(value) && value >= 0 && value < 4_294_967_295 && String(value) === key
		? value
		: undefined;
}

function isPlainObjectPrototype(prototype: object | null): boolean {
	if (prototype === null || prototype === Object.prototype) return true;
	try {
		return Object.getPrototypeOf(prototype) === null
			&& prototypeOwnsConstructor(prototype);
	} catch {
		return false;
	}
}

function isPlainArrayPrototype(prototype: object | null): boolean {
	if (prototype === Array.prototype) return true;
	if (prototype === null) return false;
	try {
		return Array.isArray(prototype)
			&& isPlainObjectPrototype(Object.getPrototypeOf(prototype) as object | null)
			&& prototypeOwnsConstructor(prototype);
	} catch {
		return false;
	}
}

function prototypeOwnsConstructor(prototype: object): boolean {
	const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
	if (
		!constructorDescriptor
		|| constructorDescriptor.enumerable
		|| !('value' in constructorDescriptor)
		|| typeof constructorDescriptor.value !== 'function'
	) return false;
	const prototypeDescriptor = Object.getOwnPropertyDescriptor(constructorDescriptor.value, 'prototype');
	return prototypeDescriptor !== undefined
		&& 'value' in prototypeDescriptor
		&& prototypeDescriptor.value === prototype;
}

function appendJsonPath(parent: JsonPathNode | undefined, token: string): JsonPathNode {
	return { parent, token };
}

function renderJsonPath(path: JsonPathNode | undefined): string {
	if (!path) return '';
	const tokens: string[] = [];
	for (let current: JsonPathNode | undefined = path; current; current = current.parent) {
		tokens.push(pointer(current.token));
	}
	tokens.reverse();
	return `/${tokens.join('/')}`;
}

export function validateSnapshotV1(value: unknown): readonly FrameGraphSnapshotIssue[] {
	const issues: Issues = [];
	const root = record(value, '', issues);
	if (!root) return issues;
	keys(root, '', ['format', 'version', 'producer', 'capture', 'graph', 'memory', 'timings', 'diagnostics', 'extensions'], [], issues);
	literal(root.format, FRAME_GRAPH_SNAPSHOT_FORMAT, '/format', issues);

	const version = record(root.version, '/version', issues);
	if (version) {
		keys(version, '/version', ['major', 'minor'], [], issues);
		literal(version.major, FRAME_GRAPH_SNAPSHOT_VERSION.major, '/version/major', issues);
		literal(version.minor, FRAME_GRAPH_SNAPSHOT_VERSION.minor, '/version/minor', issues);
	}
	validateProducer(root.producer, issues);
	validateCapture(root.capture, issues);
	const graph = validateGraph(root.graph, issues);
	const memory = validateMemory(root.memory, issues);
	const timings = validateTimings(root.timings, issues);
	validateDiagnostics(root.diagnostics, issues);
	validateExtensions(root.extensions, issues);
	if (graph && memory && timings && issues.length === 0) validateReferences(value as FrameGraphSnapshot, issues);
	return issues;
}

function validateProducer(value: unknown, issues: Issues): void {
	const producer = record(value, '/producer', issues);
	if (!producer) return;
	keys(producer, '/producer', ['name'], ['version', 'language', 'runtime'], issues);
	nonEmptyString(producer.name, '/producer/name', issues);
	optionalNonEmptyString(producer.version, '/producer/version', issues);
	optionalNonEmptyString(producer.language, '/producer/language', issues);
	if (producer.runtime !== undefined) {
		const runtime = record(producer.runtime, '/producer/runtime', issues);
		if (runtime) {
			keys(runtime, '/producer/runtime', [], ['implementation', 'graphicsApi', 'backend'], issues);
			optionalNonEmptyString(runtime.implementation, '/producer/runtime/implementation', issues);
			optionalNonEmptyString(runtime.graphicsApi, '/producer/runtime/graphicsApi', issues);
			optionalNonEmptyString(runtime.backend, '/producer/runtime/backend', issues);
		}
	}
}

function validateCapture(value: unknown, issues: Issues): void {
	const capture = record(value, '/capture', issues);
	if (!capture) return;
	keys(capture, '/capture', ['frameIndex'], ['capturedAt', 'migration'], issues);
	safeInteger(capture.frameIndex, '/capture/frameIndex', issues);
	optionalString(capture.capturedAt, '/capture/capturedAt', issues);
	if (capture.migration !== undefined) {
		const migration = record(capture.migration, '/capture/migration', issues);
		if (migration) {
			keys(migration, '/capture/migration', ['sourceFormat', 'unavailableFacts'], [], issues);
			enumValue(migration.sourceFormat, ['legacy-v0', 't3d-v1'], '/capture/migration/sourceFormat', issues);
			stringArray(migration.unavailableFacts, '/capture/migration/unavailableFacts', issues, false, UNAVAILABLE_FACTS);
		}
	}
}

function validateGraph(value: unknown, issues: Issues): UnknownRecord | undefined {
	const graph = record(value, '/graph', issues);
	if (!graph) return undefined;
	const names = ['groups', 'nodes', 'resources', 'textureViews', 'accesses', 'dependencies', 'roots', 'segments'] as const;
	keys(graph, '/graph', [...names], [], issues);
	for (const name of names) array(graph[name], `/graph/${name}`, issues);
	forEachRecord(graph.groups, '/graph/groups', issues, (group, path) => {
		keys(group, path, ['id', 'label'], ['parentId', 'stableKey'], issues);
		entityId(group.id, `${path}/id`, issues, 'group');
		optionalEntityId(group.parentId, `${path}/parentId`, issues, 'group');
		nonEmptyString(group.label, `${path}/label`, issues);
		optionalString(group.stableKey, `${path}/stableKey`, issues);
	});
	forEachRecord(graph.nodes, '/graph/nodes', issues, (node, path) => {
		keys(node, path, ['id', 'kind', 'sideEffect', 'compileState'], ['stableKey', 'recordingOrder', 'label', 'groupId'], issues);
		entityId(node.id, `${path}/id`, issues, 'node');
		enumValue(node.kind, NODE_KINDS, `${path}/kind`, issues);
		boolean(node.sideEffect, `${path}/sideEffect`, issues);
		optionalSafeInteger(node.recordingOrder, `${path}/recordingOrder`, issues);
		optionalString(node.label, `${path}/label`, issues);
		optionalString(node.stableKey, `${path}/stableKey`, issues);
		optionalEntityId(node.groupId, `${path}/groupId`, issues, 'group');
		const state = record(node.compileState, `${path}/compileState`, issues);
		if (!state) return;
		if (state.status === 'retained') {
			keys(state, `${path}/compileState`, ['status', 'executionOrder'], [], issues);
			safeInteger(state.executionOrder, `${path}/compileState/executionOrder`, issues);
		} else if (state.status === 'culled') {
			keys(state, `${path}/compileState`, ['status', 'reason'], [], issues);
			nonEmptyString(state.reason, `${path}/compileState/reason`, issues);
		} else {
			issues.push(issue('invalid-enum', `${path}/compileState/status`, 'Expected retained or culled.'));
		}
	});
	forEachRecord(graph.resources, '/graph/resources', issues, (resource, path) => validateResource(resource, path, issues));
	forEachRecord(graph.textureViews, '/graph/textureViews', issues, (view, path) => validateTextureView(view, path, issues));
	forEachRecord(graph.accesses, '/graph/accesses', issues, (access, path) => validateAccess(access, path, issues));
	forEachRecord(graph.dependencies, '/graph/dependencies', issues, (dependency, path) => {
		keys(dependency, path, ['fromNodeId', 'toNodeId', 'resourceId', 'kind'], [], issues);
		entityId(dependency.fromNodeId, `${path}/fromNodeId`, issues, 'node');
		entityId(dependency.toNodeId, `${path}/toNodeId`, issues, 'node');
		entityId(dependency.resourceId, `${path}/resourceId`, issues, 'resource');
		enumValue(dependency.kind, ['value', 'ordering'], `${path}/kind`, issues);
	});
	forEachRecord(graph.roots, '/graph/roots', issues, (root, path) => {
		keys(root, path, ['reason'], ['nodeId', 'resourceId'], issues);
		enumValue(root.reason, ROOT_REASONS, `${path}/reason`, issues);
		optionalEntityId(root.nodeId, `${path}/nodeId`, issues, 'node');
		optionalEntityId(root.resourceId, `${path}/resourceId`, issues, 'resource');
		if ((root.nodeId === undefined) === (root.resourceId === undefined)) {
			issues.push(issue('invalid-root', path, 'A root must reference exactly one node or resource.'));
		}
	});
	forEachRecord(graph.segments, '/graph/segments', issues, (segment, path) => {
		keys(segment, path, ['id', 'order', 'kind', 'nodeIds'], [], issues);
		entityId(segment.id, `${path}/id`, issues, 'segment');
		safeInteger(segment.order, `${path}/order`, issues);
		enumValue(segment.kind, ['frame-graph', 'external-submission'], `${path}/kind`, issues);
		stringArray(segment.nodeIds, `${path}/nodeIds`, issues, true, undefined, 'node');
		if (Array.isArray(segment.nodeIds) && segment.nodeIds.length === 0) {
			issues.push(issue('invalid-segment-sequence', `${path}/nodeIds`, 'Execution segment must contain at least one node.'));
		}
	});
	return graph;
}

function validateResource(resource: UnknownRecord, path: string, issues: Issues): void {
	keys(resource, path, ['id', 'kind', 'origin', 'usageFlags'], ['stableKey', 'label', 'groupId', 'lifetime', 'allocationId', 'estimatedByteSize', 'descriptor', 'initialContents'], issues);
	entityId(resource.id, `${path}/id`, issues, 'resource');
	const kind = enumValue(resource.kind, ['texture', 'buffer'], `${path}/kind`, issues);
	const origin = enumValue(resource.origin, ORIGINS, `${path}/origin`, issues);
	const initialContents = resource.initialContents === undefined
		? undefined
		: enumValue(resource.initialContents, ['defined', 'undefined'], `${path}/initialContents`, issues);
	if ((origin === 'transient' || origin === 'surface') && initialContents !== 'undefined') {
		issues.push(issue('invalid-initial-contents', `${path}/initialContents`, `${origin} resources must begin with undefined contents.`));
	}
	optionalString(resource.stableKey, `${path}/stableKey`, issues);
	optionalString(resource.label, `${path}/label`, issues);
	optionalEntityId(resource.groupId, `${path}/groupId`, issues, 'group');
	optionalEntityId(resource.allocationId, `${path}/allocationId`, issues, 'allocation');
	optionalSafeInteger(resource.estimatedByteSize, `${path}/estimatedByteSize`, issues);
	if (resource.lifetime !== undefined) {
		const lifetime = record(resource.lifetime, `${path}/lifetime`, issues);
		if (lifetime) {
			keys(lifetime, `${path}/lifetime`, ['firstUse', 'lastUse'], [], issues);
			const first = safeInteger(lifetime.firstUse, `${path}/lifetime/firstUse`, issues);
			const last = safeInteger(lifetime.lastUse, `${path}/lifetime/lastUse`, issues);
			if (first !== undefined && last !== undefined && last < first) {
				issues.push(issue('invalid-lifetime', `${path}/lifetime`, 'lastUse must be greater than or equal to firstUse.'));
			}
		}
	}
	if (kind === 'texture') stringArray(resource.usageFlags, `${path}/usageFlags`, issues, false, TEXTURE_USAGE);
	if (kind === 'buffer') stringArray(resource.usageFlags, `${path}/usageFlags`, issues, false, BUFFER_USAGE);
	if (resource.descriptor === undefined) return;
	const descriptor = record(resource.descriptor, `${path}/descriptor`, issues);
	if (!descriptor || !kind) return;
	if (kind === 'buffer') {
		keys(descriptor, `${path}/descriptor`, ['kind', 'size'], [], issues);
		literal(descriptor.kind, 'buffer', `${path}/descriptor/kind`, issues);
		safeInteger(descriptor.size, `${path}/descriptor/size`, issues);
		return;
	}
	keys(descriptor, `${path}/descriptor`, ['kind', 'format', 'size', 'dimension', 'mipLevelCount', 'sampleCount', 'viewFormats'], [], issues);
	literal(descriptor.kind, 'texture', `${path}/descriptor/kind`, issues);
	nonEmptyString(descriptor.format, `${path}/descriptor/format`, issues);
	nonEmptyString(descriptor.dimension, `${path}/descriptor/dimension`, issues);
	positiveSafeInteger(descriptor.mipLevelCount, `${path}/descriptor/mipLevelCount`, issues);
	positiveSafeInteger(descriptor.sampleCount, `${path}/descriptor/sampleCount`, issues);
	stringArray(descriptor.viewFormats, `${path}/descriptor/viewFormats`, issues, false, undefined, undefined, true);
	const size = record(descriptor.size, `${path}/descriptor/size`, issues);
	if (size) {
		keys(size, `${path}/descriptor/size`, ['width', 'height', 'depthOrArrayLayers'], [], issues);
		positiveSafeInteger(size.width, `${path}/descriptor/size/width`, issues);
		positiveSafeInteger(size.height, `${path}/descriptor/size/height`, issues);
		positiveSafeInteger(size.depthOrArrayLayers, `${path}/descriptor/size/depthOrArrayLayers`, issues);
	}
}

function validateTextureView(view: UnknownRecord, path: string, issues: Issues): void {
	keys(view, path, ['id', 'resourceId', 'format', 'dimension', 'aspect', 'baseMipLevel', 'mipLevelCount', 'baseArrayLayer', 'arrayLayerCount', 'swizzle'], ['stableKey', 'label'], issues);
	entityId(view.id, `${path}/id`, issues, 'view');
	entityId(view.resourceId, `${path}/resourceId`, issues, 'resource');
	optionalString(view.stableKey, `${path}/stableKey`, issues);
	optionalString(view.label, `${path}/label`, issues);
	for (const name of ['format', 'dimension', 'aspect', 'swizzle'] as const) nonEmptyString(view[name], `${path}/${name}`, issues);
	safeInteger(view.baseMipLevel, `${path}/baseMipLevel`, issues);
	positiveSafeInteger(view.mipLevelCount, `${path}/mipLevelCount`, issues);
	safeInteger(view.baseArrayLayer, `${path}/baseArrayLayer`, issues);
	positiveSafeInteger(view.arrayLayerCount, `${path}/arrayLayerCount`, issues);
}

function validateAccess(access: UnknownRecord, path: string, issues: Issues): void {
	keys(access, path, ['id', 'nodeId', 'resourceId', 'access', 'mode', 'producesValue'], ['textureViewId', 'textureRegion', 'bufferRange', 'contents'], issues);
	entityId(access.id, `${path}/id`, issues, 'access');
	entityId(access.nodeId, `${path}/nodeId`, issues, 'node');
	entityId(access.resourceId, `${path}/resourceId`, issues, 'resource');
	const accessKind = enumValue(access.access, ACCESS_KINDS, `${path}/access`, issues);
	optionalEntityId(access.textureViewId, `${path}/textureViewId`, issues, 'view');
	boolean(access.producesValue, `${path}/producesValue`, issues);
	if (access.mode === 'read') {
		if (access.contents !== undefined) issues.push(issue('unexpected-property', `${path}/contents`, 'Read access cannot declare contents.'));
		if (access.producesValue !== false) issues.push(issue('invalid-read', `${path}/producesValue`, 'Read access must set producesValue to false.'));
	} else if (access.mode === 'write') {
		enumValue(access.contents, ['overwrite', 'preserve'], `${path}/contents`, issues);
	} else {
		issues.push(issue('invalid-enum', `${path}/mode`, 'Expected read or write.'));
	}
	if (accessKind && access.mode !== undefined) {
		const expectedMode = READ_ACCESS_KINDS.has(accessKind) ? 'read' : WRITE_ACCESS_KINDS.has(accessKind) ? 'write' : undefined;
		if (expectedMode !== undefined && access.mode !== expectedMode) {
			issues.push(issue('invalid-access-mode', `${path}/mode`, `Access kind "${accessKind}" requires mode "${expectedMode}".`));
		}
	}
	if (access.textureRegion !== undefined) validateTextureRegion(access.textureRegion, `${path}/textureRegion`, issues);
	if (access.bufferRange !== undefined) {
		const range = record(access.bufferRange, `${path}/bufferRange`, issues);
		if (range) {
			keys(range, `${path}/bufferRange`, ['offset'], ['size'], issues);
			safeInteger(range.offset, `${path}/bufferRange/offset`, issues);
			optionalSafeInteger(range.size, `${path}/bufferRange/size`, issues);
		}
	}
	if (accessKind?.startsWith('texture-')) {
		if (access.bufferRange !== undefined) issues.push(issue('invalid-access-range', `${path}/bufferRange`, 'Texture access cannot contain bufferRange.'));
		if ((accessKind === 'texture-copy-src' || accessKind === 'texture-copy-dst') && access.textureViewId !== undefined) {
			issues.push(issue('invalid-access-view', `${path}/textureViewId`, 'Texture copy access cannot reference a texture view.'));
		}
	}
	if (accessKind?.startsWith('buffer-')) {
		if (access.textureRegion !== undefined) issues.push(issue('invalid-access-range', `${path}/textureRegion`, 'Buffer access cannot contain textureRegion.'));
		if (access.textureViewId !== undefined) issues.push(issue('invalid-access-view', `${path}/textureViewId`, 'Buffer access cannot reference a texture view.'));
	}
}

function validateTextureRegion(value: unknown, path: string, issues: Issues): void {
	const region = record(value, path, issues);
	if (!region) return;
	keys(region, path, ['baseMipLevel', 'mipLevelCount', 'aspect'], ['baseArrayLayer', 'arrayLayerCount', 'baseDepthSlice', 'depthSliceCount'], issues);
	safeInteger(region.baseMipLevel, `${path}/baseMipLevel`, issues);
	positiveSafeInteger(region.mipLevelCount, `${path}/mipLevelCount`, issues);
	nonEmptyString(region.aspect, `${path}/aspect`, issues);
	const arrayPresent = region.baseArrayLayer !== undefined || region.arrayLayerCount !== undefined;
	const depthPresent = region.baseDepthSlice !== undefined || region.depthSliceCount !== undefined;
	if (arrayPresent) {
		safeInteger(region.baseArrayLayer, `${path}/baseArrayLayer`, issues);
		positiveSafeInteger(region.arrayLayerCount, `${path}/arrayLayerCount`, issues);
	}
	if (depthPresent) {
		safeInteger(region.baseDepthSlice, `${path}/baseDepthSlice`, issues);
		positiveSafeInteger(region.depthSliceCount, `${path}/depthSliceCount`, issues);
	}
	if (arrayPresent === depthPresent) issues.push(issue('invalid-texture-region', path, 'Texture region must contain exactly one array-layer or depth-slice interval.'));
}

function validateMemory(value: unknown, issues: Issues): UnknownRecord | undefined {
	const memory = record(value, '/memory', issues);
	if (!memory) return undefined;
	keys(memory, '/memory', ['allocationReport', 'poolReport'], [], issues);
	const allocationReport = record(memory.allocationReport, '/memory/allocationReport', issues);
	if (allocationReport) {
		if (allocationReport.status === 'available') {
			keys(allocationReport, '/memory/allocationReport', ['status', 'allocations'], [], issues);
			forEachRecord(allocationReport.allocations, '/memory/allocationReport/allocations', issues, (allocation, path) => {
				keys(allocation, path, ['id', 'kind', 'compatibilityClassId'], ['estimatedByteSize'], issues);
				entityId(allocation.id, `${path}/id`, issues, 'allocation');
				enumValue(allocation.kind, ['texture', 'buffer'], `${path}/kind`, issues);
				entityId(allocation.compatibilityClassId, `${path}/compatibilityClassId`, issues, 'compatibility');
				optionalSafeInteger(allocation.estimatedByteSize, `${path}/estimatedByteSize`, issues);
			});
		} else validateUnavailable(allocationReport, '/memory/allocationReport', issues);
	}
	const pool = record(memory.poolReport, '/memory/poolReport', issues);
	if (pool) {
		if (pool.status === 'available') {
			keys(pool, '/memory/poolReport', ['status', 'acquireCount', 'reuseCount', 'createdCount', 'retainedCount'], ['estimatedRetainedBytes'], issues);
			for (const name of ['acquireCount', 'reuseCount', 'createdCount', 'retainedCount'] as const) safeInteger(pool[name], `/memory/poolReport/${name}`, issues);
			optionalSafeInteger(pool.estimatedRetainedBytes, '/memory/poolReport/estimatedRetainedBytes', issues);
		} else validateUnavailable(pool, '/memory/poolReport', issues);
	}
	return memory;
}

function validateTimings(value: unknown, issues: Issues): UnknownRecord | undefined {
	const timings = record(value, '/timings', issues);
	if (!timings) return undefined;
	keys(timings, '/timings', ['gpu'], [], issues);
	const gpu = record(timings.gpu, '/timings/gpu', issues);
	if (!gpu) return timings;
	if (gpu.status === 'available') {
		keys(gpu, '/timings/gpu', ['status', 'frameSpanMicros', 'nodes'], [], issues);
		finiteNumber(gpu.frameSpanMicros, '/timings/gpu/frameSpanMicros', issues);
		forEachRecord(gpu.nodes, '/timings/gpu/nodes', issues, (timing, path) => {
			keys(timing, path, ['nodeId', 'durationMicros'], [], issues);
			entityId(timing.nodeId, `${path}/nodeId`, issues, 'node');
			finiteNumber(timing.durationMicros, `${path}/durationMicros`, issues);
		});
	} else validateUnavailable(gpu, '/timings/gpu', issues);
	return timings;
}

function validateDiagnostics(value: unknown, issues: Issues): void {
	forEachRecord(value, '/diagnostics', issues, (diagnostic, path) => {
		keys(diagnostic, path, ['severity', 'code', 'message'], ['nodeId', 'resourceId'], issues);
		enumValue(diagnostic.severity, ['info', 'warning', 'error'], `${path}/severity`, issues);
		nonEmptyString(diagnostic.code, `${path}/code`, issues);
		string(diagnostic.message, `${path}/message`, issues);
		optionalEntityId(diagnostic.nodeId, `${path}/nodeId`, issues, 'node');
		optionalEntityId(diagnostic.resourceId, `${path}/resourceId`, issues, 'resource');
	});
}

function validateExtensions(value: unknown, issues: Issues): void {
	const extensions = record(value, '/extensions', issues);
	if (!extensions) return;
	for (const [name, extension] of Object.entries(extensions)) {
		const path = `/extensions/${pointer(name)}`;
		if (!/^.+\..+$/.test(name)) issues.push(issue('invalid-extension-name', path, 'Extension names must be namespace-qualified.'));
		jsonValue(extension, path, issues);
	}
}

function validateReferences(snapshot: FrameGraphSnapshot, issues: Issues): void {
	const unavailable = new Set(snapshot.capture.migration?.unavailableFacts ?? []);
	const ids = new Map<string, string>();
	const register = (id: string, path: string) => {
		const existing = ids.get(id);
		if (existing) issues.push(issue('duplicate-id', path, `Entity id "${id}" is already declared at ${existing}.`));
		else ids.set(id, path);
	};
	snapshot.graph.groups.forEach((entry, index) => register(entry.id, `/graph/groups/${index}/id`));
	snapshot.graph.nodes.forEach((entry, index) => register(entry.id, `/graph/nodes/${index}/id`));
	snapshot.graph.resources.forEach((entry, index) => register(entry.id, `/graph/resources/${index}/id`));
	snapshot.graph.textureViews.forEach((entry, index) => register(entry.id, `/graph/textureViews/${index}/id`));
	snapshot.graph.accesses.forEach((entry, index) => register(entry.id, `/graph/accesses/${index}/id`));
	snapshot.graph.segments.forEach((entry, index) => register(entry.id, `/graph/segments/${index}/id`));
	if (snapshot.memory.allocationReport.status === 'available') {
		snapshot.memory.allocationReport.allocations.forEach((entry, index) => register(entry.id, `/memory/allocationReport/allocations/${index}/id`));
	}
	const groupIds = new Set(snapshot.graph.groups.map((group) => group.id));
	const nodeById = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
	const resourceById = new Map(snapshot.graph.resources.map((resource) => [resource.id, resource]));
	const viewById = new Map(snapshot.graph.textureViews.map((view) => [view.id, view]));
	const allocationById = new Map(snapshot.memory.allocationReport.status === 'available'
		? snapshot.memory.allocationReport.allocations.map((allocation) => [allocation.id, allocation] as const)
		: []);
	validateMigrationAvailability(snapshot, unavailable, issues);
	for (let index = 0; index < snapshot.graph.groups.length; index++) {
		const group = snapshot.graph.groups[index];
		if (group.parentId && !groupIds.has(group.parentId)) missing(`/graph/groups/${index}/parentId`, 'group', group.parentId, issues);
		if (group.parentId) {
			const parentIndex = snapshot.graph.groups.findIndex((candidate) => candidate.id === group.parentId);
			if (parentIndex >= index) issues.push(issue('invalid-group-order', `/graph/groups/${index}/parentId`, 'A group parent must appear before its child.'));
		}
		const seen = new Set<string>([group.id]);
		let parentId = group.parentId;
		while (parentId) {
			if (seen.has(parentId)) {
				issues.push(issue('group-cycle', `/graph/groups/${index}/parentId`, 'Group parent references form a cycle.'));
				break;
			}
			seen.add(parentId);
			parentId = snapshot.graph.groups.find((candidate) => candidate.id === parentId)?.parentId;
		}
	}
	const retainedNodes: { readonly node: FrameGraphSnapshot['graph']['nodes'][number]; readonly index: number }[] = [];
	for (let index = 0; index < snapshot.graph.nodes.length; index++) {
		const node = snapshot.graph.nodes[index];
		if (node.groupId && !groupIds.has(node.groupId)) missing(`/graph/nodes/${index}/groupId`, 'group', node.groupId, issues);
		if (node.compileState.status === 'retained') {
			retainedNodes.push({ node, index });
		}
	}
	const retainedByExecutionOrder = [...retainedNodes].sort((a, b) => (
		a.node.compileState.status === 'retained' && b.node.compileState.status === 'retained'
			? a.node.compileState.executionOrder - b.node.compileState.executionOrder
			: 0
	));
	retainedByExecutionOrder.forEach(({ node, index }, expectedOrder) => {
		if (node.compileState.status === 'retained' && node.compileState.executionOrder !== expectedOrder) {
			issues.push(issue('invalid-execution-order', `/graph/nodes/${index}/compileState/executionOrder`, 'Retained node executionOrder values must form the contiguous range 0..N-1.'));
		}
	});
	for (let index = 0; index < snapshot.graph.resources.length; index++) {
		const resource = snapshot.graph.resources[index];
		if (snapshot.capture.migration === undefined && resource.initialContents === undefined) {
			issues.push(issue('missing-initial-contents', `/graph/resources/${index}/initialContents`, 'ZenFG producers must declare the resource initial contents.'));
		}
		if (resource.groupId && !groupIds.has(resource.groupId)) missing(`/graph/resources/${index}/groupId`, 'group', resource.groupId, issues);
		if (resource.allocationId) {
			const allocation = allocationById.get(resource.allocationId);
			if (!allocation) missing(`/graph/resources/${index}/allocationId`, 'allocation', resource.allocationId, issues);
			else if (allocation.kind !== resource.kind) issues.push(issue('reference-kind', `/graph/resources/${index}/allocationId`, 'Resource and allocation kinds must match.'));
		}
		if (resource.lifetime && resource.lifetime.lastUse >= retainedNodes.length) {
			issues.push(issue('invalid-lifetime', `/graph/resources/${index}/lifetime`, 'Resource lifetime must use retained execution-order indices.'));
		}
	}
	for (let index = 0; index < snapshot.graph.textureViews.length; index++) {
		const view = snapshot.graph.textureViews[index];
		const resource = resourceById.get(view.resourceId);
		if (!resource) missing(`/graph/textureViews/${index}/resourceId`, 'resource', view.resourceId, issues);
		else if (resource.kind !== 'texture') issues.push(issue('reference-kind', `/graph/textureViews/${index}/resourceId`, 'Texture view must reference a texture resource.'));
	}
	for (let index = 0; index < snapshot.graph.accesses.length; index++) {
		const access = snapshot.graph.accesses[index];
		const node = nodeById.get(access.nodeId);
		const resource = resourceById.get(access.resourceId);
		if (!node) missing(`/graph/accesses/${index}/nodeId`, 'node', access.nodeId, issues);
		if (!resource) missing(`/graph/accesses/${index}/resourceId`, 'resource', access.resourceId, issues);
		if (resource && !accessKindMatchesResource(access.access, resource.kind)) issues.push(issue('reference-kind', `/graph/accesses/${index}/access`, 'Access kind does not match the referenced resource kind.'));
		if (access.textureViewId) {
			const view = viewById.get(access.textureViewId);
			if (!view) missing(`/graph/accesses/${index}/textureViewId`, 'texture view', access.textureViewId, issues);
			else if (view.resourceId !== access.resourceId) issues.push(issue('reference-mismatch', `/graph/accesses/${index}/textureViewId`, 'Texture view and access must reference the same resource.'));
		}
		const regionsUnavailable = unavailable.has('graph.accesses.regions');
		if (resource?.kind === 'texture' && access.textureRegion === undefined && !regionsUnavailable) {
			issues.push(issue('invalid-access-range', `/graph/accesses/${index}/textureRegion`, 'Texture access requires textureRegion when access regions are available.'));
		}
		if (resource?.kind === 'buffer' && access.bufferRange === undefined && !regionsUnavailable) {
			issues.push(issue('invalid-access-range', `/graph/accesses/${index}/bufferRange`, 'Buffer access requires bufferRange when access regions are available.'));
		}
	}
	const dependencies = new Set<string>();
	for (let index = 0; index < snapshot.graph.dependencies.length; index++) {
		const dependency = snapshot.graph.dependencies[index];
		let fromOrder: number | undefined;
		let toOrder: number | undefined;
		for (const [name, id] of [['fromNodeId', dependency.fromNodeId], ['toNodeId', dependency.toNodeId]] as const) {
			const node = nodeById.get(id);
			if (!node) missing(`/graph/dependencies/${index}/${name}`, 'node', id, issues);
			else if (node.compileState.status !== 'retained') issues.push(issue('reference-state', `/graph/dependencies/${index}/${name}`, 'Dependency nodes must be retained.'));
			else if (name === 'fromNodeId') fromOrder = node.compileState.executionOrder;
			else toOrder = node.compileState.executionOrder;
		}
		if (!resourceById.has(dependency.resourceId)) missing(`/graph/dependencies/${index}/resourceId`, 'resource', dependency.resourceId, issues);
		if (fromOrder !== undefined && toOrder !== undefined && fromOrder >= toOrder) {
			issues.push(issue('invalid-dependency-order', `/graph/dependencies/${index}/toNodeId`, 'Dependency edges must point from an earlier retained node to a later retained node.'));
		}
		const key = `${dependency.fromNodeId}\u0000${dependency.toNodeId}\u0000${dependency.resourceId}\u0000${dependency.kind}`;
		if (dependencies.has(key)) issues.push(issue('duplicate-dependency', `/graph/dependencies/${index}`, 'Duplicate dependency tuple.'));
		dependencies.add(key);
	}
	for (let index = 0; index < snapshot.graph.roots.length; index++) {
		const root = snapshot.graph.roots[index];
		if (root.nodeId && !nodeById.has(root.nodeId)) missing(`/graph/roots/${index}/nodeId`, 'node', root.nodeId, issues);
		if (root.resourceId && !resourceById.has(root.resourceId)) missing(`/graph/roots/${index}/resourceId`, 'resource', root.resourceId, issues);
	}
	for (let index = 0; index < snapshot.diagnostics.length; index++) {
		const diagnostic = snapshot.diagnostics[index];
		if (diagnostic.nodeId && !nodeById.has(diagnostic.nodeId)) {
			missing(`/diagnostics/${index}/nodeId`, 'node', diagnostic.nodeId, issues);
		}
		if (diagnostic.resourceId && !resourceById.has(diagnostic.resourceId)) {
			missing(`/diagnostics/${index}/resourceId`, 'resource', diagnostic.resourceId, issues);
		}
	}
	const segmentedNodes = new Set<string>();
	const segmentedSequence: string[] = [];
	for (let index = 0; index < snapshot.graph.segments.length; index++) {
		const segment = snapshot.graph.segments[index];
		if (segment.order !== index) issues.push(issue('invalid-segment-order', `/graph/segments/${index}/order`, 'Segment order must equal its array index.'));
		if (segment.kind === 'external-submission' && segment.nodeIds.length !== 1) {
			issues.push(issue('invalid-segment-kind', `/graph/segments/${index}/nodeIds`, 'External-submission segment must contain exactly one node.'));
		}
		for (let nodeIndex = 0; nodeIndex < segment.nodeIds.length; nodeIndex++) {
			const id = segment.nodeIds[nodeIndex];
			const node = nodeById.get(id);
			const path = `/graph/segments/${index}/nodeIds/${nodeIndex}`;
			if (!node) missing(path, 'node', id, issues);
			else if (node.compileState.status !== 'retained') issues.push(issue('reference-state', path, 'Execution segment may only reference retained nodes.'));
			else if (segment.kind === 'external-submission' && node.kind !== 'external-submission') issues.push(issue('invalid-segment-kind', path, 'External-submission segment must contain an external-submission node.'));
			else if (segment.kind === 'frame-graph' && node.kind === 'external-submission') issues.push(issue('invalid-segment-kind', path, 'FrameGraph segment cannot contain an external-submission node.'));
			if (segmentedNodes.has(id)) issues.push(issue('duplicate-segment-node', path, 'Retained node may appear in only one execution segment.'));
			segmentedNodes.add(id);
			segmentedSequence.push(id);
		}
	}
	for (const node of snapshot.graph.nodes) {
		if (node.compileState.status === 'retained' && !segmentedNodes.has(node.id)) issues.push(issue('missing-segment-node', '/graph/segments', `Retained node "${node.id}" is not assigned to an execution segment.`));
	}
	const expectedSequence = retainedByExecutionOrder.map(({ node }) => node.id);
	if (segmentedSequence.length === expectedSequence.length && segmentedSequence.some((id, index) => id !== expectedSequence[index])) {
		issues.push(issue('invalid-segment-sequence', '/graph/segments', 'Concatenated segment nodes must follow retained execution order.'));
	}
	if (snapshot.timings.gpu.status === 'available') {
		const timed = new Set<string>();
		for (let index = 0; index < snapshot.timings.gpu.nodes.length; index++) {
			const timing = snapshot.timings.gpu.nodes[index];
			const node = nodeById.get(timing.nodeId);
			if (!node) missing(`/timings/gpu/nodes/${index}/nodeId`, 'node', timing.nodeId, issues);
			else if (node.compileState.status !== 'retained' || (node.kind !== 'render' && node.kind !== 'compute')) issues.push(issue('reference-state', `/timings/gpu/nodes/${index}/nodeId`, 'GPU timing must reference a retained render or compute node.'));
			if (timed.has(timing.nodeId)) issues.push(issue('duplicate-timing', `/timings/gpu/nodes/${index}/nodeId`, 'A node may have only one GPU timing.'));
			timed.add(timing.nodeId);
		}
	}
}

function validateMigrationAvailability(
	snapshot: FrameGraphSnapshot,
	unavailable: ReadonlySet<string>,
	issues: Issues,
): void {
	const migrated = snapshot.capture.migration !== undefined;
	const groupsUnavailable = unavailable.has('graph.groups');
	if (groupsUnavailable) {
		if (!migrated || snapshot.graph.groups.length !== 0) issues.push(issue('invalid-migration-availability', '/graph/groups', 'Unavailable groups require Legacy migration provenance and an empty groups table.'));
		for (let index = 0; index < snapshot.graph.nodes.length; index++) {
			if (snapshot.graph.nodes[index].groupId !== undefined) issues.push(issue('invalid-migration-availability', `/graph/nodes/${index}/groupId`, 'Group references must be absent when groups are unavailable.'));
		}
		for (let index = 0; index < snapshot.graph.resources.length; index++) {
			if (snapshot.graph.resources[index].groupId !== undefined) issues.push(issue('invalid-migration-availability', `/graph/resources/${index}/groupId`, 'Group references must be absent when groups are unavailable.'));
		}
	}
	const viewsUnavailable = unavailable.has('graph.textureViews');
	if (viewsUnavailable) {
		if (!migrated || snapshot.graph.textureViews.length !== 0) issues.push(issue('invalid-migration-availability', '/graph/textureViews', 'Unavailable texture views require Legacy migration provenance and an empty textureViews table.'));
		for (let index = 0; index < snapshot.graph.accesses.length; index++) {
			if (snapshot.graph.accesses[index].textureViewId !== undefined) issues.push(issue('invalid-migration-availability', `/graph/accesses/${index}/textureViewId`, 'Texture view references must be absent when texture views are unavailable.'));
		}
	}
	const recordingUnavailable = unavailable.has('graph.nodes.recordingOrder');
	for (let index = 0; index < snapshot.graph.nodes.length; index++) {
		const recordingOrder = snapshot.graph.nodes[index].recordingOrder;
		if (recordingUnavailable) {
			if (recordingOrder !== undefined) issues.push(issue('invalid-migration-availability', `/graph/nodes/${index}/recordingOrder`, 'recordingOrder must be absent when recording order is unavailable.'));
		} else if (recordingOrder !== index) {
			issues.push(issue('invalid-recording-order', `/graph/nodes/${index}/recordingOrder`, 'Node recordingOrder must equal its array index.'));
		}
	}
	if (unavailable.has('graph.accesses.regions')) {
		if (!migrated) issues.push(issue('invalid-migration-availability', '/capture/migration/unavailableFacts', 'Unavailable access regions require Legacy migration provenance.'));
		const hasMissingRegion = snapshot.graph.accesses.some((access) => (
			access.access.startsWith('texture-') ? access.textureRegion === undefined : access.bufferRange === undefined
		));
		if (!hasMissingRegion) issues.push(issue('invalid-migration-availability', '/capture/migration/unavailableFacts', 'Access regions may be marked unavailable only when at least one access region is missing.'));
	}
}

function validateUnavailable(value: UnknownRecord, path: string, issues: Issues): void {
	if (value.status !== 'unavailable') {
		issues.push(issue('invalid-enum', `${path}/status`, 'Expected available or unavailable.'));
		return;
	}
	keys(value, path, ['status', 'reason'], [], issues);
	nonEmptyString(value.reason, `${path}/reason`, issues);
}

function accessKindMatchesResource(access: FrameGraphSnapshotAccessKind, resourceKind: 'texture' | 'buffer'): boolean {
	return access.startsWith(resourceKind === 'texture' ? 'texture-' : 'buffer-');
}

function forEachRecord(value: unknown, path: string, issues: Issues, callback: (entry: UnknownRecord, path: string) => void): void {
	const entries = array(value, path, issues);
	if (!entries) return;
	entries.forEach((entry, index) => {
		const entryPath = `${path}/${index}`;
		const item = record(entry, entryPath, issues);
		if (item) callback(item, entryPath);
	});
}

function record(value: unknown, path: string, issues: Issues): UnknownRecord | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		issues.push(issue('invalid-type', path, 'Expected an object.'));
		return undefined;
	}
	return value as UnknownRecord;
}

function array(value: unknown, path: string, issues: Issues): unknown[] | undefined {
	if (!Array.isArray(value)) {
		issues.push(issue('invalid-type', path, 'Expected an array.'));
		return undefined;
	}
	return value;
}

function keys(value: UnknownRecord, path: string, required: readonly string[], optional: readonly string[], issues: Issues): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of required) {
		if (!(key in value)) issues.push(issue('missing-property', `${path}/${pointer(key)}`, `Required property "${key}" is missing.`));
	}
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) issues.push(issue('unexpected-property', `${path}/${pointer(key)}`, `Property "${key}" is not part of Snapshot 1.0.`));
	}
}

function literal(value: unknown, expected: string | number, path: string, issues: Issues): void {
	if (value !== expected) issues.push(issue('invalid-literal', path, `Expected ${JSON.stringify(expected)}.`));
}

function string(value: unknown, path: string, issues: Issues): string | undefined {
	if (typeof value !== 'string') {
		issues.push(issue('invalid-type', path, 'Expected a string.'));
		return undefined;
	}
	return value;
}

function nonEmptyString(value: unknown, path: string, issues: Issues): string | undefined {
	const result = string(value, path, issues);
	if (result !== undefined && result.length === 0) issues.push(issue('empty-string', path, 'Expected a non-empty string.'));
	return result;
}

function optionalString(value: unknown, path: string, issues: Issues): void {
	if (value !== undefined) string(value, path, issues);
}

function optionalNonEmptyString(value: unknown, path: string, issues: Issues): void {
	if (value !== undefined) nonEmptyString(value, path, issues);
}

function entityId(value: unknown, path: string, issues: Issues, expectedPrefix?: EntityPrefix): string | undefined {
	const id = nonEmptyString(value, path, issues);
	if (id !== undefined && !ENTITY_ID_PATTERN.test(id)) {
		issues.push(issue('invalid-id', path, 'Entity id must use a type-prefixed string such as "node:1".'));
	} else if (id !== undefined && expectedPrefix !== undefined && !id.startsWith(`${expectedPrefix}:`)) {
		issues.push(issue('invalid-id', path, `Entity id must use the "${expectedPrefix}:" prefix.`));
	}
	return id;
}

function optionalEntityId(value: unknown, path: string, issues: Issues, expectedPrefix: EntityPrefix): void {
	if (value !== undefined) entityId(value, path, issues, expectedPrefix);
}

function boolean(value: unknown, path: string, issues: Issues): boolean | undefined {
	if (typeof value !== 'boolean') {
		issues.push(issue('invalid-type', path, 'Expected a boolean.'));
		return undefined;
	}
	return value;
}

function safeInteger(value: unknown, path: string, issues: Issues): number | undefined {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		issues.push(issue('invalid-integer', path, 'Expected a non-negative safe integer.'));
		return undefined;
	}
	return value as number;
}

function positiveSafeInteger(value: unknown, path: string, issues: Issues): number | undefined {
	const result = safeInteger(value, path, issues);
	if (result === 0) issues.push(issue('invalid-integer', path, 'Expected a positive safe integer.'));
	return result;
}

function optionalSafeInteger(value: unknown, path: string, issues: Issues): void {
	if (value !== undefined) safeInteger(value, path, issues);
}

function finiteNumber(value: unknown, path: string, issues: Issues): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		issues.push(issue('invalid-number', path, 'Expected a finite non-negative number.'));
		return undefined;
	}
	return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string, issues: Issues): T | undefined {
	if (typeof value !== 'string' || !allowed.includes(value as T)) {
		issues.push(issue('invalid-enum', path, `Expected one of: ${allowed.join(', ')}.`));
		return undefined;
	}
	return value as T;
}

function stringArray<T extends string>(
	value: unknown,
	path: string,
	issues: Issues,
	entities = false,
	allowed?: readonly T[],
	entityPrefix?: EntityPrefix,
	nonEmpty = false,
): void {
	const entries = array(value, path, issues);
	if (!entries) return;
	const seen = new Set<string>();
	entries.forEach((entry, index) => {
		const entryPath = `${path}/${index}`;
		const text = entities ? entityId(entry, entryPath, issues, entityPrefix) : nonEmpty ? nonEmptyString(entry, entryPath, issues) : string(entry, entryPath, issues);
		if (text === undefined) return;
		if (allowed && !allowed.includes(text as T)) issues.push(issue('invalid-enum', entryPath, `Expected one of: ${allowed.join(', ')}.`));
		if (seen.has(text)) issues.push(issue('duplicate-value', entryPath, `Duplicate value "${text}".`));
		seen.add(text);
	});
}

type JsonValueFrame =
	| { readonly kind: 'visit'; readonly value: unknown; readonly path: string; readonly containerDepth: number }
	| { readonly kind: 'leave'; readonly value: object }
	| { readonly kind: 'hole'; readonly path: string };

function jsonValue(value: unknown, rootPath: string, issues: Issues): void {
	const ancestors = new Set<object>();
	const stack: JsonValueFrame[] = [{ kind: 'visit', value, path: rootPath, containerDepth: 0 }];
	let depthIssueReported = false;

	while (stack.length > 0) {
		const frame = stack.pop()!;
		if (frame.kind === 'leave') {
			ancestors.delete(frame.value);
			continue;
		}
		if (frame.kind === 'hole') {
			issues.push(issue('invalid-json-value', frame.path, 'JSON arrays cannot contain holes.'));
			continue;
		}

		const { value: entry, path, containerDepth } = frame;
		if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') continue;
		if (typeof entry === 'number') {
			if (!Number.isFinite(entry)) issues.push(issue('invalid-json-value', path, 'JSON numbers must be finite.'));
			continue;
		}
		if (typeof entry !== 'object') {
			issues.push(issue('invalid-json-value', path, 'Expected a JSON value.'));
			continue;
		}

		const isArray = Array.isArray(entry);
		if (!isArray) {
			const prototype = Object.getPrototypeOf(entry);
			if (prototype !== Object.prototype && prototype !== null) {
				issues.push(issue('invalid-json-value', path, 'JSON objects must be plain objects.'));
				continue;
			}
		}
		if (ancestors.has(entry)) {
			issues.push(issue('invalid-json-value', path, 'JSON values cannot contain cycles.'));
			continue;
		}

		const nextDepth = containerDepth + 1;
		if (nextDepth > FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH) {
			if (!depthIssueReported) {
				issues.push(issue(
					'extension-depth-exceeded',
					rootPath,
					`Extension JSON nesting depth must not exceed ${FRAME_GRAPH_SNAPSHOT_MAX_EXTENSION_DEPTH} container levels.`,
				));
				depthIssueReported = true;
			}
			continue;
		}

		ancestors.add(entry);
		stack.push({ kind: 'leave', value: entry });
		if (isArray) {
			for (let index = entry.length - 1; index >= 0; index--) {
				const entryPath = `${path}/${index}`;
				stack.push(index in entry
					? { kind: 'visit', value: entry[index], path: entryPath, containerDepth: nextDepth }
					: { kind: 'hole', path: entryPath });
			}
		} else {
			const entries = Object.entries(entry);
			for (let index = entries.length - 1; index >= 0; index--) {
				const [key, child] = entries[index];
				stack.push({
					kind: 'visit',
					value: child,
					path: `${path}/${pointer(key)}`,
					containerDepth: nextDepth,
				});
			}
		}
	}
}

function missing(path: string, kind: string, id: string, issues: Issues): void {
	issues.push(issue('missing-reference', path, `Unknown ${kind} id "${id}".`));
}

function pointer(value: string): string {
	return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function issue(code: string, path: string, message: string): FrameGraphSnapshotIssue {
	return { severity: 'error', code, path, message };
}
