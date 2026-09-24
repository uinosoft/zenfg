import { FRAME_GRAPH_ERROR_CODES, FrameGraphError, type FrameGraphErrorOptions } from './error.ts';
import { BufferAccess, TextureAccess } from './types.ts';

export const textureAccessValues = new Set<string>(Object.values(TextureAccess));
export const bufferAccessValues = new Set<string>(Object.values(BufferAccess));

export type TextureFormatBlockInfo = {
	readonly width: number;
	readonly height: number;
	readonly bytes: number;
};

export type TextureFormatKind = 'color' | 'depth' | 'stencil' | 'depth-stencil' | 'compressed' | 'unknown';

export type TextureFormatInfo = {
	readonly format: GPUTextureFormat;
	readonly kind: TextureFormatKind;
	readonly blockInfo?: TextureFormatBlockInfo;
};

type TextureFormatInfoInit = Omit<TextureFormatInfo, 'format'>;

const textureFormatInfo = new Map<GPUTextureFormat, TextureFormatInfo>();

// FrameGraph tracks format aspects and texel blocks for dependency ranges and
// byte footprints. Device-dependent usage capabilities remain native WebGPU validation.
const plainColorFormatList = [
	'r8unorm',
	'r8snorm',
	'r8uint',
	'r8sint',
	'r16unorm',
	'r16snorm',
	'r16uint',
	'r16sint',
	'r16float',
	'rg8unorm',
	'rg8snorm',
	'rg8uint',
	'rg8sint',
	'r32uint',
	'r32sint',
	'r32float',
	'rg16unorm',
	'rg16snorm',
	'rg16uint',
	'rg16sint',
	'rg16float',
	'rgba8unorm',
	'rgba8unorm-srgb',
	'rgba8snorm',
	'rgba8uint',
	'rgba8sint',
	'bgra8unorm',
	'bgra8unorm-srgb',
	'rgb9e5ufloat',
	'rgb10a2uint',
	'rgb10a2unorm',
	'rg11b10ufloat',
	'rg32uint',
	'rg32sint',
	'rg32float',
	'rgba16unorm',
	'rgba16snorm',
	'rgba16uint',
	'rgba16sint',
	'rgba16float',
	'rgba32uint',
	'rgba32sint',
	'rgba32float',
] as const satisfies readonly GPUTextureFormat[];

const depthTextureFormatList = [
	'depth16unorm',
	'depth24plus',
	'depth32float',
] as const satisfies readonly GPUTextureFormat[];

const depthStencilTextureFormatList = [
	'depth24plus-stencil8',
	'depth32float-stencil8',
] as const satisfies readonly GPUTextureFormat[];

const stencilTextureFormatList = [
	'stencil8',
] as const satisfies readonly GPUTextureFormat[];

function registerFormat(format: GPUTextureFormat, init: TextureFormatInfoInit): void {
	textureFormatInfo.set(format, {
		format,
		...init,
	});
}

function updateFormat(format: GPUTextureFormat, init: Partial<TextureFormatInfoInit>): void {
	const current = textureFormatInfo.get(format) ?? {
		format,
		kind: 'unknown',
	};
	textureFormatInfo.set(format, {
		...current,
		...init,
	});
}

for (const format of plainColorFormatList) {
	registerFormat(format, {
		kind: 'color',
	});
}

for (const format of depthTextureFormatList) {
	updateFormat(format, {
		kind: 'depth',
	});
}

for (const format of depthStencilTextureFormatList) {
	updateFormat(format, {
		kind: 'depth-stencil',
	});
}

for (const format of stencilTextureFormatList) {
	updateFormat(format, { kind: 'stencil' });
}

function addBlockInfo(formats: readonly GPUTextureFormat[], info: TextureFormatBlockInfo): void {
	for (const format of formats) {
		updateFormat(format, { blockInfo: info });
	}
}

addBlockInfo([
	'r8unorm',
	'r8snorm',
	'r8uint',
	'r8sint',
	'stencil8',
], { width: 1, height: 1, bytes: 1 });

addBlockInfo([
	'r16unorm',
	'r16snorm',
	'r16uint',
	'r16sint',
	'r16float',
	'rg8unorm',
	'rg8snorm',
	'rg8uint',
	'rg8sint',
	'depth16unorm',
], { width: 1, height: 1, bytes: 2 });

addBlockInfo([
	'r32uint',
	'r32sint',
	'r32float',
	'rg16unorm',
	'rg16snorm',
	'rg16uint',
	'rg16sint',
	'rg16float',
	'rgba8unorm',
	'rgba8unorm-srgb',
	'rgba8snorm',
	'rgba8uint',
	'rgba8sint',
	'bgra8unorm',
	'bgra8unorm-srgb',
	'rgb9e5ufloat',
	'rgb10a2uint',
	'rgb10a2unorm',
	'rg11b10ufloat',
	'depth24plus',
	'depth32float',
], { width: 1, height: 1, bytes: 4 });

addBlockInfo([
	'rg32uint',
	'rg32sint',
	'rg32float',
	'rgba16unorm',
	'rgba16snorm',
	'rgba16uint',
	'rgba16sint',
	'rgba16float',
], { width: 1, height: 1, bytes: 8 });

addBlockInfo([
	'rgba32uint',
	'rgba32sint',
	'rgba32float',
], { width: 1, height: 1, bytes: 16 });

addBlockInfo([
	'bc1-rgba-unorm',
	'bc1-rgba-unorm-srgb',
	'bc4-r-unorm',
	'bc4-r-snorm',
	'etc2-rgb8unorm',
	'etc2-rgb8unorm-srgb',
	'etc2-rgb8a1unorm',
	'etc2-rgb8a1unorm-srgb',
	'eac-r11unorm',
	'eac-r11snorm',
], { width: 4, height: 4, bytes: 8 });

addBlockInfo([
	'bc2-rgba-unorm',
	'bc2-rgba-unorm-srgb',
	'bc3-rgba-unorm',
	'bc3-rgba-unorm-srgb',
	'bc5-rg-unorm',
	'bc5-rg-snorm',
	'bc6h-rgb-ufloat',
	'bc6h-rgb-float',
	'bc7-rgba-unorm',
	'bc7-rgba-unorm-srgb',
	'etc2-rgba8unorm',
	'etc2-rgba8unorm-srgb',
	'eac-rg11unorm',
	'eac-rg11snorm',
], { width: 4, height: 4, bytes: 16 });

for (const [format, info] of textureFormatInfo) {
	if (info.blockInfo && (format.startsWith('bc') || format.startsWith('etc') || format.startsWith('eac'))) {
		updateFormat(format, { kind: 'compressed' });
	}
}

function astcBlockInfo(format: GPUTextureFormat): TextureFormatBlockInfo | undefined {
	const astc = /^astc-(\d+)x(\d+)-unorm(?:-srgb)?$/.exec(format);
	if (!astc) {
		return undefined;
	}
	return {
		width: Number(astc[1]),
		height: Number(astc[2]),
		bytes: 16,
	};
}

function stripSrgbSuffix(format: GPUTextureFormat): string {
	return format.endsWith('-srgb') ? format.slice(0, -'-srgb'.length) : format;
}

export function getTextureFormatInfo(format: GPUTextureFormat): TextureFormatInfo {
	const info = textureFormatInfo.get(format);
	if (info) {
		return info;
	}
	const blockInfo = astcBlockInfo(format);
	if (blockInfo) {
		return {
			format,
			kind: 'compressed',
			blockInfo,
		};
	}
	return {
		format,
		kind: 'unknown',
	};
}

export function getTextureFormatBlockInfo(format: GPUTextureFormat, options: FrameGraphErrorOptions = { phase: 'compile' }): TextureFormatBlockInfo {
	const blockInfo = getTextureFormatInfo(format).blockInfo;
	if (blockInfo) {
		return blockInfo;
	}
	throw new FrameGraphError(FRAME_GRAPH_ERROR_CODES.UnsupportedTextureFormatUsage, `Unsupported texture format "${format}" for buffer-texture copy validation.`, options);
}

export function isDepthFormat(format: GPUTextureFormat): boolean {
	const kind = getTextureFormatInfo(format).kind;
	return kind === 'depth' || kind === 'depth-stencil' || kind === 'stencil';
}

export function hasStencilAspect(format: GPUTextureFormat): boolean {
	const kind = getTextureFormatInfo(format).kind;
	return kind === 'stencil' || kind === 'depth-stencil';
}

export function areTextureViewFormatsCompatible(textureFormat: GPUTextureFormat, viewFormat: GPUTextureFormat): boolean {
	return textureFormat === viewFormat || stripSrgbSuffix(textureFormat) === stripSrgbSuffix(viewFormat);
}

export function areTextureCopyFormatsCompatible(source: GPUTextureFormat, destination: GPUTextureFormat): boolean {
	return source === destination || stripSrgbSuffix(source) === stripSrgbSuffix(destination);
}
