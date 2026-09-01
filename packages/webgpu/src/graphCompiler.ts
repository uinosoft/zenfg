import {
	type BufferDesc,
	type BufferHandle,
	type BufferRange,
	type CompiledTextureRegion,
	type FrameGraphCompilationReport,
	type FrameGraphCompilationAccess,
	type FrameGraphExecutionSegmentKind,
	type GraphRootReason,
	type ResourceHandle,
	type TextureDesc,
	TextureAccess,
} from './types.ts';
import { FRAME_GRAPH_ERROR_CODES, FrameGraphError } from './error.ts';
import { bufferAllocationSize, estimateTextureByteSize, textureSizeTuple } from './resourceDescriptors.ts';
import { getTextureFormatCapabilities } from './formatCaps.ts';
import type {
	InternalAccess,
	InternalNode,
	InternalResource,
	InternalTextureRegion,
	InternalTextureView,
	PhysicalAllocation,
} from './internalTypes.ts';

type DependencyAnalysis = {
	readonly producers: ReadonlyMap<number, ReadonlySet<number>>;
	// Value edges retain the producer selected by ordered logical value history.
	readonly valueReverseEdges: ReadonlyMap<number, ReadonlySet<number>>;
	readonly reportDependencies?: readonly FrameGraphCompilationReport['dependencies'][number][];
};

type MutableDependencyAnalysis = {
	readonly producers: Map<number, Set<number>>;
	readonly valueReverseEdges: Map<number, Set<number>>;
	readonly reportDependencies?: FrameGraphCompilationReport['dependencies'][number][];
};

const TEXTURE_ASPECT_COLOR = 1 << 0;
const TEXTURE_ASPECT_DEPTH = 1 << 1;
const TEXTURE_ASPECT_STENCIL = 1 << 2;

export type ResolvedTextureRange = Omit<InternalTextureRegion, 'aspect'> & {
	readonly aspectMask: number;
};

type TextureAccessStateEntry = {
	readonly nodeId: number;
	readonly range: ResolvedTextureRange;
};

type TextureWriteStateEntry = TextureAccessStateEntry & {
	readonly producesValue: boolean;
};

type TextureAccessState = {
	// Range-partitioned writes that define (or invalidate) the value visible at
	// the current recording position. They create value edges for reads/preserves.
	readonly lastWrites: TextureWriteStateEntry[];
	// Readers since the last overlapping write. They create WAR ordering edges for
	// a later write but never become producers or keep an old value alive directly.
	readonly pendingReaders: TextureAccessStateEntry[];
};

export type ResolvedBufferRange = {
	readonly offset: number;
	readonly size: number;
};

type BufferAccessStateEntry = {
	readonly nodeId: number;
	readonly range: ResolvedBufferRange;
};

type BufferAccessState = {
	// Range-partitioned producers for the value visible at this recording position.
	readonly lastWriters: BufferAccessStateEntry[];
	// Readers waiting only for an overlapping later writer's WAR ordering edge.
	readonly pendingReaders: BufferAccessStateEntry[];
};

type RetentionAnalysis = {
	readonly retained: ReadonlySet<number>;
	readonly roots: readonly InternalGraphRoot[];
};

type InternalGraphRoot = {
	readonly reason: GraphRootReason;
	readonly nodeId?: number;
	readonly resourceId?: number;
};

export type InternalResourceLifetime = {
	readonly resource: ResourceHandle;
	readonly firstUse: number;
	readonly lastUse: number;
};

export type InternalExecutionSegment = {
	readonly index: number;
	readonly kind: FrameGraphExecutionSegmentKind;
	readonly nodeIds: readonly number[];
};

type CompileResources = {
	readonly orderedNodes: readonly InternalNode[];
	readonly lifetimes: readonly InternalResourceLifetime[];
	readonly lifetimeByResource: ReadonlyMap<number, InternalResourceLifetime>;
	readonly physicalAllocations: ReadonlyMap<number, PhysicalAllocation>;
};

type AllocationBuilder = {
	readonly id: number;
	readonly kind: PhysicalAllocation['kind'];
	readonly key: string;
	lastUse: number;
	readonly resourceIds: number[];
};

export type InternalCompiledPlan = {
	readonly nodes: readonly InternalNode[];
	readonly resources: readonly {
		readonly resource: InternalResource;
		readonly usage: GPUTextureUsageFlags | GPUBufferUsageFlags;
		readonly lifetime?: InternalResourceLifetime;
		readonly physicalAllocationId?: number;
	}[];
	readonly executionSegments: readonly InternalExecutionSegment[];
	readonly physicalAllocations: ReadonlyMap<number, PhysicalAllocation>;
};

export type CompileFrameGraphResult = {
	readonly plan: InternalCompiledPlan;
	readonly report?: FrameGraphCompilationReport;
};

export type ResourceResolver = (handle: ResourceHandle) => InternalResource;

export type GraphCompilerInput = {
	readonly nodes: readonly InternalNode[];
	readonly resources: ReadonlyMap<number, InternalResource>;
	readonly textureViews: ReadonlyMap<number, InternalTextureView>;
	readonly rootResources: ReadonlyMap<number, ReadonlySet<GraphRootReason>>;
	readonly debugGroups: FrameGraphCompilationReport['debugGroups'];
	readonly nodeDebugGroupIds: ReadonlyMap<number, number>;
	readonly resourceDebugGroupIds: ReadonlyMap<number, number>;
	readonly resourceFor: ResourceResolver;
	readonly validateAccess: (access: InternalAccess, node: InternalNode) => void;
	readonly accumulateRetainedUsage: (access: InternalAccess) => void;
	readonly validateDeclaredUsage: () => void;
	readonly effectiveResourceUsage: (resource: InternalResource) => GPUTextureUsageFlags | GPUBufferUsageFlags;
	readonly resourcePoolKey: (resource: InternalResource) => string;
	readonly report: boolean;
};

export function compileFrameGraph(input: GraphCompilerInput): CompileFrameGraphResult {
	const dependencies = analyzeGraphAccesses(input);
	const retention = collectRetainedNodes(input, dependencies);
	for (const node of input.nodes) {
		if (!retention.retained.has(node.id)) {
			continue;
		}
		for (const access of node.accesses) {
			input.accumulateRetainedUsage(access);
		}
	}
	input.validateDeclaredUsage();
	return buildCompiledPlan(input, dependencies, retention);
}

function analyzeGraphAccesses(input: GraphCompilerInput): DependencyAnalysis {
	const dependencies: MutableDependencyAnalysis = {
		producers: new Map(),
		valueReverseEdges: new Map(),
		...(input.report ? { reportDependencies: [] } : {}),
	};
	const bufferStates = new Map<number, BufferAccessState>();
	const textureStates = new Map<number, TextureAccessState>();

	for (const node of input.nodes) {
		for (const access of node.accesses) {
			input.validateAccess(access, node);
		}
	}

	for (const node of input.nodes) {
		for (const access of node.accesses) {
			if (access.resource.kind === 'buffer') {
				recordBufferDependency(input.resourceFor, access, node.id, bufferStates, dependencies);
				continue;
			}
			recordTextureDependency(
				input.resourceFor,
				access,
				node.id,
				textureStates,
				dependencies,
			);
		}
	}

	for (const [resourceId, state] of bufferStates) {
		for (const writer of state.lastWriters) {
			addProducer(dependencies.producers, resourceId, writer.nodeId);
		}
	}
	for (const [resourceId, state] of textureStates) {
		for (const write of state.lastWrites) {
			if (write.producesValue) {
				addProducer(dependencies.producers, resourceId, write.nodeId);
			}
		}
	}

	return dependencies;
}

function recordTextureDependency(
	resourceFor: ResourceResolver,
	access: InternalAccess,
	nodeId: number,
	textureStates: Map<number, TextureAccessState>,
	dependencies: MutableDependencyAnalysis,
): void {
	const resource = resourceFor(access.resource);
	const existing = textureStates.get(access.resource.id);
	const state: TextureAccessState = existing ?? {
		lastWrites: [],
		pendingReaders: [],
	};
	const range = resolveTextureStateRange(resourceFor, access);

	if (access.mode === 'read') {
		const overlappingWrites = state.lastWrites.filter((write) => resolvedTextureRangesOverlap(write.range, range));
		if (overlappingWrites.some((write) => !write.producesValue)) {
			throw new FrameGraphError(
				FRAME_GRAPH_ERROR_CODES.ReadAfterDiscard,
				`Resource "${access.resource.label ?? access.resource.id}" is read after its value was discarded for the declared range.`,
				{ phase: 'compile', nodeId, resourceId: access.resource.id, context: { range } },
			);
		}
		const overlappingWriters = overlappingWrites.filter((write) => write.producesValue);
		const uncoveredRanges = subtractResolvedTextureRanges(
			[range],
			overlappingWriters.map((writer) => writer.range),
		);
		if (resource.initialContents === 'undefined' && uncoveredRanges.length > 0) {
			throw new FrameGraphError(
				FRAME_GRAPH_ERROR_CODES.ReadBeforeWrite,
				`Resource "${access.resource.label ?? access.resource.id}" with undefined initial contents is read before it is produced for the full declared range.`,
				{ phase: 'compile', nodeId, resourceId: access.resource.id, context: { range } },
			);
		}

		for (const writer of overlappingWriters) {
			if (writer.nodeId !== nodeId) {
				addDependencyEdge(dependencies, writer.nodeId, nodeId, access.resource, true);
			}
		}
		state.pendingReaders.push({ nodeId, range });
		textureStates.set(access.resource.id, state);
		return;
	}

	const overlappingWrites = state.lastWrites.filter((write) => (
		write.nodeId !== nodeId
		&& resolvedTextureRangesOverlap(write.range, range)
	));
	const overlappingWriters = overlappingWrites.filter((write) => write.producesValue);
	const overlappingInvalidations = overlappingWrites.filter((write) => !write.producesValue);
	if (access.consumesPreviousValue) {
		if (overlappingInvalidations.length > 0) {
			throw new FrameGraphError(
				FRAME_GRAPH_ERROR_CODES.PreserveBeforeWrite,
				`Resource "${access.resource.label ?? access.resource.id}" preserves contents after its value was discarded for the declared range.`,
				{ phase: 'compile', nodeId, resourceId: access.resource.id, context: { range } },
			);
		}
		const uncoveredRanges = subtractResolvedTextureRanges(
			[range],
			overlappingWriters.map((writer) => writer.range),
		);
		if (resource.initialContents === 'undefined' && uncoveredRanges.length > 0) {
			throw new FrameGraphError(
				FRAME_GRAPH_ERROR_CODES.PreserveBeforeWrite,
				`Resource "${access.resource.label ?? access.resource.id}" with undefined initial contents preserves contents before it is produced for the full declared range.`,
				{ phase: 'compile', nodeId, resourceId: access.resource.id, context: { range } },
			);
		}
		for (const writer of overlappingWriters) {
			addDependencyEdge(dependencies, writer.nodeId, nodeId, access.resource, true);
		}
	}
	else {
		for (const write of overlappingWrites) {
			addDependencyEdge(dependencies, write.nodeId, nodeId, access.resource, false);
		}
	}
	for (const reader of state.pendingReaders) {
		if (reader.nodeId !== nodeId && resolvedTextureRangesOverlap(reader.range, range)) {
			addDependencyEdge(dependencies, reader.nodeId, nodeId, access.resource, false);
		}
	}
	textureStates.set(access.resource.id, {
		lastWrites: [
			...subtractTextureAccessStateEntries(state.lastWrites, range),
			{ nodeId, range, producesValue: access.producesValue },
		],
		pendingReaders: subtractTextureAccessStateEntries(state.pendingReaders, range),
	});
}

function recordBufferDependency(
	resourceFor: ResourceResolver,
	access: InternalAccess,
	nodeId: number,
	bufferStates: Map<number, BufferAccessState>,
	dependencies: MutableDependencyAnalysis,
): void {
	const resource = resourceFor(access.resource);
	const existing = bufferStates.get(access.resource.id);
	const state: BufferAccessState = existing ?? {
		lastWriters: [],
		pendingReaders: [],
	};
	const range = resolveBufferAccessRange(resourceFor, access);

	if (access.mode === 'read') {
		const overlappingWriters = state.lastWriters.filter((writer) => bufferRangesOverlap(writer.range, range));
		if (resource.initialContents === 'undefined' && !bufferRangeCoveredByWriters(range, overlappingWriters)) {
			throw new FrameGraphError(
				FRAME_GRAPH_ERROR_CODES.ReadBeforeWrite,
				`Buffer "${access.resource.label ?? access.resource.id}" with undefined initial contents is read before it is produced.`,
				{ phase: 'compile', nodeId, resourceId: access.resource.id, context: { range } },
			);
		}
		for (const writer of overlappingWriters) {
			if (writer.nodeId !== nodeId) {
				addDependencyEdge(dependencies, writer.nodeId, nodeId, access.resource, true);
			}
		}
		state.pendingReaders.push({ nodeId, range });
		bufferStates.set(access.resource.id, state);
		return;
	}

	if (!access.producesValue) {
		return;
	}
	const overlappingWriters = state.lastWriters.filter((writer) => (
		writer.nodeId !== nodeId && bufferRangesOverlap(writer.range, range)
	));
	if (access.consumesPreviousValue) {
		if (resource.initialContents === 'undefined' && !bufferRangeCoveredByWriters(range, overlappingWriters)) {
			throw new FrameGraphError(
				FRAME_GRAPH_ERROR_CODES.PreserveBeforeWrite,
				`Buffer "${access.resource.label ?? access.resource.id}" with undefined initial contents preserves contents before it is produced.`,
				{ phase: 'compile', nodeId, resourceId: access.resource.id, context: { range } },
			);
		}
		for (const writer of overlappingWriters) {
			addDependencyEdge(dependencies, writer.nodeId, nodeId, access.resource, true);
		}
	}
	else {
		for (const writer of overlappingWriters) {
			addDependencyEdge(dependencies, writer.nodeId, nodeId, access.resource, false);
		}
	}
	for (const reader of state.pendingReaders) {
		if (reader.nodeId !== nodeId && bufferRangesOverlap(reader.range, range)) {
			addDependencyEdge(dependencies, reader.nodeId, nodeId, access.resource, false);
		}
	}
	bufferStates.set(access.resource.id, {
		lastWriters: [
			...subtractBufferRange(state.lastWriters, range),
			{ nodeId, range },
		],
		pendingReaders: subtractBufferRange(state.pendingReaders, range),
	});
}

function collectRetainedNodes(input: GraphCompilerInput, dependencies: DependencyAnalysis): RetentionAnalysis {
	const retained = new Set<number>();
	const roots: InternalGraphRoot[] = [];
	const visit = (nodeId: number) => {
		if (retained.has(nodeId)) {
			return;
		}
		retained.add(nodeId);
		for (const dependency of dependencies.valueReverseEdges.get(nodeId) ?? []) {
			visit(dependency);
		}
	};

	for (const node of input.nodes) {
		if (node.sideEffect) {
			roots.push({ reason: 'side-effect', nodeId: node.id });
			visit(node.id);
		}
	}
	for (const [resourceId, reasons] of input.rootResources) {
		if (input.resources.has(resourceId)) {
			for (const reason of reasons) {
				roots.push({ reason, resourceId });
			}
		}
		for (const producer of dependencies.producers.get(resourceId) ?? []) {
			visit(producer);
		}
	}

	return { retained, roots };
}

function buildCompiledPlan(
	input: GraphCompilerInput,
	dependencies: DependencyAnalysis,
	retention: RetentionAnalysis,
): CompileFrameGraphResult {
	const compileResources = buildCompileResources(input, retention.retained);
	const { orderedNodes, lifetimeByResource, physicalAllocations } = compileResources;
	const executionSegments = buildExecutionSegments(orderedNodes);

	const reportResourceIds = new Set<number>([
		...input.nodes.flatMap((node) => node.accesses.map((access) => access.resource.id)),
		...retention.roots.flatMap((root) => root.resourceId !== undefined ? [root.resourceId] : []),
	]);
	const executionResourceIds = new Set<number>(
		orderedNodes.flatMap((node) => node.accesses.map((access) => access.resource.id)),
	);
	const toCompiledResource = (resource: InternalResource) => ({
		resource,
		usage: input.effectiveResourceUsage(resource),
		lifetime: lifetimeByResource.get(resource.handle.id),
		physicalAllocationId: physicalAllocations.get(resource.handle.id)?.id,
	});
	const resources = [...input.resources.values()]
		.filter((resource) => executionResourceIds.has(resource.handle.id))
		.map(toCompiledResource);
	const reportResources = [...input.resources.values()]
		.filter((resource) => reportResourceIds.has(resource.handle.id))
		.map(toCompiledResource);

	const plan: InternalCompiledPlan = {
		nodes: orderedNodes,
		resources,
		executionSegments,
		physicalAllocations,
	};
	if (!input.report) {
		return { plan };
	}
	return {
		plan,
		report: buildCompilationReport(
			input,
			retention,
			dependencies,
			orderedNodes,
			reportResources,
			executionSegments,
			physicalAllocations,
		),
	};
}

function buildCompilationReport(
	input: GraphCompilerInput,
	retention: RetentionAnalysis,
	dependencies: DependencyAnalysis,
	orderedNodes: readonly InternalNode[],
	resources: InternalCompiledPlan['resources'],
	executionSegments: readonly InternalExecutionSegment[],
	physicalAllocations: ReadonlyMap<number, PhysicalAllocation>,
): FrameGraphCompilationReport {
	const recordingOrderByNodeId = new Map(input.nodes.map((node, order) => [node.id, order]));
	const orderByNodeId = new Map(orderedNodes.map((node, order) => [node.id, order]));
	let nextAccessId = 1;
	const accesses = input.nodes.flatMap((node) => node.accesses.map((access): FrameGraphCompilationAccess => {
		const order = orderByNodeId.get(node.id);
		const textureRegion = access.resource.kind === 'texture'
			? toCompiledTextureRegion(
				resolveTextureAccessRange(input.resourceFor, access),
				input.resourceFor(access.resource).desc as TextureDesc,
			)
			: undefined;
		const bufferRange = access.resource.kind === 'buffer'
			? resolveBufferAccessRange(input.resourceFor, access)
			: undefined;
		const common = {
			id: nextAccessId++,
			nodeId: node.id,
			resourceId: access.resource.id,
			access: access.access,
			textureViewId: access.textureView?.id,
			textureRegion,
			bufferRange,
			...(order !== undefined ? { order } : {}),
		};
		return access.mode === 'read'
			? { ...common, mode: 'read', producesValue: false }
			: {
				...common,
				mode: 'write',
				contents: access.contents!,
				producesValue: access.producesValue,
			};
	}));
	const compatibilityClassByKey = new Map<string, number>();
	const uniqueAllocations = new Map<number, PhysicalAllocation>();
	for (const allocation of physicalAllocations.values()) {
		uniqueAllocations.set(allocation.id, allocation);
	}

	return {
		nodes: orderedNodes.map((node) => toReportNode(node, input.nodeDebugGroupIds, recordingOrderByNodeId.get(node.id)!)),
		culledNodes: input.nodes
			.filter((node) => !retention.retained.has(node.id))
			.map((node) => ({
				...toReportNode(node, input.nodeDebugGroupIds, recordingOrderByNodeId.get(node.id)!),
				reason: 'not-reachable-from-root' as const,
			})),
		resources: resources.map(({ resource, usage, lifetime, physicalAllocationId }) => {
			const debugGroupId = input.resourceDebugGroupIds.get(resource.handle.id);
			const common = {
				id: resource.handle.id,
				label: resource.handle.label,
				origin: resource.origin,
				initialContents: resource.initialContents,
				...(debugGroupId !== undefined ? { debugGroupId } : {}),
				usage,
				lifetime: lifetime
					? { firstUse: lifetime.firstUse, lastUse: lifetime.lastUse }
					: undefined,
				physicalAllocationId,
			};
			if (resource.handle.kind === 'texture') {
				const desc = resource.desc as TextureDesc;
				const [width, height, depthOrArrayLayers] = textureSizeTuple(desc.size);
				return {
					...common,
					kind: 'texture' as const,
					descriptor: {
						format: desc.format,
						size: { width, height, depthOrArrayLayers },
						dimension: desc.dimension ?? '2d',
						mipLevelCount: desc.mipLevelCount ?? 1,
						sampleCount: desc.sampleCount ?? 1,
						viewFormats: [...(desc.viewFormats ?? [])],
					},
					estimatedByteSize: estimateTextureByteSize(desc),
				};
			}
			const desc = resource.desc as BufferDesc;
			return {
				...common,
				kind: 'buffer' as const,
				descriptor: { size: desc.size },
				estimatedByteSize: desc.size,
			};
		}),
		textureViews: [...input.textureViews.values()]
			.filter((view) => accesses.some((access) => access.textureViewId === view.handle.id))
			.map((view) => ({
				id: view.handle.id,
				resourceId: view.texture.id,
				label: view.desc.label,
				format: view.desc.format,
				dimension: view.desc.dimension,
				aspect: view.desc.aspect,
				baseMipLevel: view.desc.baseMipLevel,
				mipLevelCount: view.desc.mipLevelCount,
				baseArrayLayer: view.desc.baseArrayLayer,
				arrayLayerCount: view.desc.arrayLayerCount,
				swizzle: view.desc.swizzle,
			})),
		debugGroups: input.debugGroups.map((group) => ({ ...group })),
		accesses,
		dependencies: (dependencies.reportDependencies ?? [])
			.filter((dependency) => retention.retained.has(dependency.fromNodeId) && retention.retained.has(dependency.toNodeId))
			.map((dependency) => ({ ...dependency })),
		roots: retention.roots.map((root) => ({ ...root })),
		allocations: [...uniqueAllocations.values()]
			.sort((a, b) => a.id - b.id)
			.map((allocation) => {
				const compatibilityKey = `${allocation.kind}|${allocation.key}`;
				let compatibilityClassId = compatibilityClassByKey.get(compatibilityKey);
				if (compatibilityClassId === undefined) {
					compatibilityClassId = compatibilityClassByKey.size + 1;
					compatibilityClassByKey.set(compatibilityKey, compatibilityClassId);
				}
				return {
					id: allocation.id,
					kind: allocation.kind,
					compatibilityClassId,
					estimatedByteSize: estimateAllocationByteSize(input, allocation),
				};
			}),
		executionSegments: executionSegments.map((segment) => ({
			index: segment.index,
			kind: segment.kind,
			nodeIds: [...segment.nodeIds],
		})),
	};
}

function estimateAllocationByteSize(input: GraphCompilerInput, allocation: PhysicalAllocation): number {
	const resourceId = allocation.resourceIds[0];
	if (resourceId === undefined) {
		throw new Error('Physical allocation ' + allocation.id + ' has no logical resources.');
	}
	const resource = input.resources.get(resourceId);
	if (!resource) {
		throw new Error('Physical allocation ' + allocation.id + ' references unknown resource ' + resourceId + '.');
	}
	return allocation.kind === 'texture'
		? estimateTextureByteSize(resource.desc as TextureDesc)
		: bufferAllocationSize((resource.desc as BufferDesc).size);
}

function toReportNode(
	node: InternalNode,
	debugGroupIds: ReadonlyMap<number, number>,
	recordingOrder: number,
): FrameGraphCompilationReport['nodes'][number] {
	const debugGroupId = debugGroupIds.get(node.id);
	return {
		id: node.id,
		recordingOrder,
		kind: node.kind,
		label: node.label,
		sideEffect: node.sideEffect,
		...(debugGroupId !== undefined ? { debugGroupId } : {}),
	};
}

function buildExecutionSegments(orderedNodes: readonly InternalNode[]): InternalExecutionSegment[] {
	const segments: InternalExecutionSegment[] = [];
	let frameGraphNodeIds: number[] = [];
	const flushFrameGraphSegment = () => {
		if (frameGraphNodeIds.length === 0) {
			return;
		}
		segments.push({
			index: segments.length,
			kind: 'frame-graph',
			nodeIds: frameGraphNodeIds,
		});
		frameGraphNodeIds = [];
	};

	for (const node of orderedNodes) {
		if (node.kind === 'external-submission') {
			flushFrameGraphSegment();
			segments.push({
				index: segments.length,
				kind: 'external-submission',
				nodeIds: [node.id],
			});
			continue;
		}
		frameGraphNodeIds.push(node.id);
	}
	flushFrameGraphSegment();
	return segments;
}

function buildCompileResources(
	input: GraphCompilerInput,
	retained: ReadonlySet<number>,
): CompileResources {
	const orderedNodes = input.nodes.filter((node) => retained.has(node.id));
	const orderIndex = new Map(orderedNodes.map((node, index) => [node.id, index]));
	const lifetimes = computeLifetimes(orderedNodes, orderIndex);
	const lifetimeByResource = new Map(lifetimes.map((lifetime) => [lifetime.resource.id, lifetime]));
	const physicalAllocations = buildPhysicalAllocations(input, lifetimes);

	return { orderedNodes, lifetimes, lifetimeByResource, physicalAllocations };
}

function computeLifetimes(nodes: readonly InternalNode[], orderIndex: ReadonlyMap<number, number>): InternalResourceLifetime[] {
	const ranges = new Map<number, { resource: ResourceHandle; firstUse: number; lastUse: number }>();
	for (const node of nodes) {
		const index = orderIndex.get(node.id);
		if (index === undefined) {
			continue;
		}
		for (const access of node.accesses) {
			const current = ranges.get(access.resource.id);
			if (current) {
				current.firstUse = Math.min(current.firstUse, index);
				current.lastUse = Math.max(current.lastUse, index);
			}
			else {
				ranges.set(access.resource.id, {
					resource: access.resource,
					firstUse: index,
					lastUse: index,
				});
			}
		}
	}
	return [...ranges.values()];
}

function buildPhysicalAllocations(
	input: GraphCompilerInput,
	lifetimes: readonly InternalResourceLifetime[],
): Map<number, PhysicalAllocation> {
	let nextPhysicalId = 1;
	const allocationBuilders: AllocationBuilder[] = [];
	const allocationsByKindAndKey = new Map<PhysicalAllocation['kind'], Map<string, AllocationBuilder[]>>();
	const allocationByResource = new Map<number, PhysicalAllocation>();

	const transientLifetimes = lifetimes
		.filter((lifetime) => input.resourceFor(lifetime.resource).origin === 'transient')
		.sort((a, b) => a.firstUse - b.firstUse || a.lastUse - b.lastUse);

	for (const lifetime of transientLifetimes) {
		const resource = input.resourceFor(lifetime.resource);
		const key = input.resourcePoolKey(resource);
		let allocationsByKey = allocationsByKindAndKey.get(resource.handle.kind);
		if (!allocationsByKey) {
			allocationsByKey = new Map();
			allocationsByKindAndKey.set(resource.handle.kind, allocationsByKey);
		}
		let candidates = allocationsByKey.get(key);
		if (!candidates) {
			candidates = [];
			allocationsByKey.set(key, candidates);
		}

		// Lifetimes are processed by firstUse, so only the latest assigned interval can overlap.
		const existing = candidates.find((allocation) => allocation.lastUse < lifetime.firstUse);

		if (existing) {
			existing.lastUse = lifetime.lastUse;
			existing.resourceIds.push(resource.handle.id);
			continue;
		}

		const allocation: AllocationBuilder = {
			id: nextPhysicalId++,
			kind: resource.handle.kind,
			key,
			lastUse: lifetime.lastUse,
			resourceIds: [resource.handle.id],
		};
		allocationBuilders.push(allocation);
		candidates.push(allocation);
	}

	for (const builder of allocationBuilders) {
		const allocation: PhysicalAllocation = {
			id: builder.id,
			kind: builder.kind,
			key: builder.key,
			resourceIds: [...builder.resourceIds],
		};
		for (const resourceId of allocation.resourceIds) {
			allocationByResource.set(resourceId, allocation);
		}
	}

	return allocationByResource;
}

function addProducer(producers: Map<number, Set<number>>, resourceId: number, nodeId: number): void {
	let nodes = producers.get(resourceId);
	if (!nodes) {
		nodes = new Set();
		producers.set(resourceId, nodes);
	}
	nodes.add(nodeId);
}

export function resolveTextureAccessRange(
	resourceFor: ResourceResolver,
	access: InternalAccess,
): InternalTextureRegion {
	if (access.resource.kind !== 'texture') {
		throw new Error('Buffer access does not have a texture subresource range.');
	}
	if (access.textureRegion) {
		return access.textureRegion;
	}
	const desc = resourceFor(access.resource).desc as TextureDesc;
	const [, , depthOrArrayLayers] = textureSizeTuple(desc.size);
	const dimension = desc.dimension ?? '2d';
	return {
		baseMipLevel: 0,
		mipLevelCount: desc.mipLevelCount ?? 1,
		baseArrayLayer: 0,
		arrayLayerCount: dimension === '2d' ? depthOrArrayLayers : 1,
		baseDepthSlice: 0,
		depthSliceCount: dimension === '3d' ? depthOrArrayLayers : 1,
		aspect: (access.access === TextureAccess.DepthRead || access.access === TextureAccess.DepthWrite) ? 'depth-only' : 'all',
	};
}

function toCompiledTextureRegion(range: InternalTextureRegion, desc: TextureDesc): CompiledTextureRegion {
	const dimension = desc.dimension ?? '2d';
	return {
		baseMipLevel: range.baseMipLevel,
		mipLevelCount: range.mipLevelCount,
		...(dimension === '2d'
			? { baseArrayLayer: range.baseArrayLayer, arrayLayerCount: range.arrayLayerCount }
			: {}),
		...(dimension === '3d'
			? { baseDepthSlice: range.baseDepthSlice, depthSliceCount: range.depthSliceCount }
			: {}),
		aspect: range.aspect,
	};
}

function resolveTextureStateRange(
	resourceFor: ResourceResolver,
	access: InternalAccess,
): ResolvedTextureRange {
	const range = resolveTextureAccessRange(resourceFor, access);
	const resource = resourceFor(access.resource);
	const desc = resource.desc as TextureDesc;
	return {
		baseMipLevel: range.baseMipLevel,
		mipLevelCount: range.mipLevelCount,
		baseArrayLayer: range.baseArrayLayer,
		arrayLayerCount: range.arrayLayerCount,
		baseDepthSlice: range.baseDepthSlice,
		depthSliceCount: range.depthSliceCount,
		aspectMask: resolveTextureAspectMask(desc.format, range.aspect),
	};
}

function resolveTextureAspectMask(format: GPUTextureFormat, aspect: GPUTextureAspect): number {
	if (aspect === 'depth-only') {
		return TEXTURE_ASPECT_DEPTH;
	}
	if (aspect === 'stencil-only') {
		return TEXTURE_ASPECT_STENCIL;
	}
	switch (getTextureFormatCapabilities(format).kind) {
		case 'depth':
			return TEXTURE_ASPECT_DEPTH;
		case 'stencil':
			return TEXTURE_ASPECT_STENCIL;
		case 'depth-stencil':
			return TEXTURE_ASPECT_DEPTH | TEXTURE_ASPECT_STENCIL;
		default:
			return TEXTURE_ASPECT_COLOR;
	}
}

function resolvedTextureRangesOverlap(a: ResolvedTextureRange, b: ResolvedTextureRange): boolean {
	return numericRangesOverlap(a.baseMipLevel, a.mipLevelCount, b.baseMipLevel, b.mipLevelCount)
		&& numericRangesOverlap(a.baseArrayLayer, a.arrayLayerCount, b.baseArrayLayer, b.arrayLayerCount)
		&& numericRangesOverlap(a.baseDepthSlice, a.depthSliceCount, b.baseDepthSlice, b.depthSliceCount)
		&& (a.aspectMask & b.aspectMask) !== 0;
}

export function intersectResolvedTextureRanges(
	a: ResolvedTextureRange,
	b: ResolvedTextureRange,
): ResolvedTextureRange | undefined {
	if (!resolvedTextureRangesOverlap(a, b)) {
		return undefined;
	}
	const mipStart = Math.max(a.baseMipLevel, b.baseMipLevel);
	const mipEnd = Math.min(
		a.baseMipLevel + a.mipLevelCount,
		b.baseMipLevel + b.mipLevelCount,
	);
	const layerStart = Math.max(a.baseArrayLayer, b.baseArrayLayer);
	const layerEnd = Math.min(
		a.baseArrayLayer + a.arrayLayerCount,
		b.baseArrayLayer + b.arrayLayerCount,
	);
	const depthStart = Math.max(a.baseDepthSlice, b.baseDepthSlice);
	const depthEnd = Math.min(
		a.baseDepthSlice + a.depthSliceCount,
		b.baseDepthSlice + b.depthSliceCount,
	);
	return {
		baseMipLevel: mipStart,
		mipLevelCount: mipEnd - mipStart,
		baseArrayLayer: layerStart,
		arrayLayerCount: layerEnd - layerStart,
		baseDepthSlice: depthStart,
		depthSliceCount: depthEnd - depthStart,
		aspectMask: a.aspectMask & b.aspectMask,
	};
}

function subtractTextureAccessStateEntries<T extends TextureAccessStateEntry>(
	entries: readonly T[],
	coveredRange: ResolvedTextureRange,
): T[] {
	return entries.flatMap((entry) => (
		subtractResolvedTextureRange(entry.range, coveredRange)
			.map((range) => ({ ...entry, range }))
	));
}

export function subtractResolvedTextureRanges(
	ranges: readonly ResolvedTextureRange[],
	coveredRanges: readonly ResolvedTextureRange[],
): ResolvedTextureRange[] {
	let remaining = [...ranges];
	for (const coveredRange of coveredRanges) {
		remaining = remaining.flatMap((range) => subtractResolvedTextureRange(range, coveredRange));
	}
	return remaining;
}

export function subtractResolvedTextureRange(
	range: ResolvedTextureRange,
	coveredRange: ResolvedTextureRange,
): ResolvedTextureRange[] {
	const intersection = intersectResolvedTextureRanges(range, coveredRange);
	if (!intersection) {
		return [range];
	}

	const remaining: ResolvedTextureRange[] = [];
	const unaffectedAspects = range.aspectMask & ~intersection.aspectMask;
	if (unaffectedAspects !== 0) {
		remaining.push({ ...range, aspectMask: unaffectedAspects });
	}

	const affectedAspects = intersection.aspectMask;
	const rangeMipEnd = range.baseMipLevel + range.mipLevelCount;
	const intersectionMipEnd = intersection.baseMipLevel + intersection.mipLevelCount;
	const rangeLayerEnd = range.baseArrayLayer + range.arrayLayerCount;
	const intersectionLayerEnd = intersection.baseArrayLayer + intersection.arrayLayerCount;
	const rangeDepthEnd = range.baseDepthSlice + range.depthSliceCount;
	const intersectionDepthEnd = intersection.baseDepthSlice + intersection.depthSliceCount;

	if (range.baseMipLevel < intersection.baseMipLevel) {
		remaining.push({
			baseMipLevel: range.baseMipLevel,
			mipLevelCount: intersection.baseMipLevel - range.baseMipLevel,
			baseArrayLayer: range.baseArrayLayer,
			arrayLayerCount: range.arrayLayerCount,
			baseDepthSlice: range.baseDepthSlice,
			depthSliceCount: range.depthSliceCount,
			aspectMask: affectedAspects,
		});
	}
	if (intersectionMipEnd < rangeMipEnd) {
		remaining.push({
			baseMipLevel: intersectionMipEnd,
			mipLevelCount: rangeMipEnd - intersectionMipEnd,
			baseArrayLayer: range.baseArrayLayer,
			arrayLayerCount: range.arrayLayerCount,
			baseDepthSlice: range.baseDepthSlice,
			depthSliceCount: range.depthSliceCount,
			aspectMask: affectedAspects,
		});
	}
	if (range.baseArrayLayer < intersection.baseArrayLayer) {
		remaining.push({
			baseMipLevel: intersection.baseMipLevel,
			mipLevelCount: intersection.mipLevelCount,
			baseArrayLayer: range.baseArrayLayer,
			arrayLayerCount: intersection.baseArrayLayer - range.baseArrayLayer,
			baseDepthSlice: range.baseDepthSlice,
			depthSliceCount: range.depthSliceCount,
			aspectMask: affectedAspects,
		});
	}
	if (intersectionLayerEnd < rangeLayerEnd) {
		remaining.push({
			baseMipLevel: intersection.baseMipLevel,
			mipLevelCount: intersection.mipLevelCount,
			baseArrayLayer: intersectionLayerEnd,
			arrayLayerCount: rangeLayerEnd - intersectionLayerEnd,
			baseDepthSlice: range.baseDepthSlice,
			depthSliceCount: range.depthSliceCount,
			aspectMask: affectedAspects,
		});
	}
	if (range.baseDepthSlice < intersection.baseDepthSlice) {
		remaining.push({
			baseMipLevel: intersection.baseMipLevel,
			mipLevelCount: intersection.mipLevelCount,
			baseArrayLayer: intersection.baseArrayLayer,
			arrayLayerCount: intersection.arrayLayerCount,
			baseDepthSlice: range.baseDepthSlice,
			depthSliceCount: intersection.baseDepthSlice - range.baseDepthSlice,
			aspectMask: affectedAspects,
		});
	}
	if (intersectionDepthEnd < rangeDepthEnd) {
		remaining.push({
			baseMipLevel: intersection.baseMipLevel,
			mipLevelCount: intersection.mipLevelCount,
			baseArrayLayer: intersection.baseArrayLayer,
			arrayLayerCount: intersection.arrayLayerCount,
			baseDepthSlice: intersectionDepthEnd,
			depthSliceCount: rangeDepthEnd - intersectionDepthEnd,
			aspectMask: affectedAspects,
		});
	}
	return remaining;
}

function resolveBufferAccessRange(resourceFor: ResourceResolver, access: InternalAccess): ResolvedBufferRange {
	if (access.resource.kind !== 'buffer') {
		throw new Error('Texture access does not have a buffer range.');
	}
	return resolveBufferRange(resourceFor, access.resource, access.bufferRange);
}

export function resolveBufferRange(
	resourceFor: ResourceResolver,
	handle: BufferHandle,
	range: BufferRange | undefined,
): ResolvedBufferRange {
	const desc = resourceFor(handle).desc as BufferDesc;
	const offset = Number(range?.offset ?? 0);
	const size = range?.size === undefined ? desc.size - offset : Number(range.size);
	return { offset, size };
}

export function bufferRangesOverlap(a: ResolvedBufferRange, b: ResolvedBufferRange): boolean {
	return numericRangesOverlap(a.offset, a.size, b.offset, b.size);
}

function subtractBufferRange(
	entries: readonly BufferAccessStateEntry[],
	coveredRange: ResolvedBufferRange,
): BufferAccessStateEntry[] {
	const coveredEnd = coveredRange.offset + coveredRange.size;
	const remaining: BufferAccessStateEntry[] = [];
	for (const entry of entries) {
		if (!bufferRangesOverlap(entry.range, coveredRange)) {
			remaining.push(entry);
			continue;
		}

		const entryEnd = entry.range.offset + entry.range.size;
		if (entry.range.offset < coveredRange.offset) {
			remaining.push({
				nodeId: entry.nodeId,
				range: {
					offset: entry.range.offset,
					size: coveredRange.offset - entry.range.offset,
				},
			});
		}
		if (entryEnd > coveredEnd) {
			remaining.push({
				nodeId: entry.nodeId,
				range: {
					offset: coveredEnd,
					size: entryEnd - coveredEnd,
				},
			});
		}
	}
	return remaining;
}

function bufferRangeCoveredByWriters(
	range: ResolvedBufferRange,
	writers: readonly BufferAccessStateEntry[],
): boolean {
	let coveredEnd = range.offset;
	const sortedRanges = writers
		.map((writer) => writer.range)
		.filter((writerRange) => bufferRangesOverlap(writerRange, range))
		.sort((a, b) => a.offset - b.offset);
	for (const writerRange of sortedRanges) {
		if (writerRange.offset > coveredEnd) {
			return false;
		}
		coveredEnd = Math.max(coveredEnd, writerRange.offset + writerRange.size);
		if (coveredEnd >= range.offset + range.size) {
			return true;
		}
	}
	return coveredEnd >= range.offset + range.size;
}

export function textureRegionsOverlap(a: InternalTextureRegion, b: InternalTextureRegion): boolean {
	return numericRangesOverlap(a.baseMipLevel, a.mipLevelCount, b.baseMipLevel, b.mipLevelCount)
		&& numericRangesOverlap(a.baseArrayLayer, a.arrayLayerCount, b.baseArrayLayer, b.arrayLayerCount)
		&& numericRangesOverlap(a.baseDepthSlice, a.depthSliceCount, b.baseDepthSlice, b.depthSliceCount)
		&& textureAspectsOverlap(a.aspect, b.aspect);
}

export function textureSubresourcesAlias(a: InternalTextureRegion, b: InternalTextureRegion): boolean {
	return numericRangesOverlap(a.baseMipLevel, a.mipLevelCount, b.baseMipLevel, b.mipLevelCount)
		&& numericRangesOverlap(a.baseArrayLayer, a.arrayLayerCount, b.baseArrayLayer, b.arrayLayerCount)
		&& textureAspectsOverlap(a.aspect, b.aspect);
}

function numericRangesOverlap(aBase: number, aCount: number, bBase: number, bCount: number): boolean {
	return aBase < bBase + bCount && bBase < aBase + aCount;
}

function textureAspectsOverlap(a: GPUTextureAspect, b: GPUTextureAspect): boolean {
	return a === 'all' || b === 'all' || a === b;
}

function addEdge(edges: Map<number, Set<number>>, from: number, to: number): void {
	if (from === to) {
		return;
	}
	let targets = edges.get(from);
	if (!targets) {
		targets = new Set();
		edges.set(from, targets);
	}
	targets.add(to);
}

function addDependencyEdge(
	dependencies: MutableDependencyAnalysis,
	from: number,
	to: number,
	resource: ResourceHandle,
	contributesValue: boolean,
): void {
	const reportDependencies = dependencies.reportDependencies;
	if (contributesValue) {
		addEdge(dependencies.valueReverseEdges, to, from);
		if (reportDependencies && !reportDependencies.some((edge) => edge.fromNodeId === from && edge.toNodeId === to && edge.resourceId === resource.id && edge.kind === 'value')) {
			reportDependencies.push({ fromNodeId: from, toNodeId: to, resourceId: resource.id, kind: 'value' });
		}
	}
	else if (reportDependencies && !reportDependencies.some((edge) => edge.fromNodeId === from && edge.toNodeId === to && edge.resourceId === resource.id)) {
		reportDependencies.push({ fromNodeId: from, toNodeId: to, resourceId: resource.id, kind: 'ordering' });
	}
}
