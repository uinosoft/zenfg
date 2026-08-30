import type {
	BufferDesc,
	TextureDesc,
	TextureSize,
} from './types.ts';
import { getTextureFormatBlockInfo } from './formatCaps.ts';
import { assertNonNegativeSafeInteger } from './numericValidation.ts';

export function snapshotTextureDescriptor<T extends TextureDesc>(desc: T): T {
	return {
		...desc,
		size: snapshotExtent3D(desc.size, `Texture descriptor "${desc.label ?? 'unlabeled'}" size`),
		...(desc.viewFormats === undefined ? {} : { viewFormats: desc.viewFormats.slice() }),
	};
}

export function snapshotExtent3D(size: TextureSize, field: string): TextureSize {
	if (Array.isArray(size)) {
		validateExtentSequenceLength(size.length, field);
		return [...size];
	}
	if (Symbol.iterator in Object(size)) {
		const values = Array.from(size as Iterable<number>);
		validateExtentSequenceLength(values.length, field);
		return values;
	}
	return { ...(size as GPUExtent3DDict) };
}

export function snapshotOrigin3D(origin: GPUOrigin3D | undefined, field: string): GPUOrigin3D | undefined {
	if (origin === undefined) {
		return undefined;
	}
	if (Array.isArray(origin)) {
		validateOriginSequenceLength(origin.length, field);
		return [...origin];
	}
	if (Symbol.iterator in Object(origin)) {
		const values = Array.from(origin as Iterable<number>);
		validateOriginSequenceLength(values.length, field);
		return values;
	}
	return { ...(origin as GPUOrigin3DDict) };
}

function validateExtentSequenceLength(length: number, field: string): void {
	if (length < 1 || length > 3) {
		throw new Error(`${field} iterable must contain between 1 and 3 values. Received ${length}.`);
	}
}

function validateOriginSequenceLength(length: number, field: string): void {
	if (length < 1 || length > 3) {
		throw new Error(`${field} iterable must contain between 1 and 3 values. Received ${length}.`);
	}
}

export function normalizeTextureSize(size: TextureSize): GPUTextureDescriptor['size'] {
	const [width, height, depthOrArrayLayers] = textureSizeTuple(size);
	return {
		width,
		height,
		depthOrArrayLayers,
	};
}

export function textureSizeTuple(size: TextureSize): readonly [number, number, number] {
	if (Array.isArray(size)) {
		return [size[0], size[1] ?? 1, size[2] ?? 1];
	}
	if (Symbol.iterator in Object(size)) {
		const [width, height = 1, depthOrArrayLayers = 1] = Array.from(size as Iterable<number>);
		return [width, height, depthOrArrayLayers];
	}
	const objectSize = size as { width: number; height?: number; depthOrArrayLayers?: number };
	return [objectSize.width, objectSize.height ?? 1, objectSize.depthOrArrayLayers ?? 1];
}

export function textureRenderExtent(desc: TextureDesc, baseMipLevel: number): readonly [number, number] {
	const [baseWidth, baseHeight] = textureSizeTuple(desc.size);
	const divisor = 2 ** baseMipLevel;
	return [
		Math.max(1, Math.floor(baseWidth / divisor)),
		Math.max(1, Math.floor(baseHeight / divisor)),
	];
}

/** Estimates the graph-visible byte footprint of a texture descriptor. */
export function estimateTextureByteSize(desc: TextureDesc): number {
	const blockInfo = textureEstimateBlockInfo(desc.format);
	const [baseWidth, baseHeight, baseDepth] = textureSizeTuple(desc.size);
	const mipLevelCount = desc.mipLevelCount ?? 1;
	const sampleCount = desc.sampleCount ?? 1;
	let bytes = 0;

	for (let mipLevel = 0; mipLevel < mipLevelCount; mipLevel++) {
		const divisor = 2 ** mipLevel;
		const width = Math.max(1, Math.floor(baseWidth / divisor));
		const height = Math.max(1, Math.floor(baseHeight / divisor));
		const depth = desc.dimension === '3d'
			? Math.max(1, Math.floor(baseDepth / divisor))
			: baseDepth;
		bytes += Math.ceil(width / blockInfo.width)
			* Math.ceil(height / blockInfo.height)
			* depth
			* blockInfo.bytes
			* sampleCount;
	}

	return bytes;
}

function textureEstimateBlockInfo(format: GPUTextureFormat): { readonly width: number; readonly height: number; readonly bytes: number } {
	try {
		return getTextureFormatBlockInfo(format);
	}
	catch {
		// Diagnostics stay available for implementation-defined formats that
		// the validation table does not know yet.
		return { width: 1, height: 1, bytes: 4 };
	}
}

export function originTuple(origin: GPUOrigin3D | undefined): readonly [number, number, number] {
	if (!origin) {
		return [0, 0, 0];
	}
	if (Array.isArray(origin)) {
		return [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0];
	}
	if (Symbol.iterator in Object(origin)) {
		const [x = 0, y = 0, z = 0] = Array.from(origin as Iterable<number>);
		return [x, y, z];
	}
	const objectOrigin = origin as { x?: number; y?: number; z?: number };
	return [objectOrigin.x ?? 0, objectOrigin.y ?? 0, objectOrigin.z ?? 0];
}

function textureSizeKey(size: TextureSize): string {
	return textureSizeTuple(size).join('x');
}

export function texturePoolKey(desc: TextureDesc, usage: GPUTextureUsageFlags): string {
	return [
		desc.format,
		textureSizeKey(desc.size),
		desc.dimension ?? '2d',
		desc.sampleCount ?? 1,
		desc.mipLevelCount ?? 1,
		[...(desc.viewFormats ?? [])].sort().join(','),
		usage,
	].join('|');
}

export function bufferAllocationSize(size: number): number {
	assertNonNegativeSafeInteger(size, 'Buffer allocation size');
	let bucket = 1;
	while (bucket < size) {
		bucket *= 2;
	}
	if (!Number.isSafeInteger(bucket)) {
		throw new Error(`Buffer allocation size ${size} rounds to an unsafe allocation bucket ${bucket}.`);
	}
	return bucket;
}

export function bufferPoolKey(desc: BufferDesc, usage: GPUBufferUsageFlags): string {
	return `${bufferAllocationSize(desc.size)}|${usage}`;
}
