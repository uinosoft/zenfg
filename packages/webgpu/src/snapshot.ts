/**
 * Converts a full `@zenfg/webgpu` compilation report, execution timing result,
 * and resource-pool snapshot into the portable ZenFG Snapshot 1.0 wire model.
 *
 * Capture inputs from the same compiled frame: compile with `{ report: true }`,
 * execute with `{ gpuTiming: true }`, await that timing result, and read pool
 * statistics after execution before calling {@link createFrameGraphSnapshot}.
 *
 * @packageDocumentation
 */

import {
	FRAME_GRAPH_SNAPSHOT_FORMAT,
	FRAME_GRAPH_SNAPSHOT_VERSION,
} from '@zenfg/snapshot/format';
import type {
	FrameGraphSnapshot,
	FrameGraphSnapshotAccess,
	FrameGraphSnapshotBufferUsageFlag,
	FrameGraphSnapshotProducer,
	FrameGraphSnapshotResource,
	FrameGraphSnapshotTextureUsageFlag,
} from '@zenfg/snapshot';
import type {
	FrameGraphCompilationReport,
	FrameGraphGpuTimingReport,
	FrameGraphResourcePoolStats,
} from './types.ts';

/** Inputs required to project one WebGPU frame into a portable snapshot. */
export type CreateFrameGraphSnapshotOptions = {
	/**
	 * Full immutable report returned by `recorder.compile({ report: true })`.
	 * It must describe the same compiled frame represented by `gpuTiming`.
	 */
	readonly compilation: FrameGraphCompilationReport;
	/**
	 * Timing result returned by `compiled.execute({ gpuTiming: true })`.
	 * Its frame index becomes `snapshot.capture.frameIndex`; unavailable timing
	 * remains an explicit unavailable timing record.
	 */
	readonly gpuTiming: FrameGraphGpuTimingReport;
	/**
	 * Aggregate pool counters to record with the capture. Read them after frame
	 * execution when the snapshot should include that execution's releases.
	 */
	readonly resourcePool: FrameGraphResourcePoolStats;
	/**
	 * ISO-8601 capture timestamp.
	 *
	 * @defaultValue The current time from `new Date().toISOString()`.
	 */
	readonly capturedAt?: string;
	/** Version of the application or library producing this capture. */
	readonly producerVersion?: string;
	/**
	 * Optional runtime implementation, graphics API, and backend metadata.
	 * `graphicsApi` defaults to `'webgpu'` when omitted.
	 */
	readonly runtime?: NonNullable<FrameGraphSnapshotProducer['runtime']>;
};

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

/**
 * Creates an independent canonical Snapshot 1.0 value from one executed frame.
 *
 * @remarks The conversion preserves retained and culled nodes, normalized
 * accesses and dependencies, execution segments, allocation planning, GPU
 * timing availability, and resource-pool counters. The returned object is a
 * deep JSON clone and does not retain references to the supplied reports.
 *
 * @throws If a compilation resource contains WebGPU usage bits that Snapshot
 * 1.0 cannot represent.
 *
 * @example
 * ```ts
 * import { FrameGraph } from '@zenfg/webgpu';
 * import { createFrameGraphSnapshot } from '@zenfg/webgpu/snapshot';
 *
 * const graph = new FrameGraph(device);
 * const recorder = graph.beginFrame();
 * const scratch = recorder.createBuffer({ size: 256 });
 * recorder.clearBuffer({
 *   operations: [{ target: scratch }],
 *   sideEffect: true,
 * });
 * const compiled = recorder.compile({ report: true });
 * const gpuTiming = await compiled.execute({ frameIndex: 7, gpuTiming: true });
 * const snapshot = createFrameGraphSnapshot({
 *   compilation: compiled.compilationReport,
 *   gpuTiming,
 *   resourcePool: graph.getResourcePoolStats(),
 * });
 * ```
 */
export function createFrameGraphSnapshot(options: CreateFrameGraphSnapshotOptions): FrameGraphSnapshot {
	const { compilation, gpuTiming, resourcePool } = options;
	const executionOrderByNodeId = new Map(compilation.nodes.map((node, order) => [node.id, order]));
	const nodes = [...compilation.nodes, ...compilation.culledNodes]
		.sort((a, b) => a.recordingOrder - b.recordingOrder)
		.map((node) => {
			const executionOrder = executionOrderByNodeId.get(node.id);
			return {
				id: nodeId(node.id),
				recordingOrder: node.recordingOrder,
				kind: node.kind,
				label: node.label,
				sideEffect: node.sideEffect,
				groupId: node.debugGroupId === undefined ? undefined : groupId(node.debugGroupId),
				compileState: executionOrder === undefined
					? { status: 'culled' as const, reason: (node as FrameGraphCompilationReport['culledNodes'][number]).reason }
					: { status: 'retained' as const, executionOrder },
			};
		});
	const resources = compilation.resources.map((resource): FrameGraphSnapshotResource => {
		const common = {
			id: resourceId(resource.id),
			label: resource.label,
			origin: resource.origin === 'swapchain' ? 'surface' as const : resource.origin,
			initialContents: resource.initialContents,
			groupId: resource.debugGroupId === undefined ? undefined : groupId(resource.debugGroupId),
			lifetime: resource.lifetime,
			allocationId: resource.physicalAllocationId === undefined ? undefined : allocationId(resource.physicalAllocationId),
			estimatedByteSize: resource.estimatedByteSize,
		};
		return resource.kind === 'texture'
			? {
				...common,
				kind: resource.kind,
				descriptor: { kind: 'texture', ...resource.descriptor },
				usageFlags: decodeUsage('texture', resource.usage),
			}
			: {
				...common,
				kind: resource.kind,
				descriptor: { kind: 'buffer', ...resource.descriptor },
				usageFlags: decodeUsage('buffer', resource.usage),
			};
	});
	const accesses = compilation.accesses.map((access): FrameGraphSnapshotAccess => {
		const common = {
			id: accessId(access.id),
			nodeId: nodeId(access.nodeId),
			resourceId: resourceId(access.resourceId),
			access: access.access,
			textureViewId: access.textureViewId === undefined ? undefined : viewId(access.textureViewId),
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
	const snapshot: FrameGraphSnapshot = {
		format: FRAME_GRAPH_SNAPSHOT_FORMAT,
		version: FRAME_GRAPH_SNAPSHOT_VERSION,
		producer: {
			name: '@zenfg/webgpu',
			version: options.producerVersion,
			language: 'typescript',
			runtime: {
				graphicsApi: 'webgpu',
				...options.runtime,
			},
		},
		capture: {
			frameIndex: gpuTiming.frameIndex,
			capturedAt: options.capturedAt ?? new Date().toISOString(),
		},
		graph: {
			groups: compilation.debugGroups.map((group) => ({
				id: groupId(group.id),
				parentId: group.parentId === undefined ? undefined : groupId(group.parentId),
				label: group.label,
			})),
			nodes,
			resources,
			textureViews: compilation.textureViews.map((view) => ({
				id: viewId(view.id),
				resourceId: resourceId(view.resourceId),
				label: view.label,
				format: view.format,
				dimension: view.dimension,
				aspect: view.aspect,
				baseMipLevel: view.baseMipLevel,
				mipLevelCount: view.mipLevelCount,
				baseArrayLayer: view.baseArrayLayer,
				arrayLayerCount: view.arrayLayerCount,
				swizzle: view.swizzle,
			})),
			accesses,
			dependencies: compilation.dependencies.map((dependency) => ({
				fromNodeId: nodeId(dependency.fromNodeId),
				toNodeId: nodeId(dependency.toNodeId),
				resourceId: resourceId(dependency.resourceId),
				kind: dependency.kind,
			})),
			roots: compilation.roots.map((root) => ({
				reason: root.reason,
				nodeId: root.nodeId === undefined ? undefined : nodeId(root.nodeId),
				resourceId: root.resourceId === undefined ? undefined : resourceId(root.resourceId),
			})),
			segments: compilation.executionSegments.map((segment) => ({
				id: segmentId(segment.index),
				order: segment.index,
				kind: segment.kind,
				nodeIds: segment.nodeIds.map(nodeId),
			})),
		},
		memory: {
			allocationReport: {
				status: 'available',
				allocations: compilation.allocations.map((allocation) => ({
					id: allocationId(allocation.id),
					kind: allocation.kind,
					compatibilityClassId: compatibilityId(allocation.compatibilityClassId),
					estimatedByteSize: allocation.estimatedByteSize,
				})),
			},
			poolReport: {
				status: 'available',
				...resourcePool,
			},
		},
		timings: {
			gpu: gpuTiming.status === 'available'
				? {
					status: 'available',
					frameSpanMicros: gpuTiming.frameDurationMicros,
					nodes: gpuTiming.nodes.map((timing) => ({
						nodeId: nodeId(timing.nodeId),
						durationMicros: timing.durationMicros,
					})),
				}
				: {
					status: 'unavailable',
					reason: gpuTiming.reason,
				},
		},
		diagnostics: [],
		extensions: {},
	};
	return JSON.parse(JSON.stringify(snapshot)) as FrameGraphSnapshot;
}

function decodeUsage(kind: 'texture', usage: number): FrameGraphSnapshotTextureUsageFlag[];
function decodeUsage(kind: 'buffer', usage: number): FrameGraphSnapshotBufferUsageFlag[];
function decodeUsage(kind: 'texture' | 'buffer', usage: number): string[] {
	const definitions = kind === 'texture' ? TEXTURE_USAGE_FLAGS : BUFFER_USAGE_FLAGS;
	let known = 0;
	const flags: string[] = [];
	for (const [bit, flag] of definitions) {
		known |= bit;
		if ((usage & bit) !== 0) flags.push(flag);
	}
	const unknown = (usage & ~known) >>> 0;
	if (unknown !== 0) {
		throw new Error(`Cannot create FrameGraph Snapshot: ${kind} usage contains unknown bits 0x${unknown.toString(16)}.`);
	}
	return flags;
}

const nodeId = (id: number) => `node:${id}`;
const resourceId = (id: number) => `resource:${id}`;
const groupId = (id: number) => `group:${id}`;
const viewId = (id: number) => `view:${id}`;
const accessId = (id: number) => `access:${id}`;
const allocationId = (id: number) => `allocation:${id}`;
const compatibilityId = (id: number) => `compatibility:${id}`;
const segmentId = (id: number) => `segment:${id}`;
