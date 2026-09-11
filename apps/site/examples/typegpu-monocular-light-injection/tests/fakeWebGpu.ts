export function installWebGpuGlobals(): () => void {
    const target = globalThis as Record<string, unknown>;
    const previous = {
        GPUBufferUsage: target.GPUBufferUsage,
        GPUTextureUsage: target.GPUTextureUsage,
        GPUShaderStage: target.GPUShaderStage,
    };
    target.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
    target.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
    target.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
    return () => Object.assign(target, previous);
}

export function fakeDevice(limitOverrides: Partial<{
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxUniformBufferBindingSize: number;
    maxTextureDimension2D: number;
    maxComputeWorkgroupsPerDimension: number;
}> = {}): GPUDevice {
    let textureId = 0;
    const createTexture = (descriptor: GPUTextureDescriptor): GPUTexture => {
        const size = Array.isArray(descriptor.size) ? descriptor.size : [descriptor.size.width, descriptor.size.height ?? 1, descriptor.size.depthOrArrayLayers ?? 1];
        const label = descriptor.label ?? `texture-${textureId++}`;
        return {
            label,
            width: size[0], height: size[1] ?? 1, depthOrArrayLayers: size[2] ?? 1,
            mipLevelCount: descriptor.mipLevelCount ?? 1,
            sampleCount: descriptor.sampleCount ?? 1,
            dimension: descriptor.dimension ?? '2d',
            format: descriptor.format,
            usage: descriptor.usage,
            createView() { return { label: `${label}.view` } as GPUTextureView; },
            destroy() {},
        } as GPUTexture;
    };
    const makePipeline = () => ({ getBindGroupLayout() { return {} as GPUBindGroupLayout; } });
    return {
        limits: {
            maxBufferSize: 268_435_456,
            maxStorageBufferBindingSize: 134_217_728,
            maxUniformBufferBindingSize: 65_536,
            maxTextureDimension2D: 8192,
            maxComputeWorkgroupsPerDimension: 65_535,
            ...limitOverrides,
        },
        features: new Set(),
        queue: { writeBuffer() {}, submit() {} },
        createBuffer(descriptor: GPUBufferDescriptor) {
            const data = new ArrayBuffer(descriptor.size);
            return {
                label: descriptor.label, size: descriptor.size, usage: descriptor.usage,
                mapState: descriptor.mappedAtCreation ? 'mapped' : 'unmapped',
                getMappedRange() { return data; }, mapAsync: async () => {}, unmap() {}, destroy() {},
            } as GPUBuffer;
        },
        createTexture,
        createSampler() { return {} as GPUSampler; },
        createBindGroupLayout() { return {} as GPUBindGroupLayout; },
        createPipelineLayout() { return {} as GPUPipelineLayout; },
        createBindGroup() { return {} as GPUBindGroup; },
        createShaderModule() { return { getCompilationInfo: async () => ({ messages: [] }) } as unknown as GPUShaderModule; },
        createComputePipeline() { return makePipeline() as unknown as GPUComputePipeline; },
        createRenderPipeline() { return makePipeline() as unknown as GPURenderPipeline; },
        async createComputePipelineAsync() { return makePipeline() as unknown as GPUComputePipeline; },
        async createRenderPipelineAsync() { return makePipeline() as unknown as GPURenderPipeline; },
        importExternalTexture() { return {} as GPUExternalTexture; },
    } as unknown as GPUDevice;
}

export function minimalBundle(): ArrayBuffer {
    const manifest = {
        model: 'depthart-relative-s-448', precision: 'f32-reference',
        input: { kind: 'srgb-image', tensorId: 'input', colorSpace: 'rgb', resize: 'cubic-warp', mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
        output: { kind: 'relative-disparity', tensorId: 'output', resize: 'bilinear-align-corners', polarity: 'direct' },
        tensors: [
            { id: 'input', shape: [1, 4, 2, 2], dtype: 'f32', layout: 'hwc4', byteLength: 64, storage: { kind: 'input' } },
            { id: 'output', shape: [1, 4, 2, 2], dtype: 'f32', layout: 'hwc4', byteLength: 64, storage: { kind: 'output' } },
        ],
        slots: [], dispatches: [], weightSections: [],
    };
    const json = new TextEncoder().encode(JSON.stringify(manifest));
    const payloadOffset = Math.ceil((48 + json.length) / 256) * 256;
    const buffer = new ArrayBuffer(payloadOffset);
    const bytes = new Uint8Array(buffer);
    bytes.set(new TextEncoder().encode('DARTBND\0'));
    new DataView(buffer).setUint32(8, 1, true);
    new DataView(buffer).setUint32(24, json.length, true);
    bytes.set(json, 48);
    return buffer;
}

export function deferPipelineCreation(device: GPUDevice) {
    let resolve!: (pipeline: unknown) => void;
    const promise = new Promise<unknown>((resolvePromise) => {
        resolve = resolvePromise;
    });
    const mutable = device as unknown as {
        createComputePipelineAsync: () => Promise<GPUComputePipeline>;
        createRenderPipelineAsync: () => Promise<GPURenderPipeline>;
    };
    mutable.createComputePipelineAsync = () => promise as Promise<GPUComputePipeline>;
    mutable.createRenderPipelineAsync = () => promise as Promise<GPURenderPipeline>;
    return () => resolve({ getBindGroupLayout() { return {} as GPUBindGroupLayout; } });
}
