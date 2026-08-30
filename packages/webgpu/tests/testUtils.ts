import assert from 'node:assert/strict';

import {
	type BufferHandle,
	type FrameGraphCompilationReport,
	type FrameGraphRecorder,
	type TextureHandle,
} from '../src/index.ts';

export const textureUsage = {
	COPY_SRC: 0x01,
	COPY_DST: 0x02,
	TEXTURE_BINDING: 0x04,
	STORAGE_BINDING: 0x08,
	RENDER_ATTACHMENT: 0x10,
};

export const bufferUsage = {
	MAP_READ: 0x0001,
	COPY_SRC: 0x0004,
	COPY_DST: 0x0008,
	INDEX: 0x0010,
	QUERY_RESOLVE: 0x0200,
	VERTEX: 0x0020,
	UNIFORM: 0x0040,
	STORAGE: 0x0080,
	INDIRECT: 0x0100,
};

const mapMode = {
	READ: 0x0001,
};

if (typeof globalThis.GPUTextureUsage === 'undefined') {
	(globalThis as any).GPUTextureUsage = textureUsage;
}

if (typeof globalThis.GPUBufferUsage === 'undefined') {
	(globalThis as any).GPUBufferUsage = bufferUsage;
}

if (typeof globalThis.GPUMapMode === 'undefined') {
	(globalThis as any).GPUMapMode = mapMode;
}

export function texture(
	label: string,
	usage = textureUsage.RENDER_ATTACHMENT | textureUsage.TEXTURE_BINDING,
	overrides: Partial<Pick<GPUTexture, 'width' | 'height' | 'depthOrArrayLayers' | 'mipLevelCount' | 'sampleCount' | 'dimension' | 'format'>> & {
		readonly size?: GPUExtent3D;
	} = {},
): GPUTexture {
	const size = textureSize(overrides.size);
	return {
		label,
		width: overrides.width ?? size[0],
		height: overrides.height ?? size[1],
		depthOrArrayLayers: overrides.depthOrArrayLayers ?? size[2],
		mipLevelCount: overrides.mipLevelCount ?? 1,
		sampleCount: overrides.sampleCount ?? 1,
		dimension: overrides.dimension ?? '2d',
		format: overrides.format ?? 'rgba8unorm',
		usage,
		createView() {
			return { label } as GPUTextureView;
		},
		destroy() {},
	} as unknown as GPUTexture;
}

function textureSize(size: GPUExtent3D | undefined): readonly [number, number, number] {
	if (size === undefined) return [1, 1, 1];
	if (Symbol.iterator in Object(size)) {
		const values = Array.from(size as Iterable<number>);
		return [values[0], values[1] ?? 1, values[2] ?? 1];
	}
	const extent = size as GPUExtent3DDict;
	return [extent.width, extent.height ?? 1, extent.depthOrArrayLayers ?? 1];
}

export function buffer(
	label: string,
	usage = bufferUsage.STORAGE | bufferUsage.COPY_SRC | bufferUsage.COPY_DST,
	size = 64,
): GPUBuffer {
	return {
		label,
		size,
		usage,
		destroy() {},
		mapAsync() {
			return Promise.resolve();
		},
		getMappedRange() {
			return new ArrayBuffer(0);
		},
		unmap() {},
	} as unknown as GPUBuffer;
}

export function mockCommandEncoder(overrides: Record<string, unknown> = {}): GPUCommandEncoder {
	return {
		beginRenderPass() {
			return { end() {} };
		},
		beginComputePass() {
			return { end() {} };
		},
		copyBufferToBuffer() {},
		copyBufferToTexture() {},
		copyTextureToBuffer() {},
		copyTextureToTexture() {},
		clearBuffer() {},
		resolveQuerySet() {},
		pushDebugGroup() {},
		popDebugGroup() {},
		finish() {
			return {} as GPUCommandBuffer;
		},
		...overrides,
	} as unknown as GPUCommandEncoder;
}

export function mockDevice(commandEncoder: GPUCommandEncoder = mockCommandEncoder()): GPUDevice {
	let textureCount = 0;
	let bufferCount = 0;
	return {
		createCommandEncoder() {
			return commandEncoder;
		},
		createTexture(desc: GPUTextureDescriptor) {
			return {
				...texture(`transient-texture-${textureCount++}`, desc.usage),
				_desc: desc,
			} as unknown as GPUTexture;
		},
		createBuffer(desc: GPUBufferDescriptor) {
			return {
				...buffer(`transient-buffer-${bufferCount++}`, desc.usage),
				size: desc.size,
				_desc: desc,
			} as unknown as GPUBuffer;
		},
		createQuerySet(desc: GPUQuerySetDescriptor) {
			return {
				type: desc.type,
				count: desc.count,
				destroy() {},
			} as unknown as GPUQuerySet;
		},
		queue: {
			submit() {},
		},
	} as unknown as GPUDevice;
}

export function compiledResource(compiled: FrameGraphCompilationReport, handle: TextureHandle | BufferHandle) {
	const resource = compiled.resources.find((entry) => entry.id === handle.id);
	assert.ok(resource, `Expected compiled resource for ${handle.label ?? handle.id}`);
	return resource;
}

export function internalCompiledPlan(graph: FrameGraphRecorder): {
	readonly physicalAllocations: ReadonlyMap<number, unknown>;
} | undefined {
	return (graph as unknown as {
		readonly compiledPlan?: {
			readonly physicalAllocations: ReadonlyMap<number, unknown>;
		};
	}).compiledPlan;
}

export function allocationResourceLabels(compiled: FrameGraphCompilationReport, physicalResourceId: number | undefined): Set<string | number> {
	assert.equal(typeof physicalResourceId, 'number');
	return new Set(compiled.resources
		.filter((resource) => resource.physicalAllocationId === physicalResourceId)
		.map((resource) => resource.label ?? resource.id));
}
