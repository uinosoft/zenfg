import assert from 'node:assert/strict';
import test from 'node:test';

import { ResourcePool } from '../src/resourcePool.ts';
import { bufferPoolKey, texturePoolKey } from '../src/resourceDescriptors.ts';
import { mockDevice, texture } from './testUtils.ts';

type TrackedTexture = GPUTexture & { readonly labelWriteCount: number };
type TrackedBuffer = GPUBuffer & { readonly labelWriteCount: number };

function labelTrackingDevice(): {
	readonly device: GPUDevice;
	readonly textures: TrackedTexture[];
	readonly buffers: TrackedBuffer[];
} {
	const textures: TrackedTexture[] = [];
	const buffers: TrackedBuffer[] = [];
	const device = {
		createTexture(desc: GPUTextureDescriptor) {
			let label = desc.label ?? '';
			let labelWriteCount = 0;
			const resource = {
				get label() {
					return label;
				},
				set label(value: string) {
					label = value;
					labelWriteCount++;
				},
				get labelWriteCount() {
					return labelWriteCount;
				},
				createView() {
					return {} as GPUTextureView;
				},
				destroy() {},
			} as unknown as TrackedTexture;
			textures.push(resource);
			return resource;
		},
		createBuffer(desc: GPUBufferDescriptor) {
			let label = desc.label ?? '';
			let labelWriteCount = 0;
			const resource = {
				get label() {
					return label;
				},
				set label(value: string) {
					label = value;
					labelWriteCount++;
				},
				get labelWriteCount() {
					return labelWriteCount;
				},
				destroy() {},
			} as unknown as TrackedBuffer;
			buffers.push(resource);
			return resource;
		},
	} as unknown as GPUDevice;

	return { device, textures, buffers };
}

test('ResourcePool release rejects unknown bucket keys', () => {
	const pool = new ResourcePool(mockDevice());

	assert.throws(
		() => pool.release([{ resource: texture('orphan'), key: 'missing-texture-bucket' }]),
		/ResourcePool\.release.*unknown bucket "missing-texture-bucket"/,
	);
});

test('texture pool compatibility includes normalized viewFormats', () => {
	const base = {
		format: 'rgba8unorm' as const,
		size: [1, 1] as const,
	};
	const linearOnly = texturePoolKey(base, 0x10);
	const srgbView = texturePoolKey({
		...base,
		viewFormats: ['rgba8unorm-srgb'] as const,
	}, 0x10);
	const reordered = texturePoolKey({
		...base,
		viewFormats: ['rgba8unorm-srgb', 'rgba8unorm'] as const,
	}, 0x10);
	const reverseOrder = texturePoolKey({
		...base,
		viewFormats: ['rgba8unorm', 'rgba8unorm-srgb'] as const,
	}, 0x10);

	assert.notEqual(linearOnly, srgbView);
	assert.equal(reordered, reverseOrder);
});

test('clearRetainedResources clears bucket metadata while preserving cumulative counters', () => {
	const pool = new ResourcePool(mockDevice());
	const textureDesc = { format: 'rgba8unorm' as const, size: [1, 1] as const };
	const bufferDesc = { size: 33 };
	const textureUsage = 0x10;
	const bufferUsage = 0x80;
	const textureKey = texturePoolKey(textureDesc, textureUsage);
	const bufferKey = bufferPoolKey(bufferDesc, bufferUsage);
	const pooledTexture = pool.acquireTexture(textureDesc, textureUsage, textureKey);
	const pooledBuffer = pool.acquireBuffer(bufferDesc, bufferUsage, bufferKey);

	pool.release([
		{ resource: pooledTexture, key: textureKey },
		{ resource: pooledBuffer, key: bufferKey },
	]);
	const metadata = (pool as unknown as {
		readonly metadata: ReadonlyMap<string, unknown>;
	}).metadata;
	assert.equal(metadata.size, 2);

	pool.clearRetainedResources();

	assert.equal(metadata.size, 0);
	assert.deepEqual(pool.getStats(), {
		acquireCount: 2,
		reuseCount: 0,
		createdCount: 2,
		retainedCount: 0,
		estimatedRetainedBytes: 0,
	});
});

test('texture reuse refreshes changed labels without rewriting stable labels', () => {
	const { device, textures } = labelTrackingDevice();
	const pool = new ResourcePool(device);
	const baseDesc = { format: 'rgba8unorm' as const, size: [1, 1] as const };
	const usage = 0x10;
	const key = texturePoolKey(baseDesc, usage);
	const first = pool.acquireTexture({ ...baseDesc, label: 'first' }, usage, key) as TrackedTexture;
	pool.release([{ resource: first, key }]);

	const stable = pool.acquireTexture({ ...baseDesc, label: 'first' }, usage, key) as TrackedTexture;
	assert.equal(stable, first);
	assert.equal(stable.labelWriteCount, 0);
	pool.release([{ resource: stable, key }]);

	const renamed = pool.acquireTexture({ ...baseDesc, label: 'second' }, usage, key) as TrackedTexture;
	assert.equal(renamed, first);
	assert.equal(renamed.label, 'second');
	assert.equal(renamed.labelWriteCount, 1);
	pool.release([{ resource: renamed, key }]);

	const unlabeled = pool.acquireTexture(baseDesc, usage, key) as TrackedTexture;
	assert.equal(unlabeled, first);
	assert.equal(unlabeled.label, '');
	assert.equal(unlabeled.labelWriteCount, 2);
	pool.release([{ resource: unlabeled, key }]);

	assert.equal(textures.length, 1);
	assert.deepEqual(pool.getStats(), {
		acquireCount: 4,
		reuseCount: 3,
		createdCount: 1,
		retainedCount: 1,
		estimatedRetainedBytes: 4,
	});
});

test('buffer reuse refreshes changed labels without rewriting stable labels', () => {
	const { device, buffers } = labelTrackingDevice();
	const pool = new ResourcePool(device);
	const baseDesc = { size: 33 };
	const usage = 0x80;
	const key = bufferPoolKey(baseDesc, usage);
	const first = pool.acquireBuffer({ ...baseDesc, label: 'first' }, usage, key) as TrackedBuffer;
	pool.release([{ resource: first, key }]);

	const stable = pool.acquireBuffer({ ...baseDesc, label: 'first' }, usage, key) as TrackedBuffer;
	assert.equal(stable, first);
	assert.equal(stable.labelWriteCount, 0);
	pool.release([{ resource: stable, key }]);

	const renamed = pool.acquireBuffer({ ...baseDesc, label: 'second' }, usage, key) as TrackedBuffer;
	assert.equal(renamed, first);
	assert.equal(renamed.label, 'second');
	assert.equal(renamed.labelWriteCount, 1);
	pool.release([{ resource: renamed, key }]);

	const unlabeled = pool.acquireBuffer(baseDesc, usage, key) as TrackedBuffer;
	assert.equal(unlabeled, first);
	assert.equal(unlabeled.label, '');
	assert.equal(unlabeled.labelWriteCount, 2);
	pool.release([{ resource: unlabeled, key }]);

	assert.equal(buffers.length, 1);
	assert.deepEqual(pool.getStats(), {
		acquireCount: 4,
		reuseCount: 3,
		createdCount: 1,
		retainedCount: 1,
		estimatedRetainedBytes: 64,
	});
});
