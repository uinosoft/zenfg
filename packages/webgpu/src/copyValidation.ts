import type {
	BufferDesc,
	BufferHandle,
	BufferRange,
	CopyOperation,
	ResourceHandle,
	TextureDesc,
	TextureHandle,
} from './types.ts';
import { getTextureFormatBlockInfo, getTextureFormatInfo } from './formatCaps.ts';
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
import { FRAME_GRAPH_ERROR_CODES, FrameGraphError } from './error.ts';
import type {
	InternalNode,
	InternalCopyOperation,
	InternalResource,
	InternalTextureRegion,
} from './internalTypes.ts';

export type ResourceResolver = (handle: ResourceHandle) => InternalResource;

export function snapshotCopyOperation(operation: CopyOperation, index: number): InternalCopyOperation {
	const prefix = `Copy operation ${index}`;
	switch (operation.type) {
		case 'buffer-to-buffer':
			return { ...operation };
		case 'texture-to-texture':
			return {
				...operation,
				sourceOrigin: snapshotOrigin3D(operation.sourceOrigin, `${prefix} sourceOrigin`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'record', resourceId: operation.source.id }),
				destinationOrigin: snapshotOrigin3D(operation.destinationOrigin, `${prefix} destinationOrigin`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'record', resourceId: operation.destination.id }),
				copySize: snapshotExtent3D(operation.copySize, `${prefix} copySize`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'record' }),
			};
		case 'buffer-to-texture':
			return {
				...operation,
				sourceLayout: { ...operation.sourceLayout },
				destinationOrigin: snapshotOrigin3D(operation.destinationOrigin, `${prefix} destinationOrigin`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'record', resourceId: operation.destination.id }),
				copySize: snapshotExtent3D(operation.copySize, `${prefix} copySize`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'record' }),
			};
		case 'texture-to-buffer':
			return {
				...operation,
				sourceOrigin: snapshotOrigin3D(operation.sourceOrigin, `${prefix} sourceOrigin`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'record', resourceId: operation.source.id }),
				destinationLayout: { ...operation.destinationLayout },
				copySize: snapshotExtent3D(operation.copySize, `${prefix} copySize`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'record' }),
			};
	}
}

export function defaultTextureCopyAspect(
	resourceFor: ResourceResolver,
	handle: TextureHandle,
): GPUTextureAspect {
	const desc = resourceFor(handle).desc as TextureDesc;
	switch (getTextureFormatInfo(desc.format).kind) {
		case 'stencil':
			return 'stencil-only';
		case 'depth':
		case 'depth-stencil':
			return 'depth-only';
		default:
			return 'all';
	}
}

function textureCopyAspectForRange(
	resourceFor: ResourceResolver,
	handle: TextureHandle,
	aspect: GPUTextureAspect | undefined,
): GPUTextureAspect {
	if (aspect === undefined || aspect === 'all') {
		return aspect ?? defaultTextureCopyAspect(resourceFor, handle);
	}
	const kind = getTextureFormatInfo((resourceFor(handle).desc as TextureDesc).format).kind;
	if (aspect === 'depth-only' && (kind === 'depth' || kind === 'depth-stencil')) {
		return aspect;
	}
	if (aspect === 'stencil-only' && (kind === 'stencil' || kind === 'depth-stencil')) {
		return aspect;
	}
	// Keep invalid native aspects conservative in the graph model. WebGPU still
	// receives the original aspect and remains responsible for rejecting it.
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
		aspect: textureCopyAspectForRange(resourceFor, handle, aspect),
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
		size: bufferTextureCopyByteSize(resourceFor, 'record', textureHandle, layout, copySize),
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
				break;
			case 'texture-to-texture': {
				validateTextureCopyRange(resourceFor, node, operation.source, operation.sourceMipLevel, operation.sourceOrigin, operation.copySize);
				validateTextureCopyRange(resourceFor, node, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize);
				break;
			}
			case 'buffer-to-texture':
				validateTextureCopyRange(resourceFor, node, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize);
				validateBufferTextureLayout(resourceFor, node, operation.source, operation.destination, operation.sourceLayout, operation.copySize);
				break;
			case 'texture-to-buffer':
				validateTextureCopyRange(resourceFor, node, operation.source, operation.sourceMipLevel, operation.sourceOrigin, operation.copySize);
				validateBufferTextureLayout(resourceFor, node, operation.destination, operation.source, operation.destinationLayout, operation.copySize);
				break;
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
	assertNonNegativeSafeInteger(offset, `${prefix} offset`, { code: FRAME_GRAPH_ERROR_CODES.InvalidBufferRange, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	assertNonNegativeSafeInteger(size, `${prefix} size`, { code: FRAME_GRAPH_ERROR_CODES.InvalidBufferRange, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	if (offset > desc.size || size > desc.size - offset) {
		throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.InvalidBufferRange, `Buffer copy range exceeds buffer "${handle.label ?? handle.id}" size.`, { phase: 'compile', nodeId: node.id, resourceId: handle.id });
	}
}

function validateTextureCopyRange(
	resourceFor: ResourceResolver,
	node: InternalNode,
	handle: TextureHandle,
	mipLevel: number | undefined,
	origin: GPUOrigin3D | undefined,
	copySize: GPUExtent3D,
): void {
	const resource = resourceFor(handle);
	const desc = resource.desc as TextureDesc;
	const resolvedMipLevel = mipLevel ?? 0;
	const mipLevelCount = desc.mipLevelCount ?? 1;
	const prefix = `Texture copy range for "${handle.label ?? handle.id}"`;
	assertNonNegativeUint32(resolvedMipLevel, `${prefix} mipLevel`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	const [originX, originY, originZ] = originTuple(origin);
	assertNonNegativeUint32(originX, `${prefix} origin.x`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	assertNonNegativeUint32(originY, `${prefix} origin.y`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	assertNonNegativeUint32(originZ, `${prefix} origin.z`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	const [copyWidth, copyHeight, copyDepth] = textureSizeTuple(copySize);
	assertPositiveUint32(copyWidth, `${prefix} copySize.width`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	assertPositiveUint32(copyHeight, `${prefix} copySize.height`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	assertPositiveUint32(copyDepth, `${prefix} copySize.depthOrArrayLayers`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: handle.id });
	if (resolvedMipLevel >= mipLevelCount) {
		throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, `Texture copy range for "${handle.label ?? handle.id}" exceeds declared mip levels.`, { phase: 'compile', nodeId: node.id, resourceId: handle.id });
	}
	const [baseWidth, baseHeight, depthOrArrayLayers] = textureSizeTuple(desc.size);
	const width = Math.max(1, Math.floor(baseWidth / (2 ** resolvedMipLevel)));
	const height = Math.max(1, Math.floor(baseHeight / (2 ** resolvedMipLevel)));
	const depth = desc.dimension === '3d'
		? Math.max(1, Math.floor(depthOrArrayLayers / (2 ** resolvedMipLevel)))
		: depthOrArrayLayers;
	const blockInfo = getTextureFormatInfo(desc.format).blockInfo;
	const physicalWidth = blockInfo ? Math.ceil(width / blockInfo.width) * blockInfo.width : width;
	const physicalHeight = blockInfo ? Math.ceil(height / blockInfo.height) * blockInfo.height : height;
	if (originX + copyWidth > physicalWidth || originY + copyHeight > physicalHeight || originZ + copyDepth > depth) {
		throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, `Texture copy range exceeds texture "${handle.label ?? handle.id}" size.`, { phase: 'compile', nodeId: node.id, resourceId: handle.id });
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
	const resource = resourceFor(bufferHandle);
	const desc = resource.desc as BufferDesc;
	const prefix = `Copy node "${node.label ?? node.id}" buffer-texture layout for buffer "${bufferHandle.label ?? bufferHandle.id}"`;
	assertNonNegativeSafeInteger(layout.offset ?? 0, `${prefix} offset`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: bufferHandle.id, context: { textureResourceId: textureHandle.id } });
	const bytesPerRow = layout.bytesPerRow;
	if (bytesPerRow !== undefined) {
		assertNonNegativeUint32(bytesPerRow, `${prefix} bytesPerRow`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: bufferHandle.id, context: { textureResourceId: textureHandle.id } });
	}
	if (layout.rowsPerImage !== undefined) {
		assertNonNegativeUint32(layout.rowsPerImage, `${prefix} rowsPerImage`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: bufferHandle.id, context: { textureResourceId: textureHandle.id } });
	}
	const offset = Number(layout.offset ?? 0);
	const requiredBytesInCopy = bufferTextureCopyByteSize(resourceFor, 'compile', textureHandle, layout, copySize);
	assertNonNegativeSafeInteger(requiredBytesInCopy, `${prefix} required byte size`, { code: FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, phase: 'compile', nodeId: node.id, resourceId: bufferHandle.id, context: { textureResourceId: textureHandle.id } });
	if (offset > desc.size || requiredBytesInCopy > desc.size - offset) {
		throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.InvalidNodeOperation, `Copy node "${node.label ?? node.id}" buffer-texture copy layout exceeds buffer "${bufferHandle.label ?? bufferHandle.id}" size: offset ${offset} + required bytes ${requiredBytesInCopy} > buffer size ${desc.size}.`, { phase: 'compile', nodeId: node.id, resourceId: bufferHandle.id, context: { textureResourceId: textureHandle.id } });
	}
}

function bufferTextureCopyByteSize(
	resourceFor: ResourceResolver,
	phase: 'record' | 'compile',
	textureHandle: TextureHandle,
	layout: Omit<GPUTexelCopyBufferLayout, 'buffer'>,
	copySize: GPUExtent3D,
): number {
	const textureDesc = resourceFor(textureHandle).desc as TextureDesc;
	const [copyWidth, copyHeight, copyDepth] = textureSizeTuple(copySize);
	const blockInfo = getTextureFormatBlockInfo(textureDesc.format, { phase, resourceId: textureHandle.id });
	const widthInBlocks = Math.ceil(copyWidth / blockInfo.width);
	const heightInBlocks = Math.ceil(copyHeight / blockInfo.height);
	const bytesInLastRow = widthInBlocks * blockInfo.bytes;
	const bytesPerRow = Math.max(layout.bytesPerRow ?? 0, bytesInLastRow);
	const rowsPerImage = Math.max(layout.rowsPerImage ?? 0, heightInBlocks);
	let requiredBytesInCopy = 0;
	if (copyDepth > 0) {
		requiredBytesInCopy += bytesPerRow * rowsPerImage * (copyDepth - 1);
		if (heightInBlocks > 0) {
			requiredBytesInCopy += bytesPerRow * (heightInBlocks - 1) + bytesInLastRow;
		}
	}
	return requiredBytesInCopy;
}
