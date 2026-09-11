import {
    BufferAccess,
    type FrameGraphRecording,
    type TextureHandle,
    type TextureViewHandle,
} from '@zenfg/webgpu';
import { copyMatrix, generatePrimitives, INSTANCE_BYTES, packInstances } from './primitives.ts';
import { createShaderSources } from './shaders.ts';
import type { ReferenceFrameOptions, ReferenceRenderer, ReferenceRendererOptions } from './types.ts';

const COLOR_FORMATS = new Set<GPUTextureFormat>(['rgba8unorm', 'bgra8unorm', 'rgba8unorm-srgb', 'bgra8unorm-srgb', 'rgba16float']);
const DEPTH_FORMATS = new Set<GPUTextureFormat>(['depth16unorm', 'depth24plus', 'depth32float']);
const FRAME_BYTES = 176;
const INDIRECT_BYTES = 3 * 20;
const WORKGROUP_SIZE = 64;

/**
 * Creates a small GPU-driven primitive renderer on a borrowed device. All GPU
 * work is recorded into the caller's graph; only CPU input uploads use its queue.
 */
export function createReferenceRenderer(device: GPUDevice, options: ReferenceRendererOptions = {}): ReferenceRenderer {
    const capacity = options.maxInstances ?? 10_000;
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('maxInstances must be a positive integer.');
    const alignment = device.limits.minStorageBufferOffsetAlignment;
    const segmentBytes = Math.ceil(capacity * 4 / alignment) * alignment;
    const visibleBytes = segmentBytes * 3;
    const instanceBytes = capacity * INSTANCE_BYTES;
    if (Math.max(instanceBytes, visibleBytes) > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)
        || Math.ceil(visibleBytes / 4 / WORKGROUP_SIZE) > device.limits.maxComputeWorkgroupsPerDimension) {
        throw new Error('maxInstances exceeds the device buffer or compute limits.');
    }

    const owned: GPUBuffer[] = [];
    const buffer = (label: string, size: number, usage: GPUBufferUsageFlags, data?: Float32Array | Uint32Array): GPUBuffer => {
        const result = device.createBuffer({ label: `reference.${label}`, size, usage, mappedAtCreation: data !== undefined });
        owned.push(result);
        if (data) {
            new Uint8Array(result.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            result.unmap();
        }
        return result;
    };
    try {
        const geometry = generatePrimitives();
        const vertices = buffer('vertices', geometry.vertices.byteLength, GPUBufferUsage.VERTEX, geometry.vertices);
        const indices = buffer('indices', geometry.indices.byteLength, GPUBufferUsage.INDEX, geometry.indices);
        const instances = buffer('instances', instanceBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        const camera = buffer('camera', FRAME_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        const sources = createShaderSources(geometry.batches);
        const resetPipeline = device.createComputePipeline({
            label: 'reference.Reset', layout: 'auto',
            compute: { module: device.createShaderModule({ label: 'reference.reset', code: sources.reset }), entryPoint: 'main' },
        });
        const cullPipeline = device.createComputePipeline({
            label: 'reference.Cull', layout: 'auto',
            compute: { module: device.createShaderModule({ label: 'reference.cull', code: sources.cull }), entryPoint: 'main' },
        });
        const drawModule = device.createShaderModule({ label: 'reference.draw', code: sources.draw });
        const pipelines = new Map<string, GPURenderPipeline>();
        const recordings = new WeakSet<FrameGraphRecording>();
        let count = 0;
        let generation = 0;
        let destroyed = false;
        const assertAlive = (): void => {
            if (destroyed) throw new Error('Reference renderer has been destroyed.');
        };

        return {
            setInstances(items) {
                assertAlive();
                const packed = packInstances(items, capacity);
                if (packed.byteLength > 0) device.queue.writeBuffer(instances, 0, packed.buffer);
                count = items.length;
                generation++;
            },
            record(frame, input) {
                assertAlive();
                if (recordings.has(frame)) throw new Error('A reference renderer can record only once per recording.');
                const targets = validateTargets(frame, input);
                const params = packFrame(input, count, segmentBytes / 4);
                const convention = input.depthConvention ?? 'reverse-z';
                const readOnly = input.depth.depthReadOnly === true;
                const key = `${targets.colorFormat}/${targets.depthFormat}/${convention}/${readOnly}`;
                let drawPipeline = pipelines.get(key);
                if (!drawPipeline) {
                    drawPipeline = device.createRenderPipeline({
                        label: `reference.Draw.${key}`, layout: 'auto',
                        vertex: {
                            module: drawModule, entryPoint: 'vertex_main',
                            buffers: [{ arrayStride: 24, attributes: [
                                { shaderLocation: 0, offset: 0, format: 'float32x3' },
                                { shaderLocation: 1, offset: 12, format: 'float32x3' },
                            ] }],
                        },
                        fragment: { module: drawModule, entryPoint: 'fragment_main', targets: [{ format: targets.colorFormat }] },
                        primitive: { topology: 'triangle-list', cullMode: 'none' },
                        depthStencil: {
                            format: targets.depthFormat,
                            depthWriteEnabled: !readOnly,
                            depthCompare: convention === 'reverse-z' ? 'greater' : 'less',
                        },
                    });
                    pipelines.set(key, drawPipeline);
                }
                device.queue.writeBuffer(camera, 0, params.buffer);
                recordings.add(frame);
                const version = ++generation;
                const instanceCount = count;
                const pipeline = drawPipeline;
                const guard = (executionDevice: GPUDevice): void => {
                    assertAlive();
                    if (executionDevice !== device) throw new Error('Reference renderer and FrameGraph must use the same GPUDevice.');
                    if (version !== generation) throw new Error('Cannot execute a stale recording: renderer inputs have been updated.');
                };

                frame.withDebugGroup('Reference Renderer', () => {
                    const vertexBuffer = frame.importBuffer(vertices);
                    const indexBuffer = frame.importBuffer(indices);
                    const instanceBuffer = frame.importBuffer(instances);
                    const cameraBuffer = frame.importBuffer(camera);
                    const indirect = frame.createBuffer({ label: 'reference.indirect-args', size: INDIRECT_BYTES });
                    const visible = frame.createBuffer({ label: 'reference.visible-ids', size: visibleBytes });
                    const paramsRead = frame.use(cameraBuffer, BufferAccess.Uniform);
                    const instancesRead = frame.use(instanceBuffer, BufferAccess.StorageRead);

                    // Reset initializes the entire dynamically written region before Cull preserves it.
                    const resetArgs = frame.use(indirect, BufferAccess.StorageWrite, { contents: 'overwrite' });
                    const resetVisible = frame.use(visible, BufferAccess.StorageWrite, { contents: 'overwrite' });
                    frame.compute({
                        label: 'Reset', uses: [resetArgs, resetVisible],
                        encode({ device: executionDevice, pass, unwrap }) {
                            guard(executionDevice);
                            pass.setPipeline(resetPipeline);
                            pass.setBindGroup(0, device.createBindGroup({ layout: resetPipeline.getBindGroupLayout(0), entries: [
                                { binding: 0, resource: { buffer: unwrap(resetArgs) } },
                                { binding: 1, resource: { buffer: unwrap(resetVisible) } },
                            ] }));
                            pass.dispatchWorkgroups(Math.ceil(visibleBytes / 4 / WORKGROUP_SIZE));
                        },
                    });

                    const cullArgsRead = frame.use(indirect, BufferAccess.StorageRead);
                    const cullArgs = frame.use(indirect, BufferAccess.StorageWrite, { contents: 'preserve' });
                    const cullVisible = frame.use(visible, BufferAccess.StorageWrite, { contents: 'preserve' });
                    frame.compute({
                        label: 'Cull', uses: [paramsRead, instancesRead, cullArgsRead, cullArgs, cullVisible],
                        encode({ device: executionDevice, pass, unwrap }) {
                            guard(executionDevice);
                            pass.setPipeline(cullPipeline);
                            pass.setBindGroup(0, device.createBindGroup({ layout: cullPipeline.getBindGroupLayout(0), entries: [
                                { binding: 0, resource: { buffer: unwrap(paramsRead) } },
                                { binding: 1, resource: { buffer: unwrap(instancesRead) } },
                                { binding: 2, resource: { buffer: unwrap(cullArgs) } },
                                { binding: 3, resource: { buffer: unwrap(cullVisible) } },
                            ] }));
                            pass.dispatchWorkgroups(Math.max(1, Math.ceil(instanceCount / WORKGROUP_SIZE)));
                        },
                    });

                    const visibleRead = frame.use(visible, BufferAccess.StorageRead);
                    const indirectRead = frame.use(indirect, BufferAccess.Indirect);
                    const vertexRead = frame.use(vertexBuffer, BufferAccess.Vertex);
                    const indexRead = frame.use(indexBuffer, BufferAccess.Index);
                    frame.render({
                        label: 'Draw', colorAttachments: [input.color], depthStencilAttachment: input.depth,
                        uses: [paramsRead, instancesRead, visibleRead, indirectRead, vertexRead, indexRead],
                        encode({ device: executionDevice, pass, unwrap }) {
                            guard(executionDevice);
                            pass.setPipeline(pipeline);
                            pass.setVertexBuffer(0, unwrap(vertexRead));
                            pass.setIndexBuffer(unwrap(indexRead), 'uint32');
                            for (let batch = 0; batch < 3; batch++) {
                                pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
                                    { binding: 0, resource: { buffer: unwrap(paramsRead) } },
                                    { binding: 1, resource: { buffer: unwrap(instancesRead) } },
                                    { binding: 2, resource: { buffer: unwrap(visibleRead), offset: batch * segmentBytes, size: segmentBytes } },
                                ] }));
                                pass.drawIndexedIndirect(unwrap(indirectRead), batch * 20);
                            }
                        },
                    });
                });
            },
            destroy() {
                if (destroyed) return;
                destroyed = true;
                for (const resource of owned) resource.destroy();
                pipelines.clear();
            },
        };
    } catch (error) {
        for (const resource of owned) resource.destroy();
        throw error;
    }
}

function packFrame(input: ReferenceFrameOptions, count: number, visibleStride: number): Float32Array {
    const matrix = copyMatrix(input.viewProjection, 'viewProjection');
    const result = new Float32Array(FRAME_BYTES / 4);
    result.set(matrix);
    // Clip half-spaces: w+x, w-x, w+y, w-y, z, w-z. No reverse-Z special case.
    for (let axis = 0; axis < 4; axis++) {
        const base = axis * 4;
        result[16 + axis] = matrix[base + 3] + matrix[base];
        result[20 + axis] = matrix[base + 3] - matrix[base];
        result[24 + axis] = matrix[base + 3] + matrix[base + 1];
        result[28 + axis] = matrix[base + 3] - matrix[base + 1];
        result[32 + axis] = matrix[base + 2];
        result[36 + axis] = matrix[base + 3] - matrix[base + 2];
    }
    if (result.some(value => !Number.isFinite(value))) throw new Error('viewProjection exceeds the float32 range.');
    new Uint32Array(result.buffer).set([count, visibleStride, input.culling === false ? 0 : 1, 0], 40);
    return result;
}

function attachmentInfo(frame: FrameGraphRecording, target: TextureHandle | TextureViewHandle) {
    const view = target.kind === 'texture-view' ? frame.getTextureViewDesc(target) : undefined;
    const desc = frame.getTextureDesc(view?.texture ?? target as TextureHandle);
    const size = Symbol.iterator in Object(desc.size)
        ? Array.from(desc.size as Iterable<number>)
        : [(desc.size as GPUExtent3DDict).width, (desc.size as GPUExtent3DDict).height ?? 1];
    const mip = view?.baseMipLevel ?? 0;
    if ((desc.dimension ?? '2d') !== '2d' || (desc.sampleCount ?? 1) !== 1
        || (view && (view.dimension !== '2d' || view.mipLevelCount !== 1 || view.arrayLayerCount !== 1))) {
        throw new Error('Reference renderer requires single-sampled 2D attachments selecting one mip and layer.');
    }
    return {
        format: view?.format ?? desc.format,
        width: Math.max(1, Math.floor(size[0] / 2 ** mip)),
        height: Math.max(1, Math.floor((size[1] ?? 1) / 2 ** mip)),
    };
}

function validateTargets(frame: FrameGraphRecording, input: ReferenceFrameOptions) {
    const color = attachmentInfo(frame, input.color.target);
    const depth = attachmentInfo(frame, input.depth.target);
    if (!COLOR_FORMATS.has(color.format)) throw new Error(`Unsupported color format: ${color.format}.`);
    if (!DEPTH_FORMATS.has(depth.format)) throw new Error(`Unsupported depth format: ${depth.format}.`);
    if (color.width !== depth.width || color.height !== depth.height) throw new Error('Color and depth attachment sizes must match.');
    if (input.color.resolveTarget !== undefined || input.color.depthSlice !== undefined) throw new Error('Resolve targets and 3D depth slices are not supported.');
    const convention = input.depthConvention ?? 'reverse-z';
    if (convention !== 'reverse-z' && convention !== 'forward-z') throw new Error('Unsupported depth convention.');
    if (input.depth.depthLoadOp === 'clear' && input.depth.depthClearValue !== (convention === 'reverse-z' ? 0 : 1)) {
        throw new Error('Depth clear value must match depthConvention (reverse-z: 0, forward-z: 1).');
    }
    return { colorFormat: color.format, depthFormat: depth.format };
}
