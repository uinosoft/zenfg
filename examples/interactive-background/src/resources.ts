import { FrameGraph } from '@zenfg/webgpu';
import {
    bloomBlurShader,
    bloomExtractShader,
    compositeShader,
    flowFieldShader,
    latticeShader,
} from './backgroundShaders.ts';

export const frameParamsFloatCount = 16;

export type RenderPipelines = {
    readonly flow: GPUComputePipeline;
    readonly lattice: GPURenderPipeline;
    readonly bloomExtract: GPURenderPipeline;
    readonly bloomBlur: GPURenderPipeline;
    readonly composite: GPURenderPipeline;
};

export type BackgroundResources = {
    readonly device: GPUDevice;
    readonly context: GPUCanvasContext;
    readonly format: GPUTextureFormat;
    readonly graph: FrameGraph;
    readonly uniformBuffer: GPUBuffer;
    readonly linearSampler: GPUSampler;
    readonly pipelines: RenderPipelines;
};

export async function createBackgroundResources(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat): Promise<BackgroundResources> {
    const pipelines = await createPipelines(device, format);
    const uniformBuffer = device.createBuffer({
        label: 'ZenFG background frame params',
        size: frameParamsFloatCount * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const linearSampler = device.createSampler({
        label: 'ZenFG background linear clamp sampler',
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
        magFilter: 'linear', minFilter: 'linear',
    });
    return { device, context, format, graph: new FrameGraph(device), uniformBuffer, linearSampler, pipelines };
}

async function createPipelines(device: GPUDevice, format: GPUTextureFormat): Promise<RenderPipelines> {
    const flowModule = device.createShaderModule({ label: 'ZenFG background flow shader', code: flowFieldShader });
    const latticeModule = device.createShaderModule({ label: 'ZenFG background lattice shader', code: latticeShader });
    const bloomExtractModule = device.createShaderModule({ label: 'ZenFG background bloom extraction shader', code: bloomExtractShader });
    const bloomBlurModule = device.createShaderModule({ label: 'ZenFG background bloom blur shader', code: bloomBlurShader });
    const compositeModule = device.createShaderModule({ label: 'ZenFG background composite shader', code: compositeShader });
    const [flow, lattice, bloomExtract, bloomBlur, composite] = await Promise.all([
        device.createComputePipelineAsync({
            label: 'ZenFG background · flow field',
            layout: 'auto',
            compute: { module: flowModule, entryPoint: 'flow_main' },
        }),
        device.createRenderPipelineAsync({
            label: 'ZenFG background · lattice',
            layout: 'auto',
            vertex: { module: latticeModule, entryPoint: 'fullscreen_vertex' },
            fragment: { module: latticeModule, entryPoint: 'lattice_fragment', targets: [{ format: 'rgba16float' }] },
            primitive: { topology: 'triangle-list' },
        }),
        device.createRenderPipelineAsync({
            label: 'ZenFG background · bloom extraction',
            layout: 'auto',
            vertex: { module: bloomExtractModule, entryPoint: 'fullscreen_vertex' },
            fragment: { module: bloomExtractModule, entryPoint: 'bloom_extract_fragment', targets: [{ format: 'rgba16float' }] },
            primitive: { topology: 'triangle-list' },
        }),
        device.createRenderPipelineAsync({
            label: 'ZenFG background · bloom blur',
            layout: 'auto',
            vertex: { module: bloomBlurModule, entryPoint: 'fullscreen_vertex' },
            fragment: { module: bloomBlurModule, entryPoint: 'bloom_blur_fragment', targets: [{ format: 'rgba16float' }] },
            primitive: { topology: 'triangle-list' },
        }),
        device.createRenderPipelineAsync({
            label: 'ZenFG background · composite',
            layout: 'auto',
            vertex: { module: compositeModule, entryPoint: 'fullscreen_vertex' },
            fragment: { module: compositeModule, entryPoint: 'composite_fragment', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        }),
    ]);
    return { flow, lattice, bloomExtract, bloomBlur, composite };
}
