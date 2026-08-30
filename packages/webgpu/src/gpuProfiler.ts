import type { FrameGraphGpuTimingReport } from './types.ts';
import type { InternalNode } from './internalTypes.ts';

export type GpuTimingNodeQuery = {
	readonly nodeId: number;
	readonly kind: 'render' | 'compute';
	readonly label?: string;
	readonly beginIndex: number;
	readonly endIndex: number;
};

export type ActiveGpuTimingFrame = {
	readonly frameIndex: number;
	readonly queryCount: number;
	readonly byteSize: number;
	readonly nodeQueries: readonly GpuTimingNodeQuery[];
	readonly queryByNodeId: ReadonlyMap<number, GpuTimingNodeQuery>;
	readonly promise: Promise<FrameGraphGpuTimingReport>;
	readonly resolve: (report: FrameGraphGpuTimingReport) => void;
	readonly reject: (error: unknown) => void;
};

type GpuTimingResources = {
	querySet: GPUQuerySet;
	queryCapacity: number;
	resolveBuffer: GPUBuffer;
	readbackBuffer: GPUBuffer;
	bufferSize: number;
	pending: boolean;
};

export type GpuProfilerState = {
	readonly device: GPUDevice;
	resources?: GpuTimingResources;
	activeFrame?: ActiveGpuTimingFrame;
	destroyed: boolean;
};

export type BeginGpuTimingResult = {
	readonly frame?: ActiveGpuTimingFrame;
	readonly promise: Promise<FrameGraphGpuTimingReport>;
};

function alignTo(value: number, alignment: number): number {
	return Math.ceil(value / alignment) * alignment;
}

export function createGpuProfilerState(device: GPUDevice): GpuProfilerState {
	return { device, destroyed: false };
}

export function gpuTimingTimestampWrites(
	state: GpuProfilerState,
	query: GpuTimingNodeQuery | undefined,
): GPURenderPassTimestampWrites | undefined {
	if (!query || !state.resources) {
		return undefined;
	}
	return {
		querySet: state.resources.querySet,
		beginningOfPassWriteIndex: query.beginIndex,
		endOfPassWriteIndex: query.endIndex,
	};
}

export function beginGpuTimingFrame(
	state: GpuProfilerState,
	nodes: readonly InternalNode[],
	frameIndex: number,
): BeginGpuTimingResult {
	const timedNodes = nodes.filter(
		(node): node is InternalNode & { readonly kind: 'render' | 'compute' } => (
			node.kind === 'render' || node.kind === 'compute'
		),
	);
	if (timedNodes.length === 0) {
		return {
			promise: Promise.resolve({
				status: 'available',
				frameIndex,
				frameDurationMicros: 0,
				nodes: [],
			}),
		};
	}
	if (state.resources?.pending || state.activeFrame) {
		return {
			promise: Promise.resolve({
				status: 'unavailable',
				frameIndex,
				reason: 'busy',
			}),
		};
	}
	if (state.destroyed || !state.device.features?.has('timestamp-query')) {
		return {
			promise: Promise.resolve({
				status: 'unavailable',
				frameIndex,
				reason: 'unsupported',
			}),
		};
	}

	const nodeQueries = timedNodes.map((node, index): GpuTimingNodeQuery => ({
		nodeId: node.id,
		kind: node.kind,
		label: node.label,
		beginIndex: index * 2,
		endIndex: index * 2 + 1,
	}));
	const queryCount = nodeQueries.length * 2;
	const byteSize = alignTo(queryCount * 8, 256);
	const resources = ensureGpuTimingResources(state, queryCount, byteSize);
	if (!resources) {
		return {
			promise: Promise.resolve({
				status: 'unavailable',
				frameIndex,
				reason: 'unsupported',
			}),
		};
	}

	let resolve!: (report: FrameGraphGpuTimingReport) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<FrameGraphGpuTimingReport>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	const frame: ActiveGpuTimingFrame = {
		frameIndex,
		queryCount,
		byteSize,
		nodeQueries,
		queryByNodeId: new Map(nodeQueries.map((query) => [query.nodeId, query])),
		promise,
		resolve,
		reject,
	};
	resources.pending = true;
	state.activeFrame = frame;
	return { frame, promise };
}

function ensureGpuTimingResources(
	state: GpuProfilerState,
	queryCount: number,
	byteSize: number,
): GpuTimingResources | undefined {
	if (state.resources && state.resources.queryCapacity >= queryCount && state.resources.bufferSize >= byteSize) {
		return state.resources;
	}

	destroyGpuTimingResources(state);
	let querySet: GPUQuerySet | undefined;
	let resolveBuffer: GPUBuffer | undefined;
	let readbackBuffer: GPUBuffer | undefined;
	try {
		querySet = state.device.createQuerySet({ type: 'timestamp', count: queryCount });
		resolveBuffer = state.device.createBuffer({
			label: 'FrameGraph GPU timing resolve buffer',
			size: byteSize,
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
		});
		readbackBuffer = state.device.createBuffer({
			label: 'FrameGraph GPU timing readback buffer',
			size: byteSize,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
		state.resources = {
			querySet,
			queryCapacity: queryCount,
			resolveBuffer,
			readbackBuffer,
			bufferSize: byteSize,
			pending: false,
		};
		return state.resources;
	}
	catch {
		querySet?.destroy();
		resolveBuffer?.destroy();
		readbackBuffer?.destroy();
		state.resources = undefined;
		return undefined;
	}
}

export function resolveGpuTimingFrame(
	state: GpuProfilerState,
	commandEncoder: GPUCommandEncoder,
	frame: ActiveGpuTimingFrame | undefined,
): void {
	if (!frame || !state.resources) {
		return;
	}
	commandEncoder.resolveQuerySet(state.resources.querySet, 0, frame.queryCount, state.resources.resolveBuffer, 0);
	commandEncoder.copyBufferToBuffer(state.resources.resolveBuffer, 0, state.resources.readbackBuffer, 0, frame.byteSize);
}

export function readGpuTimingFrame(
	state: GpuProfilerState,
	frame: ActiveGpuTimingFrame | undefined,
): void {
	const resources = state.resources;
	if (!frame || !resources) {
		return;
	}

	const failReadback = () => {
		try {
			resources.readbackBuffer.unmap();
		}
		catch {
			// The buffer may not have reached the mapped state.
		}
		if (!state.destroyed && state.activeFrame === frame) {
			resources.pending = false;
			state.activeFrame = undefined;
			frame.resolve({
				status: 'unavailable',
				frameIndex: frame.frameIndex,
				reason: 'readback-failed',
			});
		}
	};
	let mapPromise: Promise<void>;
	try {
		mapPromise = resources.readbackBuffer.mapAsync(GPUMapMode.READ);
	}
	catch {
		failReadback();
		return;
	}

	void mapPromise.then(() => {
		if (state.destroyed || state.activeFrame !== frame) {
			return;
		}
		const mapped = resources.readbackBuffer.getMappedRange(0, frame.byteSize);
		const timestamps = new BigUint64Array(mapped.slice(0, frame.queryCount * 8));
		let frameBegin = timestamps[frame.nodeQueries[0].beginIndex];
		let frameEnd = timestamps[frame.nodeQueries[0].endIndex];
		const nodes = frame.nodeQueries.map((query) => {
			const begin = timestamps[query.beginIndex];
			const end = timestamps[query.endIndex];
			frameBegin = begin < frameBegin ? begin : frameBegin;
			frameEnd = end > frameEnd ? end : frameEnd;
			return {
				nodeId: query.nodeId,
				kind: query.kind,
				label: query.label,
				durationMicros: Number(end >= begin ? end - begin : 0n) / 1000,
			};
		});
		resources.readbackBuffer.unmap();
		resources.pending = false;
		state.activeFrame = undefined;
		frame.resolve({
			status: 'available',
			frameIndex: frame.frameIndex,
			frameDurationMicros: Number(frameEnd >= frameBegin ? frameEnd - frameBegin : 0n) / 1000,
			nodes,
		});
	}).catch(failReadback);
}

export function abortGpuTimingFrame(state: GpuProfilerState, frame: ActiveGpuTimingFrame | undefined): void {
	if (!frame || state.activeFrame !== frame) {
		return;
	}
	if (state.resources) {
		state.resources.pending = false;
	}
	state.activeFrame = undefined;
	frame.resolve({
		status: 'unavailable',
		frameIndex: frame.frameIndex,
		reason: 'readback-failed',
	});
}

function destroyGpuTimingResources(state: GpuProfilerState): void {
	if (!state.resources) {
		return;
	}
	state.resources.querySet.destroy?.();
	state.resources.resolveBuffer.destroy();
	state.resources.readbackBuffer.destroy();
	state.resources = undefined;
}

export function destroyGpuProfiler(state: GpuProfilerState): void {
	state.destroyed = true;
	state.activeFrame?.reject(new Error('FrameGraph was destroyed before GPU timing readback completed.'));
	state.activeFrame = undefined;
	destroyGpuTimingResources(state);
}
