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
} from './types.ts';

type ResourcePoolBucketMetadata = {
	kind: ResourceKind;
	key: string;
	bytesPerResource: number;
};

export class ResourcePool {
	private readonly textures = new Map<string, GPUTexture[]>();
	private readonly buffers = new Map<string, GPUBuffer[]>();
	private readonly metadata = new Map<string, ResourcePoolBucketMetadata>();
	private acquireCount = 0;
	private reuseCount = 0;
	private createdCount = 0;
	private retainedCount = 0;
	private estimatedRetainedBytes = 0;

	constructor(private readonly device: GPUDevice) {}

	acquireTexture(desc: TextureDesc, usage: GPUTextureUsageFlags, key = texturePoolKey(desc, usage)): GPUTexture {
		const pooled = this.textures.get(key)?.pop();
		const metadata = this.bucketMetadata('texture', key, estimateTextureByteSize(desc));
		this.acquireCount++;
		if (pooled) {
			this.reuseCount++;
			this.recordRetainedDelta(metadata, -1);
			const label = desc.label ?? '';
			if (pooled.label !== label) {
				pooled.label = label;
			}
			return pooled;
		}
		this.createdCount++;
		return this.device.createTexture({
			label: desc.label,
			format: desc.format,
			viewFormats: desc.viewFormats ? [...desc.viewFormats] : undefined,
			size: normalizeTextureSize(desc.size),
			dimension: desc.dimension,
			mipLevelCount: desc.mipLevelCount,
			sampleCount: desc.sampleCount,
			usage,
		});
	}

	acquireBuffer(desc: BufferDesc, usage: GPUBufferUsageFlags, key = bufferPoolKey(desc, usage)): GPUBuffer {
		const pooled = this.buffers.get(key)?.pop();
		const metadata = this.bucketMetadata('buffer', key, bufferAllocationSize(desc.size));
		this.acquireCount++;
		if (pooled) {
			this.reuseCount++;
			this.recordRetainedDelta(metadata, -1);
			const label = desc.label ?? '';
			if (pooled.label !== label) {
				pooled.label = label;
			}
			return pooled;
		}
		this.createdCount++;
		return this.device.createBuffer({
			label: desc.label,
			size: bufferAllocationSize(desc.size),
			usage,
		});
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

	private destroyRetainedResources(): void {
		for (const bucket of this.textures.values()) {
			for (const texture of bucket) {
				texture.destroy();
			}
		}
		for (const bucket of this.buffers.values()) {
			for (const buffer of bucket) {
				buffer.destroy();
			}
		}
		this.textures.clear();
		this.buffers.clear();
		this.metadata.clear();
		this.retainedCount = 0;
		this.estimatedRetainedBytes = 0;
	}

	private releaseBucketMetadata(kind: ResourceKind, key: string): ResourcePoolBucketMetadata {
		const statsKey = `${kind}|${key}`;
		const metadata = this.metadata.get(statsKey);
		if (!metadata) {
			throw new Error(`ResourcePool.release received a ${kind} for unknown bucket "${key}". Resources must be released with the key returned by acquire.`);
		}
		return metadata;
	}

	private bucketMetadata(kind: ResourceKind, key: string, bytesPerResource?: number): ResourcePoolBucketMetadata {
		const statsKey = `${kind}|${key}`;
		let metadata = this.metadata.get(statsKey);
		if (!metadata) {
			if (bytesPerResource === undefined) {
				throw new Error(`Missing byte estimate for resource pool bucket "${key}".`);
			}
			metadata = {
				kind,
				key,
				bytesPerResource,
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
