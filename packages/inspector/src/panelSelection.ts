import type { FrameGraphDebugViewModel } from './debugCaptureModel.ts';
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
			return snapshot.roots[selected.index];
		case 'culled': {
			const culled = snapshot.culledNodes[selected.index];
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
			return isValidIndex(selected.index, snapshot.roots.length);
		case 'culled':
			return isValidIndex(selected.index, snapshot.culledNodes.length);
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

function isValidIndex(index: number, length: number): boolean {
	return Number.isInteger(index) && index >= 0 && index < length;
}
