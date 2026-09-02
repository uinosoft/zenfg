import type {
	BufferDesc,
	BufferHandle,
	BufferRange,
	CopyOperation,
	ResourceHandle,
	TextureDesc,
	TextureHandle,
} from './types.ts';
import {
	areTextureCopyFormatsCompatible,
	getTextureFormatBlockInfo,
	isDepthFormat,
} from './formatCaps.ts';
import {
	originTuple,
	snapshotExtent3D,
	snapshotOrigin3D,
	textureSizeTuple,
} from './resourceDescriptors.ts';
import {
	assertNonNegativeSafeInteger,
	assertNonNegativeUint32,
	assertPositiveUint32,
} from './numericValidation.ts';
import { sameResource } from './handles.ts';
import type {
	InternalNode,
	InternalCopyOperation,
	InternalResource,
	InternalTextureRegion,
} from './internalTypes.ts';
import {
	bufferRangesOverlap,
	textureSubresourcesAlias,
} from './graphCompiler.ts';

export type ResourceResolver = (handle: ResourceHandle) => InternalResource;

export function snapshotCopyOperation(operation: CopyOperation, index: number): InternalCopyOperation {
	const prefix = `Copy operation ${index}`;
	switch (operation.type) {
		case 'buffer-to-buffer':
			return { ...operation };
		case 'texture-to-texture':
			return {
				...operation,
				sourceOrigin: snapshotOrigin3D(operation.sourceOrigin, `${prefix} sourceOrigin`),
				destinationOrigin: snapshotOrigin3D(operation.destinationOrigin, `${prefix} destinationOrigin`),
				copySize: snapshotExtent3D(operation.copySize, `${prefix} copySize`),
			};
		case 'buffer-to-texture':
			return {
				...operation,
				sourceLayout: { ...operation.sourceLayout },
				destinationOrigin: snapshotOrigin3D(operation.destinationOrigin, `${prefix} destinationOrigin`),
				copySize: snapshotExtent3D(operation.copySize, `${prefix} copySize`),
			};
		case 'texture-to-buffer':
			return {
				...operation,
				sourceOrigin: snapshotOrigin3D(operation.sourceOrigin, `${prefix} sourceOrigin`),
				destinationLayout: { ...operation.destinationLayout },
				copySize: snapshotExtent3D(operation.copySize, `${prefix} copySize`),
			};
	}
}

export function defaultTextureCopyAspect(
	resourceFor: ResourceResolver,
	handle: TextureHandle,
): GPUTextureAspect {
	const desc = resourceFor(handle).desc as TextureDesc;
	if (desc.format === 'stencil8') {
		return 'stencil-only';
	}
	if (desc.format.includes('depth')) {
		return 'depth-only';
	}
	return 'all';
}

export function textureCopyRange(
	resourceFor: ResourceResolver,
	handle: TextureHandle,
	mipLevel: number | undefined,
	origin: GPUOrigin3D | undefined,
	copySize: GPUExtent3D,
	aspect: GPUTextureAspect | undefined,
): InternalTextureRegion {
	const [, , copyDepth] = textureSizeTuple(copySize);
	const [, , originZ] = originTuple(origin);
	const desc = resourceFor(handle).desc as TextureDesc;
	const dimension = desc.dimension ?? '2d';
	return {
		baseMipLevel: mipLevel ?? 0,
		mipLevelCount: 1,
		baseArrayLayer: dimension === '2d' ? originZ : 0,
		arrayLayerCount: dimension === '2d' ? copyDepth : 1,
		baseDepthSlice: dimension === '3d' ? originZ : 0,
		depthSliceCount: dimension === '3d' ? copyDepth : 1,
		aspect: aspect ?? defaultTextureCopyAspect(resourceFor, handle),
	};
}

export function textureCopyOverwritesSubresource(
	resourceFor: ResourceResolver,
	handle: TextureHandle,
	mipLevel: number | undefined,
	origin: GPUOrigin3D | undefined,
	copySize: GPUExtent3D,
): boolean {
	const [originX, originY] = originTuple(origin);
	const [copyWidth, copyHeight] = textureSizeTuple(copySize);
	const desc = resourceFor(handle).desc as TextureDesc;
	const [width, height] = textureSizeTuple(desc.size);
	const mip = mipLevel ?? 0;
	const mipWidth = Math.max(1, width >> mip);
	const mipHeight = (desc.dimension ?? '2d') === '1d' ? 1 : Math.max(1, height >> mip);
	return originX === 0
		&& originY === 0
		&& copyWidth === mipWidth
		&& copyHeight === mipHeight;
}

export function bufferTextureCopyRange(
	resourceFor: ResourceResolver,
	textureHandle: TextureHandle,
	layout: Omit<GPUTexelCopyBufferLayout, 'buffer'>,
	copySize: GPUExtent3D,
): BufferRange {
	return {
		offset: layout.offset ?? 0,
		size: bufferTextureCopyByteSize(resourceFor, textureHandle, layout, copySize),
	};
}

export function validateCopyNodeDescriptor(
	resourceFor: ResourceResolver,
	node: InternalNode,
): void {
	for (const operation of node.copyOperations ?? []) {
		switch (operation.type) {
			case 'buffer-to-buffer':
				validateBufferCopyRange(resourceFor, node, operation.source, operation.sourceOffset ?? 0, operation.size, 'source');
				validateBufferCopyRange(resourceFor, node, operation.destination, operation.destinationOffset ?? 0, operation.size, 'destination');
				validateBufferToBufferCopy(node, operation.source, operation.sourceOffset ?? 0, operation.destination, operation.destinationOffset ?? 0, operation.size);
				break;
			case 'texture-to-texture': {
				validateTextureCopyRange(resourceFor, operation.source, operation.sourceMipLevel, operation.sourceOrigin, operation.copySize, operation.sourceAspect);
				validateTextureCopyRange(resourceFor, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize, operation.destinationAspect);
				validateTextureToTextureCopy(resourceFor, node, operation);
				const sourceAspect = operation.sourceAspect ?? defaultTextureCopyAspect(resourceFor, operation.source);
				const destinationAspect = operation.destinationAspect ?? defaultTextureCopyAspect(resourceFor, operation.destination);
				if (sourceAspect !== destinationAspect) {
					throw new Error(`Copy node "${node.label ?? node.id}" texture-to-texture copy aspect mismatch: source aspect "${sourceAspect}" and destination aspect "${destinationAspect}" must match.`);
				}
				break;
			}
			case 'buffer-to-texture':
				validateTextureCopyRange(resourceFor, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize, operation.destinationAspect);
				validateBufferTextureLayout(resourceFor, node, operation.source, operation.destination, operation.sourceLayout, operation.copySize);
				break;
			case 'texture-to-buffer':
				validateTextureCopyRange(resourceFor, operation.source, operation.sourceMipLevel, operation.sourceOrigin, operation.copySize, operation.sourceAspect);
				validateBufferTextureLayout(resourceFor, node, operation.destination, operation.source, operation.destinationLayout, operation.copySize);
				break;
		}
	}
}

function validateBufferToBufferCopy(
	node: InternalNode,
	source: BufferHandle,
	sourceOffset: GPUSize64,
	destination: BufferHandle,
	destinationOffset: GPUSize64,
	size: GPUSize64,
): void {
	if (Number(sourceOffset) % 4 !== 0 || Number(destinationOffset) % 4 !== 0 || Number(size) % 4 !== 0) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-to-buffer copy from "${source.label ?? source.id}" to "${destination.label ?? destination.id}" must use 4-byte aligned sourceOffset, destinationOffset, and size. Received sourceOffset ${sourceOffset}, destinationOffset ${destinationOffset}, size ${size}.`);
	}
	if (sameResource(source, destination)) {
		const sourceRange = { offset: Number(sourceOffset), size: Number(size) };
		const destinationRange = { offset: Number(destinationOffset), size: Number(size) };
		if (bufferRangesOverlap(sourceRange, destinationRange)) {
			throw new Error(`Copy node "${node.label ?? node.id}" buffer-to-buffer copy ranges must not overlap when source and destination are the same buffer "${source.label ?? source.id}": source [${sourceRange.offset}, ${sourceRange.offset + sourceRange.size}) and destination [${destinationRange.offset}, ${destinationRange.offset + destinationRange.size}). WebGPU requires same-buffer copy ranges to be disjoint.`);
		}
	}
}

function validateTextureToTextureCopy(
	resourceFor: ResourceResolver,
	node: InternalNode,
	operation: Extract<InternalCopyOperation, { type: 'texture-to-texture' }>,
): void {
	const sourceDesc = resourceFor(operation.source).desc as TextureDesc;
	const destinationDesc = resourceFor(operation.destination).desc as TextureDesc;
	if (!areTextureCopyFormatsCompatible(sourceDesc.format, destinationDesc.format)) {
		throw new Error(`Copy node "${node.label ?? node.id}" texture-to-texture copy formats are not copy-compatible: source "${operation.source.label ?? operation.source.id}" uses "${sourceDesc.format}", destination "${operation.destination.label ?? operation.destination.id}" uses "${destinationDesc.format}". WebGPU texture copy formats must match or differ only by sRGB suffix.`);
	}
	if (sameResource(operation.source, operation.destination)) {
		const sourceRange = textureCopyRange(resourceFor, operation.source, operation.sourceMipLevel, operation.sourceOrigin, operation.copySize, operation.sourceAspect);
		const destinationRange = textureCopyRange(resourceFor, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize, operation.destinationAspect);
		if (textureSubresourcesAlias(sourceRange, destinationRange)) {
			throw new Error(`Copy node "${node.label ?? node.id}" texture-to-texture copy uses the same texture "${operation.source.label ?? operation.source.id}" with overlapping subresources; subresources must be disjoint. WebGPU requires same-texture copy subresources to be disjoint.`);
		}
	}
}

function validateBufferCopyRange(
	resourceFor: ResourceResolver,
	node: InternalNode,
	handle: BufferHandle,
	offset: GPUSize64,
	size: GPUSize64,
	role: 'source' | 'destination',
): void {
	const resource = resourceFor(handle);
	const desc = resource.desc as BufferDesc;
	const prefix = `Copy node "${node.label ?? node.id}" ${role} buffer "${handle.label ?? handle.id}"`;
	assertNonNegativeSafeInteger(offset, `${prefix} offset`);
	assertNonNegativeSafeInteger(size, `${prefix} size`);
	if (offset > desc.size || size > desc.size - offset) {
		throw new Error(`Buffer copy range exceeds buffer "${handle.label ?? handle.id}" size.`);
	}
}

function validateTextureCopyRange(
	resourceFor: ResourceResolver,
	handle: TextureHandle,
	mipLevel: number | undefined,
	origin: GPUOrigin3D | undefined,
	copySize: GPUExtent3D,
	aspect: GPUTextureAspect | undefined,
): void {
	const resource = resourceFor(handle);
	const desc = resource.desc as TextureDesc;
	const resolvedMipLevel = mipLevel ?? 0;
	const mipLevelCount = desc.mipLevelCount ?? 1;
	const prefix = `Texture copy range for "${handle.label ?? handle.id}"`;
	assertNonNegativeUint32(resolvedMipLevel, `${prefix} mipLevel`);
	const [originX, originY, originZ] = originTuple(origin);
	assertNonNegativeUint32(originX, `${prefix} origin.x`);
	assertNonNegativeUint32(originY, `${prefix} origin.y`);
	assertNonNegativeUint32(originZ, `${prefix} origin.z`);
	const [copyWidth, copyHeight, copyDepth] = textureSizeTuple(copySize);
	assertPositiveUint32(copyWidth, `${prefix} copySize.width`);
	assertPositiveUint32(copyHeight, `${prefix} copySize.height`);
	assertPositiveUint32(copyDepth, `${prefix} copySize.depthOrArrayLayers`);
	validateTextureCopyAspect(resourceFor, handle, aspect);
	if (resolvedMipLevel >= mipLevelCount) {
		throw new Error(`Texture copy range for "${handle.label ?? handle.id}" exceeds declared mip levels.`);
	}
	const [baseWidth, baseHeight, depthOrArrayLayers] = textureSizeTuple(desc.size);
	const width = Math.max(1, Math.floor(baseWidth / (2 ** resolvedMipLevel)));
	const height = Math.max(1, Math.floor(baseHeight / (2 ** resolvedMipLevel)));
	const depth = desc.dimension === '3d'
		? Math.max(1, Math.floor(depthOrArrayLayers / (2 ** resolvedMipLevel)))
		: depthOrArrayLayers;
	const blockInfo = getTextureFormatBlockInfo(desc.format);
	if (originX % blockInfo.width !== 0 || originY % blockInfo.height !== 0) {
		throw new Error(`Texture copy origin for "${handle.label ?? handle.id}" must align to texture format "${desc.format}" texel blocks.`);
	}
	if (copyWidth % blockInfo.width !== 0 || copyHeight % blockInfo.height !== 0) {
		throw new Error(`Texture copy size for "${handle.label ?? handle.id}" must align to texture format "${desc.format}" texel blocks.`);
	}
	const physicalWidth = Math.ceil(width / blockInfo.width) * blockInfo.width;
	const physicalHeight = Math.ceil(height / blockInfo.height) * blockInfo.height;
	if (originX + copyWidth > physicalWidth || originY + copyHeight > physicalHeight || originZ + copyDepth > depth) {
		throw new Error(`Texture copy range exceeds texture "${handle.label ?? handle.id}" size.`);
	}
}

function validateTextureCopyAspect(
	resourceFor: ResourceResolver,
	handle: TextureHandle,
	aspect: GPUTextureAspect | undefined,
): void {
	const desc = resourceFor(handle).desc as TextureDesc;
	const resolvedAspect = aspect ?? defaultTextureCopyAspect(resourceFor, handle);
	if (resolvedAspect === 'stencil-only' && !desc.format.includes('stencil')) {
		throw new Error(`Texture copy aspect "stencil-only" is not valid for texture "${handle.label ?? handle.id}".`);
	}
	if (resolvedAspect === 'depth-only' && !desc.format.includes('depth')) {
		throw new Error(`Texture copy aspect "depth-only" is not valid for texture "${handle.label ?? handle.id}".`);
	}
	if (resolvedAspect === 'all' && isDepthFormat(desc.format)) {
		throw new Error(`Texture copy aspect "all" is not valid for depth/stencil texture "${handle.label ?? handle.id}".`);
	}
}

function validateBufferTextureLayout(
	resourceFor: ResourceResolver,
	node: InternalNode,
	bufferHandle: BufferHandle,
	textureHandle: TextureHandle,
	layout: Omit<GPUTexelCopyBufferLayout, 'buffer'>,
	copySize: GPUExtent3D,
): void {
	const textureResource = resourceFor(textureHandle);
	const textureDesc = textureResource.desc as TextureDesc;
	const resource = resourceFor(bufferHandle);
	const desc = resource.desc as BufferDesc;
	const [copyWidth, copyHeight, copyDepth] = textureSizeTuple(copySize);
	const blockInfo = getTextureFormatBlockInfo(textureDesc.format);
	if (copyWidth % blockInfo.width !== 0 || copyHeight % blockInfo.height !== 0) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-texture copy for texture "${textureHandle.label ?? textureHandle.id}" size ${copyWidth}x${copyHeight} must align to format "${textureDesc.format}" texel blocks ${blockInfo.width}x${blockInfo.height}.`);
	}
	const widthInBlocks = copyWidth / blockInfo.width;
	const heightInBlocks = copyHeight / blockInfo.height;
	const bytesInLastRow = widthInBlocks * blockInfo.bytes;
	const bytesPerRow = layout.bytesPerRow;
	const prefix = `Copy node "${node.label ?? node.id}" buffer-texture layout for buffer "${bufferHandle.label ?? bufferHandle.id}"`;
	assertNonNegativeSafeInteger(layout.offset ?? 0, `${prefix} offset`);
	if (bytesPerRow !== undefined) {
		assertNonNegativeUint32(bytesPerRow, `${prefix} bytesPerRow`);
	}
	if (layout.rowsPerImage !== undefined) {
		assertNonNegativeUint32(layout.rowsPerImage, `${prefix} rowsPerImage`);
	}
	if (layout.offset !== undefined && Number(layout.offset) % blockInfo.bytes !== 0) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-texture copy offset must align to format "${textureDesc.format}" texel block size ${blockInfo.bytes} bytes; actual offset ${layout.offset} for buffer "${bufferHandle.label ?? bufferHandle.id}".`);
	}
	if (heightInBlocks > 1 && bytesPerRow === undefined) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-texture copy requires bytesPerRow because copied height is ${heightInBlocks} texel block rows.`);
	}
	if (copyDepth > 1 && (bytesPerRow === undefined || layout.rowsPerImage === undefined)) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-texture copy requires bytesPerRow and rowsPerImage because copy depth is ${copyDepth}.`);
	}
	if (bytesPerRow !== undefined && bytesPerRow % 256 !== 0) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-texture copy bytesPerRow must be 256-byte aligned; actual bytesPerRow ${bytesPerRow}.`);
	}
	if (bytesPerRow !== undefined && bytesPerRow < bytesInLastRow) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-texture copy bytesPerRow ${bytesPerRow} is smaller than the copied texture row ${bytesInLastRow} bytes.`);
	}
	if (layout.rowsPerImage !== undefined && layout.rowsPerImage < heightInBlocks) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-texture copy rowsPerImage ${layout.rowsPerImage} is smaller than copied height ${heightInBlocks} texel block rows.`);
	}
	const offset = Number(layout.offset ?? 0);
	const requiredBytesInCopy = bufferTextureCopyByteSize(resourceFor, textureHandle, layout, copySize);
	assertNonNegativeSafeInteger(requiredBytesInCopy, `${prefix} required byte size`);
	if (offset > desc.size || requiredBytesInCopy > desc.size - offset) {
		throw new Error(`Copy node "${node.label ?? node.id}" buffer-texture copy layout exceeds buffer "${bufferHandle.label ?? bufferHandle.id}" size: offset ${offset} + required bytes ${requiredBytesInCopy} > buffer size ${desc.size}.`);
	}
}

function bufferTextureCopyByteSize(
	resourceFor: ResourceResolver,
	textureHandle: TextureHandle,
	layout: Omit<GPUTexelCopyBufferLayout, 'buffer'>,
	copySize: GPUExtent3D,
): number {
	const textureDesc = resourceFor(textureHandle).desc as TextureDesc;
	const [copyWidth, copyHeight, copyDepth] = textureSizeTuple(copySize);
	const blockInfo = getTextureFormatBlockInfo(textureDesc.format);
	const widthInBlocks = copyWidth / blockInfo.width;
	const heightInBlocks = copyHeight / blockInfo.height;
	const bytesInLastRow = widthInBlocks * blockInfo.bytes;
	const bytesPerRow = layout.bytesPerRow;
	const rowsPerImage = layout.rowsPerImage ?? 0;
	let requiredBytesInCopy = 0;
	if (copyDepth > 0) {
		requiredBytesInCopy += (bytesPerRow ?? 0) * rowsPerImage * (copyDepth - 1);
		if (heightInBlocks > 0) {
			requiredBytesInCopy += (bytesPerRow ?? 0) * (heightInBlocks - 1) + bytesInLastRow;
		}
	}
	return requiredBytesInCopy;
}
