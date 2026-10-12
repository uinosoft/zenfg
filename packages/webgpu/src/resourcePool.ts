import { FRAME_GRAPH_ERROR_CODES, FrameGraphError } from './error.ts';
import {
	bufferAllocationSize,
	bufferPoolKey,
	estimateTextureByteSize,
	normalizeTextureSize,
	texturePoolKey,
} from './resourceDescriptors.ts';
import type {
	BufferDesc,
	FrameGraphResourcePoolStats,
	ResourceKind,
	TextureDesc,
	ResourcePoolEntryInfo,
	ResourcePoolScope,
	ResourcePoolEvictionReport,
} from './types.ts';

type ResourcePoolBucketMetadata = {
	kind: ResourceKind;
	key: string;
	bytesPerResource: number;
	info: ResourcePoolEntryInfo;
};

export class ResourcePool {
	private readonly textures = new Map<string, GPUTexture[]>();
	private readonly buffers = new Map<string, GPUBuffer[]>();
	private readonly metadata = new Map<string, ResourcePoolBucketMetadata>();
	private readonly lastAcquiredExecution = new WeakMap<GPUTexture | GPUBuffer, number>();
	private executionSerial = 0;
	private acquireCount = 0;
	private reuseCount = 0;
	private createdCount = 0;
	private retainedCount = 0;
	private estimatedRetainedBytes = 0;

	constructor(private readonly device: GPUDevice) {}

	beginExecution(): void {
		if (!Number.isSafeInteger(this.executionSerial + 1)) {
			throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.Internal, 'Resource pool execution serial exhausted.', { phase: 'execute' });
		}
		this.executionSerial++;
	}

	acquireTexture(desc: TextureDesc, usage: GPUTextureUsageFlags, key = texturePoolKey(desc, usage), scope?: ResourcePoolScope): GPUTexture {
		const pooled = this.textures.get(key)?.pop();
		const statsKey = `texture|${key}`;
		const hadMetadata = this.metadata.has(statsKey);
		const metadata = this.bucketMetadata('texture', key, estimateTextureByteSize(desc), () => Object.freeze({
			kind: 'texture', scope, estimatedBytes: estimateTextureByteSize(desc), unusedExecutions: 0,
			descriptor: Object.freeze({
				size: Object.freeze(normalizeTextureSize(desc.size) as { width: number; height: number; depthOrArrayLayers: number }),
				format: desc.format, dimension: desc.dimension ?? '2d',
				mipLevelCount: desc.mipLevelCount ?? 1, sampleCount: desc.sampleCount ?? 1,
				viewFormats: Object.freeze([...(desc.viewFormats ?? [])].sort()), usage,
			}),
		}));
		this.acquireCount++;
		if (pooled) {
			this.reuseCount++;
			this.recordRetainedDelta(metadata, -1);
			const label = desc.label ?? '';
			if (pooled.label !== label) {
				pooled.label = label;
			}
			this.lastAcquiredExecution.set(pooled, this.executionSerial);
			return pooled;
		}
		try {
			const texture = this.device.createTexture({
				label: desc.label,
				format: desc.format,
				viewFormats: desc.viewFormats ? [...desc.viewFormats] : undefined,
				size: normalizeTextureSize(desc.size),
				dimension: desc.dimension,
				mipLevelCount: desc.mipLevelCount,
				sampleCount: desc.sampleCount,
				usage,
			});
			this.createdCount++;
			this.lastAcquiredExecution.set(texture, this.executionSerial);
			return texture;
		}
		catch (error) {
			if (!hadMetadata) {
				this.metadata.delete(statsKey);
			}
			throw error;
		}
	}

	acquireBuffer(desc: BufferDesc, usage: GPUBufferUsageFlags, key = bufferPoolKey(desc, usage, { code: FRAME_GRAPH_ERROR_CODES.InvalidResourceDescriptor, phase: 'execute' }), scope?: ResourcePoolScope): GPUBuffer {
		const pooled = this.buffers.get(key)?.pop();
		const statsKey = `buffer|${key}`;
		const hadMetadata = this.metadata.has(statsKey);
		const metadata = this.bucketMetadata('buffer', key, bufferAllocationSize(desc.size, { code: FRAME_GRAPH_ERROR_CODES.InvalidResourceDescriptor, phase: 'execute' }), () => Object.freeze({
			kind: 'buffer', scope, estimatedBytes: bufferAllocationSize(desc.size, { code: FRAME_GRAPH_ERROR_CODES.InvalidResourceDescriptor, phase: 'execute' }), unusedExecutions: 0,
			descriptor: Object.freeze({ size: bufferAllocationSize(desc.size, { code: FRAME_GRAPH_ERROR_CODES.InvalidResourceDescriptor, phase: 'execute' }), usage }),
		}));
		this.acquireCount++;
		if (pooled) {
			this.reuseCount++;
			this.recordRetainedDelta(metadata, -1);
			const label = desc.label ?? '';
			if (pooled.label !== label) {
				pooled.label = label;
			}
			this.lastAcquiredExecution.set(pooled, this.executionSerial);
			return pooled;
		}
		try {
			const buffer = this.device.createBuffer({
				label: desc.label,
				size: bufferAllocationSize(desc.size, { code: FRAME_GRAPH_ERROR_CODES.InvalidResourceDescriptor, phase: 'execute' }),
				usage,
			});
			this.createdCount++;
			this.lastAcquiredExecution.set(buffer, this.executionSerial);
			return buffer;
		}
		catch (error) {
			if (!hadMetadata) {
				this.metadata.delete(statsKey);
			}
			throw error;
		}
	}

	release(resources: readonly { readonly resource: GPUTexture | GPUBuffer; readonly key: string }[]): void {
		for (const { resource, key } of resources) {
			if ('createView' in resource) {
				const metadata = this.releaseBucketMetadata('texture', key);
				let bucket = this.textures.get(key);
				if (!bucket) {
					bucket = [];
					this.textures.set(key, bucket);
				}
				bucket.push(resource);
				this.recordRetainedDelta(metadata, 1);
			}
			else {
				const metadata = this.releaseBucketMetadata('buffer', key);
				let bucket = this.buffers.get(key);
				if (!bucket) {
					bucket = [];
					this.buffers.set(key, bucket);
				}
				bucket.push(resource);
				this.recordRetainedDelta(metadata, 1);
			}
		}
	}

	clearRetainedResources(): void {
		this.destroyRetainedResources();
	}

	destroy(): void {
		this.destroyRetainedResources();
	}

	getStats(): FrameGraphResourcePoolStats {
		return {
			acquireCount: this.acquireCount,
			reuseCount: this.reuseCount,
			createdCount: this.createdCount,
			retainedCount: this.retainedCount,
			estimatedRetainedBytes: this.estimatedRetainedBytes,
		};
	}

	/**
	 * Select with immutable views before touching buckets. Selection records are maintenance-local.
	 * Runtime guards belong to FrameGraph, which also blocks execution and destruction.
	 */
	evict(predicate: (info: ResourcePoolEntryInfo) => boolean): ResourcePoolEvictionReport {
		if (typeof predicate !== 'function') throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.InvalidArgument,
			'Resource pool predicate must be a function.', { phase: 'record' });
		const selected = new Set<GPUTexture | GPUBuffer>();
		for (const [kind, buckets] of [['texture', this.textures], ['buffer', this.buffers]] as const) {
			for (const [key, bucket] of buckets) {
				const metadata = this.releaseBucketMetadata(kind, key);
				for (const resource of bucket) {
					const info = Object.freeze({ ...metadata.info,
						unusedExecutions: this.executionSerial - this.lastAcquiredExecution.get(resource)! });
					const decision: unknown = predicate(info);
					if (typeof decision !== 'boolean') {
						if (decision !== null && (typeof decision === 'object' || typeof decision === 'function')
							&& typeof (decision as { then?: unknown }).then === 'function') {
							void Promise.resolve(decision).catch(() => undefined);
						}
						throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.InvalidArgument,
							'Resource pool predicate must synchronously return a boolean.', { phase: 'record' });
					}
					if (decision) selected.add(resource);
				}
			}
		}
		const estimatedEvictedBytes = this.removeSelected('texture', this.textures, selected)
			+ this.removeSelected('buffer', this.buffers, selected);
		this.destroyResources(selected);
		return Object.freeze({ evictedCount: selected.size, estimatedEvictedBytes });
	}

	private removeSelected<T extends GPUTexture | GPUBuffer>(
		kind: ResourceKind, buckets: Map<string, T[]>, selected: ReadonlySet<GPUTexture | GPUBuffer>,
	): number {
		let bytes = 0;
		for (const [key, bucket] of buckets) {
			const metadata = this.releaseBucketMetadata(kind, key);
			let retained = 0;
			for (const resource of bucket) {
				if (selected.has(resource)) {
					this.recordRetainedDelta(metadata, -1);
					bytes += metadata.bytesPerResource;
					this.lastAcquiredExecution.delete(resource);
				} else {
					bucket[retained++] = resource;
				}
			}
			bucket.length = retained;
			if (retained === 0) {
				buckets.delete(key);
				this.metadata.delete(kind + '|' + key);
			}
		}
		return bytes;
	}

	private destroyResources(resources: Iterable<GPUTexture | GPUBuffer>): void {
		let failure: unknown;
		let failed = false;
		for (const resource of resources) {
			try { resource.destroy(); } catch (error) {
				if (!failed) { failure = error; failed = true; }
			}
		}
		if (failed) throw failure;
	}

	private destroyRetainedResources(): void {
		this.evict(() => true);
	}

	private releaseBucketMetadata(kind: ResourceKind, key: string): ResourcePoolBucketMetadata {
		const statsKey = `${kind}|${key}`;
		const metadata = this.metadata.get(statsKey);
		if (!metadata) {
			throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.Internal, `ResourcePool.release received a ${kind} for unknown bucket "${key}". Resources must be released with the key returned by acquire.`, { phase: 'execute' });
		}
		return metadata;
	}

	private bucketMetadata(kind: ResourceKind, key: string, bytesPerResource: number, info: () => ResourcePoolEntryInfo): ResourcePoolBucketMetadata {
		const statsKey = `${kind}|${key}`;
		let metadata = this.metadata.get(statsKey);
		if (!metadata) {
			metadata = {
				kind,
				key,
				bytesPerResource,
				info: info(),
			};
			this.metadata.set(statsKey, metadata);
		}
		return metadata;
	}

	private recordRetainedDelta(metadata: ResourcePoolBucketMetadata, delta: number): void {
		this.retainedCount += delta;
		this.estimatedRetainedBytes += delta * metadata.bytesPerResource;
	}
}
