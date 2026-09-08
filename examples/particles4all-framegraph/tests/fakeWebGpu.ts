import assert from 'node:assert/strict';

export interface FakeGpuTrace {
    bufferCreates: GPUBufferDescriptor[];
    textureCreates: GPUTextureDescriptor[];
    bindGroups: GPUBindGroupDescriptor[];
    renderPipelines: GPURenderPipelineDescriptor[];
    renderPasses: GPURenderPassDescriptor[];
    bufferWrites: { label: string; offset: number; size: number; bytes: Uint8Array }[];
    destroyedBuffers: GPUBuffer[];
    destroyedTextures: GPUTexture[];
    copies: { source: GPUBuffer; destination: GPUBuffer; size: number }[];
    maps: number;
    dispatches: number;
    draws: number;
    submits: number;
    throwOnSubmit: boolean;
    throwOnEncode: boolean;
    deferMaps: boolean;
    pendingMaps: (() => void)[];
}

export function createGpuTrace(): FakeGpuTrace {
    return {
        bufferCreates: [], textureCreates: [], bindGroups: [], renderPipelines: [], renderPasses: [],
        bufferWrites: [], destroyedBuffers: [], destroyedTextures: [], copies: [],
        maps: 0, dispatches: 0, draws: 0, submits: 0,
        throwOnSubmit: false, throwOnEncode: false, deferMaps: false, pendingMaps: [],
    };
}

export function installWebGpuGlobals(): () => void {
    const target = globalThis as Record<string, unknown>;
    const entries = {
        GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 },
        GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
        GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
        GPUMapMode: { READ: 1, WRITE: 2 },
    };
    const previous = new Map(Object.keys(entries).map(key => [key, Object.getOwnPropertyDescriptor(target, key)]));
    Object.assign(target, entries);
    return () => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else delete target[key];
        }
    };
}

/** Executes graph callbacks and validates host buffer operations; it does not run WGSL. */
export function createFakeDevice(
    trace = createGpuTrace(),
    limitOverrides: Partial<Record<keyof GPUSupportedLimits, number>> = {},
): GPUDevice {
    const limits = {
        maxBufferSize: 1_073_741_824,
        maxStorageBufferBindingSize: 1_073_741_824,
        maxTextureDimension2D: 8192,
        maxTextureDimension3D: 2048,
        maxStorageBuffersPerShaderStage: 8,
        maxComputeInvocationsPerWorkgroup: 256,
        maxComputeWorkgroupSizeX: 256,
        maxComputeWorkgroupsPerDimension: 65_535,
        ...limitOverrides,
    } as unknown as GPUSupportedLimits;
    const dataByBuffer = new WeakMap<GPUBuffer, ArrayBuffer>();
    const backing = (buffer: GPUBuffer) => {
        let data = dataByBuffer.get(buffer);
        if (!data) { data = new ArrayBuffer(Number(buffer.size)); dataByBuffer.set(buffer, data); }
        return data;
    };
    const assertRange = (buffer: GPUBuffer, offset: number, size: number) => {
        assert.ok(offset >= 0 && size >= 0 && offset + size <= buffer.size,
            `${buffer.label}: buffer range ${offset}+${size} exceeds ${buffer.size}`);
        assert.equal(buffer.mapState, 'unmapped', `${buffer.label} is still mapped`);
        assert.ok(!trace.destroyedBuffers.includes(buffer), `${buffer.label} has been destroyed`);
    };
    const pipeline = (descriptor: { label?: string }) => ({
        label: descriptor.label ?? '', getBindGroupLayout() { return {} as GPUBindGroupLayout; },
    });
    const dispatch = () => { if (trace.throwOnEncode) throw new Error('mock encode failure'); trace.dispatches++; };
    const draw = () => { if (trace.throwOnEncode) throw new Error('mock encode failure'); trace.draws++; };
    const pass = () => ({
        pushDebugGroup() {}, popDebugGroup() {}, insertDebugMarker() {},
        setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {},
        setViewport() {}, setScissorRect() {}, setBlendConstant() {},
        dispatchWorkgroups: dispatch, dispatchWorkgroupsIndirect: dispatch,
        draw, drawIndexed: draw, drawIndirect: draw, drawIndexedIndirect: draw, end() {},
    });
    const device = {
        limits, features: new Set<GPUFeatureName>(), lost: new Promise(() => {}),
        queue: {
            writeBuffer(buffer: GPUBuffer, bufferOffset: number, source: AllowSharedBufferSource, dataOffset = 0, size?: number) {
                const view = ArrayBuffer.isView(source);
                const elementSize = view && 'BYTES_PER_ELEMENT' in source ? Number(source.BYTES_PER_ELEMENT) : 1;
                const bytes = view ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
                const offset = dataOffset * elementSize;
                const byteSize = size === undefined ? bytes.byteLength - offset : size * elementSize;
                assertRange(buffer, bufferOffset, byteSize);
                trace.bufferWrites.push({ label: buffer.label, offset: bufferOffset, size: byteSize, bytes: bytes.slice(offset, offset + Math.min(byteSize, 4096)) });
                if (dataByBuffer.has(buffer)) new Uint8Array(backing(buffer)).set(bytes.subarray(offset, offset + byteSize), bufferOffset);
            },
            writeTexture() {}, copyExternalImageToTexture() {},
            submit() { if (trace.throwOnSubmit) throw new Error('mock queue submit failure'); trace.submits++; },
            onSubmittedWorkDone() { return Promise.resolve(); },
        },
        createBuffer(descriptor: GPUBufferDescriptor) {
            assert.ok(descriptor.size <= limits.maxBufferSize, `${descriptor.label}: maxBufferSize`);
            trace.bufferCreates.push(descriptor);
            let mapState: GPUBufferMapState = descriptor.mappedAtCreation ? 'mapped' : 'unmapped';
            const buffer = {
                label: descriptor.label ?? '', size: descriptor.size, usage: descriptor.usage,
                get mapState() { return mapState; },
                getMappedRange(offset = 0, size?: number) {
                    assert.equal(mapState, 'mapped');
                    const data = backing(buffer);
                    return offset === 0 && (size === undefined || size === data.byteLength) ? data : data.slice(offset, size === undefined ? undefined : offset + size);
                },
                mapAsync() {
                    assert.equal(mapState, 'unmapped');
                    trace.maps++;
                    mapState = 'pending';
                    return new Promise<void>((resolve) => {
                        const complete = () => { mapState = 'mapped'; resolve(); };
                        if (trace.deferMaps) trace.pendingMaps.push(complete);
                        else complete();
                    });
                },
                unmap() { mapState = 'unmapped'; },
                destroy() { trace.destroyedBuffers.push(buffer); mapState = 'unmapped'; },
            } as unknown as GPUBuffer;
            return buffer;
        },
        createTexture(descriptor: GPUTextureDescriptor) {
            trace.textureCreates.push(descriptor);
            const size = descriptor.size as GPUExtent3DDict | [number, number?, number?];
            const texture = {
                label: descriptor.label ?? '',
                width: Array.isArray(size) ? size[0] : size.width,
                height: Array.isArray(size) ? (size[1] ?? 1) : (size.height ?? 1),
                depthOrArrayLayers: Array.isArray(size) ? (size[2] ?? 1) : (size.depthOrArrayLayers ?? 1),
                mipLevelCount: descriptor.mipLevelCount ?? 1, sampleCount: descriptor.sampleCount ?? 1,
                dimension: descriptor.dimension ?? '2d', format: descriptor.format, usage: descriptor.usage,
                createView(viewDescriptor?: GPUTextureViewDescriptor) { return { label: viewDescriptor?.label ?? `${descriptor.label ?? ''}.view` } as GPUTextureView; },
                destroy() { trace.destroyedTextures.push(texture); },
            } as GPUTexture;
            return texture;
        },
        createSampler() { return {} as GPUSampler; },
        createBindGroupLayout() { return {} as GPUBindGroupLayout; },
        createPipelineLayout() { return {} as GPUPipelineLayout; },
        createBindGroup(descriptor: GPUBindGroupDescriptor) { trace.bindGroups.push(descriptor); return {} as GPUBindGroup; },
        createShaderModule(descriptor: GPUShaderModuleDescriptor) { return { label: descriptor.label ?? '', getCompilationInfo: async () => ({ messages: [] }) } as unknown as GPUShaderModule; },
        createComputePipeline: pipeline,
        createRenderPipeline(descriptor: GPURenderPipelineDescriptor) { trace.renderPipelines.push(descriptor); return pipeline(descriptor); },
        createCommandEncoder() {
            return {
                pushDebugGroup() {}, popDebugGroup() {}, insertDebugMarker() {},
                beginComputePass() { return pass(); },
                beginRenderPass(descriptor: GPURenderPassDescriptor) { trace.renderPasses.push(descriptor); return pass(); },
                clearBuffer(buffer: GPUBuffer, offset = 0, size = Number(buffer.size) - offset) { assertRange(buffer, offset, size); },
                copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number) {
                    assertRange(source, sourceOffset, size); assertRange(destination, destinationOffset, size);
                    trace.copies.push({ source, destination, size });
                },
                copyTextureToTexture() {}, copyBufferToTexture() {}, copyTextureToBuffer() {}, resolveQuerySet() {},
                finish() { return {} as GPUCommandBuffer; },
            };
        },
        pushErrorScope() {}, popErrorScope() { return Promise.resolve(null); },
        addEventListener() {}, removeEventListener() {}, destroy() {},
    } as unknown as GPUDevice;
    return device;
}
