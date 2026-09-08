import type {
	FrameGraphSnapshot,
	FrameGraphSnapshotAccessKind,
	FrameGraphSnapshotBufferRange,
	FrameGraphSnapshotGpuTimings,
	FrameGraphSnapshotNodeKind,
	FrameGraphSnapshotResourceKind,
	FrameGraphSnapshotResourceOrigin,
	FrameGraphSnapshotRoot,
	FrameGraphSnapshotSegment,
	FrameGraphSnapshotTextureRegion,
	FrameGraphSnapshotWriteContents,
} from '@zenfg/snapshot';

type ResourceAccessMode = 'read' | 'write';

export type FrameGraphDebugExecutionSegment = FrameGraphSnapshotSegment & {
	readonly index: number;
};

export type FrameGraphDebugResourceRef = {
    readonly id: string;
    readonly kind: FrameGraphSnapshotResourceKind;
    readonly label?: string;
};

type FrameGraphDebugAccessEdgeBase = {
	readonly accessId: string;
	readonly nodeId: string;
    readonly resource: FrameGraphDebugResourceRef;
	readonly access: FrameGraphSnapshotAccessKind;
	readonly textureViewId?: string;
	readonly textureRegion?: FrameGraphSnapshotTextureRegion;
	readonly bufferRange?: FrameGraphSnapshotBufferRange;
};

export type FrameGraphDebugAccessEdge = FrameGraphDebugAccessEdgeBase & (
    | {
        readonly mode: 'read';
        readonly producesValue: false;
        readonly contents?: never;
    }
    | {
        readonly mode: 'write';
		readonly contents: FrameGraphSnapshotWriteContents;
        readonly producesValue: boolean;
    }
);

export type FrameGraphDebugAccess = FrameGraphDebugAccessEdge extends infer TAccess
	? TAccess extends FrameGraphDebugAccessEdge ? Omit<TAccess, 'nodeId'> : never
    : never;

export type FrameGraphDebugNode = {
	readonly id: string;
    readonly order: number;
	readonly kind: FrameGraphSnapshotNodeKind;
    readonly label?: string;
	readonly sideEffect: boolean;
	readonly debugGroupId?: string;
    readonly gpuDurationMicros?: number;
    readonly reads: readonly FrameGraphDebugAccess[];
    readonly writes: readonly FrameGraphDebugAccess[];
};

export type FrameGraphDebugResource = FrameGraphDebugResourceRef & {
	readonly origin: FrameGraphSnapshotResourceOrigin;
	readonly initialContents?: 'defined' | 'undefined';
	readonly debugGroupId?: string;
	readonly usageFlags: readonly string[];
    readonly lifetime?: { readonly firstUse: number; readonly lastUse: number };
	readonly physicalResourceId?: string;
	readonly descriptor?: FrameGraphSnapshot['graph']['resources'][number]['descriptor'];
	readonly estimatedByteSize?: number;
};

export type FrameGraphDebugEdge = {
	readonly fromNodeId: string;
	readonly toNodeId: string;
    readonly resource: FrameGraphDebugResourceRef;
    readonly kind: 'value' | 'ordering';
};

export type FrameGraphDebugRoot = FrameGraphSnapshotRoot & {
	readonly key: string;
    readonly resource?: FrameGraphDebugResourceRef;
};

/** Semantic identity within one recording, independent of root array order. */
export function rootKey(root: FrameGraphSnapshotRoot): string {
	return root.reason === 'side-effect' ? JSON.stringify([root.reason, root.nodeId])
		: JSON.stringify([root.reason, root.resourceId, root.range?.kind === 'buffer'
			? ['buffer', root.range.offset, root.range.size]
			: root.range?.regions.map((r) => [r.baseMipLevel, r.mipLevelCount, r.aspect, r.baseArrayLayer, r.arrayLayerCount, r.baseDepthSlice, r.depthSliceCount]) ?? null]);
}

export type FrameGraphDebugCulledNode = {
    readonly node: Omit<FrameGraphDebugNode, 'order'>;
    readonly reason: string;
};

export type FrameGraphDebugPhysicalAllocation = {
	readonly id: string;
	readonly kind: FrameGraphSnapshotResourceKind;
	readonly compatibilityClassId: string;
	readonly estimatedByteSize?: number;
	readonly resourceIds: readonly string[];
};

export type FrameGraphDebugGroupSummary = {
	readonly retainedNodeCount: number;
	readonly culledNodeCount: number;
	readonly nodeKindCounts: Readonly<Partial<Record<FrameGraphSnapshotNodeKind, number>>>;
	readonly inputResources: readonly FrameGraphDebugResourceRef[];
	readonly outputResources: readonly FrameGraphDebugResourceRef[];
	readonly outputRoots: readonly FrameGraphDebugRoot[];
	readonly registeredTransientResourceCount: number;
	readonly accessedTransientResourceCount: number;
	readonly physicalAllocationCount: number;
	readonly executionSegmentCount: number;
	readonly externalSubmissionCount: number;
	readonly gpuWorkDurationMicros: number;
	readonly timedNodeCount: number;
	readonly timingEligibleNodeCount: number;
};

export type FrameGraphDebugGroup = {
	readonly id: string;
	readonly parentId?: string;
	readonly label: string;
	readonly path: readonly string[];
	/** Stable while same-named siblings retain their recording-order occurrence. */
	readonly pathKey: string;
	readonly depth: number;
	/** Ordered ancestor ids from root through this group. */
	readonly ancestorIds: readonly string[];
	readonly summary: FrameGraphDebugGroupSummary;
};

export type FrameGraphDebugMetrics = {
	readonly timingEligibleNodeCount: number;
	readonly timedNodeCount: number;
	readonly slowestNode?: FrameGraphDebugNode;
	readonly transientEstimatedByteSize?: number;
	readonly logicalCapacityBytes?: number;
	readonly physicalEstimatedBytes?: number;
	readonly aliasReuseBytes?: number;
	readonly aliasedAllocationCount: number;
	readonly estimatedCoverage: {
		readonly transient: EstimateCoverage;
		readonly logical: EstimateCoverage;
		readonly physical: EstimateCoverage;
	};
};

export type EstimateCoverage = { readonly known: number; readonly total: number };

export type FrameGraphDebugSnapshotSource = {
	readonly kind: 'live' | 'file' | 'programmatic';
	readonly label: string;
	readonly migratedFromLegacy?: boolean;
};

export type FrameGraphDebugViewModel = {
	readonly protocol: FrameGraphSnapshot;
	readonly source: FrameGraphDebugSnapshotSource;
    readonly frameIndex: number;
    readonly nodes: readonly FrameGraphDebugNode[];
    readonly resources: readonly FrameGraphDebugResource[];
    readonly edges: readonly FrameGraphDebugEdge[];
    readonly accessEdges: readonly FrameGraphDebugAccessEdge[];
    readonly roots: readonly FrameGraphDebugRoot[];
    readonly culledNodes: readonly FrameGraphDebugCulledNode[];
	readonly physicalAllocations: readonly FrameGraphDebugPhysicalAllocation[];
	readonly debugGroups: readonly FrameGraphDebugGroup[];
	readonly executionSegments: readonly FrameGraphDebugExecutionSegment[];
	readonly textureViewById: ReadonlyMap<string, FrameGraphSnapshot['graph']['textureViews'][number]>;
	readonly nodeById: ReadonlyMap<string, FrameGraphDebugNode>;
	readonly canonicalNodeById: ReadonlyMap<string, FrameGraphSnapshot['graph']['nodes'][number]>;
	readonly culledById: ReadonlyMap<string, FrameGraphDebugCulledNode>;
	readonly diagnosticsByNodeId: ReadonlyMap<string, readonly FrameGraphSnapshot['diagnostics'][number][]>;
	readonly diagnosticsByResourceId: ReadonlyMap<string, readonly FrameGraphSnapshot['diagnostics'][number][]>;
	readonly resourceById: ReadonlyMap<string, FrameGraphDebugResource>;
	readonly groupById: ReadonlyMap<string, FrameGraphDebugGroup>;
	readonly groupByPathKey: ReadonlyMap<string, FrameGraphDebugGroup>;
	readonly allocationById: ReadonlyMap<string, FrameGraphDebugPhysicalAllocation>;
	readonly accessesByNodeId: ReadonlyMap<string, readonly FrameGraphDebugAccessEdge[]>;
	readonly accessesByResourceId: ReadonlyMap<string, readonly FrameGraphDebugAccessEdge[]>;
	readonly segmentByNodeId: ReadonlyMap<string, FrameGraphDebugExecutionSegment>;
	readonly segmentByIndex: ReadonlyMap<number, FrameGraphDebugExecutionSegment>;
	readonly metrics: FrameGraphDebugMetrics;
    readonly profiling:
        | {
            readonly status: 'available';
            readonly frameIndex: number;
			readonly timings: readonly { readonly nodeId: string; readonly gpuDurationMicros: number }[];
            readonly gpuFrameDurationMicros: number;
        }
        | {
            readonly status: 'unavailable';
            readonly frameIndex: number;
			readonly reason: Extract<FrameGraphSnapshotGpuTimings, { readonly status: 'unavailable' }>['reason'];
            readonly timings: readonly [];
        };
	readonly resourcePool: FrameGraphSnapshot['memory']['poolReport'];
	readonly availability: {
		readonly groups: boolean;
		readonly textureViews: boolean;
		readonly recordingOrder: boolean;
		readonly accessRegions: boolean;
	};
};

export function createDebugViewModel(
	snapshot: FrameGraphSnapshot,
	source: FrameGraphDebugSnapshotSource = { kind: 'programmatic', label: 'Programmatic' },
): FrameGraphDebugViewModel {
	const compilation = snapshot.graph;
	const unavailable = new Set(snapshot.capture.migration?.unavailableFacts ?? []);
	const availability = {
		groups: !unavailable.has('graph.groups'),
		textureViews: !unavailable.has('graph.textureViews'),
		recordingOrder: !unavailable.has('graph.nodes.recordingOrder'),
		accessRegions: !unavailable.has('graph.accesses.regions'),
	};
	const resolvedSource: FrameGraphDebugSnapshotSource = snapshot.capture.migration?.sourceFormat === 'legacy-v0'
		? { ...source, migratedFromLegacy: true }
		: source;
	const gpuTiming = snapshot.timings.gpu;
	const resourcePool = snapshot.memory.poolReport;
	const normalizedGroups = normalizeDebugGroups(compilation);
	const knownGroupIds = new Set(normalizedGroups.map((group) => group.id));
	validateDebugGroupReferences(compilation, knownGroupIds);
	const resourcesById = new Map(compilation.resources.map((resource) => [resource.id, resource]));
	const resourceRef = (resourceId: string): FrameGraphDebugResourceRef => {
        const resource = resourcesById.get(resourceId);
        if (!resource) {
            throw new Error(`Compilation report references unknown resource ${resourceId}.`);
        }
        return { id: resource.id, kind: resource.kind, label: resource.label };
    };
    const accessEdges = compilation.accesses.map((access): FrameGraphDebugAccessEdge => {
        const common = {
            accessId: access.id,
            nodeId: access.nodeId,
            resource: resourceRef(access.resourceId),
            access: access.access,
            textureViewId: access.textureViewId,
            textureRegion: access.textureRegion,
            bufferRange: access.bufferRange,
        };
        return access.mode === 'read'
            ? { ...common, mode: 'read', producesValue: false }
            : {
                ...common,
                mode: 'write',
                contents: access.contents,
                producesValue: access.producesValue,
            };
    });
	const accessesByNode = new Map<string, FrameGraphDebugAccessEdge[]>();
	const accessesByResource = new Map<string, FrameGraphDebugAccessEdge[]>();
    for (const access of accessEdges) {
        const nodeAccesses = accessesByNode.get(access.nodeId) ?? [];
        nodeAccesses.push(access);
        accessesByNode.set(access.nodeId, nodeAccesses);
		const resourceAccesses = accessesByResource.get(access.resource.id) ?? [];
		resourceAccesses.push(access);
		accessesByResource.set(access.resource.id, resourceAccesses);
    }
	const timings = gpuTiming.status === 'available'
        ? new Map(gpuTiming.nodes.map((timing) => [timing.nodeId, timing.durationMicros]))
        : new Map<string, number>();
	const nodeAccesses = (nodeId: string, mode: ResourceAccessMode): FrameGraphDebugAccess[] => (
        (accessesByNode.get(nodeId) ?? [])
            .filter((access) => access.mode === mode)
			.map(({ nodeId: _nodeId, ...access }) => access)
	);
	const nodes: FrameGraphDebugNode[] = compilation.nodes
		.filter((node) => node.compileState.status === 'retained')
		.sort((a, b) => a.compileState.status === 'retained' && b.compileState.status === 'retained'
			? a.compileState.executionOrder - b.compileState.executionOrder
			: 0)
		.map((node) => ({
		id: node.id,
		order: node.compileState.status === 'retained' ? node.compileState.executionOrder : 0,
		kind: node.kind,
		label: node.label,
		sideEffect: node.sideEffect,
		debugGroupId: node.groupId,
		gpuDurationMicros: timings.get(node.id),
		reads: nodeAccesses(node.id, 'read'),
		writes: nodeAccesses(node.id, 'write'),
	}));
	const resources: FrameGraphDebugResource[] = compilation.resources.map((resource) => ({
		id: resource.id,
		kind: resource.kind,
		label: resource.label,
		origin: resource.origin,
		initialContents: resource.initialContents,
		debugGroupId: resource.groupId,
		usageFlags: resource.usageFlags,
		lifetime: resource.lifetime,
		physicalResourceId: resource.allocationId,
		descriptor: resource.descriptor,
		estimatedByteSize: resource.estimatedByteSize,
	}));
	const edges: FrameGraphDebugEdge[] = compilation.dependencies.map((dependency) => ({
		...dependency,
		resource: resourceRef(dependency.resourceId),
	}));
	const roots: FrameGraphDebugRoot[] = compilation.roots.map((root) => ({
		...root,
		key: rootKey(root),
		resource: root.resourceId === undefined ? undefined : resourceRef(root.resourceId),
	}));
	const culledNodes: FrameGraphDebugCulledNode[] = compilation.nodes
		.filter((node) => node.compileState.status === 'culled')
		.map((node) => ({
		node: {
			id: node.id,
			kind: node.kind,
			label: node.label,
			sideEffect: node.sideEffect,
			debugGroupId: node.groupId,
			reads: nodeAccesses(node.id, 'read'),
			writes: nodeAccesses(node.id, 'write'),
		},
		reason: node.compileState.status === 'culled' ? node.compileState.reason : 'unknown',
	}));
	const resourceIdsByAllocation = new Map<string, string[]>();
	for (const resource of compilation.resources) {
		if (resource.allocationId === undefined) continue;
		const resourceIds = resourceIdsByAllocation.get(resource.allocationId) ?? [];
		resourceIds.push(resource.id);
		resourceIdsByAllocation.set(resource.allocationId, resourceIds);
	}
	const physicalAllocations: FrameGraphDebugPhysicalAllocation[] = snapshot.memory.allocationReport.status === 'available'
		? snapshot.memory.allocationReport.allocations.map((allocation) => ({
			...allocation,
			resourceIds: resourceIdsByAllocation.get(allocation.id) ?? [],
		}))
		: [];
	const executionSegments: FrameGraphDebugExecutionSegment[] = compilation.segments.map((segment) => ({
		...segment,
		index: segment.order,
	}));
	const debugGroups = buildDebugGroupSummaries({
		groups: normalizedGroups,
		nodes,
		culledNodes,
		resources,
		accessEdges,
		edges,
		roots,
		executionSegments,
	});
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const canonicalNodeById = new Map(compilation.nodes.map((node) => [node.id, node]));
	const culledById = new Map(culledNodes.map((entry) => [entry.node.id, entry]));
	const diagnosticsByNodeId = new Map<string, FrameGraphSnapshot['diagnostics'][number][]>();
	const diagnosticsByResourceId = new Map<string, FrameGraphSnapshot['diagnostics'][number][]>();
	for (const diagnostic of snapshot.diagnostics) {
		for (const [id, index] of [[diagnostic.nodeId, diagnosticsByNodeId], [diagnostic.resourceId, diagnosticsByResourceId]] as const) {
			if (id === undefined) continue;
			const entries = index.get(id) ?? [];
			entries.push(diagnostic);
			index.set(id, entries);
		}
	}
	const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
	const groupById = new Map(debugGroups.map((group) => [group.id, group]));
	const groupByPathKey = new Map(debugGroups.map((group) => [group.pathKey, group]));
	const allocationById = new Map(physicalAllocations.map((allocation) => [allocation.id, allocation]));
	const textureViewById = new Map(compilation.textureViews.map((view) => [view.id, view]));
	const segmentByNodeId = new Map<string, FrameGraphDebugExecutionSegment>();
	const segmentByIndex = new Map(executionSegments.map((segment) => [segment.index, segment]));
	for (const segment of executionSegments) {
		for (const nodeId of segment.nodeIds) segmentByNodeId.set(nodeId, segment);
	}
	const timingEligibleNodes = nodes.filter((node) => node.kind === 'render' || node.kind === 'compute');
	const timedNodes = timingEligibleNodes.filter((node) => node.gpuDurationMicros !== undefined);
	const slowestNode = timedNodes.reduce<FrameGraphDebugNode | undefined>((slowest, node) => (
		!slowest || node.gpuDurationMicros! > slowest.gpuDurationMicros! ? node : slowest
	), undefined);
	const transientResources = resources.filter((resource) => resource.origin === 'transient');
	const transientEstimatedByteSize = sumKnown(transientResources.map((resource) => resource.estimatedByteSize));
	const allocationAvailable = snapshot.memory.allocationReport.status === 'available';
	const physicalSizes = physicalAllocations.map((allocation) => allocation.estimatedByteSize);
	const physicalEstimatedBytes = allocationAvailable ? sumKnown(physicalSizes) : undefined;
	const logicalAllocationSizes = transientResources
		.filter((resource) => resource.physicalResourceId !== undefined)
		.map((resource) => allocationById.get(resource.physicalResourceId!)?.estimatedByteSize);
	const logicalCapacityBytes = allocationAvailable ? sumKnown(logicalAllocationSizes) : undefined;
	const metrics: FrameGraphDebugMetrics = {
		timingEligibleNodeCount: timingEligibleNodes.length,
		timedNodeCount: timedNodes.length,
		slowestNode,
		transientEstimatedByteSize,
		logicalCapacityBytes,
		physicalEstimatedBytes,
		aliasReuseBytes: logicalCapacityBytes === undefined || physicalEstimatedBytes === undefined
			? undefined
			: Math.max(0, logicalCapacityBytes - physicalEstimatedBytes),
		aliasedAllocationCount: physicalAllocations.filter((allocation) => allocation.resourceIds.length > 1).length,
		estimatedCoverage: {
			transient: estimateCoverage(transientResources.map((resource) => resource.estimatedByteSize)),
			logical: estimateCoverage(logicalAllocationSizes),
			physical: estimateCoverage(physicalSizes),
		},
	};

	return {
		protocol: snapshot,
		source: resolvedSource,
		frameIndex: snapshot.capture.frameIndex,
		nodes,
		resources,
		edges,
		accessEdges,
		roots,
		culledNodes,
		physicalAllocations,
		debugGroups,
		executionSegments,
		textureViewById,
		nodeById,
		canonicalNodeById,
		culledById,
		diagnosticsByNodeId,
		diagnosticsByResourceId,
		resourceById,
		groupById,
		groupByPathKey,
		allocationById,
		accessesByNodeId: accessesByNode,
		accessesByResourceId: accessesByResource,
		segmentByNodeId,
		segmentByIndex,
		metrics,
        profiling: gpuTiming.status === 'available'
            ? {
                status: 'available',
                frameIndex: snapshot.capture.frameIndex,
                timings: gpuTiming.nodes.map((timing) => ({
                    nodeId: timing.nodeId,
                    gpuDurationMicros: timing.durationMicros,
                })),
                gpuFrameDurationMicros: gpuTiming.frameSpanMicros,
            }
            : {
                status: 'unavailable',
                frameIndex: snapshot.capture.frameIndex,
                timings: [],
                reason: gpuTiming.reason,
            },
		resourcePool,
		availability,
	};
}

function estimateCoverage(values: readonly (number | undefined)[]): EstimateCoverage {
	return { known: values.filter((value) => value !== undefined).length, total: values.length };
}

function sumKnown(values: readonly (number | undefined)[]): number | undefined {
	let total = 0;
	for (const value of values) {
		if (value === undefined) return undefined;
		total += value;
	}
	return total;
}

type NormalizedDebugGroup = Omit<FrameGraphDebugGroup, 'summary'>;

function normalizeDebugGroups(compilation: FrameGraphSnapshot['graph']): NormalizedDebugGroup[] {
	const rawGroups = compilation.groups;
	const rawById = new Map<string, FrameGraphSnapshot['graph']['groups'][number]>();
	const siblingOccurrences = new Map<string, number>();
	const nextOccurrenceByParent = new Map<string | undefined, Map<string, number>>();
	for (const group of rawGroups) {
		if (rawById.has(group.id)) {
			throw new Error(`Compilation report contains duplicate debug group id ${group.id}.`);
		}
		const label = group.label.trim();
		if (label.length === 0) {
			throw new Error(`Compilation report debug group ${group.id} has an empty label.`);
		}
		rawById.set(group.id, { ...group, label });
		const nextOccurrenceByLabel = nextOccurrenceByParent.get(group.parentId) ?? new Map<string, number>();
		const occurrence = nextOccurrenceByLabel.get(label) ?? 0;
		siblingOccurrences.set(group.id, occurrence);
		nextOccurrenceByLabel.set(label, occurrence + 1);
		nextOccurrenceByParent.set(group.parentId, nextOccurrenceByLabel);
	}

	const normalizedById = new Map<string, NormalizedDebugGroup>();
	const identityPathById = new Map<string, readonly (readonly [label: string, siblingOccurrence: number])[]>();
	const visiting = new Set<string>();
	const resolve = (id: string): NormalizedDebugGroup => {
		const existing = normalizedById.get(id);
		if (existing) return existing;
		const raw = rawById.get(id);
		if (!raw) throw new Error(`Compilation report references unknown debug group ${id}.`);
		if (visiting.has(id)) throw new Error(`Compilation report debug group ${id} has a parent cycle.`);
		visiting.add(id);
		const parent = raw.parentId === undefined ? undefined : resolve(raw.parentId);
		const path = [...(parent?.path ?? []), raw.label];
		const identityPath = [
			...(raw.parentId === undefined ? [] : identityPathById.get(raw.parentId)!),
			[raw.label, siblingOccurrences.get(raw.id)!] as const,
		];
		const ancestorIds = [...(parent?.ancestorIds ?? []), raw.id];
		const normalized: NormalizedDebugGroup = {
			id: raw.id,
			parentId: raw.parentId,
			label: raw.label,
			path,
			pathKey: JSON.stringify(identityPath),
			depth: path.length - 1,
			ancestorIds,
		};
		visiting.delete(id);
		identityPathById.set(id, identityPath);
		normalizedById.set(id, normalized);
		return normalized;
	};
	return rawGroups.map((group) => resolve(group.id));
}

function validateDebugGroupReferences(
	compilation: FrameGraphSnapshot['graph'],
	knownGroupIds: ReadonlySet<string>,
): void {
	for (const entry of [...compilation.nodes, ...compilation.resources]) {
		if (entry.groupId !== undefined && !knownGroupIds.has(entry.groupId)) {
			throw new Error(`Compilation report references unknown debug group ${entry.groupId}.`);
		}
	}
}

/** Declaration boundaries are topological, not per-range initial-value provenance. */
export function declarationEntrances(
	nodes: readonly FrameGraphDebugNode[],
	accesses: readonly FrameGraphDebugAccessEdge[],
	edges: readonly FrameGraphDebugEdge[],
): readonly FrameGraphDebugAccessEdge[] {
	const retained = new Set(nodes.map((node) => node.id));
	const incoming = new Set(edges.map((edge) => JSON.stringify([edge.resource.id, edge.toNodeId])));
	const seen = new Set<string>();
	return accesses.filter((access) => {
		const key = JSON.stringify([access.resource.id, access.nodeId]);
		if (!retained.has(access.nodeId) || incoming.has(key) || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function buildDebugGroupSummaries(input: {
	readonly groups: readonly NormalizedDebugGroup[];
	readonly nodes: readonly FrameGraphDebugNode[];
	readonly culledNodes: readonly FrameGraphDebugCulledNode[];
	readonly resources: readonly FrameGraphDebugResource[];
	readonly accessEdges: readonly FrameGraphDebugAccessEdge[];
	readonly edges: readonly FrameGraphDebugEdge[];
	readonly roots: readonly FrameGraphDebugRoot[];
	readonly executionSegments: readonly FrameGraphDebugExecutionSegment[];
}): FrameGraphDebugGroup[] {
	const groupsById = new Map(input.groups.map((group) => [group.id, group]));
	const resourcesById = new Map(input.resources.map((resource) => [resource.id, resource]));
	const entrances = declarationEntrances(input.nodes, input.accessEdges, input.edges);
	const isInGroup = (candidateId: string | undefined, groupId: string) => (
		candidateId !== undefined && groupsById.get(candidateId)?.ancestorIds.includes(groupId) === true
	);

	return input.groups.map((group): FrameGraphDebugGroup => {
		const retained = input.nodes.filter((node) => isInGroup(node.debugGroupId, group.id));
		const culled = input.culledNodes.filter((entry) => isInGroup(entry.node.debugGroupId, group.id));
		const retainedIds = new Set(retained.map((node) => node.id));
		const allIds = new Set([...retainedIds, ...culled.map((entry) => entry.node.id)]);
		const nodeKindCounts: Partial<Record<FrameGraphSnapshotNodeKind, number>> = {};
		for (const node of [...retained, ...culled.map((entry) => entry.node)]) {
			nodeKindCounts[node.kind] = (nodeKindCounts[node.kind] ?? 0) + 1;
		}

		const inputIds = new Set<string>();
		const outputIds = new Set<string>();
		for (const edge of input.edges) {
			const fromInside = retainedIds.has(edge.fromNodeId);
			const toInside = retainedIds.has(edge.toNodeId);
			if (!fromInside && toInside) inputIds.add(edge.resource.id);
			if (fromInside && !toInside) outputIds.add(edge.resource.id);
		}
		for (const access of entrances) {
			const fromInside = isInGroup(resourcesById.get(access.resource.id)?.debugGroupId, group.id);
			const toInside = retainedIds.has(access.nodeId);
			if (!fromInside && toInside) inputIds.add(access.resource.id);
			if (fromInside && !toInside) outputIds.add(access.resource.id);
		}
		const outputRoots: FrameGraphDebugRoot[] = [];
		for (const root of input.roots) {
			if (!root.resource) continue;
			if (root.resolution?.producerNodeIds.some((id) => retainedIds.has(id))
				|| root.resolution?.usesInitialContents && isInGroup(resourcesById.get(root.resource.id)?.debugGroupId, group.id)) {
				outputIds.add(root.resource.id);
				outputRoots.push(root);
			}
		}

		const registeredTransient = input.resources.filter((resource) => resource.origin === 'transient'
			&& isInGroup(resource.debugGroupId, group.id));
		const registeredTransientIds = new Set(registeredTransient.map((resource) => resource.id));
		const accessedTransientIds = new Set(input.accessEdges
			.filter((access) => allIds.has(access.nodeId) && registeredTransientIds.has(access.resource.id))
			.map((access) => access.resource.id));
		const allocationIds = new Set(registeredTransient.flatMap((resource) => (
			resource.physicalResourceId === undefined ? [] : [resource.physicalResourceId]
		)));
		const segmentIds = new Set(input.executionSegments
			.filter((segment) => segment.nodeIds.some((id) => retainedIds.has(id)))
			.map((segment) => segment.index));
		const timingEligible = retained.filter((node) => node.kind === 'render' || node.kind === 'compute');
		const timed = timingEligible.filter((node) => node.gpuDurationMicros !== undefined);

		return {
			...group,
			summary: {
				retainedNodeCount: retained.length,
				culledNodeCount: culled.length,
				nodeKindCounts,
				inputResources: [...inputIds].map((id) => resourcesById.get(id)!).filter(Boolean),
				outputResources: [...outputIds].map((id) => resourcesById.get(id)!).filter(Boolean),
				outputRoots,
				registeredTransientResourceCount: registeredTransient.length,
				accessedTransientResourceCount: accessedTransientIds.size,
				physicalAllocationCount: allocationIds.size,
				executionSegmentCount: segmentIds.size,
				externalSubmissionCount: retained.filter((node) => node.kind === 'external-submission').length,
				gpuWorkDurationMicros: timed.reduce((sum, node) => sum + node.gpuDurationMicros!, 0),
				timedNodeCount: timed.length,
				timingEligibleNodeCount: timingEligible.length,
			},
		};
	});
}
