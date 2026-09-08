import { rootKey, type FrameGraphDebugViewModel } from './debugCaptureModel.ts';
import type { Selection } from './panelTypes.ts';

export function resolveSelectedDetail(
	snapshot: FrameGraphDebugViewModel,
	selected: Selection | undefined,
): unknown {
	if (!selected) return snapshot;

	switch (selected.kind) {
		case 'node': {
			const node = snapshot.nodeById.get(selected.id);
			const executionSegment = snapshot.segmentByNodeId.get(selected.id);
			return node
				? {
					...node,
					debugGroupPath: debugGroupPath(snapshot, node.debugGroupId),
					executionSegment,
					reads: node.reads.map((access) => resolveAccessDetail(snapshot, access)),
					writes: node.writes.map((access) => resolveAccessDetail(snapshot, access)),
				}
				: undefined;
		}
		case 'resource':
			return resolveResourceDetail(snapshot, selected.id);
		case 'group':
			return snapshot.groupByPathKey.get(selected.pathKey);
		case 'root':
			return snapshot.roots.find((root) => root.key === selected.key);
		case 'culled': {
			const culled = snapshot.culledById.get(selected.id);
			return culled ? {
				...culled,
				node: {
					...culled.node,
					reads: culled.node.reads.map((access) => resolveAccessDetail(snapshot, access)),
					writes: culled.node.writes.map((access) => resolveAccessDetail(snapshot, access)),
				},
			} : undefined;
		}
		case 'allocation':
			return snapshot.allocationById.get(selected.id);
		case 'segment':
			return snapshot.segmentByIndex.get(selected.index);
	}
}

export function selectionExists(snapshot: FrameGraphDebugViewModel, selected: Selection): boolean {
	switch (selected.kind) {
		case 'node':
			return snapshot.nodeById.has(selected.id);
		case 'group':
			return snapshot.groupByPathKey.has(selected.pathKey);
		case 'resource':
			return snapshot.resourceById.has(selected.id);
		case 'root':
			return snapshot.roots.filter((root) => root.key === selected.key).length === 1;
		case 'culled':
			return snapshot.culledById.has(selected.id);
		case 'allocation':
			return snapshot.allocationById.has(selected.id);
		case 'segment':
			return snapshot.segmentByIndex.has(selected.index);
	}
}

function resolveResourceDetail(snapshot: FrameGraphDebugViewModel, resourceId: string): unknown {
	const resource = snapshot.resourceById.get(resourceId);
	if (!resource) return undefined;
	const accesses = (snapshot.accessesByResourceId.get(resourceId) ?? [])
		.map((access) => resolveAccessDetail(snapshot, access));
	return {
		...resource,
		debugGroupPath: debugGroupPath(snapshot, resource.debugGroupId),
		writes: accesses.filter((access) => access.mode === 'write'),
		reads: accesses.filter((access) => access.mode === 'read'),
	};
}

function resolveAccessDetail<TAccess extends { readonly textureViewId?: string }>(
	snapshot: FrameGraphDebugViewModel,
	access: TAccess,
): TAccess & { readonly textureView?: FrameGraphDebugViewModel['protocol']['graph']['textureViews'][number] } {
	return access.textureViewId === undefined
		? access
		: {
			...access,
			textureView: snapshot.textureViewById.get(access.textureViewId),
		};
}

function debugGroupPath(snapshot: FrameGraphDebugViewModel, groupId: string | undefined): string {
	if (groupId === undefined) return '-';
	return snapshot.groupById.get(groupId)?.path.join(' / ') ?? `#${groupId}`;
}

/** Resolve identity again after a capture, including retained/culled transitions. */
export function resolveNodeSelection(snapshot: FrameGraphDebugViewModel, id: string): Selection | undefined {
	if (snapshot.nodeById.has(id)) return { kind: 'node', id };
	if (snapshot.culledById.has(id)) return { kind: 'culled', id };
	return undefined;
}

export type SelectedCanonicalDetail = { readonly path: string; readonly value: unknown };

/** Raw shows the canonical source object, never the presentation model. */
export function resolveSelectedCanonicalDetail(
	snapshot: FrameGraphDebugViewModel,
	selected: Selection | undefined,
): SelectedCanonicalDetail | undefined {
	if (!selected) return undefined;
	const protocol = snapshot.protocol;
	function at<T>(values: readonly T[], path: string, predicate: (value: T) => boolean): SelectedCanonicalDetail | undefined {
		const index = values.findIndex(predicate);
		return index < 0 ? undefined : { path: `${path}[${index}]`, value: values[index] };
	}
	switch (selected.kind) {
		case 'node':
		case 'culled': return at(protocol.graph.nodes, '$.graph.nodes', (node) => node.id === selected.id);
		case 'resource': return at(protocol.graph.resources, '$.graph.resources', (resource) => resource.id === selected.id);
		case 'group': {
			const id = snapshot.groupByPathKey.get(selected.pathKey)?.id;
			return at(protocol.graph.groups, '$.graph.groups', (group) => group.id === id);
		}
		case 'root': return at(protocol.graph.roots, '$.graph.roots', (root) => rootKey(root) === selected.key);
		case 'allocation': return protocol.memory.allocationReport.status === 'available'
			? at(protocol.memory.allocationReport.allocations, '$.memory.allocationReport.allocations', (allocation) => allocation.id === selected.id)
			: undefined;
		case 'segment': return at(protocol.graph.segments, '$.graph.segments', (segment) => segment.order === selected.index);
	}
}
