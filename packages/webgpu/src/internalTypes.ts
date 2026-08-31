import type {
	BufferAccess,
	BufferDesc,
	BufferRange,
	BufferHandle,
	ClearBufferOperation,
	CommandEncodeContext,
	ComputeEncodeContext,
	CopyOperation,
	ExternalSubmissionContext,
	NodeKind,
	RenderEncodeContext,
	ResourceAccess,
	ResourceAccessMode,
	ResourceHandle,
	ResourceKind,
	ResourceOrigin,
	SynchronousCallback,
	InitialContents,
	TextureDesc,
	TextureAccess,
	TextureHandle,
	TextureViewAccess,
	TextureViewHandle,
	NormalizedTextureViewDesc,
	WriteContents,
} from './types.ts';

type InternalUseBase = {
	readonly owner: object;
	readonly accesses: readonly InternalAccess[];
};

export type InternalUse = InternalUseBase & (
	| {
		readonly kind: 'texture-use';
		readonly access: TextureAccess;
		readonly handle: TextureHandle;
	}
	| {
		readonly kind: 'texture-view-use';
		readonly access: TextureViewAccess;
		readonly handle: TextureViewHandle;
	}
	| {
		readonly kind: 'buffer-use';
		readonly access: BufferAccess;
		readonly handle: BufferHandle;
	}
);

export type InternalTextureRegion = {
	readonly baseMipLevel: number;
	readonly mipLevelCount: number;
	readonly baseArrayLayer: number;
	readonly arrayLayerCount: number;
	readonly baseDepthSlice: number;
	readonly depthSliceCount: number;
	readonly aspect: GPUTextureAspect;
};

export type InternalTextureView = {
	readonly handle: TextureViewHandle;
	readonly texture: TextureHandle;
	readonly desc: NormalizedTextureViewDesc;
	readonly descriptor: GPUTextureViewDescriptor;
	readonly region: InternalTextureRegion;
	requiredUsage: GPUTextureUsageFlags;
};

export type InternalResource =
	| {
		readonly handle: TextureHandle;
		readonly origin: ResourceOrigin;
		readonly initialContents: InitialContents;
		readonly desc: TextureDesc;
		readonly physical?: GPUTexture;
		requiredUsage: GPUTextureUsageFlags;
	}
	| {
		readonly handle: BufferHandle;
		readonly origin: ResourceOrigin;
		readonly initialContents: InitialContents;
		readonly desc: BufferDesc;
		readonly physical?: GPUBuffer;
		requiredUsage: GPUBufferUsageFlags;
	};

export type InternalAccess = {
	readonly resource: ResourceHandle;
	readonly access: ResourceAccess['access'];
	readonly mode: ResourceAccessMode;
	readonly consumesPreviousValue: boolean;
	readonly producesValue: boolean;
	readonly contents?: WriteContents;
	readonly textureView?: TextureViewHandle;
	readonly textureViewDescriptor?: GPUTextureViewDescriptor;
	readonly textureRegion?: InternalTextureRegion;
	readonly bufferRange?: BufferRange;
};

export type InternalRenderColorAttachment = {
	readonly target: TextureHandle;
	readonly textureView?: TextureViewHandle;
	readonly loadOp: GPULoadOp;
	readonly storeOp: GPUStoreOp;
	readonly clearValue?: GPUColorDict;
	readonly resolveTarget?: TextureHandle;
	readonly resolveTextureView?: TextureViewHandle;
	readonly depthSlice?: number;
	readonly targetViewDescriptor: GPUTextureViewDescriptor;
	readonly textureRegion: InternalTextureRegion;
	readonly resolveTargetViewDescriptor?: GPUTextureViewDescriptor;
	readonly resolveTextureRegion?: InternalTextureRegion;
};

export type InternalRenderDepthStencilAttachment = {
	readonly target: TextureHandle;
	readonly textureView?: TextureViewHandle;
	readonly depthClearValue?: number;
	readonly depthLoadOp?: GPULoadOp;
	readonly depthStoreOp?: GPUStoreOp;
	readonly depthReadOnly?: boolean;
	readonly targetViewDescriptor: GPUTextureViewDescriptor;
	readonly textureRegion: InternalTextureRegion;
};

export type InternalNode = {
	readonly id: number;
	readonly kind: NodeKind;
	readonly label?: string;
	readonly accesses: readonly InternalAccess[];
	readonly uses: readonly InternalUse[];
	readonly sideEffect: boolean;
	readonly renderPass?: {
		readonly colorAttachments: readonly InternalRenderColorAttachment[];
		readonly depthStencilAttachment?: InternalRenderDepthStencilAttachment;
	};
	readonly copyOperations?: readonly CopyOperation[];
	readonly clearBufferOperations?: readonly ClearBufferOperation[];
	readonly renderEncode?: SynchronousCallback<RenderEncodeContext>;
	readonly computeEncode?: SynchronousCallback<ComputeEncodeContext>;
	readonly commandEncode?: SynchronousCallback<CommandEncodeContext>;
	readonly externalSubmit?: SynchronousCallback<ExternalSubmissionContext>;
};

export type PhysicalAllocation = {
	readonly id: number;
	readonly kind: ResourceKind;
	readonly key: string;
	readonly resourceIds: readonly number[];
};
