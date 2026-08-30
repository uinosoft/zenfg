import {
	BufferAccess,
	type BufferDesc,
	type BufferHandle,
	type BufferRange,
	type BufferUse,
	type BufferUseOptions,
	type BufferWriteUseOptions,
	type ClearBufferNodeDesc,
	type ClearBufferOperation,
	type CommandEncodeContext,
	type CommandNodeDesc,
	type CompiledFrame,
	type CompiledFrameExecuteOptions,
	type CompiledFrameWithReport,
	type ComputeEncodeContext,
	type ComputePassNodeDesc,
	type CopyNodeDesc,
	type CopyOperation,
	type ExternalSubmissionContext,
	type ExternalSubmissionNodeDesc,
	type FrameGraphRecorder,
	type FrameGraphCompilationReport,
	type FrameGraphGpuTimingReport,
	type FrameGraphResourcePoolStats,
	type GraphRootReason,
	type NodeKind,
	type RenderPassNodeDesc,
	type RenderEncodeContext,
	type ResourceAccess,
	type ResourceHandle,
	type ResourceUse,
	type TextureDesc,
	type TextureHandle,
	type TextureUse,
	type TextureViewAccess,
	type TextureViewDesc,
	type TextureViewHandle,
	type TextureViewUse,
	type UnwrappedResource,
	type WriteContents,
	type WriteUseOptions,
	type NormalizedTextureViewDesc,
	TextureAccess,
	type ImportBufferOptions,
	type ImportTextureOptions,
} from './types.ts';
import {
	bufferAccessValues,
	getTextureFormatCapabilities,
	areTextureViewFormatsCompatible,
	hasStencilAspect,
	isColorRenderableFormat,
	isDepthFormat,
	textureAccessValues,
} from './formatCaps.ts';
import {
	bufferAllocationSize,
	bufferPoolKey,
	snapshotTextureDescriptor,
	texturePoolKey,
	textureRenderExtent,
	textureSizeTuple,
} from './resourceDescriptors.ts';
import {
	assertNonNegativeSafeInteger,
	assertNonNegativeUint32,
	assertPositiveUint32,
} from './numericValidation.ts';
import {
	makeBufferHandle,
	makeTextureHandle,
	makeTextureViewHandle,
	isHandleOwnedBy,
	sameResource,
} from './handles.ts';
import type {
	InternalAccess,
	InternalNode,
	InternalResource,
	InternalTextureRegion,
	InternalTextureView,
	InternalUse,
} from './internalTypes.ts';
import { ResourcePool } from './resourcePool.ts';
import {
	bufferAccessMode,
	bufferAccessUsage,
	bufferUsageFlag,
	textureAccessMode,
	textureAccessUsage,
} from './usage.ts';
import {
	abortGpuTimingFrame,
	beginGpuTimingFrame,
	createGpuProfilerState,
	destroyGpuProfiler,
	gpuTimingTimestampWrites,
	readGpuTimingFrame,
	resolveGpuTimingFrame,
	type GpuProfilerState,
	type GpuTimingNodeQuery,
} from './gpuProfiler.ts';
import {
	bufferTextureCopyRange,
	defaultTextureCopyAspect,
	snapshotCopyOperation,
	textureCopyOverwritesSubresource,
	textureCopyRange,
	validateCopyNodeDescriptor,
} from './copyValidation.ts';
import {
	compileFrameGraph,
	resolveBufferRange,
	resolveTextureAccessRange,
	textureRegionsOverlap,
	type InternalCompiledPlan,
} from './graphCompiler.ts';
import {
	normalizeTextureView,
	type NormalizedTextureView,
	type TextureViewDefaultRole,
} from './textureViews.ts';

type RenderAttachmentCompatibility = {
	readonly handle: TextureHandle;
	readonly baseMipLevel: number;
	readonly extent: readonly [number, number];
	readonly sampleCount: number;
};

type InternalExecuteContext = {
	readonly frameIndex: number;
	readonly device: GPUDevice;
	readonly commandEncoder: GPUCommandEncoder;
	resolveTexture(handle: TextureHandle): GPUTexture;
	resolveTextureView(handle: TextureViewHandle): GPUTextureView;
	resolveTextureView(handle: TextureHandle, access: TextureViewAccess): GPUTextureView;
	resolveBuffer(handle: BufferHandle): GPUBuffer;
	unwrap<TUse extends ResourceUse>(use: TUse): UnwrappedResource<TUse>;
	invalidate(): void;
};

function formatUsageFlags(flags: number | undefined): string {
	return `0x${(flags ?? 0).toString(16)}`;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return value !== null
		&& (typeof value === 'object' || typeof value === 'function')
		&& typeof (value as { readonly then?: unknown }).then === 'function';
}

function snapshotColor(value: GPUColor | undefined, field: string): GPUColorDict | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (Symbol.iterator in Object(value)) {
		const values = Array.from(value as Iterable<number>);
		if (values.length !== 4) {
			throw new Error(`${field} iterable must contain exactly 4 values. Received ${values.length}.`);
		}
		return { r: values[0], g: values[1], b: values[2], a: values[3] };
	}
	const color = value as GPUColorDict;
	return { r: color.r, g: color.g, b: color.b, a: color.a };
}

type FrameGraphRuntimeState = {
	readonly device: GPUDevice;
	readonly pool: ResourcePool;
	readonly gpuProfiler: GpuProfilerState;
	isExecuting: boolean;
	isDestroyed: boolean;
};

type CompiledGpuDebugGroupPathEntry = {
	readonly id: number;
	readonly label: string;
};

type CompiledGpuDebugGroups = {
	readonly groupIdByNodeId: ReadonlyMap<number, number>;
	readonly pathByGroupId: ReadonlyMap<number, readonly CompiledGpuDebugGroupPathEntry[]>;
};

/**
 * Long-lived device-bound runtime shared by independent recordings and compiled
 * frames. It owns only the transient pool and GPU profiler.
 *
 * @beta
 */
export class FrameGraph {
	private readonly runtime: FrameGraphRuntimeState;

	/** Creates a CPU-only runtime bound permanently to `device`. */
	constructor(device: GPUDevice) {
		this.runtime = {
			device,
			pool: new ResourcePool(device),
			gpuProfiler: createGpuProfilerState(device),
			isExecuting: false,
			isDestroyed: false,
		};
	}

	/** Starts an independent single-use recording. */
	beginFrame(): FrameGraphRecorder {
		this.assertNotDestroyed();
		return new FrameGraphRecorderImpl(this.runtime);
	}

	/** Returns aggregate transient-pool counters and retained-byte estimates. */
	getResourcePoolStats(): FrameGraphResourcePoolStats {
		this.assertNotDestroyed();
		return this.runtime.pool.getStats();
	}

	/** Destroys resources retained for reuse while preserving historical counters. */
	clearResourcePool(): void {
		this.assertNotDestroyed();
		this.assertNotExecuting('clearResourcePool');
		this.runtime.pool.clearRetainedResources();
	}

	/**
	 * Permanently releases runtime-owned resources and invalidates outstanding
	 * recorders and compiled frames. Imported resources remain caller-owned.
	 */
	destroy(): void {
		if (this.runtime.isDestroyed) {
			return;
		}
		this.assertNotExecuting('destroy');
		this.runtime.isDestroyed = true;
		this.runtime.pool.destroy();
		destroyGpuProfiler(this.runtime.gpuProfiler);
	}

	private assertNotDestroyed(): void {
		if (this.runtime.isDestroyed) {
			throw new Error('FrameGraph has been destroyed.');
		}
	}

	private assertNotExecuting(operation: string): void {
		if (this.runtime.isExecuting) {
			throw new Error(`FrameGraph.${operation}() cannot be called while CompiledFrame.execute() is running.`);
		}
	}
}

class CompiledFrameImpl implements CompiledFrame {
	constructor(
		protected readonly recorder: FrameGraphRecorderImpl,
	) {}

	execute(options?: CompiledFrameExecuteOptions & { readonly gpuTiming?: false }): void;
	execute(options: CompiledFrameExecuteOptions & { readonly gpuTiming: true }): Promise<FrameGraphGpuTimingReport>;
	execute(options: CompiledFrameExecuteOptions & { readonly gpuTiming?: boolean }): void | Promise<FrameGraphGpuTimingReport>;
	execute(options: CompiledFrameExecuteOptions & { readonly gpuTiming?: boolean } = {}): void | Promise<FrameGraphGpuTimingReport> {
		return this.recorder.executeCompiled(options);
	}
}

class ReportedCompiledFrameImpl extends CompiledFrameImpl implements CompiledFrameWithReport {
	constructor(recorder: FrameGraphRecorderImpl, readonly compilationReport: FrameGraphCompilationReport) {
		super(recorder);
	}
}

/** Single-use recording implementation created by `FrameGraph.beginFrame()`. */
class FrameGraphRecorderImpl implements FrameGraphRecorder {
	private readonly recordingOwner = {};
	private nextResourceId = 1;
	private nextTextureViewId = 1;
	private nextNodeId = 1;
	private nextDebugGroupId = 1;
	private readonly resources = new Map<number, InternalResource>();
	private importedTextures = new WeakMap<GPUTexture, TextureHandle>();
	private importedBuffers = new WeakMap<GPUBuffer, BufferHandle>();
	private readonly textureViews = new Map<number, InternalTextureView>();
	private readonly nodes: InternalNode[] = [];
	private readonly rootResources = new Map<number, Set<GraphRootReason>>();
	private readonly debugGroups: FrameGraphCompilationReport['debugGroups'][number][] = [];
	private readonly debugGroupStack: number[] = [];
	private readonly nodeDebugGroupIds = new Map<number, number>();
	private readonly resourceDebugGroupIds = new Map<number, number>();
	private compiledPlan: InternalCompiledPlan | undefined;
	private compiledGpuDebugGroups: CompiledGpuDebugGroups | undefined;
	private isConsumed = false;

	constructor(private readonly runtime: FrameGraphRuntimeState) {}

	/** Opens a distinct diagnostic-only recording group. */
	pushDebugGroup(label: string): void {
		this.assertCanMutate('pushDebugGroup');
		const normalizedLabel = label.trim();
		if (normalizedLabel.length === 0) {
			throw new Error('FrameGraph debug group label must not be empty.');
		}
		const parentId = this.debugGroupStack.at(-1);
		const id = this.nextDebugGroupId++;
		this.debugGroups.push({ id, parentId, label: normalizedLabel });
		this.debugGroupStack.push(id);
	}

	/** Closes the innermost diagnostic recording group. */
	popDebugGroup(): void {
		this.assertCanMutate('popDebugGroup');
		if (this.debugGroupStack.pop() === undefined) {
			throw new Error('FrameGraph debug group stack is empty.');
		}
	}

	/** Runs synchronous recording work inside a distinct diagnostic-only group. */
	withDebugGroup<T>(
		label: string,
		record: () => (T extends PromiseLike<unknown> ? never : T),
	): T {
		this.pushDebugGroup(label);
		try {
			const result = record();
			if (isPromiseLike(result)) {
				throw new Error('FrameGraph.withDebugGroup() callback must complete synchronously.');
			}
			return result;
		}
		finally {
			this.popDebugGroup();
		}
	}

	private get device(): GPUDevice {
		return this.runtime.device;
	}

	private get pool(): ResourcePool {
		return this.runtime.pool;
	}

	private get gpuProfiler(): GpuProfilerState {
		return this.runtime.gpuProfiler;
	}

	/**
	 * Registers a transient texture for the current recording.
	 *
	 * FrameGraph snapshots the descriptor, materializing its size and copying its
	 * alternate view-format list.
	 * It allocates the physical texture lazily during execution and may reuse a
	 * compatible pooled allocation whose compiled lifetime does not overlap.
	 *
	 * @param desc - Texture shape, format, and optional allocation usage.
	 * @returns A handle owned by this recording.
	 *
	 * @throws If the runtime has been destroyed or this recorder was consumed.
	 *
	 * @beta
	 */
	createTexture(desc: TextureDesc): TextureHandle {
		this.assertCanMutate('createTexture');
		const registeredDesc = snapshotTextureDescriptor(desc);
		this.validateTextureDescriptor(registeredDesc);
		const handle = makeTextureHandle(this.nextResourceId++, registeredDesc.label, this.recordingOwner);
		this.resources.set(handle.id, {
			handle,
			origin: 'transient',
			initialContents: 'undefined',
			desc: registeredDesc,
			requiredUsage: 0 as GPUTextureUsageFlags,
		});
		this.recordResourceDebugGroup(handle.id);
		this.invalidate();
		return handle;
	}

	/**
	 * Returns the descriptor registered for a logical texture.
	 *
	 * The returned object is the registered snapshot, not a mutable copy. It is
	 * intended for recording-time decisions such as selecting compatible
	 * pipeline variants and must not be changed.
	 *
	 * @param handle - Texture handle from the current recording.
	 * @returns The read-only registered descriptor.
	 *
	 * @throws If the runtime is destroyed, this recorder was consumed, or the handle is unknown.
	 *
	 * @beta
	 */
	getTextureDesc(handle: TextureHandle): Readonly<TextureDesc> {
		this.assertCanMutate('getTextureDesc');
		return this.resourceFor(handle).desc as TextureDesc;
	}

	/**
	 * Creates a recording-scoped logical view of a texture.
	 *
	 * Descriptor defaults follow `GPUTexture.createView()` and are normalized
	 * immediately. The view does not allocate a GPU object until execution.
	 *
	 * @param texture - Parent texture from the current recording.
	 * @param desc - Optional view format, dimension, aspect, and subresources.
	 * @returns A view handle owned by this recording.
	 *
	 * @throws If the runtime is destroyed, this recorder was consumed, or the parent
	 * texture is unknown.
	 *
	 * @beta
	 */
	createTextureView(texture: TextureHandle, desc?: TextureViewDesc): TextureViewHandle {
		this.assertCanMutate('createTextureView');
		const resource = this.resourceFor(texture);
		const normalized = normalizeTextureView(texture, resource.desc as TextureDesc, desc);
		const handle = makeTextureViewHandle(this.nextTextureViewId++, desc?.label, this.recordingOwner);
		this.textureViews.set(handle.id, {
			handle,
			texture,
			desc: normalized.desc,
			descriptor: normalized.descriptor,
			region: normalized.region,
			requiredUsage: 0 as GPUTextureUsageFlags,
		});
		this.invalidate();
		return handle;
	}

	/**
	 * Returns the normalized descriptor of a logical texture view.
	 *
	 * @param handle - Texture view from the current recording.
	 * @returns Read-only normalized view metadata.
	 *
	 * @throws If the runtime is destroyed, this recorder was consumed, or the view handle is unknown.
	 *
	 * @beta
	 */
	getTextureViewDesc(handle: TextureViewHandle): Readonly<NormalizedTextureViewDesc> {
		this.assertCanMutate('getTextureViewDesc');
		return this.textureViewFor(handle).desc;
	}

	/**
	 * Registers a transient buffer for the current recording.
	 *
	 * FrameGraph takes a shallow descriptor snapshot. It allocates the physical
	 * buffer lazily during execution and may reuse a compatible pooled allocation
	 * whose compiled lifetime does not overlap.
	 *
	 * @param desc - Buffer size and optional allocation usage.
	 * @returns A handle owned by this recording.
	 *
	 * @throws If the runtime has been destroyed or this recorder was consumed.
	 *
	 * @beta
	 */
	createBuffer(desc: BufferDesc): BufferHandle {
		this.assertCanMutate('createBuffer');
		const registeredDesc = { ...desc };
		this.validateBufferDescriptor(registeredDesc, true);
		const handle = makeBufferHandle(this.nextResourceId++, registeredDesc.label, this.recordingOwner);
		this.resources.set(handle.id, {
			handle,
			origin: 'transient',
			initialContents: 'undefined',
			desc: registeredDesc,
			requiredUsage: 0 as GPUBufferUsageFlags,
		});
		this.recordResourceDebugGroup(handle.id);
		this.invalidate();
		return handle;
	}

	/**
	 * Returns the descriptor registered for a logical buffer.
	 *
	 * The returned object is the registered snapshot, not a mutable copy. For an
	 * imported buffer, its size and usage reflect the graph-visible values after
	 * applying `exposedSize` and `exposedUsage`. For a transient buffer whose
	 * usage is omitted, this method does not expose the usage derived later by
	 * compilation. The descriptor is intended for recording-time decisions and
	 * must not be changed.
	 *
	 * @param handle - Buffer handle from the current recording.
	 * @returns The read-only registered descriptor.
	 *
	 * @throws If the runtime is destroyed, this recorder was consumed, or the handle is unknown.
	 *
	 * @beta
	 */
	getBufferDesc(handle: BufferHandle): Readonly<BufferDesc> {
		this.assertCanMutate('getBufferDesc');
		return this.resourceFor(handle).desc as BufferDesc;
	}

	/**
	 * Imports a caller-owned texture into graph-visible data flow.
	 *
	 * FrameGraph neither creates nor destroys the physical texture. The texture
	 * must belong to this graph's device. Physical metadata is read from the
	 * native object. Optional exposed usage may narrow the graph-visible usage,
	 * and alternate view formats remain a caller-owned declaration.
	 *
	 * @param texture - Caller-owned physical texture.
	 * @param options - Optional graph-local label, alternate view formats, and exposed usage.
	 * @returns A handle owned by this recording.
	 *
	 * @throws If the runtime has been destroyed, this recorder was consumed, or the
	 * physical texture was already imported in the current recording.
	 *
	 * @beta
	 */
	importTexture(texture: GPUTexture, options: ImportTextureOptions = {}): TextureHandle {
		this.assertCanMutate('importTexture');
		this.assertTextureNotImported(texture, 'importTexture');
		const registeredDesc = this.importedTextureDescriptor(texture, options);
		this.validateTextureDescriptor(registeredDesc);
		const handle = makeTextureHandle(this.nextResourceId++, registeredDesc.label, this.recordingOwner);
		this.resources.set(handle.id, {
			handle,
			origin: 'imported',
			initialContents: options.initialContents ?? 'defined',
			desc: registeredDesc,
			physical: texture,
			requiredUsage: 0 as GPUTextureUsageFlags,
		});
		this.recordResourceDebugGroup(handle.id);
		this.importedTextures.set(texture, handle);
		this.invalidate();
		return handle;
	}

	/**
	 * Imports the current swapchain texture.
	 *
	 * The caller owns acquisition and presentation lifecycle. FrameGraph does
	 * not destroy the texture. Register a newly acquired texture in each frame
	 * recording, use `markPresent()` to retain its producer, and execute the
	 * compiled frame while that borrowed texture remains current. Re-execution
	 * does not acquire or refresh the swapchain texture.
	 *
	 * @param texture - Current caller-owned swapchain texture.
	 * @param options - Optional graph-local label, alternate view formats, and exposed usage.
	 * @returns A swapchain handle owned by this recording.
	 *
	 * @throws If the runtime has been destroyed, this recorder was consumed, or the
	 * physical texture was already imported in the current recording.
	 *
	 * @beta
	 */
	importSwapchainTexture(texture: GPUTexture, options: ImportTextureOptions = {}): TextureHandle {
		this.assertCanMutate('importSwapchainTexture');
		this.assertTextureNotImported(texture, 'importSwapchainTexture');
		const registeredDesc = this.importedTextureDescriptor(texture, options);
		this.validateTextureDescriptor(registeredDesc);
		const handle = makeTextureHandle(this.nextResourceId++, registeredDesc.label, this.recordingOwner);
		this.resources.set(handle.id, {
			handle,
			origin: 'swapchain',
			initialContents: 'undefined',
			desc: registeredDesc,
			physical: texture,
			requiredUsage: 0 as GPUTextureUsageFlags,
		});
		this.recordResourceDebugGroup(handle.id);
		this.importedTextures.set(texture, handle);
		this.invalidate();
		return handle;
	}

	/**
	 * Imports a caller-owned buffer into graph-visible data flow.
	 *
	 * FrameGraph neither creates nor destroys the physical buffer. The buffer
	 * must belong to this graph's device. Physical metadata is read from the
	 * native object. Optional exposed size and usage may narrow the graph-visible
	 * prefix and usage contract.
	 *
	 * @param buffer - Caller-owned physical buffer.
	 * @param options - Optional graph-local label, exposed prefix size, and exposed usage.
	 * @returns A handle owned by this recording.
	 *
	 * @throws If the runtime has been destroyed, this recorder was consumed, or the
	 * physical buffer was already imported in the current recording.
	 *
	 * @beta
	 */
	importBuffer(buffer: GPUBuffer, options: ImportBufferOptions = {}): BufferHandle {
		this.assertCanMutate('importBuffer');
		this.assertBufferNotImported(buffer);
		const registeredDesc: BufferDesc = {
			label: options.label ?? (buffer.label || undefined),
			size: options.exposedSize ?? buffer.size,
			usage: options.exposedUsage ?? buffer.usage,
		};
		this.validateBufferDescriptor(registeredDesc, false);
		const handle = makeBufferHandle(this.nextResourceId++, registeredDesc.label, this.recordingOwner);
		this.resources.set(handle.id, {
			handle,
			origin: 'imported',
			initialContents: options.initialContents ?? 'defined',
			desc: registeredDesc,
			physical: buffer,
			requiredUsage: 0 as GPUBufferUsageFlags,
		});
		this.recordResourceDebugGroup(handle.id);
		this.importedBuffers.set(buffer, handle);
		this.invalidate();
		return handle;
	}

	use<TAccess extends TextureAccess>(resource: TextureHandle, access: TAccess, options?: WriteUseOptions): TextureUse<TAccess>;
	use<TAccess extends TextureViewAccess>(resource: TextureViewHandle, access: TAccess, options?: WriteUseOptions): TextureViewUse<TAccess>;
	use<TAccess extends BufferAccess>(resource: BufferHandle, access: TAccess, options?: BufferUseOptions | BufferWriteUseOptions): BufferUse<TAccess>;
	use(
		resource: TextureHandle | TextureViewHandle | BufferHandle,
		access: TextureAccess | BufferAccess,
		options?: WriteUseOptions | BufferUseOptions | BufferWriteUseOptions,
	): ResourceUse {
		this.assertCanMutate('use');
		if (resource.kind === 'texture-view') {
			this.textureViewFor(resource);
		}
		else {
			this.resourceFor(resource);
		}
		const mode = resource.kind === 'buffer'
			? bufferAccessMode(access as BufferAccess)
			: textureAccessMode(access as TextureAccess);
		const normalizedOptions = this.normalizeUseOptions(resource, mode, options);
		const descriptor = (resource.kind === 'buffer'
			? {
				resource,
				access: access as BufferAccess,
				bufferRange: normalizedOptions.range,
				contents: normalizedOptions.contents,
			}
			: {
				resource,
				access: access as TextureAccess,
				contents: normalizedOptions.contents,
			}) as ResourceAccess;
		const internal: InternalUse = {
			kind: resource.kind === 'buffer'
				? 'buffer-use'
				: resource.kind === 'texture-view' ? 'texture-view-use' : 'texture-use',
			access,
			owner: this.recordingOwner,
			handle: resource,
			accesses: this.createAccesses(descriptor),
		} as InternalUse;
		return internal as unknown as ResourceUse;
	}

	private normalizeUseOptions(
		resource: TextureHandle | TextureViewHandle | BufferHandle,
		mode: InternalAccess['mode'],
		options: WriteUseOptions | BufferUseOptions | BufferWriteUseOptions | undefined,
	): { readonly range?: BufferRange; readonly contents?: WriteContents } {
		if (options === undefined) {
			if (mode === 'write') {
				throw new Error('FrameGraph.use() write access requires explicit contents: "overwrite" or "preserve".');
			}
			return {};
		}
		if (options === null || typeof options !== 'object' || Array.isArray(options)) {
			throw new Error('FrameGraph.use() options must be an object.');
		}
		for (const key of Object.keys(options)) {
			const accepted = (key === 'range' && resource.kind === 'buffer')
				|| (key === 'contents' && mode === 'write');
			if (!accepted) {
				throw new Error(`FrameGraph.use() does not accept option "${key}" for this ${mode} access.`);
			}
		}
		let range: BufferRange | undefined;
		if (resource.kind === 'buffer' && 'range' in options && options.range !== undefined) {
			if (options.range === null || typeof options.range !== 'object' || Array.isArray(options.range)) {
				throw new Error('FrameGraph.use() buffer range must be an object.');
			}
			range = { ...options.range };
		}
		if (mode === 'read') {
			return { range };
		}
		if (!('contents' in options) || options.contents === undefined) {
			throw new Error('FrameGraph.use() write access requires explicit contents: "overwrite" or "preserve".');
		}
		const contents = options.contents;
		if (contents !== 'overwrite' && contents !== 'preserve') {
			throw new Error(`FrameGraph.use() write contents must be "overwrite" or "preserve", received "${String(contents)}".`);
		}
		return { range, contents };
	}

	private importedTextureDescriptor(
		texture: GPUTexture,
		options: ImportTextureOptions,
	): TextureDesc {
		return {
			label: options.label ?? (texture.label || undefined),
			format: texture.format,
			viewFormats: options.viewFormats ? [...options.viewFormats] : undefined,
			size: [texture.width, texture.height, texture.depthOrArrayLayers],
			dimension: texture.dimension,
			mipLevelCount: texture.mipLevelCount,
			sampleCount: texture.sampleCount,
			usage: options.exposedUsage ?? texture.usage,
		};
	}

	private assertTextureNotImported(
		texture: GPUTexture,
		operation: 'importTexture' | 'importSwapchainTexture',
	): void {
		const existing = this.importedTextures.get(texture);
		if (!existing) {
			return;
		}
		const resource = this.resourceFor(existing);
		const firstOperation = resource.origin === 'swapchain'
			? 'importSwapchainTexture'
			: 'importTexture';
		throw new Error(`FrameGraph.${operation}() cannot import GPUTexture "${texture.label || 'unlabeled'}" more than once in the same recording. It was already imported by FrameGraph.${firstOperation}() as texture "${existing.label ?? existing.id}". Reuse and pass the existing TextureHandle instead.`);
	}

	private assertBufferNotImported(buffer: GPUBuffer): void {
		const existing = this.importedBuffers.get(buffer);
		if (!existing) {
			return;
		}
		throw new Error(`FrameGraph.importBuffer() cannot import GPUBuffer "${buffer.label || 'unlabeled'}" more than once in the same recording. It was already imported as buffer "${existing.label ?? existing.id}". Reuse and pass the existing BufferHandle instead.`);
	}

	/**
	 * Adds a FrameGraph-owned render pass to the current recording.
	 *
	 * Color and depth attachment accesses are inferred from the attachment
	 * descriptors. Declare only additional graph-visible dependencies in
	 * `desc.uses`. The callback runs synchronously inside an active render
	 * pass during execution.
	 *
	 * @param desc - Render attachments, dependencies, and recording callback.
	 * @throws If the runtime is destroyed, this recorder was consumed, or attachment
	 * metadata is invalid.
	 *
	 * @beta
	 */
	render(desc: RenderPassNodeDesc): void {
		this.assertCanMutate('render');
		const uses = this.internalUses(desc.uses);
		const accesses: InternalAccess[] = uses.flatMap((use) => use.accesses);
		const colorAttachments = (desc.colorAttachments ?? []).map((attachment, index) => {
			const view = this.resolveTextureViewBinding(attachment.target, 'color-attachment', attachment.depthSlice);
			const resolveView = attachment.resolveTarget
				? this.resolveTextureViewBinding(attachment.resolveTarget, 'resolve-target')
				: undefined;
			return {
				target: view.texture,
				textureView: view.textureView,
				loadOp: attachment.loadOp,
				storeOp: attachment.storeOp,
				clearValue: snapshotColor(
					attachment.clearValue,
					`Render node "${desc.label ?? 'unlabeled'}" color attachment ${index} clearValue`,
				),
				depthSlice: attachment.depthSlice,
				targetViewDescriptor: view.descriptor,
				textureRegion: view.region,
				...(resolveView ? {
					resolveTarget: resolveView.texture,
					resolveTextureView: resolveView.textureView,
					resolveTargetViewDescriptor: resolveView.descriptor,
					resolveTextureRegion: resolveView.region,
				} : {}),
			};
		});
		const depthStencilAttachment = desc.depthStencilAttachment
			? (() => {
				const view = this.resolveTextureViewBinding(desc.depthStencilAttachment.target, 'depth-attachment');
				return {
					target: view.texture,
					textureView: view.textureView,
					depthClearValue: desc.depthStencilAttachment.depthClearValue,
					depthLoadOp: desc.depthStencilAttachment.depthLoadOp,
					depthStoreOp: desc.depthStencilAttachment.depthStoreOp,
					depthReadOnly: desc.depthStencilAttachment.depthReadOnly,
					targetViewDescriptor: view.descriptor,
					textureRegion: view.region,
				};
			})()
			: undefined;

		for (const attachment of colorAttachments) {
			const region = attachment.textureRegion;
			accesses.push(this.createTextureAccess(
				attachment.target,
				TextureAccess.ColorAttachmentWrite,
				region,
				attachment.textureView,
				attachment.targetViewDescriptor,
				attachment.storeOp === 'store',
				attachment.loadOp === 'load' ? 'preserve' : 'overwrite',
			));
			if (attachment.resolveTarget) {
				accesses.push(this.createTextureAccess(
					attachment.resolveTarget,
					TextureAccess.ColorAttachmentWrite,
					attachment.resolveTextureRegion!,
					attachment.resolveTextureView,
					attachment.resolveTargetViewDescriptor,
					undefined,
					'overwrite',
				));
			}
		}

		const depth = depthStencilAttachment;
		if (depth) {
			const region = depth.textureRegion;
			if (depth.depthReadOnly) {
				accesses.push(this.createTextureAccess(
					depth.target,
					TextureAccess.DepthRead,
					region,
					depth.textureView,
					depth.targetViewDescriptor,
				));
			}
			else {
				accesses.push(this.createTextureAccess(
					depth.target,
					TextureAccess.DepthWrite,
					region,
					depth.textureView,
					depth.targetViewDescriptor,
					depth.depthStoreOp !== 'discard',
					depth.depthLoadOp === 'load' ? 'preserve' : 'overwrite',
				));
			}
		}

		this.addNode({
			kind: 'render',
			label: desc.label,
			accesses,
			uses,
			sideEffect: desc.sideEffect ?? false,
			renderPass: {
				colorAttachments,
				depthStencilAttachment,
			},
			renderEncode: desc.encode,
		});
	}

	/**
	 * Adds a FrameGraph-owned compute pass to the current recording.
	 *
	 * The callback runs synchronously inside an active compute pass during
	 * execution. Every graph-visible resource it resolves or uses must be
	 * declared in `desc.uses`.
	 *
	 * @param desc - Compute dependencies and recording callback.
	 * @throws If the runtime has been destroyed or this recorder was consumed.
	 *
	 * @beta
	 */
	compute(desc: ComputePassNodeDesc): void {
		this.assertCanMutate('compute');
		const uses = this.internalUses(desc.uses);
		this.addNode({
			kind: 'compute',
			label: desc.label,
			accesses: uses.flatMap((use) => use.accesses),
			uses,
			sideEffect: desc.sideEffect ?? false,
			computeEncode: desc.encode,
		});
	}

	/**
	 * Adds declarative WebGPU copy commands to the current recording.
	 *
	 * Dependencies and exact ranges are derived from snapshots of the operations.
	 * Iterable texture extents and origins are materialized when this method is
	 * called.
	 *
	 * @param desc - Ordered copy operations.
	 * @throws If the runtime is destroyed, this recorder was consumed, or a copy range
	 * is invalid.
	 *
	 * @beta
	 */
	copy(desc: CopyNodeDesc): void {
		this.assertCanMutate('copy');
		const resourceFor = (handle: ResourceHandle) => this.resourceFor(handle);
		const accesses: InternalAccess[] = [];
		const operations = desc.operations.map((operation, index) => snapshotCopyOperation(operation, index));
		for (const operation of operations) {
			switch (operation.type) {
				case 'texture-to-texture': {
					accesses.push(this.createTextureAccess(operation.source, TextureAccess.CopySrc, textureCopyRange(resourceFor, operation.source, operation.sourceMipLevel, operation.sourceOrigin, operation.copySize, operation.sourceAspect)));
					const destinationRange = textureCopyRange(resourceFor, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize, operation.destinationAspect);
					const contents = textureCopyOverwritesSubresource(resourceFor, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize)
						? 'overwrite'
						: 'preserve';
					accesses.push(this.createTextureAccess(operation.destination, TextureAccess.CopyDst, destinationRange, undefined, undefined, undefined, contents));
					break;
				}
				case 'buffer-to-buffer':
					accesses.push(this.createAccess({ resource: operation.source, access: BufferAccess.CopySrc, bufferRange: { offset: operation.sourceOffset ?? 0, size: operation.size } }));
					accesses.push(this.createAccess({ resource: operation.destination, access: BufferAccess.CopyDst, bufferRange: { offset: operation.destinationOffset ?? 0, size: operation.size }, contents: 'overwrite' }));
					break;
				case 'buffer-to-texture': {
					accesses.push(this.createAccess({ resource: operation.source, access: BufferAccess.CopySrc, bufferRange: bufferTextureCopyRange(resourceFor, operation.destination, operation.sourceLayout, operation.copySize) }));
					const destinationRange = textureCopyRange(resourceFor, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize, operation.destinationAspect);
					const contents = textureCopyOverwritesSubresource(resourceFor, operation.destination, operation.destinationMipLevel, operation.destinationOrigin, operation.copySize)
						? 'overwrite'
						: 'preserve';
					accesses.push(this.createTextureAccess(operation.destination, TextureAccess.CopyDst, destinationRange, undefined, undefined, undefined, contents));
					break;
				}
				case 'texture-to-buffer':
					accesses.push(this.createTextureAccess(operation.source, TextureAccess.CopySrc, textureCopyRange(resourceFor, operation.source, operation.sourceMipLevel, operation.sourceOrigin, operation.copySize, operation.sourceAspect)));
					accesses.push(this.createAccess({ resource: operation.destination, access: BufferAccess.CopyDst, bufferRange: bufferTextureCopyRange(resourceFor, operation.source, operation.destinationLayout, operation.copySize), contents: 'overwrite' }));
					break;
			}
		}
		this.addNode({
			kind: 'copy',
			label: desc.label,
			accesses,
			uses: [],
			sideEffect: desc.sideEffect ?? false,
			copyOperations: operations,
		});
	}

	/**
	 * Adds declarative buffer clear commands to the current recording.
	 *
	 * Clear operations derive `COPY_DST` accesses for their exact byte ranges.
	 * Operations are snapshotted when this method is called.
	 *
	 * @param desc - Ordered clear operations.
	 * @throws If the runtime is destroyed, this recorder was consumed, or a clear range
	 * is invalid.
	 *
	 * @beta
	 */
	clearBuffer(desc: ClearBufferNodeDesc): void {
		this.assertCanMutate('clearBuffer');
		const operations: ClearBufferOperation[] = [];
		const accesses: InternalAccess[] = [];
		for (const operation of desc.operations) {
			const snapshot: ClearBufferOperation = {
				target: operation.target,
				offset: operation.offset,
				size: operation.size,
			};
			operations.push(snapshot);
			accesses.push(this.createAccess({
				resource: snapshot.target,
				access: BufferAccess.CopyDst,
				bufferRange: this.bufferClearRange(snapshot.target, snapshot.offset ?? 0, snapshot.size),
				contents: 'overwrite',
			}));
		}
		this.addNode({
			kind: 'clear-buffer',
			label: desc.label,
			accesses,
			uses: [],
			sideEffect: desc.sideEffect ?? false,
			clearBufferOperations: operations,
		});
	}

	/**
	 * Adds caller-defined commands to a FrameGraph-owned command segment.
	 *
	 * Command nodes default to `sideEffect: true` because their behavior is
	 * opaque to the compiler. The callback is synchronous and receives the
	 * segment's FrameGraph-owned command encoder.
	 *
	 * @param desc - Declared dependencies and synchronous callback.
	 * @throws If the runtime has been destroyed or this recorder was consumed.
	 *
	 * @beta
	 */
	command(desc: CommandNodeDesc): void {
		this.assertCanMutate('command');
		const uses = this.internalUses(desc.uses);
		this.addNode({
			kind: 'command',
			label: desc.label,
			accesses: uses.flatMap((use) => use.accesses),
			uses,
			sideEffect: desc.sideEffect ?? true,
			commandEncode: desc.encode,
		});
	}

	/**
	 * Adds an opaque caller-owned queue submission node.
	 *
	 * When retained, FrameGraph submits preceding retained graph work before
	 * invoking the callback and records following work into a later command
	 * segment. This orders submissions without waiting for GPU completion. The
	 * callback must completely declare and synchronously enqueue all graph-visible
	 * work, including access to imported resources through external-owner
	 * references, and must not retain resolved transient resources. Opacity does
	 * not imply retention; external submissions independently default to a side
	 * effect.
	 *
	 * @param desc - Declared dependencies and caller-owned submission callback.
	 * @throws If the runtime has been destroyed or this recorder was consumed.
	 *
	 * @beta
	 */
	externalSubmission(desc: ExternalSubmissionNodeDesc): void {
		this.assertCanMutate('externalSubmission');
		const uses = this.internalUses(desc.uses);
		this.addNode({
			kind: 'external-submission',
			label: desc.label,
			accesses: uses.flatMap((use) => use.accesses),
			uses,
			sideEffect: desc.sideEffect ?? true,
			externalSubmit: desc.submit,
		});
	}

	/**
	 * Retains the final producer visible for an imported swapchain texture at the
	 * end of recording.
	 *
	 * The marker does not present the surface or add WebGPU usage flags.
	 *
	 * @param resource - Handle returned by `importSwapchainTexture()`.
	 *
	 * @throws If the runtime is destroyed or this recorder was consumed, the handle is
	 * unknown, or the texture was not imported as a swapchain texture.
	 *
	 * @beta
	 */
	markPresent(resource: TextureHandle): void {
		this.assertCanMutate('markPresent');
		const internal = this.resourceFor(resource);
		if (internal.origin !== 'swapchain') {
			throw new Error('Present can only be marked on a swapchain texture.');
		}
		this.addRootResource(resource, 'present');
		this.invalidate();
	}

	/**
	 * Marks the final logical value visible for a resource at the end of recording
	 * as a required graph output.
	 *
	 * This marker only retains the value's visible producers. It does not return,
	 * unwrap, transfer ownership of, or extend the execution lifetime of a
	 * transient physical resource. Post-execution access requires caller-owned
	 * imported storage.
	 *
	 * @param resource - Current-recording texture or buffer handle.
	 *
	 * @throws If the runtime is destroyed or this recorder was consumed, or the handle is
	 * unknown.
	 *
	 * @beta
	 */
	markOutput(resource: ResourceHandle): void {
		this.assertCanMutate('markOutput');
		this.assertKnownResource(resource);
		this.addRootResource(resource, 'output');
		this.invalidate();
	}

	/**
	 * Retains the final producer of imported state that remains observable after
	 * this frame, for example temporal history consumed by a later recording.
	 *
	 * @throws If the resource is not caller-owned imported storage.
	 *
	 * @beta
	 */
	markPersistentState(resource: ResourceHandle): void {
		this.assertCanMutate('markPersistentState');
		const internal = this.resourceFor(resource);
		if (internal.origin !== 'imported') {
			throw new Error('Persistent state can only be marked on an imported resource.');
		}
		this.addRootResource(resource, 'persistent-state');
		this.invalidate();
	}

	/**
	 * Retains the final producer visible for a caller-owned, map-readable staging
	 * buffer at the end of recording.
	 *
	 * The buffer must be registered with `importBuffer()` and expose exactly
	 * `COPY_DST | MAP_READ`. FrameGraph records and submits graph work but does
	 * not map the buffer, wait for GPU completion, or manage reuse while mapping;
	 * readback consumption and lifetime remain caller-owned after submission.
	 *
	 * @param resource - Caller-owned imported staging-buffer handle.
	 *
	 * @throws If the runtime is destroyed or this recorder was consumed, the handle is
	 * unknown, the buffer is transient, or its exposed usage does not satisfy the
	 * readback contract.
	 *
	 * @beta
	 */
	markReadback(resource: BufferHandle): void {
		this.assertCanMutate('markReadback');
		const internal = this.resourceFor(resource);
		this.validateReadbackBuffer(internal);
		this.addRootResource(resource, 'readback');
		this.invalidate();
	}

	/**
	 * Retains the final resource producer visible at the end of recording for
	 * external GPU debugging or capture.
	 *
	 * This marker does not copy, map, or otherwise expose the physical resource.
	 *
	 * @param resource - Current-recording texture or buffer handle.
	 *
	 * @throws If the runtime is destroyed or this recorder was consumed, or the handle is
	 * unknown.
	 *
	 * @beta
	 */
	markDebugCapture(resource: ResourceHandle): void {
		this.assertCanMutate('markDebugCapture');
		this.assertKnownResource(resource);
		this.addRootResource(resource, 'debug-capture');
		this.invalidate();
	}

	/**
	 * Validates and compiles the current recording without executing GPU work.
	 *
	 * Compilation culls unreachable work, preserves recording order among retained
	 * nodes, derives usage flags, calculates lifetimes, and plans transient aliasing.
	 * It atomically consumes this recorder whether compilation succeeds or fails.
	 *
	 * Node recording order determines logical resource value visibility. Handles
	 * identify stable logical resources rather than value versions. A
	 * transient read or preserving write must be fully covered by producing
	 * writes recorded before that node; compilation does not bind it to a later
	 * write. Imported resources begin with their caller-owned external value.
	 *
	 * The public diagnostic report projection is built only when `report: true`
	 * is requested.
	 *
	 * @throws If declarations violate graph, WebGPU usage, format, range, or
	 * texture version constraints, if the runtime was destroyed, or if this
	 * recorder was already consumed.
	 *
	 * @beta
	 */
	compile(): CompiledFrame;
	compile(options: { readonly report?: false }): CompiledFrame;
	compile(options: { readonly report: true }): CompiledFrameWithReport;
	compile(options: { readonly report?: boolean } = {}): CompiledFrame | CompiledFrameWithReport {
		this.assertCanMutate('compile');
		this.isConsumed = true;
		try {
			if (this.debugGroupStack.length > 0) {
				const groupId = this.debugGroupStack.at(-1)!;
				const group = this.debugGroups.find((candidate) => candidate.id === groupId);
				throw new Error(`FrameGraph cannot compile with unclosed debug group "${group?.label ?? groupId}".`);
			}
			this.resetRequiredUsage();
			for (const node of this.nodes) {
				this.validateNodeDescriptor(node);
			}

			const result = compileFrameGraph({
				nodes: this.nodes,
				resources: this.resources,
				textureViews: this.textureViews,
				rootResources: this.rootResources,
				debugGroups: this.debugGroups,
				nodeDebugGroupIds: this.nodeDebugGroupIds,
				resourceDebugGroupIds: this.resourceDebugGroupIds,
				resourceFor: (handle) => this.resourceFor(handle),
				validateAccess: (access, node) => this.validateAccess(access, node),
				accumulateRetainedUsage: (access) => this.addRetainedUsage(access),
				validateDeclaredUsage: () => this.validateDeclaredUsage(),
				effectiveResourceUsage: (resource) => this.effectiveResourceUsage(resource),
				resourcePoolKey: (resource) => this.resourcePoolKey(resource),
				report: options.report === true,
			});
			this.compiledPlan = result.plan;
			this.compiledGpuDebugGroups = this.buildCompiledGpuDebugGroups(result.plan.nodes);
			this.releaseRecordingState(result.plan);
			return result.report
				? new ReportedCompiledFrameImpl(this, result.report)
				: new CompiledFrameImpl(this);
		}
		catch (error) {
			this.releaseRecordingState();
			throw error;
		}
	}

	private buildCompiledGpuDebugGroups(nodes: readonly InternalNode[]): CompiledGpuDebugGroups | undefined {
		const groupIdByNodeId = new Map<number, number>();
		const retainedGroupIds = new Set<number>();
		for (const node of nodes) {
			const groupId = this.nodeDebugGroupIds.get(node.id);
			if (groupId === undefined) {
				continue;
			}
			groupIdByNodeId.set(node.id, groupId);
			retainedGroupIds.add(groupId);
		}
		if (groupIdByNodeId.size === 0) {
			return undefined;
		}

		const groupById = new Map(this.debugGroups.map((group) => [group.id, group]));
		const pathByGroupId = new Map<number, readonly CompiledGpuDebugGroupPathEntry[]>();
		const buildPath = (groupId: number): readonly CompiledGpuDebugGroupPathEntry[] => {
			const existing = pathByGroupId.get(groupId);
			if (existing) {
				return existing;
			}
			const group = groupById.get(groupId)!;
			const parentPath = group.parentId === undefined ? [] : buildPath(group.parentId);
			const path = [...parentPath, { id: group.id, label: group.label }];
			pathByGroupId.set(groupId, path);
			return path;
		};
		for (const groupId of retainedGroupIds) {
			buildPath(groupId);
		}
		return { groupIdByNodeId, pathByGroupId };
	}

	private releaseRecordingState(plan?: InternalCompiledPlan): void {
		if (plan) {
			const retainedResourceIds = new Set(plan.resources.map(({ resource }) => resource.handle.id));
			for (const id of this.resources.keys()) {
				if (!retainedResourceIds.has(id)) {
					this.resources.delete(id);
				}
			}
			const retainedViewIds = new Set(plan.nodes.flatMap((node) => (
				node.accesses.flatMap((access) => access.textureView ? [access.textureView.id] : [])
			)));
			for (const id of this.textureViews.keys()) {
				if (!retainedViewIds.has(id)) {
					this.textureViews.delete(id);
				}
			}
		}
		else {
			this.resources.clear();
			this.textureViews.clear();
		}
		this.importedTextures = new WeakMap<GPUTexture, TextureHandle>();
		this.importedBuffers = new WeakMap<GPUBuffer, BufferHandle>();
		this.nodes.length = 0;
		this.rootResources.clear();
		this.debugGroups.length = 0;
		this.debugGroupStack.length = 0;
		this.nodeDebugGroupIds.clear();
		this.resourceDebugGroupIds.clear();
	}

	private resetRequiredUsage(): void {
		for (const resource of this.resources.values()) {
			resource.requiredUsage = 0 as never;
		}
		for (const view of this.textureViews.values()) {
			view.requiredUsage = 0 as GPUTextureUsageFlags;
		}
	}

	/**
	 * Records and submits the previously compiled logical frame.
	 *
	 * FrameGraph creates and submits one command encoder for each retained
	 * FrameGraph-owned segment and invokes external submission callbacks between
	 * them. `beforeSubmit` runs once per FrameGraph-owned segment. `afterSubmit`
	 * runs once after every segment succeeds; submission does not imply GPU
	 * completion. Transient resources are returned to the pool when execution
	 * exits, including error paths.
	 *
	 * All callbacks are synchronous. They must not retain command encoders, pass
	 * encoders, or resolved transient resources for asynchronous use.
	 *
	 * @param options - Logical frame index and optional submission hooks.
	 *
	 * @throws If no valid compiled plan exists, recording fails, a callback
	 * throws, the graph has been destroyed, or the same graph is already
	 * executing.
	 *
	 * @beta
	 */
	executeCompiled(options?: CompiledFrameExecuteOptions & { readonly gpuTiming?: false }): void;
	executeCompiled(options: CompiledFrameExecuteOptions & { readonly gpuTiming: true }): Promise<FrameGraphGpuTimingReport>;
	executeCompiled(options: CompiledFrameExecuteOptions & { readonly gpuTiming?: boolean }): void | Promise<FrameGraphGpuTimingReport>;
	executeCompiled(options: CompiledFrameExecuteOptions & { readonly gpuTiming?: boolean } = {}): void | Promise<FrameGraphGpuTimingReport> {
		this.assertNotDestroyed();
		this.assertNotExecuting('execute');
		const plan = this.compiledPlan;
		if (!plan) {
			throw new Error('CompiledFrame has no executable plan.');
		}
		const frameIndex = options.frameIndex ?? 0;
		const resourceByLogicalId = new Map<number, GPUTexture | GPUBuffer>();
		const resourceByAllocationId = new Map<number, GPUTexture | GPUBuffer>();
		const textureViewCache = new Map<string, GPUTextureView>();
		const acquiredTransient: Array<{ resource: GPUTexture | GPUBuffer; key: string }> = [];
		const gpuDebugGroups = options.gpuDebugGroups === true ? this.compiledGpuDebugGroups : undefined;
		let gpuTiming: ReturnType<typeof beginGpuTimingFrame> | undefined;

		this.runtime.isExecuting = true;
		try {
			gpuTiming = options.gpuTiming === true
				? beginGpuTimingFrame(this.gpuProfiler, plan.nodes, frameIndex)
				: undefined;
			for (const compiledResource of plan.resources) {
				const resource = compiledResource.resource;
				if (resource.physical) {
					resourceByLogicalId.set(resource.handle.id, resource.physical);
					continue;
				}
				const allocation = plan.physicalAllocations.get(resource.handle.id);
				if (!allocation) {
					continue;
				}
				const existing = resourceByAllocationId.get(allocation.id);
				if (existing) {
					resourceByLogicalId.set(resource.handle.id, existing);
					continue;
				}
				if (resource.handle.kind === 'texture') {
					const texture = this.pool.acquireTexture(
						resource.desc as TextureDesc,
						compiledResource.usage as GPUTextureUsageFlags,
						allocation.key,
					);
					resourceByAllocationId.set(allocation.id, texture);
					resourceByLogicalId.set(resource.handle.id, texture);
					acquiredTransient.push({ resource: texture, key: allocation.key });
				}
				else {
					const buffer = this.pool.acquireBuffer(
						resource.desc as BufferDesc,
						compiledResource.usage as GPUBufferUsageFlags,
						allocation.key,
					);
					resourceByAllocationId.set(allocation.id, buffer);
					resourceByLogicalId.set(resource.handle.id, buffer);
					acquiredTransient.push({ resource: buffer, key: allocation.key });
				}
			}

			const nodeById = new Map(plan.nodes.map((node) => [node.id, node]));
			const frameGraphSegments = plan.executionSegments.filter((segment) => segment.kind === 'frame-graph');
			const frameGraphSegmentCount = frameGraphSegments.length;
			const lastFrameGraphSegmentIndex = frameGraphSegments.at(-1)?.index;
			let frameGraphSegmentIndex = 0;

			for (const segment of plan.executionSegments) {
				if (segment.kind === 'external-submission') {
					const nodeId = segment.nodeIds[0];
					const node = nodeById.get(nodeId);
					if (node) {
						this.executeExternalSubmission(node, {
							frameIndex,
							device: this.device,
							resourceByLogicalId,
							textureViewCache,
						});
					}
					continue;
				}

				const commandEncoder = this.device.createCommandEncoder();
				const activeDebugGroupPath: CompiledGpuDebugGroupPathEntry[] = [];
				for (const nodeId of segment.nodeIds) {
					const node = nodeById.get(nodeId);
					if (!node) {
						continue;
					}
					if (gpuDebugGroups) {
						const groupId = gpuDebugGroups.groupIdByNodeId.get(node.id);
						this.syncGpuDebugGroups(
							commandEncoder,
							activeDebugGroupPath,
							groupId === undefined ? [] : gpuDebugGroups.pathByGroupId.get(groupId) ?? [],
						);
					}
					this.executeNode(node, {
						frameIndex,
						device: this.device,
						commandEncoder,
						resourceByLogicalId,
						textureViewCache,
						gpuTimingQuery: gpuTiming?.frame?.queryByNodeId.get(node.id),
					});
				}
				if (gpuDebugGroups) {
					this.syncGpuDebugGroups(commandEncoder, activeDebugGroupPath, []);
				}
				options.beforeSubmit?.({
					device: this.device,
					commandEncoder,
					frameIndex,
					segmentIndex: frameGraphSegmentIndex,
					segmentCount: frameGraphSegmentCount,
				});
				if (segment.index === lastFrameGraphSegmentIndex) {
					resolveGpuTimingFrame(this.gpuProfiler, commandEncoder, gpuTiming?.frame);
				}
				this.device.queue.submit([commandEncoder.finish()]);
				frameGraphSegmentIndex++;
			}
			options.afterSubmit?.({ device: this.device, frameIndex });
			readGpuTimingFrame(this.gpuProfiler, gpuTiming?.frame);
		}
		catch (error) {
			abortGpuTimingFrame(this.gpuProfiler, gpuTiming?.frame);
			throw error;
		}
		finally {
			try {
				this.releaseTransientResources(acquiredTransient);
			}
			finally {
				this.runtime.isExecuting = false;
			}
		}
		return gpuTiming?.promise;
	}

	private syncGpuDebugGroups(
		commandEncoder: GPUCommandEncoder,
		activePath: CompiledGpuDebugGroupPathEntry[],
		nextPath: readonly CompiledGpuDebugGroupPathEntry[],
	): void {
		let commonLength = 0;
		while (
			commonLength < activePath.length
			&& commonLength < nextPath.length
			&& activePath[commonLength]!.id === nextPath[commonLength]!.id
		) {
			commonLength++;
		}

		while (activePath.length > commonLength) {
			commandEncoder.popDebugGroup();
			activePath.pop();
		}
		for (let index = commonLength; index < nextPath.length; index++) {
			const group = nextPath[index]!;
			commandEncoder.pushDebugGroup(group.label);
			activePath.push(group);
		}
	}

	private releaseTransientResources(
		resources: readonly { readonly resource: GPUTexture | GPUBuffer; readonly key: string }[],
	): void {
		if (resources.length === 0) {
			return;
		}
		if (this.runtime.isDestroyed) {
			this.destroyTransientResources(resources);
			return;
		}
		this.pool.release(resources);
	}

	private destroyTransientResources(resources: readonly { readonly resource: GPUTexture | GPUBuffer }[]): void {
		for (const { resource } of resources) {
			resource.destroy();
		}
	}

	private executeExternalSubmission(
		node: InternalNode,
		options: {
			readonly frameIndex: number;
			readonly device: GPUDevice;
			readonly resourceByLogicalId: ReadonlyMap<number, GPUTexture | GPUBuffer>;
			readonly textureViewCache: Map<string, GPUTextureView>;
		},
	): void {
		if (node.kind !== 'external-submission' || !node.externalSubmit) {
			throw new Error(`External submission node "${node.label ?? node.id}" is missing its submit callback.`);
		}
		const ctx = this.createExecuteContext(node, { ...options, commandEncoder: undefined });
		try {
			node.externalSubmit({
				frameIndex: ctx.frameIndex,
				device: ctx.device,
				unwrap: ctx.unwrap,
			});
		}
		finally {
			ctx.invalidate();
		}
	}

	private executeNode(
		node: InternalNode,
		options: {
			readonly frameIndex: number;
			readonly device: GPUDevice;
			readonly commandEncoder: GPUCommandEncoder;
			readonly resourceByLogicalId: ReadonlyMap<number, GPUTexture | GPUBuffer>;
			readonly textureViewCache: Map<string, GPUTextureView>;
			readonly gpuTimingQuery?: GpuTimingNodeQuery;
		},
	): void {
		const baseContext = this.createExecuteContext(node, options);
		try {
			switch (node.kind) {
				case 'render': {
					const renderPass = options.commandEncoder.beginRenderPass(this.createRenderPassDescriptor(node, baseContext, options.gpuTimingQuery));
					try {
						node.renderEncode?.({ frameIndex: baseContext.frameIndex, device: baseContext.device, pass: renderPass, unwrap: baseContext.unwrap });
					}
					finally {
						renderPass.end();
					}
					return;
				}
				case 'compute': {
					const computePass = options.commandEncoder.beginComputePass(this.createComputePassDescriptor(node, options.gpuTimingQuery));
					try {
						node.computeEncode?.({ frameIndex: baseContext.frameIndex, device: baseContext.device, pass: computePass, unwrap: baseContext.unwrap });
					}
					finally {
						computePass.end();
					}
					return;
				}
				case 'copy':
					this.executeCopyOperations(node, options.commandEncoder, baseContext);
					return;
				case 'clear-buffer':
					this.executeClearBufferOperations(node, options.commandEncoder, baseContext);
					return;
				case 'command':
					node.commandEncode?.({ frameIndex: baseContext.frameIndex, device: baseContext.device, encoder: options.commandEncoder, unwrap: baseContext.unwrap });
					return;
				case 'external-submission':
					throw new Error(`External submission node "${node.label ?? node.id}" cannot execute inside a FrameGraph command segment.`);
			}
		}
		finally {
			baseContext.invalidate();
		}
	}

	private createExecuteContext(
		node: InternalNode,
		options: {
			readonly frameIndex: number;
			readonly device: GPUDevice;
			readonly commandEncoder: GPUCommandEncoder | undefined;
			readonly resourceByLogicalId: ReadonlyMap<number, GPUTexture | GPUBuffer>;
			readonly textureViewCache: Map<string, GPUTextureView>;
		},
	): InternalExecuteContext {
		let active = true;
		const assertActive = () => {
			if (!active) {
				throw new Error(`Resource resolver for node "${node.label ?? node.id}" is no longer active.`);
			}
		};
		const canResolve = (handle: ResourceHandle) => node.accesses.some((access) => sameResource(access.resource, handle));
		const textureFor = (handle: TextureHandle): GPUTexture => {
			this.resourceFor(handle);
			const texture = options.resourceByLogicalId.get(handle.id);
			if (!texture || !('createView' in texture)) {
				throw new Error(`Texture "${handle.label ?? handle.id}" is not available during execute.`);
			}
			return texture;
		};

		const context: InternalExecuteContext = {
			frameIndex: options.frameIndex,
			device: options.device,
			commandEncoder: options.commandEncoder as GPUCommandEncoder,
			resolveTexture: (handle) => {
				assertActive();
				this.resourceFor(handle);
				const declared = node.accesses.some((entry) => (
					sameResource(entry.resource, handle)
					&& (entry.access === TextureAccess.CopySrc || entry.access === TextureAccess.CopyDst)
				));
				if (!declared) {
					throw new Error(`Texture "${handle.label ?? handle.id}" was not declared for copy access by node "${node.label ?? node.id}".`);
				}
				return textureFor(handle);
			},
			resolveTextureView: ((handle: TextureHandle | TextureViewHandle, access?: TextureViewAccess): GPUTextureView => {
				assertActive();
				if (handle.kind === 'texture-view') {
					const view = this.textureViewFor(handle);
					const declared = node.accesses.some((entry) => entry.textureView?.id === handle.id);
					if (!declared) {
						throw new Error(`Texture view "${handle.label ?? handle.id}" was not declared by node "${node.label ?? node.id}".`);
					}
					return this.materializeTextureView(
						textureFor(view.texture),
						view.descriptor,
						view.requiredUsage,
						`view:${handle.id}`,
						options.textureViewCache,
					);
				}
				if (access === undefined) {
					throw new Error(`Resolving raw texture "${handle.label ?? handle.id}" as a view requires its declared TextureAccess role.`);
				}
				this.resourceFor(handle);
				const declared = node.accesses.find((entry) => (
					sameResource(entry.resource, handle)
						&& entry.access === access
						&& entry.textureView === undefined
						&& entry.textureViewDescriptor !== undefined
				));
				if (!declared?.textureViewDescriptor) {
					throw new Error(`Texture "${handle.label ?? handle.id}" was not declared with access "${access}" by node "${node.label ?? node.id}".`);
				}
				return this.materializeTextureView(
					textureFor(handle),
					declared.textureViewDescriptor,
					textureAccessUsage(access),
					`default:${handle.id}:${this.defaultViewRole(access)}`,
					options.textureViewCache,
				);
			}) as InternalExecuteContext['resolveTextureView'],
			resolveBuffer: (handle) => {
				assertActive();
				this.resourceFor(handle);
				if (!canResolve(handle)) {
					throw new Error(`Buffer "${handle.label ?? handle.id}" was not declared by node "${node.label ?? node.id}".`);
				}
				const buffer = options.resourceByLogicalId.get(handle.id);
				if (!buffer || 'createView' in buffer) {
					throw new Error(`Buffer "${handle.label ?? handle.id}" is not available during execute.`);
				}
				return buffer;
			},
			unwrap: (<TUse extends ResourceUse>(use: TUse): UnwrappedResource<TUse> => {
				assertActive();
				const internal = use as unknown as InternalUse;
				if (!node.uses.includes(internal)) {
					throw new Error(`Resource use was not declared by node "${node.label ?? node.id}".`);
				}
				const access = internal.accesses[0];
				if (!access) {
					throw new Error(`Resource use for node "${node.label ?? node.id}" has no normalized access.`);
				}
				if (internal.kind === 'buffer-use') {
					return context.resolveBuffer(internal.handle) as UnwrappedResource<TUse>;
				}
				if (internal.kind === 'texture-use' && (internal.access === TextureAccess.CopySrc || internal.access === TextureAccess.CopyDst)) {
					return context.resolveTexture(internal.handle) as UnwrappedResource<TUse>;
				}
				return (internal.kind === 'texture-view-use'
					? context.resolveTextureView(internal.handle)
					: context.resolveTextureView(internal.handle, internal.access as TextureViewAccess)) as UnwrappedResource<TUse>;
			}) as InternalExecuteContext['unwrap'],
			invalidate: () => {
				active = false;
			},
		};
		return context;
	}

	private createRenderPassDescriptor(
		node: InternalNode,
		ctx: InternalExecuteContext,
		gpuTimingQuery?: GpuTimingNodeQuery,
	): GPURenderPassDescriptor {
		if (!node.renderPass) {
			throw new Error(`Render node "${node.label ?? node.id}" is missing render pass metadata.`);
		}

		const colorAttachments = node.renderPass.colorAttachments.map((attachment): GPURenderPassColorAttachment => ({
			view: attachment.textureView
				? ctx.resolveTextureView(attachment.textureView)
				: ctx.resolveTextureView(attachment.target, TextureAccess.ColorAttachmentWrite),
			resolveTarget: attachment.resolveTarget
				? (attachment.resolveTextureView
					? ctx.resolveTextureView(attachment.resolveTextureView)
					: ctx.resolveTextureView(attachment.resolveTarget, TextureAccess.ColorAttachmentWrite))
				: undefined,
			depthSlice: attachment.depthSlice,
			loadOp: attachment.loadOp,
			storeOp: attachment.storeOp,
			clearValue: attachment.clearValue,
		}));

		let depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined;
		const depth = node.renderPass.depthStencilAttachment;
		if (depth) {
			depthStencilAttachment = {
				view: depth.textureView
					? ctx.resolveTextureView(depth.textureView)
					: ctx.resolveTextureView(depth.target, depth.depthReadOnly ? TextureAccess.DepthRead : TextureAccess.DepthWrite),
				depthClearValue: depth.depthLoadOp === 'clear'
					? depth.depthClearValue
					: undefined,
				depthLoadOp: depth.depthLoadOp,
				depthStoreOp: depth.depthStoreOp,
				depthReadOnly: depth.depthReadOnly,
			};
		}

		const timestampWrites = gpuTimingTimestampWrites(this.gpuProfiler, gpuTimingQuery);
		return {
			label: node.label,
			colorAttachments,
			depthStencilAttachment,
			...(timestampWrites ? { timestampWrites } : {}),
		};
	}

	private createComputePassDescriptor(node: InternalNode, gpuTimingQuery?: GpuTimingNodeQuery): GPUComputePassDescriptor {
		const timestampWrites = gpuTimingTimestampWrites(this.gpuProfiler, gpuTimingQuery);
		return {
			label: node.label,
			...(timestampWrites ? { timestampWrites } : {}),
		};
	}

	private executeCopyOperations(node: InternalNode, commandEncoder: GPUCommandEncoder, ctx: InternalExecuteContext): void {
		const resourceFor = (handle: ResourceHandle) => this.resourceFor(handle);
		for (const operation of node.copyOperations ?? []) {
			switch (operation.type) {
				case 'texture-to-texture':
					commandEncoder.copyTextureToTexture(
						{ texture: ctx.resolveTexture(operation.source), mipLevel: operation.sourceMipLevel, origin: operation.sourceOrigin, aspect: operation.sourceAspect ?? defaultTextureCopyAspect(resourceFor, operation.source) },
						{ texture: ctx.resolveTexture(operation.destination), mipLevel: operation.destinationMipLevel, origin: operation.destinationOrigin, aspect: operation.destinationAspect ?? defaultTextureCopyAspect(resourceFor, operation.destination) },
						operation.copySize,
					);
					break;
				case 'buffer-to-buffer':
					commandEncoder.copyBufferToBuffer(
						ctx.resolveBuffer(operation.source),
						operation.sourceOffset ?? 0,
						ctx.resolveBuffer(operation.destination),
						operation.destinationOffset ?? 0,
						operation.size,
					);
					break;
				case 'buffer-to-texture':
					commandEncoder.copyBufferToTexture(
						{ buffer: ctx.resolveBuffer(operation.source), ...operation.sourceLayout },
						{ texture: ctx.resolveTexture(operation.destination), mipLevel: operation.destinationMipLevel, origin: operation.destinationOrigin, aspect: operation.destinationAspect ?? defaultTextureCopyAspect(resourceFor, operation.destination) },
						operation.copySize,
					);
					break;
				case 'texture-to-buffer':
					commandEncoder.copyTextureToBuffer(
						{ texture: ctx.resolveTexture(operation.source), mipLevel: operation.sourceMipLevel, origin: operation.sourceOrigin, aspect: operation.sourceAspect ?? defaultTextureCopyAspect(resourceFor, operation.source) },
						{ buffer: ctx.resolveBuffer(operation.destination), ...operation.destinationLayout },
						operation.copySize,
					);
					break;
			}
		}
	}

	private executeClearBufferOperations(node: InternalNode, commandEncoder: GPUCommandEncoder, ctx: InternalExecuteContext): void {
		for (const operation of node.clearBufferOperations ?? []) {
			commandEncoder.clearBuffer(
				ctx.resolveBuffer(operation.target),
				operation.offset ?? 0,
				operation.size,
			);
		}
	}

	private addNode(desc: {
		readonly kind: NodeKind;
		readonly label?: string;
		readonly accesses: readonly InternalAccess[];
		readonly uses: readonly InternalUse[];
		readonly sideEffect: boolean;
		readonly renderPass?: InternalNode['renderPass'];
		readonly copyOperations?: readonly CopyOperation[];
		readonly clearBufferOperations?: readonly ClearBufferOperation[];
		readonly renderEncode?: (ctx: RenderEncodeContext) => void;
		readonly computeEncode?: (ctx: ComputeEncodeContext) => void;
		readonly commandEncode?: (ctx: CommandEncodeContext) => void;
		readonly externalSubmit?: (ctx: ExternalSubmissionContext) => void;
	}): void {
		// A node observes one pre-node value regardless of declaration order. Reads
		// therefore enter dependency analysis before writes so a same-node write
		// cannot become the producer of that node's read or preserve requirement.
		const accesses = [
			...desc.accesses.filter((access) => access.mode === 'read'),
			...desc.accesses.filter((access) => access.mode === 'write'),
		];
		for (const access of accesses) {
			this.assertKnownResource(access.resource);
		}
		const node = { id: this.nextNodeId++, kind: desc.kind, label: desc.label };
		const debugGroupId = this.debugGroupStack.at(-1);
		if (debugGroupId !== undefined) {
			this.nodeDebugGroupIds.set(node.id, debugGroupId);
		}
		this.nodes.push({
			...node,
			accesses,
			uses: desc.uses,
			sideEffect: desc.sideEffect,
			renderPass: desc.renderPass,
			copyOperations: desc.copyOperations,
			clearBufferOperations: desc.clearBufferOperations,
			renderEncode: desc.renderEncode,
			computeEncode: desc.computeEncode,
			commandEncode: desc.commandEncode,
			externalSubmit: desc.externalSubmit,
		});
		this.invalidate();
	}

	private internalUses(uses: readonly ResourceUse[] | undefined): InternalUse[] {
		const result = (uses ?? []).map((use) => use as unknown as InternalUse);
		for (let index = 0; index < result.length; index++) {
			const use = result[index];
			if (use.owner !== this.recordingOwner || !Array.isArray(use.accesses)) {
				throw new Error('Resource use does not belong to the current FrameGraph recording.');
			}
			if (result.indexOf(use) !== index) {
				throw new Error('A node cannot declare the same resource use token more than once.');
			}
		}
		return result;
	}

	private createAccess(access: ResourceAccess, producesValue?: boolean): InternalAccess {
		const mode = this.accessMode(access);
		const contents = mode === 'write' ? access.contents : undefined;
		if (mode === 'write' && contents === undefined) {
			throw new Error('Internal FrameGraph write access requires explicit contents.');
		}
		if (access.resource.kind === 'texture-view') {
			if (access.access === TextureAccess.CopySrc || access.access === TextureAccess.CopyDst) {
				throw new Error('Texture views cannot be used for copy access.');
			}
			const view = this.textureViewFor(access.resource);
			return this.createTextureAccess(
				view.texture,
				access.access as TextureAccess,
				view.region,
				view.handle,
				view.descriptor,
				producesValue,
				access.contents,
			);
		}
		if (access.resource.kind === 'texture') {
			if (access.access === TextureAccess.CopySrc || access.access === TextureAccess.CopyDst) {
				return this.createTextureAccess(
					access.resource,
					access.access,
					this.fullTextureRegion(access.resource, access.access),
					undefined,
					undefined,
					producesValue,
					access.contents,
				);
			}
			const textureAccess = access.access as TextureAccess;
			const view = this.resolveTextureViewBinding(access.resource, this.defaultViewRole(textureAccess));
			return this.createTextureAccess(
				access.resource,
				textureAccess,
				view.region,
				undefined,
				view.descriptor,
				producesValue,
				access.contents,
			);
		}
		return {
			resource: access.resource as BufferHandle,
			access: access.access as BufferAccess,
			bufferRange: 'bufferRange' in access ? access.bufferRange : undefined,
			mode,
			consumesPreviousValue: mode === 'read' || contents === 'preserve',
			producesValue: producesValue ?? mode === 'write',
			contents,
		};
	}

	private createAccesses(access: ResourceAccess, producesValue?: boolean): InternalAccess[] {
		const internal = this.createAccess(access, producesValue);
		if (
			internal.resource.kind !== 'texture'
			|| internal.access !== TextureAccess.Sampled
			|| !internal.textureRegion
			|| internal.textureRegion.mipLevelCount === 1
		) {
			return [internal];
		}
		const desc = this.resourceFor(internal.resource).desc as TextureDesc;
		if ((desc.dimension ?? '2d') !== '3d') {
			return [internal];
		}
		const [, , baseDepth] = textureSizeTuple(desc.size);
		return Array.from({ length: internal.textureRegion.mipLevelCount }, (_, offset) => {
			const mipLevel = internal.textureRegion!.baseMipLevel + offset;
			return {
				...internal,
				textureRegion: {
					...internal.textureRegion!,
					baseMipLevel: mipLevel,
					mipLevelCount: 1,
					baseDepthSlice: 0,
					depthSliceCount: Math.max(1, baseDepth >> mipLevel),
				},
			};
		});
	}

	private createTextureAccess(
		resource: TextureHandle,
		access: TextureAccess,
		textureRegion: InternalTextureRegion,
		textureView?: TextureViewHandle,
		textureViewDescriptor?: GPUTextureViewDescriptor,
		producesValue?: boolean,
		contents?: WriteContents,
	): InternalAccess {
		const mode = textureAccessMode(access);
		const normalizedContents = mode === 'write' ? contents : undefined;
		if (mode === 'write' && normalizedContents === undefined) {
			throw new Error('Internal FrameGraph texture write access requires explicit contents.');
		}
		return {
			resource,
			access,
			mode,
			consumesPreviousValue: mode === 'read' || normalizedContents === 'preserve',
			producesValue: producesValue ?? mode === 'write',
			contents: normalizedContents,
			textureView,
			textureViewDescriptor,
			textureRegion,
		};
	}

	private accessMode(access: ResourceAccess): InternalAccess['mode'] {
		if (access.resource.kind === 'texture' || access.resource.kind === 'texture-view') {
			if (!textureAccessValues.has(access.access)) {
				throw new Error(`Texture cannot use BufferAccess. Resource "${access.resource.label ?? access.resource.id}" declares invalid texture access "${access.access}".`);
			}
			return textureAccessMode(access.access as TextureAccess);
		}
		if (!bufferAccessValues.has(access.access)) {
			throw new Error(`Buffer resources cannot use TextureAccess. Resource "${access.resource.label ?? access.resource.id}" declares invalid buffer access "${access.access}".`);
		}
		return bufferAccessMode(access.access as BufferAccess);
	}

	private validateAccess(access: InternalAccess, node: InternalNode): InternalResource {
		// Compile-time validation covers resource semantics. Access kind was already
		// validated when the internal access edge was recorded.
		const resource = this.resourceFor(access.resource);
		if (access.resource.kind === 'texture') {
			this.validateTextureRegion(access.resource, access.textureRegion!);
			const textureAccess = access.access as TextureAccess;
			const format = access.textureView
				? this.textureViewFor(access.textureView).desc.format
				: (resource.desc as TextureDesc).format;
			const formatCapabilities = textureAccess === TextureAccess.CopySrc || textureAccess === TextureAccess.CopyDst
				? undefined
				: getTextureFormatCapabilities(format);
			const depthFormat = formatCapabilities?.kind === 'depth'
				|| formatCapabilities?.kind === 'depth-stencil'
				|| formatCapabilities?.kind === 'stencil';
			const sampleCount = (resource.desc as TextureDesc).sampleCount ?? 1;
			if ((textureAccess === TextureAccess.DepthRead || textureAccess === TextureAccess.DepthWrite) && !depthFormat) {
				throw new Error(`Node "${node.label ?? node.id}" declares texture "${access.resource.label ?? access.resource.id}" access "${textureAccess}" with format "${format}". Depth attachment access requires a depth or depth-stencil format.`);
			}
			if (textureAccess === TextureAccess.ColorAttachmentWrite && depthFormat) {
				throw new Error(`Node "${node.label ?? node.id}" declares texture "${access.resource.label ?? access.resource.id}" access "${textureAccess}" with depth format "${format}". ColorAttachment access requires a renderable color format.`);
			}
			if (textureAccess === TextureAccess.ColorAttachmentWrite && !formatCapabilities?.colorRenderable) {
				throw new Error(`Node "${node.label ?? node.id}" declares texture "${access.resource.label ?? access.resource.id}" access "${textureAccess}" with format "${format}". ColorAttachment access requires a renderable color format.`);
			}
			if (textureAccess === TextureAccess.Sampled && !formatCapabilities?.sampleable) {
				throw new Error(`Node "${node.label ?? node.id}" declares texture "${access.resource.label ?? access.resource.id}" access "${textureAccess}". Sampled access requires a sampleable format; actual format "${format}" is not sampleable.`);
			}
			if (
				(textureAccess === TextureAccess.StorageRead
					|| textureAccess === TextureAccess.StorageWrite
					|| textureAccess === TextureAccess.CopySrc
					|| textureAccess === TextureAccess.CopyDst)
				&& sampleCount > 1
			) {
				throw new Error(`Node "${node.label ?? node.id}" declares texture "${access.resource.label ?? access.resource.id}" access "${textureAccess}" with sampleCount ${sampleCount}. This WebGPU access requires a single-sampled texture.`);
			}
			if ((textureAccess === TextureAccess.StorageRead || textureAccess === TextureAccess.StorageWrite) && !formatCapabilities?.storage) {
				throw new Error(`Node "${node.label ?? node.id}" declares texture "${access.resource.label ?? access.resource.id}" ${textureAccess} access. Storage texture access requires a storage-capable format; actual format "${format}" is not storage-capable.`);
			}
			if (access.textureViewDescriptor) {
				this.validateTextureViewDescriptor(access.resource, access.textureViewDescriptor, access.textureRegion!, textureAccess, node);
			}
			return resource;
		}
		if (access.bufferRange) {
			this.validateBufferAccessRange(access.resource, access.bufferRange);
		}
		return resource;
	}

	private validateDeclaredUsage(): void {
		for (const resource of this.resources.values()) {
			const declaredUsage = resource.desc.usage ?? 0;
			const missingUsage = resource.requiredUsage & ~declaredUsage;
			if (declaredUsage !== 0 && missingUsage !== 0) {
				throw this.missingDeclaredUsageError('Resource', resource, declaredUsage, missingUsage);
			}
			if (resource.origin !== 'transient') {
				this.validateImportedDescriptor(resource);
				if (missingUsage !== 0) {
					throw this.missingDeclaredUsageError('Imported resource', resource, declaredUsage, missingUsage);
				}
			}
		}
	}

	private missingDeclaredUsageError(
		resourcePrefix: 'Resource' | 'Imported resource',
		resource: InternalResource,
		declaredUsage: number,
		missingUsage: number,
	): Error {
		return new Error(`${resourcePrefix} "${resource.handle.label ?? resource.handle.id}" declared usage ${formatUsageFlags(declaredUsage)} is missing required WebGPU usage ${formatUsageFlags(missingUsage)}. Required usage: ${formatUsageFlags(resource.requiredUsage)}.`);
	}

	private validateImportedDescriptor(resource: InternalResource): void {
		if (resource.handle.kind === 'texture') {
			const texture = resource.physical as GPUTexture | undefined;
			if (!texture) {
				return;
			}
			const desc = resource.desc as TextureDesc;
			const usage = desc.usage ?? 0;
			if ((texture.usage & usage) !== usage) {
				const missingUsage = usage & ~texture.usage;
				throw new Error(this.importedDescriptorMismatch(resource, 'usage', `exposed usage ${formatUsageFlags(usage)}, actual GPU texture usage ${formatUsageFlags(texture.usage)}, missing ${formatUsageFlags(missingUsage)}`));
			}
			return;
		}

		const buffer = resource.physical as GPUBuffer | undefined;
		if (!buffer) {
			return;
		}
		const desc = resource.desc as BufferDesc;
		if (buffer.size < desc.size) {
			throw new Error(this.importedDescriptorMismatch(resource, 'size', `expected at least ${desc.size} bytes, actual GPU buffer size ${buffer.size} bytes`));
		}
		const usage = desc.usage ?? 0;
		if ((buffer.usage & usage) !== usage) {
			const missingUsage = usage & ~buffer.usage;
			throw new Error(this.importedDescriptorMismatch(resource, 'usage', `exposed usage ${formatUsageFlags(usage)}, actual GPU buffer usage ${formatUsageFlags(buffer.usage)}, missing ${formatUsageFlags(missingUsage)}`));
		}
	}

	private importedDescriptorMismatch(resource: InternalResource, property: string, details: string): string {
		return `Imported ${resource.handle.kind} "${resource.handle.label ?? resource.handle.id}" descriptor mismatch for ${property}: ${details}. ${this.resourceAccessContext(resource.handle)}`;
	}

	private resourceAccessContext(handle: ResourceHandle): string {
		const accesses = this.nodes.flatMap((node) => node.accesses
			.filter((access) => sameResource(access.resource, handle))
			.map((access) => `node "${node.label ?? node.id}" ${access.mode} access "${access.access}"`));
		if (accesses.length === 0) {
			return 'No graph node access is declared for this resource.';
		}
		return `Declared accesses: ${accesses.join('; ')}.`;
	}

	private validateNodeDescriptor(node: InternalNode): void {
		if (node.kind === 'render') {
			this.validateRenderPassDescriptor(node);
			return;
		}
		if (node.kind === 'copy') {
			validateCopyNodeDescriptor((handle) => this.resourceFor(handle), node);
			return;
		}
		if (node.kind === 'clear-buffer') {
			this.validateClearBufferNodeDescriptor(node);
		}
	}

	private validateRenderPassDescriptor(node: InternalNode): void {
		if (!node.renderPass) {
			throw new Error(`Render node "${node.label ?? node.id}" is missing render pass metadata.`);
		}

		let attachmentReference: RenderAttachmentCompatibility | undefined;
		for (const attachment of node.renderPass.colorAttachments) {
			const target = this.resourceFor(attachment.target);
			const targetDesc = target.desc as TextureDesc;
			const targetFormat = attachment.targetViewDescriptor.format ?? targetDesc.format;
			if (isDepthFormat(targetFormat) || !isColorRenderableFormat(targetFormat)) {
				throw new Error(`Render node "${node.label ?? node.id}" color attachment "${attachment.target.label ?? attachment.target.id}" requires a renderable color format. Received "${targetFormat}".`);
			}
			this.validateTextureRegion(attachment.target, attachment.textureRegion);
			this.validateColorAttachmentView(node, attachment);
			if (attachment.resolveTarget) {
				const resolve = this.resourceFor(attachment.resolveTarget);
				const resolveDesc = resolve.desc as TextureDesc;
				const resolveFormat = attachment.resolveTargetViewDescriptor?.format ?? resolveDesc.format;
				this.validateTextureRegion(attachment.resolveTarget, attachment.resolveTextureRegion!);
				this.validateResolveTargetView(node, attachment);
				if (targetFormat !== resolveFormat) {
					throw new Error(`Render node "${node.label ?? node.id}" resolve target "${attachment.resolveTarget.label ?? attachment.resolveTarget.id}" format mismatch: color attachment "${attachment.target.label ?? attachment.target.id}" is "${targetFormat}", resolve target is "${resolveFormat}". WebGPU resolve target format must match the color attachment format.`);
				}
				const targetExtent = textureRenderExtent(targetDesc, attachment.textureRegion.baseMipLevel);
				const resolveExtent = textureRenderExtent(resolveDesc, attachment.resolveTextureRegion!.baseMipLevel);
				if (targetExtent[0] !== resolveExtent[0] || targetExtent[1] !== resolveExtent[1]) {
					throw new Error(`Render node "${node.label ?? node.id}" resolve target "${attachment.resolveTarget.label ?? attachment.resolveTarget.id}" render extent mismatch: color attachment "${attachment.target.label ?? attachment.target.id}" mip ${attachment.textureRegion.baseMipLevel} is ${targetExtent.join('x')}, resolve target mip ${attachment.resolveTextureRegion!.baseMipLevel} is ${resolveExtent.join('x')}. WebGPU resolve target render extent must match the color attachment render extent.`);
				}
				if ((targetDesc.sampleCount ?? 1) <= 1) {
					throw new Error(`Render node "${node.label ?? node.id}" color attachment "${attachment.target.label ?? attachment.target.id}" sampleCount is ${targetDesc.sampleCount ?? 1}. WebGPU render resolve source must be multisampled.`);
				}
				if ((resolveDesc.sampleCount ?? 1) !== 1) {
					throw new Error(`Render node "${node.label ?? node.id}" resolve target "${attachment.resolveTarget.label ?? attachment.resolveTarget.id}" sampleCount is ${resolveDesc.sampleCount ?? 1}. WebGPU render resolve target must be single-sampled.`);
				}
			}
			attachmentReference = this.validateRenderAttachmentCompatibility(
				node,
				attachment.target,
				attachment.textureRegion,
				attachmentReference,
			);
		}

		this.validateRenderPassTextureAccessConflicts(node);

		const depth = node.renderPass.depthStencilAttachment;
		if (depth) {
			const target = this.resourceFor(depth.target);
			const targetDesc = target.desc as TextureDesc;
			if (getTextureFormatCapabilities(targetDesc.format).kind !== 'depth') {
				throw new Error(`Render node "${node.label ?? node.id}" depth attachment "${depth.target.label ?? depth.target.id}" has format "${targetDesc.format}". Depth attachment access requires a pure depth format.`);
			}
			this.validateDepthAttachmentOperations(node, depth);
			this.validateTextureRegion(depth.target, depth.textureRegion);
			this.validateDepthAttachmentView(node, depth);
			this.validateRenderAttachmentCompatibility(node, depth.target, depth.textureRegion, attachmentReference);
		}
	}

	private validateDepthAttachmentOperations(
		node: InternalNode,
		depth: NonNullable<NonNullable<InternalNode['renderPass']>['depthStencilAttachment']>,
	): void {
		const nodeLabel = node.label ?? node.id;
		const attachmentLabel = depth.target.label ?? depth.target.id;
		if (depth.depthReadOnly) {
			if (depth.depthLoadOp !== undefined || depth.depthStoreOp !== undefined) {
				throw new Error(`Render node "${nodeLabel}" read-only depth attachment "${attachmentLabel}" must not provide depthLoadOp or depthStoreOp.`);
			}
			return;
		}
		if (depth.depthLoadOp === undefined || depth.depthStoreOp === undefined) {
			throw new Error(`Render node "${nodeLabel}" writable depth attachment "${attachmentLabel}" must provide depthLoadOp and depthStoreOp.`);
		}
		if (depth.depthLoadOp !== 'clear') {
			return;
		}
		if (depth.depthClearValue === undefined) {
			throw new Error(`Render node "${nodeLabel}" cleared depth attachment "${attachmentLabel}" must provide depthClearValue.`);
		}
		if (!Number.isFinite(depth.depthClearValue) || depth.depthClearValue < 0 || depth.depthClearValue > 1) {
			throw new Error(`Render node "${nodeLabel}" cleared depth attachment "${attachmentLabel}" depthClearValue must be between 0 and 1. Received ${depth.depthClearValue}.`);
		}
	}

	private validateColorAttachmentView(
		node: InternalNode,
		attachment: NonNullable<InternalNode['renderPass']>['colorAttachments'][number],
	): void {
		const dimension = attachment.targetViewDescriptor.dimension;
		if (
			attachment.textureRegion.mipLevelCount !== 1
			|| attachment.textureRegion.arrayLayerCount !== 1
			|| (dimension !== '2d' && dimension !== '2d-array' && dimension !== '3d')
		) {
			throw new Error(`Render node "${node.label ?? node.id}" color attachment "${attachment.target.label ?? attachment.target.id}" must use a single-mip, single-layer 2d, 2d-array, or 3d view.`);
		}
		if ((attachment.targetViewDescriptor.swizzle ?? 'rgba') !== 'rgba') {
			throw new Error(`Render node "${node.label ?? node.id}" color attachment views cannot use component swizzle.`);
		}
		if (dimension === '3d' && attachment.depthSlice === undefined) {
			throw new Error(`Render node "${node.label ?? node.id}" 3d color attachment "${attachment.target.label ?? attachment.target.id}" requires depthSlice.`);
		}
		if (dimension !== '3d' && attachment.depthSlice !== undefined) {
			throw new Error(`Render node "${node.label ?? node.id}" color attachment "${attachment.target.label ?? attachment.target.id}" provides depthSlice for a non-3d view.`);
		}
	}

	private validateResolveTargetView(
		node: InternalNode,
		attachment: NonNullable<InternalNode['renderPass']>['colorAttachments'][number],
	): void {
		const dimension = attachment.resolveTargetViewDescriptor?.dimension;
		if (
			attachment.resolveTextureRegion?.mipLevelCount !== 1
			|| attachment.resolveTextureRegion.arrayLayerCount !== 1
			|| (dimension !== '2d' && dimension !== '2d-array')
		) {
			throw new Error(`Render node "${node.label ?? node.id}" resolve target "${attachment.resolveTarget?.label ?? attachment.resolveTarget?.id}" must use a single-mip, single-layer 2d or 2d-array view.`);
		}
		if ((attachment.resolveTargetViewDescriptor?.swizzle ?? 'rgba') !== 'rgba') {
			throw new Error(`Render node "${node.label ?? node.id}" resolve target views cannot use component swizzle.`);
		}
	}

	private validateDepthAttachmentView(
		node: InternalNode,
		depth: NonNullable<NonNullable<InternalNode['renderPass']>['depthStencilAttachment']>,
	): void {
		const dimension = depth.targetViewDescriptor.dimension;
		if (
			depth.textureRegion.mipLevelCount !== 1
			|| depth.textureRegion.arrayLayerCount !== 1
			|| (dimension !== '2d' && dimension !== '2d-array')
		) {
			throw new Error(`Render node "${node.label ?? node.id}" depth attachment "${depth.target.label ?? depth.target.id}" must use a single-mip, single-layer 2d or 2d-array view.`);
		}
		if ((depth.targetViewDescriptor.swizzle ?? 'rgba') !== 'rgba') {
			throw new Error(`Render node "${node.label ?? node.id}" depth attachment views cannot use component swizzle.`);
		}
	}

	private validateRenderAttachmentCompatibility(
		node: InternalNode,
		handle: TextureHandle,
		range: InternalTextureRegion,
		reference: RenderAttachmentCompatibility | undefined,
	): RenderAttachmentCompatibility {
		const desc = this.resourceFor(handle).desc as TextureDesc;
		const attachment = {
			handle,
			baseMipLevel: range.baseMipLevel,
			extent: textureRenderExtent(desc, range.baseMipLevel),
			sampleCount: desc.sampleCount ?? 1,
		};
		if (!reference) {
			return attachment;
		}
		if (attachment.sampleCount !== reference.sampleCount) {
			throw new Error(`Render node "${node.label ?? node.id}" attachment "${handle.label ?? handle.id}" sampleCount ${attachment.sampleCount} does not match attachment "${reference.handle.label ?? reference.handle.id}" sampleCount ${reference.sampleCount}. WebGPU render pass color and depth attachments must have matching sample counts.`);
		}
		if (attachment.extent[0] !== reference.extent[0] || attachment.extent[1] !== reference.extent[1]) {
			throw new Error(`Render node "${node.label ?? node.id}" attachment "${handle.label ?? handle.id}" mip ${attachment.baseMipLevel} render extent ${attachment.extent.join('x')} does not match attachment "${reference.handle.label ?? reference.handle.id}" mip ${reference.baseMipLevel} render extent ${reference.extent.join('x')}. WebGPU render pass color and depth attachment render extents must match.`);
		}
		return reference;
	}

	private validateRenderPassTextureAccessConflicts(node: InternalNode): void {
		for (let i = 0; i < node.accesses.length; i++) {
			const first = node.accesses[i];
			if (first.resource.kind !== 'texture') {
				continue;
			}
			for (let j = i + 1; j < node.accesses.length; j++) {
				const second = node.accesses[j];
				if (second.resource.kind !== 'texture') {
					continue;
				}
				if (!sameResource(first.resource, second.resource)) {
					continue;
				}
				if (!textureRegionsOverlap(
					resolveTextureAccessRange((handle) => this.resourceFor(handle), first),
					resolveTextureAccessRange((handle) => this.resourceFor(handle), second),
				)) {
					continue;
				}
				const hasWrite = first.mode === 'write' || second.mode === 'write';
				if (!hasWrite) {
					continue;
				}
				throw new Error(`Render pass "${node.label ?? node.id}" has overlapping texture accesses for "${first.resource.label ?? first.resource.id}": ${first.access} (${first.mode}) conflicts with ${second.access} (${second.mode}) on overlapping subresources. WebGPU does not allow simultaneous read/write or write/write aliasing within a pass.`);
			}
		}
	}

	private validateTextureRegion(handle: TextureHandle, range: InternalTextureRegion): void {
		const desc = this.resourceFor(handle).desc as TextureDesc;
		const [, , depthOrArrayLayers] = textureSizeTuple(desc.size);
		const mipLevelCount = desc.mipLevelCount ?? 1;
		const prefix = `Texture view range for "${handle.label ?? handle.id}"`;
		assertNonNegativeUint32(range.baseMipLevel, `${prefix} baseMipLevel`);
		assertPositiveUint32(range.mipLevelCount, `${prefix} mipLevelCount`);
		if (range.baseMipLevel + range.mipLevelCount > mipLevelCount) {
			throw new Error(`Texture view range for "${handle.label ?? handle.id}" exceeds declared mip levels.`);
		}
		const dimension = desc.dimension ?? '2d';
		const maxArrayLayers = dimension === '2d' ? depthOrArrayLayers : 1;
		assertNonNegativeUint32(range.baseArrayLayer, `${prefix} baseArrayLayer`);
		assertPositiveUint32(range.arrayLayerCount, `${prefix} arrayLayerCount`);
		if (range.baseArrayLayer + range.arrayLayerCount > maxArrayLayers) {
			throw new Error(`Texture view range for "${handle.label ?? handle.id}" exceeds declared array layers.`);
		}
		const maxDepth = dimension === '3d'
			? Math.max(1, Math.floor(depthOrArrayLayers / (2 ** range.baseMipLevel)))
			: 1;
		assertNonNegativeUint32(range.baseDepthSlice, `${prefix} baseDepthSlice`);
		assertPositiveUint32(range.depthSliceCount, `${prefix} depthSliceCount`);
		if (range.baseDepthSlice + range.depthSliceCount > maxDepth) {
			throw new Error(`Texture view range for "${handle.label ?? handle.id}" exceeds declared depth slices.`);
		}
	}

	private validateClearBufferNodeDescriptor(node: InternalNode): void {
		for (const operation of node.clearBufferOperations ?? []) {
			this.validateBufferClearRange(operation.target, operation.offset ?? 0, operation.size);
		}
	}

	private validateBufferClearRange(handle: BufferHandle, offset: GPUSize64, size: GPUSize64 | undefined): void {
		const resource = this.resourceFor(handle);
		const desc = resource.desc as BufferDesc;
		const prefix = `Buffer clear range for "${handle.label ?? handle.id}"`;
		assertNonNegativeSafeInteger(offset, `${prefix} offset`);
		if (size !== undefined) {
			assertNonNegativeSafeInteger(size, `${prefix} size`);
		}
		const resolvedSize = size ?? desc.size - offset;
		if (offset > desc.size || resolvedSize > desc.size - offset) {
			throw new Error(`Buffer clear range exceeds buffer "${handle.label ?? handle.id}" size.`);
		}
		if (offset % 4 !== 0 || resolvedSize % 4 !== 0) {
			throw new Error('Buffer clear offset and size must be 4-byte aligned.');
		}
	}

	private validateBufferAccessRange(handle: BufferHandle, range: BufferRange): void {
		const prefix = `Buffer access range for "${handle.label ?? handle.id}"`;
		assertNonNegativeSafeInteger(range.offset, `${prefix} offset`);
		if (range.size !== undefined) {
			assertNonNegativeSafeInteger(range.size, `${prefix} size`);
		}
		const resolved = resolveBufferRange((resource) => this.resourceFor(resource), handle, range);
		const descriptorSize = (this.resourceFor(handle).desc as BufferDesc).size;
		if (resolved.offset > descriptorSize || resolved.size > descriptorSize - resolved.offset) {
			throw new Error(`Buffer access range exceeds buffer "${handle.label ?? handle.id}" size.`);
		}
	}

	private addRetainedUsage(access: InternalAccess): void {
		const resource = this.resourceFor(access.resource);
		this.addUsage(resource, access);
		if (access.textureView) {
			const view = this.textureViewFor(access.textureView);
			view.requiredUsage = (
				view.requiredUsage
				| textureAccessUsage(access.access as TextureAccess)
			) as GPUTextureUsageFlags;
		}
	}

	private addUsage(resource: InternalResource, access: InternalAccess): void {
		if (resource.handle.kind === 'texture') {
			this.addTextureUsage(resource, access.access as TextureAccess);
		}
		else {
			resource.requiredUsage = (resource.requiredUsage | bufferAccessUsage(access.access as BufferAccess)) as never;
		}
	}

	private addTextureUsage(resource: InternalResource, access: TextureAccess): void {
		if (resource.handle.kind !== 'texture') {
			throw new Error('Cannot add texture usage to a buffer resource.');
		}
		resource.requiredUsage = (resource.requiredUsage | textureAccessUsage(access)) as never;
	}

	private validateReadbackBuffer(resource: InternalResource): void {
		if (resource.handle.kind !== 'buffer') {
			throw new Error('Readback can only be marked on a buffer resource.');
		}
		if (resource.origin !== 'imported') {
			throw new Error(`Readback buffer "${resource.handle.label ?? resource.handle.id}" must be caller-owned and registered with importBuffer().`);
		}
		const usage = (resource.desc as BufferDesc).usage ?? 0;
		const mapRead = bufferUsageFlag('MAP_READ');
		const copyDst = bufferUsageFlag('COPY_DST');
		if ((usage & mapRead) !== mapRead) {
			throw new Error(`Readback buffer "${resource.handle.label ?? resource.handle.id}" must declare GPUBufferUsage.MAP_READ.`);
		}
		if ((usage & copyDst) !== copyDst) {
			throw new Error(`Readback buffer "${resource.handle.label ?? resource.handle.id}" must declare GPUBufferUsage.COPY_DST.`);
		}
		if ((usage & ~(mapRead | copyDst)) !== 0) {
			throw new Error(`Readback buffer "${resource.handle.label ?? resource.handle.id}" usage must only combine MAP_READ with COPY_DST.`);
		}
	}

	private effectiveResourceUsage(resource: InternalResource): GPUTextureUsageFlags | GPUBufferUsageFlags {
		return resource.desc.usage ?? resource.requiredUsage;
	}

	private resourcePoolKey(resource: InternalResource): string {
		if (resource.handle.kind === 'texture') {
			return texturePoolKey(resource.desc as TextureDesc, this.effectiveResourceUsage(resource) as GPUTextureUsageFlags);
		}
		return bufferPoolKey(resource.desc as BufferDesc, this.effectiveResourceUsage(resource) as GPUBufferUsageFlags);
	}

	private resolveTextureViewBinding(
		handle: TextureHandle | TextureViewHandle,
		role: TextureViewDefaultRole,
		depthSlice?: number,
	): NormalizedTextureView & { readonly texture: TextureHandle; readonly textureView?: TextureViewHandle } {
		const resolved = handle.kind === 'texture-view'
			? (() => {
				const view = this.textureViewFor(handle);
				return {
					desc: view.desc,
					descriptor: view.descriptor,
					region: view.region,
					texture: view.texture,
					textureView: view.handle,
				};
			})()
			: {
				...normalizeTextureView(handle, this.resourceFor(handle).desc as TextureDesc, undefined, role),
				texture: handle,
			};
		if (resolved.desc.dimension !== '3d' || depthSlice === undefined) {
			return resolved;
		}
		return {
			...resolved,
			region: {
				...resolved.region,
				baseDepthSlice: depthSlice,
				depthSliceCount: 1,
			},
		};
	}

	private defaultViewRole(access: TextureAccess): TextureViewDefaultRole {
		switch (access) {
			case TextureAccess.StorageRead:
			case TextureAccess.StorageWrite:
				return 'storage';
			case TextureAccess.ColorAttachmentWrite:
				return 'color-attachment';
			case TextureAccess.DepthRead:
			case TextureAccess.DepthWrite:
				return 'depth-attachment';
			default:
				return 'generic';
		}
	}

	private fullTextureRegion(handle: TextureHandle, access: TextureAccess): InternalTextureRegion {
		const desc = this.resourceFor(handle).desc as TextureDesc;
		const [, , depthOrArrayLayers] = textureSizeTuple(desc.size);
		const dimension = desc.dimension ?? '2d';
		return {
			baseMipLevel: 0,
			mipLevelCount: desc.mipLevelCount ?? 1,
			baseArrayLayer: 0,
			arrayLayerCount: dimension === '2d' ? depthOrArrayLayers : 1,
			baseDepthSlice: 0,
			depthSliceCount: dimension === '3d' ? depthOrArrayLayers : 1,
			aspect: access === TextureAccess.DepthRead || access === TextureAccess.DepthWrite ? 'depth-only' : 'all',
		};
	}

	private textureViewFor(handle: TextureViewHandle): InternalTextureView {
		if (!isHandleOwnedBy(handle, this.recordingOwner)) {
			throw new Error(`Texture view handle "${handle.label ?? handle.id}" does not belong to the current FrameGraph recording.`);
		}
		const view = this.textureViews.get(handle.id);
		if (!view) {
			throw new Error(`Unknown texture view "${handle.label ?? handle.id}".`);
		}
		if (view.handle !== handle) {
			throw new Error(`Texture view handle "${handle.label ?? handle.id}" does not belong to the current FrameGraph recording.`);
		}
		return view;
	}

	private materializeTextureView(
		texture: GPUTexture,
		descriptor: GPUTextureViewDescriptor,
		usage: GPUTextureUsageFlags,
		cacheKey: string,
		cache: Map<string, GPUTextureView>,
	): GPUTextureView {
		const cached = cache.get(cacheKey);
		if (cached) {
			return cached;
		}
		const view = texture.createView({
			...descriptor,
			...(usage !== 0 ? { usage } : {}),
		});
		cache.set(cacheKey, view);
		return view;
	}

	private validateTextureDescriptor(desc: TextureDesc): void {
		const prefix = `Texture descriptor "${desc.label ?? 'unlabeled'}"`;
		const [width, height, depthOrArrayLayers] = textureSizeTuple(desc.size);
		assertPositiveUint32(width, `${prefix} size.width`);
		assertPositiveUint32(height, `${prefix} size.height`);
		assertPositiveUint32(depthOrArrayLayers, `${prefix} size.depthOrArrayLayers`);
		const mipLevelCount = desc.mipLevelCount ?? 1;
		assertPositiveUint32(mipLevelCount, `${prefix} mipLevelCount`);
		const maximumMipLevelCount = this.maximumMipLevelCount(desc, width, height, depthOrArrayLayers);
		if (mipLevelCount > maximumMipLevelCount) {
			throw new Error(`${prefix} mipLevelCount must not exceed ${maximumMipLevelCount} for its declared size and dimension. Received ${mipLevelCount}.`);
		}
		const sampleCount = desc.sampleCount ?? 1;
		assertPositiveUint32(sampleCount, `${prefix} sampleCount`);
		if (sampleCount !== 1 && sampleCount !== 4) {
			throw new Error(`${prefix} sampleCount must be either 1 or 4. Received ${sampleCount}.`);
		}
		if (hasStencilAspect(desc.format)) {
			throw new Error(`FrameGraph does not support stencil texture format "${desc.format}".`);
		}
		const seen = new Set<GPUTextureFormat>();
		for (const viewFormat of desc.viewFormats ?? []) {
			if (seen.has(viewFormat)) {
				throw new Error(`Texture viewFormats contains duplicate format "${viewFormat}".`);
			}
			seen.add(viewFormat);
			if (hasStencilAspect(viewFormat)) {
				throw new Error(`FrameGraph does not support stencil view format "${viewFormat}".`);
			}
			if (!areTextureViewFormatsCompatible(desc.format, viewFormat)) {
				throw new Error(`Texture view format "${viewFormat}" is not compatible with texture format "${desc.format}".`);
			}
		}
	}

	private maximumMipLevelCount(
		desc: TextureDesc,
		width: number,
		height: number,
		depthOrArrayLayers: number,
	): number {
		const dimension = desc.dimension ?? '2d';
		const maximumDimension = dimension === '1d'
			? width
			: dimension === '3d'
				? Math.max(width, height, depthOrArrayLayers)
				: Math.max(width, height);
		return Math.floor(Math.log2(maximumDimension)) + 1;
	}

	private validateBufferDescriptor(desc: BufferDesc, transient: boolean): void {
		const prefix = `Buffer descriptor "${desc.label ?? 'unlabeled'}"`;
		assertNonNegativeSafeInteger(desc.size, `${prefix} size`);
		if (transient) {
			bufferAllocationSize(desc.size);
		}
	}

	private validateTextureViewDescriptor(
		handle: TextureHandle,
		descriptor: GPUTextureViewDescriptor,
		region: InternalTextureRegion,
		access: TextureAccess,
		node: InternalNode,
	): void {
		const desc = this.resourceFor(handle).desc as TextureDesc;
		const format = descriptor.format ?? desc.format;
		if (format !== desc.format && !(desc.viewFormats ?? []).includes(format)) {
			throw new Error(`Texture view format "${format}" for "${handle.label ?? handle.id}" was not declared in viewFormats.`);
		}
		if (!areTextureViewFormatsCompatible(desc.format, format)) {
			throw new Error(`Texture view format "${format}" is not compatible with texture format "${desc.format}".`);
		}
		const dimension = descriptor.dimension!;
		const textureDimension = desc.dimension ?? '2d';
		const [, , layers] = textureSizeTuple(desc.size);
		const aspect = descriptor.aspect ?? 'all';
		const formatKind = getTextureFormatCapabilities(format).kind;
		if (
			aspect !== 'all'
			&& aspect !== 'depth-only'
			&& aspect !== 'stencil-only'
		) {
			throw new Error(`Texture view "${handle.label ?? handle.id}" has invalid aspect "${aspect}".`);
		}
		if (aspect === 'stencil-only') {
			throw new Error(`FrameGraph does not support stencil texture view aspects.`);
		}
		if (aspect === 'depth-only' && formatKind !== 'depth') {
			throw new Error(`Texture view "${handle.label ?? handle.id}" uses depth-only aspect with non-depth format "${format}".`);
		}
		if (
			(textureDimension === '1d' || textureDimension === '3d')
			&& (
				(descriptor.baseArrayLayer ?? 0) !== 0
				|| (descriptor.arrayLayerCount ?? 1) !== 1
			)
		) {
			throw new Error(`Texture view "${handle.label ?? handle.id}" for a ${textureDimension} texture must use baseArrayLayer 0 and arrayLayerCount 1.`);
		}
		const validDimension = textureDimension === '1d'
			? dimension === '1d' && region.arrayLayerCount === 1
			: textureDimension === '3d'
				? dimension === '3d' && region.arrayLayerCount === 1
				: (
					(dimension === '2d' && region.arrayLayerCount === 1)
					|| dimension === '2d-array'
					|| (dimension === 'cube' && region.arrayLayerCount === 6)
					|| (dimension === 'cube-array' && region.arrayLayerCount % 6 === 0)
				);
		if (!validDimension) {
			throw new Error(`Node "${node.label ?? node.id}" uses texture "${handle.label ?? handle.id}" with incompatible view dimension "${dimension}".`);
		}
		if ((dimension === 'cube' || dimension === 'cube-array') && textureSizeTuple(desc.size)[0] !== textureSizeTuple(desc.size)[1]) {
			throw new Error(`Cube texture view "${handle.label ?? handle.id}" requires equal width and height.`);
		}
		if ((dimension === 'cube' || dimension === 'cube-array') && region.baseArrayLayer + region.arrayLayerCount > layers) {
			throw new Error(`Cube texture view "${handle.label ?? handle.id}" exceeds declared array layers.`);
		}
		const storageAccess = access === TextureAccess.StorageRead || access === TextureAccess.StorageWrite;
		if (storageAccess && descriptor.mipLevelCount !== 1) {
			throw new Error(`Storage texture view "${handle.label ?? handle.id}" must select exactly one mip level.`);
		}
		if (storageAccess && (dimension === 'cube' || dimension === 'cube-array')) {
			throw new Error(`Storage texture view "${handle.label ?? handle.id}" cannot use "${dimension}" dimension.`);
		}
		const colorAttachmentAccess = access === TextureAccess.ColorAttachmentWrite;
		if (
			colorAttachmentAccess
			&& (
				descriptor.mipLevelCount !== 1
				|| descriptor.arrayLayerCount !== 1
				|| (dimension !== '2d' && dimension !== '2d-array' && dimension !== '3d')
			)
		) {
			throw new Error(`Color attachment texture view "${handle.label ?? handle.id}" must be single-mip, single-layer, and 2d, 2d-array, or 3d.`);
		}
		const depthAttachmentAccess = access === TextureAccess.DepthRead
			|| access === TextureAccess.DepthWrite;
		if (
			depthAttachmentAccess
			&& (
				descriptor.mipLevelCount !== 1
				|| descriptor.arrayLayerCount !== 1
				|| (dimension !== '2d' && dimension !== '2d-array')
			)
		) {
			throw new Error(`Depth attachment texture view "${handle.label ?? handle.id}" must be single-mip, single-layer, and 2d or 2d-array.`);
		}
		const sampleCount = desc.sampleCount ?? 1;
		if (
			sampleCount > 1
			&& (
				textureDimension !== '2d'
				|| dimension !== '2d'
				|| region.mipLevelCount !== 1
				|| region.arrayLayerCount !== 1
			)
		) {
			throw new Error(`Multisampled texture view "${handle.label ?? handle.id}" must be a single-mip, single-layer 2d view.`);
		}
		const swizzle = descriptor.swizzle ?? 'rgba';
		if (!/^[rgba01]{4}$/.test(swizzle)) {
			throw new Error(`Texture view "${handle.label ?? handle.id}" has invalid component swizzle "${swizzle}".`);
		}
		if (
			swizzle !== 'rgba'
			&& !this.device.features?.has('texture-component-swizzle')
		) {
			throw new Error(`Texture view "${handle.label ?? handle.id}" uses component swizzle without the "texture-component-swizzle" device feature.`);
		}
	}

	private bufferClearRange(handle: BufferHandle, offset: GPUSize64, size: GPUSize64 | undefined): BufferRange {
		const desc = this.resourceFor(handle).desc as BufferDesc;
		return {
			offset,
			size: size ?? desc.size - Number(offset),
		};
	}

	private resourceFor(handle: ResourceHandle): InternalResource {
		if (!isHandleOwnedBy(handle, this.recordingOwner)) {
			throw new Error(`${handle.kind === 'texture' ? 'Texture' : 'Buffer'} handle "${handle.label ?? handle.id}" does not belong to the current FrameGraph recording.`);
		}
		const resource = this.resources.get(handle.id);
		if (!resource) {
			throw new Error(`Unknown ${handle.kind} resource "${handle.label ?? handle.id}".`);
		}
		if (resource.handle !== handle) {
			throw new Error(`${handle.kind === 'texture' ? 'Texture' : 'Buffer'} handle "${handle.label ?? handle.id}" does not belong to the current FrameGraph recording.`);
		}
		return resource;
	}

	private assertKnownResource(handle: ResourceHandle): void {
		this.resourceFor(handle);
	}

	private assertNotDestroyed(): void {
		if (this.runtime.isDestroyed) {
			throw new Error('FrameGraph has been destroyed.');
		}
	}

	private assertCanMutate(operation: string): void {
		this.assertNotDestroyed();
		if (this.isConsumed) {
			throw new Error(`FrameGraphRecorder.${operation}() cannot be called after compile() consumed the recording.`);
		}
	}

	private assertNotExecuting(operation: string): void {
		if (this.runtime.isExecuting) {
			throw new Error(`CompiledFrame.${operation}() cannot be called while another CompiledFrame.execute() is running on the same FrameGraph runtime.`);
		}
	}

	private addRootResource(resource: ResourceHandle, reason: GraphRootReason): void {
		let reasons = this.rootResources.get(resource.id);
		if (!reasons) {
			reasons = new Set();
			this.rootResources.set(resource.id, reasons);
		}
		reasons.add(reason);
	}

	private recordResourceDebugGroup(resourceId: number): void {
		const debugGroupId = this.debugGroupStack.at(-1);
		if (debugGroupId !== undefined) {
			this.resourceDebugGroupIds.set(resourceId, debugGroupId);
		}
	}

	private invalidate(): void {
		this.compiledPlan = undefined;
		this.compiledGpuDebugGroups = undefined;
	}
}
