import type {
	NormalizedTextureViewDesc,
	TextureDesc,
	TextureHandle,
	TextureViewDesc,
} from './types.ts';
import type { InternalTextureRegion } from './internalTypes.ts';
import { textureSizeTuple } from './resourceDescriptors.ts';

export type TextureViewDefaultRole = 'generic' | 'storage' | 'color-attachment' | 'resolve-target' | 'depth-attachment';

export type NormalizedTextureView = {
	readonly desc: NormalizedTextureViewDesc;
	readonly descriptor: GPUTextureViewDescriptor;
	readonly region: InternalTextureRegion;
};

export function normalizeTextureView(
	texture: TextureHandle,
	textureDesc: TextureDesc,
	viewDesc: TextureViewDesc | undefined,
	role: TextureViewDefaultRole = 'generic',
): NormalizedTextureView {
	const textureDimension = textureDesc.dimension ?? '2d';
	const [, , depthOrArrayLayers] = textureSizeTuple(textureDesc.size);
	const baseMipLevel = viewDesc?.baseMipLevel ?? 0;
	const baseArrayLayer = viewDesc?.baseArrayLayer ?? 0;
	const dimension = viewDesc?.dimension ?? defaultViewDimension(textureDimension, depthOrArrayLayers, role);
	const mipLevelCount = viewDesc?.mipLevelCount
		?? (role === 'generic' ? (textureDesc.mipLevelCount ?? 1) - baseMipLevel : 1);
	const arrayLayerCount = viewDesc?.arrayLayerCount
		?? defaultArrayLayerCount(dimension, depthOrArrayLayers, baseArrayLayer, role);
	const aspect = viewDesc?.aspect ?? (role === 'depth-attachment' ? 'depth-only' : 'all');
	const format = viewDesc?.format ?? textureDesc.format;
	const swizzle = viewDesc?.swizzle ?? 'rgba';
	const normalizedDesc: NormalizedTextureViewDesc = {
		texture,
		label: viewDesc?.label,
		format,
		dimension,
		aspect,
		baseMipLevel,
		mipLevelCount,
		baseArrayLayer,
		arrayLayerCount,
		swizzle,
	};
	const descriptor: GPUTextureViewDescriptor = {
		label: normalizedDesc.label,
		format,
		dimension,
		aspect,
		baseMipLevel,
		mipLevelCount,
		baseArrayLayer,
		arrayLayerCount,
		...(swizzle !== 'rgba' ? { swizzle } : {}),
	};
	const mipDepth = textureDimension === '3d'
		? Math.max(1, depthOrArrayLayers >> Math.max(0, baseMipLevel))
		: 1;
	return {
		desc: normalizedDesc,
		descriptor,
		region: {
			baseMipLevel,
			mipLevelCount,
			baseArrayLayer: textureDimension === '2d' ? baseArrayLayer : 0,
			arrayLayerCount: textureDimension === '2d' ? arrayLayerCount : 1,
			baseDepthSlice: 0,
			depthSliceCount: mipDepth,
			aspect,
		},
	};
}

function defaultViewDimension(
	textureDimension: GPUTextureDimension,
	depthOrArrayLayers: number,
	role: TextureViewDefaultRole,
): GPUTextureViewDimension {
	if (role === 'color-attachment' || role === 'resolve-target' || role === 'depth-attachment') {
		return textureDimension === '3d' && role === 'color-attachment' ? '3d' : '2d';
	}
	if (textureDimension === '1d') {
		return '1d';
	}
	if (textureDimension === '3d') {
		return '3d';
	}
	return depthOrArrayLayers === 1 ? '2d' : '2d-array';
}

function defaultArrayLayerCount(
	dimension: GPUTextureViewDimension,
	depthOrArrayLayers: number,
	baseArrayLayer: number,
	role: TextureViewDefaultRole,
): number {
	if (role === 'color-attachment' || role === 'resolve-target' || role === 'depth-attachment') {
		return 1;
	}
	switch (dimension) {
		case '2d-array':
		case 'cube-array':
			return depthOrArrayLayers - baseArrayLayer;
		case 'cube':
			return 6;
		default:
			return 1;
	}
}
