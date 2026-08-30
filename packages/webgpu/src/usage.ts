import {
	BufferAccess,
	type ResourceAccessMode,
	TextureAccess,
} from './types.ts';

export function textureAccessMode(access: TextureAccess): ResourceAccessMode {
	switch (access) {
		case TextureAccess.Sampled:
		case TextureAccess.StorageRead:
		case TextureAccess.DepthRead:
		case TextureAccess.CopySrc:
			return 'read';
		case TextureAccess.StorageWrite:
		case TextureAccess.ColorAttachmentWrite:
		case TextureAccess.DepthWrite:
		case TextureAccess.CopyDst:
			return 'write';
	}
}

export function bufferAccessMode(access: BufferAccess): ResourceAccessMode {
	switch (access) {
		case BufferAccess.Uniform:
		case BufferAccess.StorageRead:
		case BufferAccess.Vertex:
		case BufferAccess.Index:
		case BufferAccess.Indirect:
		case BufferAccess.CopySrc:
			return 'read';
		case BufferAccess.StorageWrite:
		case BufferAccess.CopyDst:
			return 'write';
	}
}

const textureUsage = {
	COPY_SRC: 0x01,
	COPY_DST: 0x02,
	TEXTURE_BINDING: 0x04,
	STORAGE_BINDING: 0x08,
	RENDER_ATTACHMENT: 0x10,
} as const;

const bufferUsage = {
	MAP_READ: 0x0001,
	MAP_WRITE: 0x0002,
	COPY_SRC: 0x0004,
	COPY_DST: 0x0008,
	INDEX: 0x0010,
	VERTEX: 0x0020,
	UNIFORM: 0x0040,
	STORAGE: 0x0080,
	INDIRECT: 0x0100,
	QUERY_RESOLVE: 0x0200,
} as const;

function textureUsageFlag(flag: keyof typeof textureUsage): GPUTextureUsageFlags {
	return (globalThis.GPUTextureUsage?.[flag] ?? textureUsage[flag]) as GPUTextureUsageFlags;
}

export function bufferUsageFlag(flag: keyof typeof bufferUsage): GPUBufferUsageFlags {
	return (globalThis.GPUBufferUsage?.[flag] ?? bufferUsage[flag]) as GPUBufferUsageFlags;
}

export function textureAccessUsage(access: TextureAccess): GPUTextureUsageFlags {
	switch (access) {
		case TextureAccess.Sampled:
			return textureUsageFlag('TEXTURE_BINDING');
		case TextureAccess.StorageRead:
		case TextureAccess.StorageWrite:
			return textureUsageFlag('STORAGE_BINDING');
		case TextureAccess.ColorAttachmentWrite:
		case TextureAccess.DepthRead:
		case TextureAccess.DepthWrite:
			return textureUsageFlag('RENDER_ATTACHMENT');
		case TextureAccess.CopySrc:
			return textureUsageFlag('COPY_SRC');
		case TextureAccess.CopyDst:
			return textureUsageFlag('COPY_DST');
	}
}

export function bufferAccessUsage(access: BufferAccess): GPUBufferUsageFlags {
	switch (access) {
		case BufferAccess.Uniform:
			return bufferUsageFlag('UNIFORM');
		case BufferAccess.StorageRead:
		case BufferAccess.StorageWrite:
			return bufferUsageFlag('STORAGE');
		case BufferAccess.Vertex:
			return bufferUsageFlag('VERTEX');
		case BufferAccess.Index:
			return bufferUsageFlag('INDEX');
		case BufferAccess.Indirect:
			return bufferUsageFlag('INDIRECT');
		case BufferAccess.CopySrc:
			return bufferUsageFlag('COPY_SRC');
		case BufferAccess.CopyDst:
			return bufferUsageFlag('COPY_DST');
	}
}
