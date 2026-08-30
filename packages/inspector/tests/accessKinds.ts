export const TextureAccess = {
	Sampled: 'texture-sampled',
	StorageRead: 'texture-storage-read',
	StorageWrite: 'texture-storage-write',
	ColorAttachmentWrite: 'texture-color-attachment-write',
	DepthRead: 'texture-depth-read',
	DepthWrite: 'texture-depth-write',
	CopySrc: 'texture-copy-src',
	CopyDst: 'texture-copy-dst',
} as const;

export const BufferAccess = {
	Uniform: 'buffer-uniform',
	StorageRead: 'buffer-storage-read',
	StorageWrite: 'buffer-storage-write',
	Vertex: 'buffer-vertex',
	Index: 'buffer-index',
	Indirect: 'buffer-indirect',
	CopySrc: 'buffer-copy-src',
	CopyDst: 'buffer-copy-dst',
} as const;
