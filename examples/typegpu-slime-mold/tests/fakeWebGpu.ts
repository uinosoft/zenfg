export interface FakeGpuTrace {
    readonly textureCreates: GPUTextureDescriptor[];
    readonly destroyedTextures: string[];
    readonly destroyedBuffers: string[];
    readonly shaderSources: string[];
    readonly bufferWrites: { readonly label: string; readonly bytes: Uint8Array }[];
    readonly listeners: Map<string, Set<EventListener>>;
    dispatches: number;
    draws: number;
    submits: number;
    writes: number;
    deviceDestroys: number;
    throwOnSubmit: boolean;
    loseDevice(info?: GPUDeviceLostInfo): void;
}

export function createGpuTrace(): FakeGpuTrace {
    return {
        textureCreates: [],
        destroyedTextures: [],
        destroyedBuffers: [],
        shaderSources: [],
        bufferWrites: [],
        listeners: new Map(),
        dispatches: 0,
        draws: 0,
        submits: 0,
        writes: 0,
        deviceDestroys: 0,
        throwOnSubmit: false,
        loseDevice() {},
    };
}

export function installWebGpuGlobals(): () => void {
    const target = globalThis as Record<string, unknown>;
    const previous = {
        GPUBufferUsage: target.GPUBufferUsage,
        GPUTextureUsage: target.GPUTextureUsage,
        GPUShaderStage: target.GPUShaderStage,
        GPUMapMode: target.GPUMapMode,
    };
    target.GPUBufferUsage = {
        MAP_READ: 1,
        MAP_WRITE: 2,
        COPY_SRC: 4,
        COPY_DST: 8,
        INDEX: 16,
        VERTEX: 32,
        UNIFORM: 64,
        STORAGE: 128,
        INDIRECT: 256,
        QUERY_RESOLVE: 512,
    };
    target.GPUTextureUsage = {
        COPY_SRC: 1,
        COPY_DST: 2,
        TEXTURE_BINDING: 4,
        STORAGE_BINDING: 8,
        RENDER_ATTACHMENT: 16,
    };
    target.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
    target.GPUMapMode = { READ: 1, WRITE: 2 };
    return () => {
        target.GPUBufferUsage = previous.GPUBufferUsage;
        target.GPUTextureUsage = previous.GPUTextureUsage;
        target.GPUShaderStage = previous.GPUShaderStage;
        target.GPUMapMode = previous.GPUMapMode;
    };
}

export function createFakeDevice(
    trace: FakeGpuTrace,
    limitOverrides: Partial<Record<keyof GPUSupportedLimits, number>> = {},
): GPUDevice {
    let textureId = 0;
    let resolveLost: (info: GPUDeviceLostInfo) => void = () => undefined;
    const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
        resolveLost = resolve;
    });
    trace.loseDevice = (info = {
        reason: 'unknown',
        message: 'mock device loss',
    } as GPUDeviceLostInfo) => resolveLost(info);
    const limits = {
        maxBufferSize: 268_435_456,
        maxStorageBufferBindingSize: 134_217_728,
        maxTextureDimension2D: 8192,
        maxComputeWorkgroupsPerDimension: 65_535,
        ...limitOverrides,
    } as unknown as GPUSupportedLimits;

    const device = {
        limits,
        features: new Set<GPUFeatureName>(),
        lost,
        queue: {
            writeBuffer(
                buffer: GPUBuffer,
                _bufferOffset: GPUSize64,
                data: AllowSharedBufferSource,
                dataOffset = 0,
                size?: GPUSize64,
            ) {
                trace.writes += 1;
                const source = ArrayBuffer.isView(data)
                    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                    : new Uint8Array(data);
                const byteOffset = ArrayBuffer.isView(data)
                    ? Number(dataOffset) * data.BYTES_PER_ELEMENT
                    : Number(dataOffset);
                const byteLength = size === undefined
                    ? source.byteLength - byteOffset
                    : Number(size) * (ArrayBuffer.isView(data) ? data.BYTES_PER_ELEMENT : 1);
                trace.bufferWrites.push({
                    label: buffer.label,
                    bytes: source.slice(byteOffset, byteOffset + byteLength),
                });
            },
            submit() {
                if (trace.throwOnSubmit) throw new Error('mock queue submit failure');
                trace.submits += 1;
            },
        },
        createBuffer(descriptor: GPUBufferDescriptor) {
            const data = new ArrayBuffer(Number(descriptor.size));
            let mapState: GPUBufferMapState = descriptor.mappedAtCreation ? 'mapped' : 'unmapped';
            return {
                label: descriptor.label ?? '',
                size: descriptor.size,
                usage: descriptor.usage,
                get mapState() { return mapState; },
                getMappedRange() { return data; },
                mapAsync() { return Promise.resolve(); },
                unmap() { mapState = 'unmapped'; },
                destroy() { trace.destroyedBuffers.push(descriptor.label ?? ''); },
            } as GPUBuffer;
        },
        createTexture(descriptor: GPUTextureDescriptor) {
            trace.textureCreates.push(descriptor);
            const label = descriptor.label ?? `texture-${textureId++}`;
            const size = descriptor.size as GPUExtent3DDict | [number, number?, number?];
            const width = Array.isArray(size) ? size[0] : size.width;
            const height = Array.isArray(size) ? (size[1] ?? 1) : (size.height ?? 1);
            const depth = Array.isArray(size)
                ? (size[2] ?? 1)
                : (size.depthOrArrayLayers ?? 1);
            return {
                label,
                width,
                height,
                depthOrArrayLayers: depth,
                mipLevelCount: descriptor.mipLevelCount ?? 1,
                sampleCount: descriptor.sampleCount ?? 1,
                dimension: descriptor.dimension ?? '2d',
                format: descriptor.format,
                usage: descriptor.usage,
                createView() { return { label: `${label}.view` } as GPUTextureView; },
                destroy() { trace.destroyedTextures.push(label); },
            } as GPUTexture;
        },
        createSampler() { return {} as GPUSampler; },
        createBindGroupLayout() { return {} as GPUBindGroupLayout; },
        createPipelineLayout() { return {} as GPUPipelineLayout; },
        createBindGroup() { return {} as GPUBindGroup; },
        createShaderModule(descriptor: GPUShaderModuleDescriptor) {
            trace.shaderSources.push(descriptor.code);
            return {} as GPUShaderModule;
        },
        createComputePipeline() { return {} as GPUComputePipeline; },
        createRenderPipeline() { return {} as GPURenderPipeline; },
        createCommandEncoder() {
            return {
                pushDebugGroup() {},
                popDebugGroup() {},
                beginComputePass() {
                    return {
                        pushDebugGroup() {},
                        popDebugGroup() {},
                        setPipeline() {},
                        setBindGroup() {},
                        dispatchWorkgroups() { trace.dispatches += 1; },
                        end() {},
                    } as unknown as GPUComputePassEncoder;
                },
                beginRenderPass() {
                    return {
                        pushDebugGroup() {},
                        popDebugGroup() {},
                        setPipeline() {},
                        setBindGroup() {},
                        executeBundles() {},
                        draw() { trace.draws += 1; },
                        end() {},
                    } as unknown as GPURenderPassEncoder;
                },
                resolveQuerySet() {},
                copyBufferToBuffer() {},
                finish() { return {} as GPUCommandBuffer; },
            } as unknown as GPUCommandEncoder;
        },
        addEventListener(type: string, listener: EventListener) {
            let listeners = trace.listeners.get(type);
            if (!listeners) {
                listeners = new Set();
                trace.listeners.set(type, listeners);
            }
            listeners.add(listener);
        },
        removeEventListener(type: string, listener: EventListener) {
            trace.listeners.get(type)?.delete(listener);
        },
        destroy() {
            trace.deviceDestroys += 1;
            resolveLost({ reason: 'destroyed', message: '' } as GPUDeviceLostInfo);
        },
    } as unknown as GPUDevice;
    return device;
}

export function createFakeTexture(
    label: string,
    format: GPUTextureFormat,
    width: number,
    height: number,
): GPUTexture {
    return {
        label,
        width,
        height,
        depthOrArrayLayers: 1,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        createView: () => ({ label: `${label}.view` }) as GPUTextureView,
        destroy() {},
    } as GPUTexture;
}
