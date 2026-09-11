export interface FakeGpuTrace {
	readonly buffers: GPUBuffer[];
	readonly bufferData: Map<GPUBuffer, Uint8Array>;
	readonly writes: { readonly buffer: GPUBuffer; readonly offset: number; readonly bytes: Uint8Array }[];
	readonly destroyedBuffers: GPUBuffer[];
	readonly destroyedTextures: GPUTexture[];
	readonly computePipelines: GPUComputePipelineDescriptor[];
	readonly renderPipelines: GPURenderPipelineDescriptor[];
	readonly bindGroups: GPUBindGroupDescriptor[];
	readonly renderPasses: GPURenderPassDescriptor[];
	readonly dispatches: { readonly x: number; readonly y: number; readonly z: number }[];
	readonly indirectDraws: { readonly buffer: GPUBuffer; readonly offset: number }[];
	readonly events: string[];
	readonly listeners: Map<string, Set<EventListener>>;
	draws: number;
	submits: number;
	deviceDestroys: number;
	loseDevice(info?: GPUDeviceLostInfo): void;
}

export function installWebGpuGlobals(): () => void {
	const target = globalThis as Record<string, unknown>;
	const names = ['GPUBufferUsage', 'GPUTextureUsage', 'GPUShaderStage', 'GPUMapMode'] as const;
	const previous = names.map(name => target[name]);
	target.GPUBufferUsage = {
		MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16,
		VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512,
	};
	target.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
	target.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
	target.GPUMapMode = { READ: 1, WRITE: 2 };
	return () => {
		names.forEach((name, index) => {
			if (previous[index] === undefined) delete target[name];
			else target[name] = previous[index];
		});
	};
}

/** Records WebGPU calls without pretending to execute or validate WGSL. */
export function createFakeGpu(limitOverrides: Partial<Record<keyof GPUSupportedLimits, number>> = {}): {
	readonly device: GPUDevice;
	readonly trace: FakeGpuTrace;
} {
	const trace: FakeGpuTrace = {
		buffers: [], bufferData: new Map(), writes: [], destroyedBuffers: [], destroyedTextures: [],
		computePipelines: [], renderPipelines: [], bindGroups: [], renderPasses: [], dispatches: [],
		indirectDraws: [], events: [], listeners: new Map(), draws: 0, submits: 0, deviceDestroys: 0,
		loseDevice() {},
	};
	let resolveLost: (info: GPUDeviceLostInfo) => void = () => undefined;
	const lost = new Promise<GPUDeviceLostInfo>(resolve => { resolveLost = resolve; });
	trace.loseDevice = (info = { reason: 'unknown', message: 'fake device loss' } as GPUDeviceLostInfo) => resolveLost(info);
	const pipeline = () => ({ getBindGroupLayout: () => ({}) as GPUBindGroupLayout });
	const device = {
		limits: {
			maxBufferSize: 268_435_456,
			maxStorageBufferBindingSize: 134_217_728,
			maxUniformBufferBindingSize: 65_536,
			maxComputeWorkgroupsPerDimension: 65_535,
			maxComputeInvocationsPerWorkgroup: 256,
			maxComputeWorkgroupSizeX: 256,
			minStorageBufferOffsetAlignment: 256,
			minUniformBufferOffsetAlignment: 256,
			maxTextureDimension2D: 8192,
			...limitOverrides,
		} as unknown as GPUSupportedLimits,
		features: new Set<GPUFeatureName>(),
		lost,
		queue: {
			writeBuffer(buffer: GPUBuffer, bufferOffset: GPUSize64, data: AllowSharedBufferSource, dataOffset = 0, size?: GPUSize64) {
				const source = ArrayBuffer.isView(data)
					? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
					: new Uint8Array(data);
				const elementSize = ArrayBuffer.isView(data)
					? (data as ArrayBufferView & { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1
					: 1;
				const offset = Number(dataOffset) * elementSize;
				const length = size === undefined ? source.byteLength - offset : Number(size) * elementSize;
				const bytes = source.slice(offset, offset + length);
				trace.bufferData.get(buffer)!.set(bytes, Number(bufferOffset));
				trace.writes.push({ buffer, offset: Number(bufferOffset), bytes });
				trace.events.push('write');
			},
			submit() { trace.submits += 1; trace.events.push('submit'); },
			onSubmittedWorkDone: () => Promise.resolve(),
		},
		createBuffer(descriptor: GPUBufferDescriptor) {
			const data = new Uint8Array(Number(descriptor.size));
			let mapState: GPUBufferMapState = descriptor.mappedAtCreation ? 'mapped' : 'unmapped';
			const buffer = {
				label: descriptor.label ?? '', size: descriptor.size, usage: descriptor.usage,
				get mapState() { return mapState; },
				getMappedRange: () => data.buffer,
				mapAsync: () => Promise.resolve(),
				unmap() { mapState = 'unmapped'; },
				destroy() { trace.destroyedBuffers.push(buffer); },
			} as unknown as GPUBuffer;
			trace.buffers.push(buffer);
			trace.bufferData.set(buffer, data);
			return buffer;
		},
		createTexture(descriptor: GPUTextureDescriptor) {
			const values = Symbol.iterator in Object(descriptor.size)
				? Array.from(descriptor.size as Iterable<number>)
				: [
					(descriptor.size as GPUExtent3DDict).width,
					(descriptor.size as GPUExtent3DDict).height ?? 1,
					(descriptor.size as GPUExtent3DDict).depthOrArrayLayers ?? 1,
				];
			const texture = {
				label: descriptor.label ?? '', width: values[0], height: values[1] ?? 1,
				depthOrArrayLayers: values[2] ?? 1, dimension: descriptor.dimension ?? '2d',
				mipLevelCount: descriptor.mipLevelCount ?? 1, sampleCount: descriptor.sampleCount ?? 1,
				format: descriptor.format, usage: descriptor.usage,
				createView(viewDescriptor: GPUTextureViewDescriptor = {}) {
					return { label: `${texture.label}.view`, descriptor: viewDescriptor } as unknown as GPUTextureView;
				},
				destroy() { trace.destroyedTextures.push(texture); },
			} as GPUTexture;
			return texture;
		},
		createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }) as unknown as GPUShaderModule,
		createBindGroupLayout: () => ({}) as GPUBindGroupLayout,
		createPipelineLayout: () => ({}) as GPUPipelineLayout,
		createBindGroup(descriptor: GPUBindGroupDescriptor) {
			trace.bindGroups.push(descriptor);
			return {} as GPUBindGroup;
		},
		createComputePipeline(descriptor: GPUComputePipelineDescriptor) {
			trace.computePipelines.push(descriptor);
			return pipeline() as unknown as GPUComputePipeline;
		},
		createRenderPipeline(descriptor: GPURenderPipelineDescriptor) {
			trace.renderPipelines.push(descriptor);
			return pipeline() as unknown as GPURenderPipeline;
		},
		createCommandEncoder() {
			return {
				pushDebugGroup() {}, popDebugGroup() {},
				beginComputePass() {
					trace.events.push('compute');
					return {
						setPipeline() {}, setBindGroup() {}, pushDebugGroup() {}, popDebugGroup() {},
						dispatchWorkgroups(x: GPUSize32, y = 1, z = 1) { trace.dispatches.push({ x, y, z }); },
						end() {},
					} as unknown as GPUComputePassEncoder;
				},
				beginRenderPass(descriptor: GPURenderPassDescriptor) {
					trace.renderPasses.push(descriptor);
					trace.events.push('render');
					return {
						setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {},
						setViewport() {}, setScissorRect() {}, pushDebugGroup() {}, popDebugGroup() {},
						draw() { trace.draws += 1; },
						drawIndexedIndirect(buffer: GPUBuffer, offset: GPUSize64) {
							trace.indirectDraws.push({ buffer, offset: Number(offset) });
						},
						end() {},
					} as unknown as GPURenderPassEncoder;
				},
				clearBuffer() {}, copyBufferToBuffer() {}, resolveQuerySet() {},
				finish: () => ({}) as GPUCommandBuffer,
			} as unknown as GPUCommandEncoder;
		},
		pushErrorScope() {},
		popErrorScope: () => Promise.resolve(null),
		addEventListener(type: string, listener: EventListener) {
			let listeners = trace.listeners.get(type);
			if (!listeners) { listeners = new Set(); trace.listeners.set(type, listeners); }
			listeners.add(listener);
		},
		removeEventListener(type: string, listener: EventListener) { trace.listeners.get(type)?.delete(listener); },
		destroy() { trace.deviceDestroys += 1; resolveLost({ reason: 'destroyed', message: '' } as GPUDeviceLostInfo); },
	} as unknown as GPUDevice;
	return { device, trace };
}
