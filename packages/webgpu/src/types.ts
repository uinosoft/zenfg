/**
 * Declares how a graph node uses a texture.
 *
 * FrameGraph derives read/write ordering and required `GPUTextureUsage` flags
 * from these values. Read-write use is expressed as separate access entries.
 *
 * @beta
 */
export enum TextureAccess {
	/** Samples the texture through a texture binding. */
	Sampled = 'texture-sampled',
	/** Reads the texture through a storage texture binding. */
	StorageRead = 'texture-storage-read',
	/** Writes the texture through a storage texture binding. */
	StorageWrite = 'texture-storage-write',
	/** Writes a color attachment or resolve target. */
	ColorAttachmentWrite = 'texture-color-attachment-write',
	/** Reads a depth attachment without changing its stored depth. */
	DepthRead = 'texture-depth-read',
	/** Writes a depth attachment. */
	DepthWrite = 'texture-depth-write',
	/** Uses the texture as the source of a copy operation. */
	CopySrc = 'texture-copy-src',
	/** Uses the texture as the destination of a copy operation. */
	CopyDst = 'texture-copy-dst',
}

/**
 * Declares how a graph node uses a buffer.
 *
 * FrameGraph derives read/write ordering and required `GPUBufferUsage` flags
 * from these values. Read-write use is expressed as separate access entries.
 *
 * @beta
 */
export enum BufferAccess {
	/** Reads the buffer through a uniform binding. */
	Uniform = 'buffer-uniform',
	/** Reads the buffer through a read-only storage binding. */
	StorageRead = 'buffer-storage-read',
	/** Writes the buffer through a storage binding. */
	StorageWrite = 'buffer-storage-write',
	/** Reads the buffer as vertex input. */
	Vertex = 'buffer-vertex',
	/** Reads the buffer as index input. */
	Index = 'buffer-index',
	/** Reads indirect draw or dispatch arguments from the buffer. */
	Indirect = 'buffer-indirect',
	/** Uses the buffer as the source of a copy operation. */
	CopySrc = 'buffer-copy-src',
	/** Uses the buffer as the destination of a copy or clear operation. */
	CopyDst = 'buffer-copy-dst',
}

/**
 * The physical WebGPU resource category represented by a logical handle.
 *
 * @beta
 */
export type ResourceKind = 'texture' | 'buffer';

/**
 * How a graph resource obtains its physical WebGPU allocation.
 *
 * @beta
 */
export type ResourceOrigin = 'transient' | 'imported' | 'swapchain';

/** Whether a resource contains a graph-readable value when recording begins. */
export type InitialContents = 'defined' | 'undefined';

/**
 * The command-recording or submission behavior represented by a graph node.
 *
 * @beta
 */
export type NodeKind = 'render' | 'compute' | 'copy' | 'clear-buffer' | 'command' | 'external-submission';

/**
 * Identifies whether an execution segment is FrameGraph-owned or caller-owned.
 *
 * @beta
 */
export type FrameGraphExecutionSegmentKind = 'frame-graph' | 'external-submission';

/**
 * The ordering direction derived from a declared resource access.
 *
 * @beta
 */
export type ResourceAccessMode = 'read' | 'write';

/** Whether a write replaces or preserves the previous logical contents. */
export type WriteContents = 'overwrite' | 'preserve';

/** Required logical-content behavior for an explicit write use. */
export type WriteUseOptions = {
	/** Declares whether the write fully replaces or retains prior logical contents. */
	readonly contents: WriteContents;
};

/** Optional byte range for an explicit buffer use. */
export type BufferUseOptions = {
	/** Omitted ranges conservatively cover the full buffer. */
	readonly range?: BufferRange;
};

/** Byte range and logical-content behavior for an explicit buffer write. */
export type BufferWriteUseOptions = BufferUseOptions & WriteUseOptions;

/**
 * The retention reason that keeps a resource producer or side-effect node alive.
 *
 * @beta
 */
export type GraphRootReason = 'present' | 'output' | 'readback' | 'side-effect' | 'debug-capture' | 'persistent-state';

/**
 * The diagnostic reason reported for a node removed during compilation.
 *
 * @beta
 */
export type CulledNodeReason = 'not-reachable-from-root';

/**
 * A WebGPU extent accepted for a logical texture.
 *
 * One- and two-element sequences use WebGPU's omitted-dimension defaults.
 * Iterable sizes are materialized when the resource is registered.
 *
 * @beta
 */
export type TextureSize = GPUExtent3D | readonly [number, number] | readonly [number, number, number];

/**
 * A normalized texture subresource interval used for dependency analysis.
 *
 * @beta
 */
export type CompiledTextureRegion = {
	/** First mip level in the interval. */
	readonly baseMipLevel: number;
	/** Number of consecutive mip levels in the interval. */
	readonly mipLevelCount: number;
	/** First array layer for a 2D texture. */
	readonly baseArrayLayer?: number;
	/** Number of consecutive array layers for a 2D texture. */
	readonly arrayLayerCount?: number;
	/** First depth slice for a 3D texture. */
	readonly baseDepthSlice?: number;
	/** Number of consecutive depth slices for a 3D texture. */
	readonly depthSliceCount?: number;
	/** Texture aspect covered by the interval. */
	readonly aspect: GPUTextureAspect;
};

/**
 * A byte interval within a logical buffer.
 *
 * Offset and size must be non-negative safe integers. An omitted size extends
 * to the end of the buffer, and a zero-length range is valid.
 *
 * @beta
 */
export type BufferRange = {
	/** Byte offset from the start of the buffer. */
	readonly offset: GPUSize64;
	/** Number of bytes, or the remainder of the buffer when omitted. */
	readonly size?: GPUSize64;
};

/**
 * An opaque, stable logical texture identity owned by one FrameGraph recording.
 *
 * The handle is not a physical `GPUTexture` or an immutable value version. Node
 * recording order and the selected subresources determine which logical value an
 * access consumes or produces. A handle cannot be used by another recorder, and
 * recording APIs reject it after its recorder is consumed by `compile()`.
 *
 * @beta
 */
export type TextureHandle = {
	/** Graph-local diagnostic identifier. */
	readonly id: number;
	/** Resource discriminator. */
	readonly kind: 'texture';
	/** Optional diagnostic label copied from the descriptor. */
	readonly label?: string;
	/** Compile-time brand; callers must not construct handles manually. */
	readonly __brand: 'TextureHandle';
};

/**
 * An opaque logical view of a texture owned by one FrameGraph recording.
 *
 * The handle selects format, dimension, aspect, mip levels, and array layers,
 * but does not own a separate physical allocation or capture a logical value.
 * Its value is resolved from its node position just like its parent texture.
 *
 * @beta
 */
export type TextureViewHandle = {
	/** Graph-local diagnostic identifier. */
	readonly id: number;
	/** View discriminator. */
	readonly kind: 'texture-view';
	/** Optional diagnostic label copied from the descriptor. */
	readonly label?: string;
	/** Compile-time brand; callers must not construct handles manually. */
	readonly __brand: 'TextureViewHandle';
};

/**
 * An opaque, stable logical buffer identity owned by one FrameGraph recording.
 *
 * The handle is not a physical `GPUBuffer` or an immutable value version. Node
 * recording order and the selected byte range determine which logical value an
 * access consumes or produces. A handle cannot be used by another recorder, and
 * recording APIs reject it after its recorder is consumed by `compile()`.
 *
 * @beta
 */
export type BufferHandle = {
	/** Graph-local diagnostic identifier. */
	readonly id: number;
	/** Resource discriminator. */
	readonly kind: 'buffer';
	/** Optional diagnostic label copied from the descriptor. */
	readonly label?: string;
	/** Compile-time brand; callers must not construct handles manually. */
	readonly __brand: 'BufferHandle';
};

/**
 * A logical texture or buffer handle from one FrameGraph recording.
 *
 * @beta
 */
export type ResourceHandle = TextureHandle | BufferHandle;

/**
 * Describes a transient texture allocated and recycled by FrameGraph.
 *
 * FrameGraph snapshots the descriptor for the current recording, materializes
 * iterable sizes, and copies `viewFormats`. When `usage` is omitted, required
 * usage is derived from retained node accesses.
 *
 * @beta
 */
export type TextureDesc = {
	/** Optional label propagated to diagnostics and physical allocations. */
	readonly label?: string;
	/** WebGPU texture format. */
	readonly format: GPUTextureFormat;
	/** Additional compatible formats permitted when creating texture views. */
	readonly viewFormats?: readonly GPUTextureFormat[];
	/** Positive uint32 texture extent. */
	readonly size: TextureSize;
	/**
	 * Texture dimension.
	 *
	 * @defaultValue `'2d'`
	 */
	readonly dimension?: GPUTextureDimension;
	/**
	 * Positive mip level count within the extent-derived maximum.
	 *
	 * @defaultValue `1`
	 */
	readonly mipLevelCount?: number;
	/**
	 * Sample count `1` or `4`.
	 *
	 * @defaultValue `1`
	 */
	readonly sampleCount?: number;
	/** Explicit allocation usage, or derived usage when omitted. */
	readonly usage?: GPUTextureUsageFlags;
};

/**
 * Selects a logical view of a FrameGraph texture.
 *
 * View usage is intentionally omitted and derived from retained graph
 * accesses. Other defaults follow `GPUTexture.createView()`.
 *
 * @beta
 */
export type TextureViewDesc = {
	readonly label?: string;
	readonly format?: GPUTextureFormat;
	readonly dimension?: GPUTextureViewDimension;
	readonly aspect?: GPUTextureAspect;
	readonly baseMipLevel?: number;
	readonly mipLevelCount?: number;
	readonly baseArrayLayer?: number;
	readonly arrayLayerCount?: number;
	readonly swizzle?: string;
};

/**
 * Fully resolved recording-time metadata for a logical texture view.
 *
 * @beta
 */
export type NormalizedTextureViewDesc = {
	readonly texture: TextureHandle;
	readonly label?: string;
	readonly format: GPUTextureFormat;
	readonly dimension: GPUTextureViewDimension;
	readonly aspect: GPUTextureAspect;
	readonly baseMipLevel: number;
	readonly mipLevelCount: number;
	readonly baseArrayLayer: number;
	readonly arrayLayerCount: number;
	readonly swizzle: string;
};

/**
 * Configures how a caller-owned texture is exposed to FrameGraph.
 *
 * Physical metadata is read from the {@link GPUTexture}. `exposedUsage` may
 * narrow the texture's native usage for graph declarations, while
 * `viewFormats` declares alternate formats known to have been allowed when the
 * physical texture was created.
 *
 * @beta
 */
export type ImportTextureOptions = {
	/**
	 * Optional graph-local label.
	 *
	 * @defaultValue The native texture label.
	 */
	readonly label?: string;
	/** Alternate view formats available on the physical texture. */
	readonly viewFormats?: readonly GPUTextureFormat[];
	/**
	 * Graph-visible usage flags.
	 *
	 * @defaultValue The native texture usage.
	 */
	readonly exposedUsage?: GPUTextureUsageFlags;
	/**
	 * Initial logical-content state.
	 *
	 * @defaultValue `'defined'`
	 */
	readonly initialContents?: InitialContents;
};

/**
 * Describes a transient buffer allocated and recycled by FrameGraph.
 *
 * FrameGraph takes a shallow snapshot for the current recording. When `usage`
 * is omitted, required usage is derived from retained node accesses.
 *
 * @beta
 */
export type BufferDesc = {
	/** Optional label propagated to diagnostics and physical allocations. */
	readonly label?: string;
	/** Non-negative safe-integer buffer size in bytes. Zero is valid. */
	readonly size: number;
	/** Explicit allocation usage, or derived usage when omitted. */
	readonly usage?: GPUBufferUsageFlags;
};

/**
 * Configures how a caller-owned buffer is exposed to FrameGraph.
 *
 * Physical metadata is read from the {@link GPUBuffer}. `exposedSize` exposes
 * a prefix of the physical allocation and `exposedUsage` may narrow its native
 * usage for graph declarations.
 *
 * @beta
 */
export type ImportBufferOptions = {
	/**
	 * Optional graph-local label.
	 *
	 * @defaultValue The native buffer label.
	 */
	readonly label?: string;
	/**
	 * Graph-visible prefix size in bytes.
	 *
	 * @defaultValue The native buffer size.
	 */
	readonly exposedSize?: number;
	/**
	 * Graph-visible usage flags.
	 *
	 * @defaultValue The native buffer usage.
	 */
	readonly exposedUsage?: GPUBufferUsageFlags;
	/**
	 * Initial logical-content state.
	 *
	 * @defaultValue `'defined'`
	 */
	readonly initialContents?: InitialContents;
};

/**
 * Declares one texture dependency of a node.
 *
 * Raw handles use a role-specific default view. Explicit logical views preserve
 * their normalized descriptor and subresource range.
 *
 * @beta
 */
export type TextureViewAccess = Exclude<TextureAccess, TextureAccess.CopySrc | TextureAccess.CopyDst>;

type TextureReadAccess = TextureAccess.Sampled | TextureAccess.StorageRead | TextureAccess.DepthRead | TextureAccess.CopySrc;
type TextureWriteAccess = TextureAccess.StorageWrite | TextureAccess.ColorAttachmentWrite | TextureAccess.DepthWrite | TextureAccess.CopyDst;
type TextureViewReadAccess = Extract<TextureViewAccess, TextureReadAccess>;
type TextureViewWriteAccess = Extract<TextureViewAccess, TextureWriteAccess>;
type BufferReadAccess = Exclude<BufferAccess, BufferAccess.StorageWrite | BufferAccess.CopyDst>;
type BufferWriteAccess = BufferAccess.StorageWrite | BufferAccess.CopyDst;

export type TextureResourceAccess =
	| {
		/** Logical texture using the role-specific default view or raw copy range. */
		readonly resource: TextureHandle;
		/** Read operation performed on the texture. */
		readonly access: TextureReadAccess;
		readonly contents?: never;
	}
	| {
		/** Logical texture using the role-specific default view or raw copy range. */
		readonly resource: TextureHandle;
		/** Write operation performed on the texture. */
		readonly access: TextureWriteAccess;
		/** Required logical-content behavior for write access. */
		readonly contents: WriteContents;
	}
	| {
		/** Explicit logical texture view used by the node. */
		readonly resource: TextureViewHandle;
		/** View-based read operation performed on the texture. */
		readonly access: TextureViewReadAccess;
		readonly contents?: never;
	}
	| {
		/** Explicit logical texture view used by the node. */
		readonly resource: TextureViewHandle;
		/** View-based write operation performed on the texture. */
		readonly access: TextureViewWriteAccess;
		/** Required logical-content behavior for write access. */
		readonly contents: WriteContents;
	};

/**
 * Declares one buffer dependency of a node.
 *
 * An omitted range conservatively covers the full buffer.
 *
 * @beta
 */
export type BufferResourceAccess =
	| {
		/** Logical buffer read by the node. */
		readonly resource: BufferHandle;
		/** Read operation performed on the buffer. */
		readonly access: BufferReadAccess;
		/** Optional byte interval. */
		readonly bufferRange?: BufferRange;
		readonly contents?: never;
	}
	| {
		/** Logical buffer written by the node. */
		readonly resource: BufferHandle;
		/** Write operation performed on the buffer. */
		readonly access: BufferWriteAccess;
		/** Optional byte interval. */
		readonly bufferRange?: BufferRange;
		/** Required logical-content behavior for write access. */
		readonly contents: WriteContents;
	};

/**
 * A graph-visible texture or buffer dependency declared by a node.
 *
 * @beta
 */
export type ResourceAccess = TextureResourceAccess | BufferResourceAccess;

declare const resourceUseBrand: unique symbol;

type OpaqueResourceUse<TKind extends string, TAccess> = {
	readonly [resourceUseBrand]: {
		readonly kind: TKind;
		readonly access: TAccess;
	};
};

/**
 * Reusable texture-access declaration created by one recording.
 *
 * The token does not capture a logical value when created. Each node that lists
 * it resolves the visible value independently from that node's recording position.
 */
export type TextureUse<TAccess extends TextureAccess = TextureAccess> =
	OpaqueResourceUse<'texture-use', TAccess>;

/**
 * Reusable logical-view access declaration created by one recording.
 *
 * The view selects subresources but the token's value is resolved only when a
 * concrete node lists it.
 */
export type TextureViewUse<TAccess extends TextureViewAccess = TextureViewAccess> =
	OpaqueResourceUse<'texture-view-use', TAccess>;

/**
 * Reusable buffer-access declaration created by one recording.
 *
 * The token snapshots its byte range but resolves the visible logical value at
 * each concrete node that lists it.
 */
export type BufferUse<TAccess extends BufferAccess = BufferAccess> =
	OpaqueResourceUse<'buffer-use', TAccess>;

/** Any reusable resource-access declaration accepted by a graph node. */
export type ResourceUse = TextureUse | TextureViewUse | BufferUse;

/** Native WebGPU object produced by unwrapping a typed use token. */
export type UnwrappedResource<TUse extends ResourceUse> =
	TUse extends BufferUse ? GPUBuffer
		: TUse extends TextureViewUse ? GPUTextureView
			: TUse extends TextureUse<infer TAccess>
				? TAccess extends TextureAccess.CopySrc | TextureAccess.CopyDst ? GPUTexture : GPUTextureView
				: never;

/**
 * Describes one color attachment of a render-pass node.
 *
 * Attachment accesses are inferred from load/store operations and do not need
 * to be repeated in the node's `uses` list.
 *
 * @beta
 */
export type RenderColorAttachmentDesc = {
	/** Logical texture rendered into. */
	readonly target: TextureHandle | TextureViewHandle;
	/** Whether the existing attachment value is loaded or cleared. */
	readonly loadOp: GPULoadOp;
	/** Whether the rendered value is stored or discarded. */
	readonly storeOp: GPUStoreOp;
	/** Clear value used when `loadOp` is `"clear"`; snapshotted when the render node is recorded. */
	readonly clearValue?: GPUColor;
	/** Optional single-sampled resolve destination. */
	readonly resolveTarget?: TextureHandle | TextureViewHandle;
	/** Required z slice when rendering into a 3D texture view. */
	readonly depthSlice?: number;
};

type RenderDepthStencilAttachmentBaseDesc = {
	/** Logical depth texture rendered into or read from. */
	readonly target: TextureHandle | TextureViewHandle;
	/** Depth clear value; required for `depthLoadOp: 'clear'`. Reverse-z callers commonly use `0`. */
	readonly depthClearValue?: number;
};

/**
 * Describes the depth attachment of a render-pass node.
 *
 * FrameGraph currently accepts pure depth formats only. Formats containing a
 * stencil aspect are rejected when registered. Reverse-z clear and comparison
 * conventions remain caller-owned.
 *
 * @beta
 */
export type RenderDepthStencilAttachmentDesc = RenderDepthStencilAttachmentBaseDesc & (
	| {
		/** Reads depth without writing it. Load/store operations must be omitted. */
		readonly depthReadOnly: true;
		readonly depthLoadOp?: never;
		readonly depthStoreOp?: never;
	}
	| {
		/** Loads existing depth into a writable attachment. */
		readonly depthLoadOp: 'load';
		readonly depthStoreOp: GPUStoreOp;
		readonly depthReadOnly?: false;
	}
	| {
		/** Clears a writable depth attachment before rendering. */
		readonly depthLoadOp: 'clear';
		readonly depthStoreOp: GPUStoreOp;
		readonly depthClearValue: number;
		readonly depthReadOnly?: false;
	}
);

/**
 * Resource context shared by synchronous node callbacks while one retained node
 * is executing.
 *
 * Encoders and resolved transient resources are valid only for the synchronous
 * callback invocation and must not be retained.
 *
 * @beta
 */
type ResourceUnwrapContext = {
	/** Caller-provided logical frame index, defaulting to `0`. */
	readonly frameIndex: number;
	/** Device permanently bound to the FrameGraph instance. */
	readonly device: GPUDevice;
	/** Resolves a use listed by the active node and rejects any other use token. */
	unwrap<TUse extends ResourceUse>(use: TUse): UnwrappedResource<TUse>;
};

/** Context for a synchronous render-pass encode callback. */
export type RenderEncodeContext = ResourceUnwrapContext & {
	readonly pass: GPURenderPassEncoder;
};

/** Context for a synchronous compute-pass encode callback. */
export type ComputeEncodeContext = ResourceUnwrapContext & {
	readonly pass: GPUComputePassEncoder;
};

/** Context for caller-defined commands in a FrameGraph-owned segment. */
export type CommandEncodeContext = ResourceUnwrapContext & {
	readonly encoder: GPUCommandEncoder;
};

/**
 * Context passed to an opaque caller-owned queue submission callback.
 *
 * It provides no FrameGraph-owned command encoder. The callback must enqueue all
 * graph-visible work on this device's queue before returning, must not retain
 * resolved transient resources, and must not recursively execute, clear, or
 * destroy the same FrameGraph runtime. Queue submission does not imply GPU
 * completion.
 *
 * @beta
 */
export type ExternalSubmissionContext = ResourceUnwrapContext;

/**
 * Declares a render pass recorded through `beginRenderPass()`.
 *
 * @beta
 */
export type RenderPassNodeDesc = {
	/** Optional diagnostic label. */
	readonly label?: string;
	/** Color attachments whose graph accesses are inferred automatically. */
	readonly colorAttachments?: readonly RenderColorAttachmentDesc[];
	/** Optional depth attachment whose graph access is inferred automatically. */
	readonly depthStencilAttachment?: RenderDepthStencilAttachmentDesc;
	/** Additional sampled, storage, vertex, index, indirect, or copy dependencies. */
	readonly uses?: readonly ResourceUse[];
	/** Retains the node even when no marked root consumes its outputs. Defaults to `false`. */
	readonly sideEffect?: boolean;
	/** Synchronous render command callback. */
	readonly encode?: (ctx: RenderEncodeContext) => void;
};

/**
 * Declares a compute pass recorded through `beginComputePass()`.
 *
 * @beta
 */
export type ComputePassNodeDesc = {
	/** Optional diagnostic label. */
	readonly label?: string;
	/** Resources read or written by the compute pass. */
	readonly uses?: readonly ResourceUse[];
	/** Retains the node even when no marked root consumes its outputs. Defaults to `false`. */
	readonly sideEffect?: boolean;
	/** Synchronous compute command callback. */
	readonly encode?: (ctx: ComputeEncodeContext) => void;
};

/**
 * A declarative WebGPU copy operation recorded by FrameGraph.
 *
 * Copy ranges must satisfy WebGPU alignment and texture format block rules.
 * Source and destination handles must belong to the current recording.
 *
 * @beta
 */
export type CopyOperation =
	| {
		/** Copies texture subresources. */
		readonly type: 'texture-to-texture';
		/** Source texture. */
		readonly source: TextureHandle;
		/** Destination texture. */
		readonly destination: TextureHandle;
		/** Source mip level; defaults to `0`. */
		readonly sourceMipLevel?: number;
		/** Destination mip level; defaults to `0`. */
		readonly destinationMipLevel?: number;
		/** Source aspect; defaults from the source format. */
		readonly sourceAspect?: GPUTextureAspect;
		/** Destination aspect; defaults from the destination format. */
		readonly destinationAspect?: GPUTextureAspect;
		/** Source origin; defaults to zero. */
		readonly sourceOrigin?: GPUOrigin3D;
		/** Destination origin; defaults to zero. */
		readonly destinationOrigin?: GPUOrigin3D;
		/** Extent copied between the selected subresources. */
		readonly copySize: GPUExtent3D;
	}
	| {
		/** Copies a byte range between buffers. */
		readonly type: 'buffer-to-buffer';
		/** Source buffer. */
		readonly source: BufferHandle;
		/** Destination buffer. */
		readonly destination: BufferHandle;
		/** Source byte offset; defaults to `0`. */
		readonly sourceOffset?: GPUSize64;
		/** Destination byte offset; defaults to `0`. */
		readonly destinationOffset?: GPUSize64;
		/** Number of bytes copied. */
		readonly size: GPUSize64;
	}
	| {
		/** Copies texel data from a buffer into a texture. */
		readonly type: 'buffer-to-texture';
		/** Source buffer. */
		readonly source: BufferHandle;
		/** Destination texture. */
		readonly destination: TextureHandle;
		/** Destination mip level; defaults to `0`. */
		readonly destinationMipLevel?: number;
		/** Destination aspect; defaults from the destination format. */
		readonly destinationAspect?: GPUTextureAspect;
		/** Buffer layout excluding the logical buffer handle. */
		readonly sourceLayout: Omit<GPUTexelCopyBufferLayout, 'buffer'>;
		/** Destination origin; defaults to zero. */
		readonly destinationOrigin?: GPUOrigin3D;
		/** Texture extent copied. */
		readonly copySize: GPUExtent3D;
	}
	| {
		/** Copies texel data from a texture into a buffer. */
		readonly type: 'texture-to-buffer';
		/** Source texture. */
		readonly source: TextureHandle;
		/** Destination buffer. */
		readonly destination: BufferHandle;
		/** Source mip level; defaults to `0`. */
		readonly sourceMipLevel?: number;
		/** Source aspect; defaults from the source format. */
		readonly sourceAspect?: GPUTextureAspect;
		/** Source origin; defaults to zero. */
		readonly sourceOrigin?: GPUOrigin3D;
		/** Buffer layout excluding the logical buffer handle. */
		readonly destinationLayout: Omit<GPUTexelCopyBufferLayout, 'buffer'>;
		/** Texture extent copied. */
		readonly copySize: GPUExtent3D;
	};

/**
 * Declares one node containing ordered copy operations.
 *
 * FrameGraph snapshots each operation and materializes texture extents and
 * origins when the node is added.
 *
 * @beta
 */
export type CopyNodeDesc = {
	/** Optional diagnostic label. */
	readonly label?: string;
	/** Copy commands recorded in array order. */
	readonly operations: readonly CopyOperation[];
	/** Retains the node when its results are otherwise unused. Defaults to `false`. */
	readonly sideEffect?: boolean;
};

/**
 * Describes one `GPUCommandEncoder.clearBuffer()` operation.
 *
 * @beta
 */
export type ClearBufferOperation = {
	/** Buffer cleared to zero. */
	readonly target: BufferHandle;
	/** Starting byte offset; defaults to `0`. */
	readonly offset?: GPUSize64;
	/** Number of bytes, or the remainder of the buffer when omitted. */
	readonly size?: GPUSize64;
};

/**
 * Declares one node containing ordered buffer-clear operations.
 *
 * FrameGraph snapshots every operation when the node is added.
 *
 * @beta
 */
export type ClearBufferNodeDesc = {
	/** Optional diagnostic label. */
	readonly label?: string;
	/** Buffer clears recorded in array order. */
	readonly operations: readonly ClearBufferOperation[];
	/** Retains the node when its results are otherwise unused. Defaults to `false`. */
	readonly sideEffect?: boolean;
};

/**
 * Declares caller-defined commands in a FrameGraph-owned command segment.
 *
 * Command nodes default to a side effect because their commands are opaque to
 * dependency analysis.
 *
 * @beta
 */
export type CommandNodeDesc = {
	/** Optional diagnostic label. */
	readonly label?: string;
	/** Resources accessed by the encoded commands. */
	readonly uses?: readonly ResourceUse[];
	/** Whether the command node is a retention root. Defaults to `true`. */
	readonly sideEffect?: boolean;
	/** Synchronous command-recording callback. */
	readonly encode?: (ctx: CommandEncodeContext) => void;
};

/**
 * Declares an opaque caller-owned queue submission node.
 *
 * When retained, FrameGraph ends its current command segment before invoking
 * `submit` and starts a later segment for following retained graph nodes. This
 * is a submission-order boundary, not a GPU-completion fence.
 *
 * @beta
 */
export type ExternalSubmissionNodeDesc = {
	/** Optional diagnostic label. */
	readonly label?: string;
	/**
	 * Complete graph-visible resource accesses made by the external work,
	 * including imported resources reached through external-owner references.
	 */
	readonly uses?: readonly ResourceUse[];
	/**
	 * Whether this opaque node is a retention root. Defaults to `true`; an
	 * unreachable `false` node is culled and creates no execution boundary.
	 */
	readonly sideEffect?: boolean;
	/**
	 * Must enqueue all graph-visible GPU work on `ctx.device.queue` before
	 * returning. Resolved transient resources must not escape the callback.
	 * FrameGraph ignores the return value and does not await this callback.
	 */
	readonly submit: (ctx: ExternalSubmissionContext) => void;
};

type FrameGraphCompilationAccessBase = {
	readonly id: number;
	readonly nodeId: number;
	readonly resourceId: number;
	readonly access: TextureAccess | BufferAccess;
	readonly textureViewId?: number;
	readonly textureRegion?: CompiledTextureRegion;
	readonly bufferRange?: BufferRange;
	readonly order?: number;
};

/** One normalized graph-visible resource access in a compilation report. */
export type FrameGraphCompilationAccess = FrameGraphCompilationAccessBase & (
	| {
		readonly mode: 'read';
		readonly producesValue: false;
		readonly contents?: never;
	}
	| {
		readonly mode: 'write';
		readonly contents: WriteContents;
		readonly producesValue: boolean;
	}
);

type FrameGraphCompilationResourceBase = {
	readonly id: number;
	readonly label?: string;
	readonly origin: ResourceOrigin;
	/** Logical-content state before the first graph-visible access. */
	readonly initialContents: InitialContents;
	/** Diagnostic group in which this resource was registered. */
	readonly debugGroupId?: number;
	/** Effective allocation usage; inferred flags include retained accesses only. */
	readonly usage: GPUTextureUsageFlags | GPUBufferUsageFlags;
	readonly lifetime?: {
		readonly firstUse: number;
		readonly lastUse: number;
	};
	readonly physicalAllocationId?: number;
	/**
	 * Estimated graph-visible bytes. Texture estimates include format blocks,
	 * mip levels, samples, and extent, but not driver alignment or overhead.
	 */
	readonly estimatedByteSize: number;
};

type FrameGraphCompilationResource = FrameGraphCompilationResourceBase & (
	| {
		readonly kind: 'texture';
		readonly descriptor: {
			readonly format: GPUTextureFormat;
			readonly size: {
				readonly width: number;
				readonly height: number;
				readonly depthOrArrayLayers: number;
			};
			readonly dimension: GPUTextureDimension;
			readonly mipLevelCount: number;
			readonly sampleCount: number;
			readonly viewFormats: readonly GPUTextureFormat[];
		};
	}
	| {
		readonly kind: 'buffer';
		readonly descriptor: {
			/** Logical graph-visible size, before resource-pool bucketing. */
			readonly size: number;
		};
	}
);

/**
 * Optional diagnostic projection of a compiled FrameGraph recording.
 *
 * @beta
 */
export type FrameGraphCompilationReport = {
	/** Retained nodes in execution order. */
	readonly nodes: readonly {
		readonly id: number;
		/** Original node position in the consumed recording. */
		readonly recordingOrder: number;
		readonly kind: NodeKind;
		readonly label?: string;
		readonly sideEffect: boolean;
		/** Recording-time diagnostic group containing this node. */
		readonly debugGroupId?: number;
	}[];
	/** Nodes removed by dead-node elimination. */
	readonly culledNodes: readonly {
		readonly id: number;
		/** Original node position in the consumed recording. */
		readonly recordingOrder: number;
		readonly kind: NodeKind;
		readonly label?: string;
		readonly sideEffect: boolean;
		/** Recording-time diagnostic group containing this node. */
		readonly debugGroupId?: number;
		readonly reason: CulledNodeReason;
	}[];
	/** Logical resources referenced by the compiled recording. */
	readonly resources: readonly FrameGraphCompilationResource[];
	/** Explicit logical texture views referenced by retained or culled accesses. */
	readonly textureViews: readonly {
		readonly id: number;
		readonly resourceId: number;
		readonly label?: string;
		readonly format: GPUTextureFormat;
		readonly dimension: GPUTextureViewDimension;
		readonly aspect: GPUTextureAspect;
		readonly baseMipLevel: number;
		readonly mipLevelCount: number;
		readonly baseArrayLayer: number;
		readonly arrayLayerCount: number;
		readonly swizzle: string;
	}[];
	/** Recording-time diagnostic hierarchy in group-open order. Group ids are local to this report. */
	readonly debugGroups: readonly {
		readonly id: number;
		readonly parentId?: number;
		readonly label: string;
	}[];
	/** Canonical access table for retained and culled nodes. */
	readonly accesses: readonly FrameGraphCompilationAccess[];
	/** Retained-node dependencies. */
	readonly dependencies: readonly {
		readonly fromNodeId: number;
		readonly toNodeId: number;
		readonly resourceId: number;
		readonly kind: 'value' | 'ordering';
	}[];
	/** Reasons graph work was retained. */
	readonly roots: readonly {
		readonly reason: GraphRootReason;
		readonly nodeId?: number;
		readonly resourceId?: number;
	}[];
	/** Physical transient allocations, without allocator-private keys. */
	readonly allocations: readonly {
		readonly id: number;
		readonly kind: ResourceKind;
		readonly compatibilityClassId: number;
		/** Estimated physical bytes for this allocation; aliases are counted once. */
		readonly estimatedByteSize: number;
	}[];
	/** Ordered FrameGraph and external-submission boundaries. */
	readonly executionSegments: readonly {
		readonly index: number;
		readonly kind: FrameGraphExecutionSegmentKind;
		readonly nodeIds: readonly number[];
	}[];
};

/** Aggregate transient resource-pool counters. */
export type FrameGraphResourcePoolStats = {
	readonly acquireCount: number;
	readonly reuseCount: number;
	readonly createdCount: number;
	readonly retainedCount: number;
	readonly estimatedRetainedBytes: number;
};

/** GPU timing result returned by `execute({ gpuTiming: true })`. */
export type FrameGraphGpuTimingReport =
	| {
		readonly status: 'available';
		readonly frameIndex: number;
		readonly frameDurationMicros: number;
		readonly nodes: readonly {
			readonly nodeId: number;
			readonly kind: 'render' | 'compute';
			readonly label?: string;
			readonly durationMicros: number;
		}[];
	}
	| {
		readonly status: 'unavailable';
		readonly frameIndex: number;
		readonly reason: 'unsupported' | 'busy' | 'readback-failed';
	};

/**
 * Context passed to `beforeSubmit` for one FrameGraph-owned command segment.
 *
 * The command encoder is valid only during the synchronous callback.
 *
 * @beta
 */
export type CompiledFrameSubmitContext = {
	/** Device permanently bound to the FrameGraph instance. */
	readonly device: GPUDevice;
	/** Encoder that will be finished and submitted after the callback returns. */
	readonly commandEncoder: GPUCommandEncoder;
	/** Caller-provided logical frame index. */
	readonly frameIndex: number;
	/** Zero-based index among FrameGraph-owned command segments. */
	readonly segmentIndex: number;
	/** Total number of FrameGraph-owned command segments in this execution. */
	readonly segmentCount: number;
};

/**
 * Context passed once after every retained execution segment has succeeded.
 *
 * Queue submission has occurred, but GPU completion is not implied.
 *
 * @beta
 */
export type CompiledFrameAfterSubmitContext = {
	/** Device permanently bound to the FrameGraph instance. */
	readonly device: GPUDevice;
	/** Caller-provided logical frame index. */
	readonly frameIndex: number;
};

/**
 * Optional per-execution hooks and diagnostic identity supplied to
 * {@link CompiledFrame.execute}.
 *
 * Recording and compilation of another frame remain valid during these hooks.
 * Recursive execution, pool clearing, and runtime destruction are rejected.
 *
 * @beta
 */
export type CompiledFrameExecuteOptions = {
	/**
	 * Logical frame identifier used by callbacks and GPU timing reports.
	 *
	 * @defaultValue `0`
	 */
	readonly frameIndex?: number;
	/**
	 * Emits retained recording groups through WebGPU debug commands. Groups are
	 * balanced independently per FrameGraph-owned execution segment; opaque
	 * external submissions are not wrapped.
	 *
	 * @defaultValue `false`
	 */
	readonly gpuDebugGroups?: boolean;
	/**
	 * Records caller-owned commands after graph nodes have been encoded and
	 * before the command buffer is finished and submitted. This callback must
	 * complete synchronously; its return value is ignored and not awaited.
	 */
	readonly beforeSubmit?: (ctx: CompiledFrameSubmitContext) => void;
	/**
	 * Runs after queue submission and before transient resources are released
	 * back to the pool. This callback must complete synchronously; its return
	 * value is ignored and not awaited.
	 */
	readonly afterSubmit?: (ctx: CompiledFrameAfterSubmitContext) => void;
};

/**
 * Runtime-facing graph recording capability exposed to renderer features.
 *
 * Handles are stable recording-local resource identities. Logical values are
 * resolved from resource range and node recording position, not handle creation
 * or use-token creation order.
 */
export interface FrameGraphRecording {
	/**
	 * Opens a distinct diagnostic-only group for subsequently registered
	 * resources and nodes. Labels need not be unique.
	 */
	pushDebugGroup(label: string): void;
	/** Closes the innermost diagnostic group. */
	popDebugGroup(): void;
	/**
	 * Runs synchronous recording work inside a distinct diagnostic-only group.
	 * Promise-like return values are rejected. Labels need not be unique.
	 */
	withDebugGroup<T>(
		label: string,
		record: () => (T extends PromiseLike<unknown> ? never : T),
	): T;
	/**
	 * Registers a transient texture owned by this recording.
	 *
	 * @remarks The descriptor is snapshotted and physical allocation is deferred
	 * until execution.
	 * @throws If the descriptor is invalid, or the runtime/recorder is unusable.
	 */
	createTexture(desc: TextureDesc): TextureHandle;
	/** Returns snapshotted metadata for a texture owned by this recording. */
	getTextureDesc(handle: TextureHandle): Readonly<TextureDesc>;
	/** Creates a logical view whose subresource selection participates in dependencies. */
	createTextureView(texture: TextureHandle, desc?: TextureViewDesc): TextureViewHandle;
	/** Returns normalized metadata for a logical texture view. */
	getTextureViewDesc(handle: TextureViewHandle): Readonly<NormalizedTextureViewDesc>;
	/** Registers a transient buffer owned by this recording. */
	createBuffer(desc: BufferDesc): BufferHandle;
	/** Returns snapshotted metadata for a buffer owned by this recording. */
	getBufferDesc(handle: BufferHandle): Readonly<BufferDesc>;
	/**
	 * Borrows a caller-owned texture with fixed identity for this recording.
	 *
	 * @remarks Ownership and destruction remain with the caller.
	 * @throws If the exposure options conflict with the native texture.
	 */
	importTexture(texture: GPUTexture, options?: ImportTextureOptions): TextureHandle;
	/**
	 * Borrows the current swapchain texture; call `markPresent()` separately and
	 * execute the compiled frame while that borrowed texture remains current.
	 */
	importSwapchainTexture(texture: GPUTexture, options?: ImportTextureOptions): TextureHandle;
	/** Borrows a caller-owned buffer with fixed identity for this recording. */
	importBuffer(buffer: GPUBuffer, options?: ImportBufferOptions): BufferHandle;
	/** Creates a reusable texture-read declaration resolved at each node that lists it. */
	use<TAccess extends TextureReadAccess>(resource: TextureHandle, access: TAccess): TextureUse<TAccess>;
	/** Creates a reusable texture-write declaration resolved at each node that lists it. */
	use<TAccess extends TextureWriteAccess>(resource: TextureHandle, access: TAccess, options: WriteUseOptions): TextureUse<TAccess>;
	/** Creates a reusable read declaration for a subresource-selecting logical view. */
	use<TAccess extends TextureViewReadAccess>(resource: TextureViewHandle, access: TAccess): TextureViewUse<TAccess>;
	/** Creates a reusable write declaration for a subresource-selecting logical view. */
	use<TAccess extends TextureViewWriteAccess>(resource: TextureViewHandle, access: TAccess, options: WriteUseOptions): TextureViewUse<TAccess>;
	/** Creates a reusable buffer-read declaration and snapshots its optional byte range. */
	use<TAccess extends BufferReadAccess>(resource: BufferHandle, access: TAccess, options?: BufferUseOptions): BufferUse<TAccess>;
	/** Creates a reusable buffer-write declaration with range and content semantics. */
	use<TAccess extends BufferWriteAccess>(resource: BufferHandle, access: TAccess, options: BufferWriteUseOptions): BufferUse<TAccess>;
	/**
	 * Declares a render-pass node.
	 *
	 * @throws If an attachment, declared use, or encode callback contract is invalid.
	 */
	render(desc: RenderPassNodeDesc): void;
	/** Declares a compute-pass node. */
	compute(desc: ComputePassNodeDesc): void;
	/** Declares inferred-access copy operations. */
	copy(desc: CopyNodeDesc): void;
	/** Declares inferred-access buffer clears. */
	clearBuffer(desc: ClearBufferNodeDesc): void;
	/** Declares caller-defined commands encoded into a FrameGraph-owned segment. */
	command(desc: CommandNodeDesc): void;
	/**
	 * Declares an opaque caller-owned submission node; retained nodes split
	 * execution segments.
	 *
	 * @remarks The callback is an ordering boundary, not a GPU-completion fence.
	 */
	externalSubmission(desc: ExternalSubmissionNodeDesc): void;
	/** Retains the final visible producer of a swapchain texture for presentation. */
	markPresent(resource: TextureHandle): void;
	/**
	 * Marks the final logical value of a texture or buffer as a required graph output.
	 *
	 * This marker only retains the value's visible producers. It does not return,
	 * unwrap, transfer ownership of, or extend the execution lifetime of a
	 * transient physical resource. Post-execution access requires caller-owned
	 * imported storage.
	 */
	markOutput(resource: ResourceHandle): void;
	/** Retains the final producer of caller-owned state needed by a later frame. */
	markPersistentState(resource: ResourceHandle): void;
	/**
	 * Retains the final visible producer of a caller-owned staging buffer imported
	 * with graph-visible `GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ`.
	 */
	markReadback(resource: BufferHandle): void;
	/** Retains the final visible producer of a resource for debug capture. */
	markDebugCapture(resource: ResourceHandle): void;
}

/**
 * Executable result of one consumed recording. It may be re-executed only while
 * its captured callbacks and borrowed GPU resources remain valid.
 */
export interface CompiledFrame {
	/**
	 * Executes synchronously without GPU timestamp readback.
	 *
	 * @throws If encoding, submission, or a callback fails; the runtime was
	 * destroyed; or another compiled frame is executing.
	 */
	execute(options?: CompiledFrameExecuteOptions & { readonly gpuTiming?: false }): void;
	/**
	 * Executes synchronously and returns a promise for GPU timestamp readback.
	 *
	 * @remarks An unsupported or busy timestamp implementation resolves to an
	 * `unavailable` report rather than rejecting solely for that condition.
	 * @throws Synchronously if encoding, submission, or a callback fails; the
	 * runtime was destroyed; or another compiled frame is executing.
	 */
	execute(options: CompiledFrameExecuteOptions & { readonly gpuTiming: true }): Promise<FrameGraphGpuTimingReport>;
	execute(options: CompiledFrameExecuteOptions & { readonly gpuTiming?: boolean }): void | Promise<FrameGraphGpuTimingReport>;
}

/** Compiled frame carrying an opt-in readonly diagnostic snapshot. */
export interface CompiledFrameWithReport extends CompiledFrame {
	readonly compilationReport: FrameGraphCompilationReport;
}

/** Application-facing single-use ordered recording object. */
export interface FrameGraphRecorder extends FrameGraphRecording {
	/**
	 * Consumes this recorder and resolves ordered logical values into a compact,
	 * conditionally re-executable payload.
	 *
	 * @remarks The recorder is consumed atomically even when compilation fails.
	 * @throws If declarations are inconsistent or invalid, a debug group remains
	 * open, the runtime was destroyed, or this recorder was already consumed.
	 */
	compile(): CompiledFrame;
	compile(options: { readonly report?: false }): CompiledFrame;
	/** Consumes this recorder and also returns a callback-free diagnostic snapshot. */
	compile(options: { readonly report: true }): CompiledFrameWithReport;
}
