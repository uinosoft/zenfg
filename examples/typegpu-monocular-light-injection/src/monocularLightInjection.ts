// Inference and relighting kernels are adapted from the TypeGPU example. See THIRD_PARTY_NOTICES.md.
import { common, d, tgpu } from 'typegpu';
import type {
    SampledFlag,
    StorageFlag,
    TgpuBindGroup,
    TgpuBuffer,
    TgpuComputePipeline,
    TgpuRenderPipeline,
    TgpuRoot,
    TgpuSampler,
    TgpuTexture,
    UniformFlag,
} from 'typegpu';
import {
    BufferAccess,
    TextureAccess,
    type BufferHandle,
    type FrameGraphRecording,
    type TextureHandle,
} from '@zenfg/webgpu';
import { parseDepthBundle } from './inference/bundle.ts';
import { DepthInferencePlan } from './inference/depthart.ts';
import { DepthDisparityRangeEstimator } from './inference/disparity-range.ts';
import { DepthDType } from './inference/types.ts';
import {
    DEPTH_WORKGROUP_SIZE,
    DepthParams,
    RelightMode,
    RelightParams,
    SURFACE_FAR_Z,
    SURFACE_WORKGROUP_SIZE,
    depthPrepareKernel,
    depthPrepareLayout,
    rangeStabilityLayout,
    relightFragment,
    relightFrameLayout,
    relightLayout,
    stabilizeRangeKernel,
    surfaceKernel,
    surfaceLayout,
} from './monocularLightInjectionShaders.ts';
import type {
    CreateMonocularLightInjectionOptions,
    MonocularFrameOptions,
    MonocularLightInjectionModelMetadata,
    MonocularLightInjectionRuntimeStats,
    MonocularLightInjectionSettings,
    PendingMonocularFrame,
    MonocularUvTransform,
} from './types.ts';

const LIGHT_Z_CLEARANCE = 0.04;
export const MONOCULAR_LIGHT_INJECTION_LIGHT_Z_MIN = SURFACE_FAR_Z + LIGHT_Z_CLEARANCE;
export const MONOCULAR_LIGHT_INJECTION_LIGHT_Z_MAX = 1.65;

const DEFAULT_SETTINGS: MonocularLightInjectionSettings = {
    lightPosition: [0.34, 0.34],
    lightZ: 0.42,
    mirror: true,
    lightColor: [1, 0.72, 0.46],
    exposure: 0.5,
    intensity: 3,
    relief: 0.85,
    specular: 0.22,
    shadow: 0.7,
    occlusion: 0.55,
    mode: 'relit',
};


type SurfaceTexture = TgpuTexture<{
    size: readonly [number, number];
    format: 'rgba16float';
}> & StorageFlag & SampledFlag;

interface CommonResources {
    readonly root: TgpuRoot;
    readonly frameRange: TgpuBuffer<d.Vec2f> & StorageFlag;
    readonly stableRange: TgpuBuffer<d.Vec2f> & StorageFlag;
    readonly depthParams: TgpuBuffer<typeof DepthParams> & UniformFlag;
    readonly relightParams: TgpuBuffer<typeof RelightParams> & UniformFlag;
    readonly sampler: TgpuSampler;
    readonly rangeBindGroup: TgpuBindGroup<typeof rangeStabilityLayout.entries>;
    readonly stabilizePipeline: TgpuComputePipeline;
    readonly depthPipeline: TgpuComputePipeline;
    readonly surfacePipeline: TgpuComputePipeline;
    readonly relightPipeline: TgpuRenderPipeline<d.Vec4f>;
}

interface ModelAttachment {
    readonly plan: DepthInferencePlan;
    readonly rangeEstimator: DepthDisparityRangeEstimator;
    readonly disparity: TgpuBuffer<d.WgslArray<d.Vec4f>> & StorageFlag;
    readonly history: TgpuBuffer<d.WgslArray<d.F32>> & StorageFlag;
    readonly surface: SurfaceTexture;
    readonly depthBindGroup: TgpuBindGroup<typeof depthPrepareLayout.entries>;
    readonly surfaceBindGroup: TgpuBindGroup<typeof surfaceLayout.entries>;
    readonly relightBindGroup: TgpuBindGroup<typeof relightLayout.entries>;
    readonly depthWorkgroups: number;
    readonly fieldWorkgroups: readonly [number, number];
    readonly metadata: MonocularLightInjectionModelMetadata;
}

interface RelightFrameGraphHandles {
    readonly relightParams: BufferHandle;
    readonly surface: TextureHandle;
}

interface DepthFrameGraphHandles extends RelightFrameGraphHandles {
    readonly arena: readonly BufferHandle[];
    readonly weights: readonly BufferHandle[];
    readonly inferenceUniforms: readonly BufferHandle[];
    readonly mutableInferenceStorage: readonly BufferHandle[];
    readonly readonlyInferenceStorage: readonly BufferHandle[];
    readonly rangeUniform: BufferHandle;
    readonly rangeStorage: BufferHandle;
    readonly frameRange: BufferHandle;
    readonly stableRange: BufferHandle;
    readonly depthParams: BufferHandle;
    readonly history: BufferHandle;
}

class MonocularLightInjection {
    private readonly outputFormat: GPUTextureFormat;
    private settings: MonocularLightInjectionSettings;
    private attachment: ModelAttachment | null = null;
    private historyResetPending = true;
    private pendingFrame: symbol | undefined;
    private surfaceDefined = false;
    private submittedDepthUpdates = 0;
    private isDestroyed = false;
    private asyncOperation: 'setModelBundle' | null = null;
    private asyncGeneration = 0;

    constructor(
        outputFormat: GPUTextureFormat,
        settings: MonocularLightInjectionSettings,
        private readonly resources: CommonResources,
    ) {
        this.outputFormat = outputFormat;
        this.settings = settings;
    }

    async setModelBundle(bytes: ArrayBuffer): Promise<MonocularLightInjectionModelMetadata> {
        this.assertNotDestroyed();
        this.assertIdle('setModelBundle');
        const resources = this.resources;
        const generation = this.beginAsyncOperation('setModelBundle');
        let plan: DepthInferencePlan | undefined;
        let rangeEstimator: DepthDisparityRangeEstimator | undefined;
        let next: ModelAttachment | undefined;
        try {
            const bundle = parseDepthBundle(bytes);
            const usesShaderF16 = bundle.tensors.some((tensor) => tensor.dtype === DepthDType.F16);
            if (usesShaderF16 && !resources.root.device.features.has('shader-f16')) {
                throw new Error('This model bundle requires the WebGPU shader-f16 feature.');
            }

            plan = new DepthInferencePlan(resources.root, bundle);
            rangeEstimator = new DepthDisparityRangeEstimator(resources.root);
            validatePlanLimits(resources.root.device, plan);
            await Promise.all([plan.initAsync(), rangeEstimator.initAsync()]);
            this.assertAsyncOperationCurrent('setModelBundle', generation);
            next = createModelAttachment(resources, plan, rangeEstimator, usesShaderF16);
            this.assertAsyncOperationCurrent('setModelBundle', generation);
        } catch (error) {
            if (next) {
                next.history.destroy();
                next.surface.destroy();
            }
            rangeEstimator?.destroy();
            plan?.destroy();
            throw error;
        } finally {
            this.finishAsyncOperation('setModelBundle', generation);
        }

        const previous = this.attachment;
        this.attachment = next;
        this.surfaceDefined = false;
        this.historyResetPending = true;
        destroyModelAttachment(previous);
        return { ...next.metadata, outputSize: [...next.metadata.outputSize] };
    }

    setSettings(patch: Partial<MonocularLightInjectionSettings>): void {
        this.assertNotDestroyed();
        this.assertIdle('setSettings');
        this.settings = mergeSettings(this.settings, patch);
    }

    getSettings(): Readonly<MonocularLightInjectionSettings> {
        this.assertNotDestroyed();
        return cloneSettings(this.settings);
    }

    resetHistory(): void {
        this.assertNotDestroyed();
        this.assertIdle('resetHistory');
        this.requireAttachment('resetHistory');
        this.historyResetPending = true;
    }

    recordFrame(graph: FrameGraphRecording, options: MonocularFrameOptions): PendingMonocularFrame {
        this.assertNotDestroyed();
        this.assertIdle('recordFrame');
        if (this.asyncOperation) throw new Error('Model replacement is still pending.');
        const resources = this.resources;
        const attachment = this.requireAttachment('recordFrame');
        const targetSize = validateColorTarget(graph, options.color, this.outputFormat);
        const uvTransform = validateUvTransform(options.uvTransform);
        const updateDepth = options.updateDepth || this.historyResetPending;

        const identity = Symbol('monocular-frame');
        this.pendingFrame = identity;
        try {
            const externalFrame = resources.root.device.importExternalTexture({ source: options.source });
            this.writeRelightParams(uvTransform, options.swapAxes);
            const frameBindGroup = resources.root.createBindGroup(relightFrameLayout, { frame: externalFrame });
            const relightHandles = importRelightResources(graph, resources, attachment, this.surfaceDefined);

            if (updateDepth) {
                resources.depthParams.write({
                    outputSize: d.vec2u(...attachment.plan.outputSize),
                    reset: this.historyResetPending ? 1 : 0,
                });
                const depthHandles = importDepthResources(graph, resources, attachment, relightHandles);
                this.recordDepth(graph, resources, attachment, depthHandles, externalFrame, uvTransform, options.swapAxes);
                graph.markPersistentState(depthHandles.history);
                graph.markPersistentState(depthHandles.stableRange);
                graph.markPersistentState(depthHandles.surface);
            }
            this.recordRelight(graph, resources, attachment, relightHandles, frameBindGroup, options.color, targetSize);

            let settled = false;
            const settle = (commit: boolean): void => {
                if (settled) return;
                settled = true;
                if (this.isDestroyed || this.pendingFrame !== identity) return;
                this.pendingFrame = undefined;
                if (commit && updateDepth) {
                    this.historyResetPending = false;
                    this.surfaceDefined = true;
                    this.submittedDepthUpdates += 1;
                }
            };
            return Object.freeze({ commit: () => settle(true), discard: () => settle(false) });
        } catch (error) {
            this.pendingFrame = undefined;
            throw error;
        }
    }

    getRuntimeStats(): MonocularLightInjectionRuntimeStats {
        this.assertNotDestroyed();
        const metadata = this.attachment?.metadata;
        return {
            ready: metadata !== undefined,
            model: metadata?.model,
            outputSize: metadata ? [...metadata.outputSize] : undefined,
            dispatchCount: metadata?.dispatchCount ?? 0,
            usesShaderF16: metadata?.usesShaderF16 ?? false,
            submittedDepthUpdates: this.submittedDepthUpdates,
        };
    }

    dispose(): void {
        if (this.isDestroyed) return;
        this.isDestroyed = true;
        this.asyncGeneration += 1;
        this.asyncOperation = null;
        this.destroyAttachment();
        destroyCommonResources(this.resources);
        this.pendingFrame = undefined;
    }

    private recordDepth(
        graph: FrameGraphRecording,
        resources: CommonResources,
        attachment: ModelAttachment,
        handles: DepthFrameGraphHandles,
        externalFrame: GPUExternalTexture,
        uvTransform: MonocularUvTransform,
        swapAxes: boolean,
    ): void {
        graph.compute({
            label: 'monocular-light-injection.depth',
            uses: [
                ...handles.arena.map((handle) => graph.use(handle, BufferAccess.StorageWrite, { contents: 'preserve' })),
                ...handles.weights.map((handle) => graph.use(handle, BufferAccess.StorageRead)),
                ...handles.inferenceUniforms.map((handle) => graph.use(handle, BufferAccess.Uniform)),
                ...handles.mutableInferenceStorage.map((handle) => graph.use(handle, BufferAccess.StorageWrite, { contents: 'preserve' })),
                ...handles.readonlyInferenceStorage.map((handle) => graph.use(handle, BufferAccess.StorageRead)),
                graph.use(handles.rangeUniform, BufferAccess.Uniform),
                graph.use(handles.rangeStorage, BufferAccess.StorageWrite, { contents: 'overwrite' }),
                graph.use(handles.depthParams, BufferAccess.Uniform),
                graph.use(handles.frameRange, BufferAccess.StorageWrite, { contents: 'overwrite' }),
                graph.use(handles.stableRange, BufferAccess.StorageWrite, { contents: 'preserve' }),
                graph.use(handles.history, BufferAccess.StorageWrite, { contents: 'preserve' }),
                graph.use(handles.surface, TextureAccess.StorageWrite, { contents: 'overwrite' }),
            ],
            encode: ({ pass }) => {
                attachment.plan.encodeFrame(pass, externalFrame, {
                    uvTransform: d.mat2x2f(...uvTransform),
                    mirrorX: this.settings.mirror,
                    swapAxes,
                });
                attachment.rangeEstimator.encode(pass);
                resources.stabilizePipeline.with(pass).with(resources.rangeBindGroup).dispatchWorkgroups(1);
                resources.depthPipeline.with(pass).with(attachment.depthBindGroup).dispatchWorkgroups(attachment.depthWorkgroups);
                resources.surfacePipeline.with(pass).with(attachment.surfaceBindGroup).dispatchWorkgroups(...attachment.fieldWorkgroups);
            },
        });
    }

    private recordRelight(
        graph: FrameGraphRecording,
        resources: CommonResources,
        attachment: ModelAttachment,
        handles: RelightFrameGraphHandles,
        frameBindGroup: TgpuBindGroup<typeof relightFrameLayout.entries>,
        color: TextureHandle,
        targetSize: { readonly width: number; readonly height: number },
    ): void {
        graph.render({
            label: 'monocular-light-injection.relight',
            uses: [
                graph.use(handles.surface, TextureAccess.Sampled),
                graph.use(handles.relightParams, BufferAccess.Uniform),
            ],
            colorAttachments: [{
                target: color,
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                storeOp: 'store',
            }],
            encode: ({ pass }) => {
                const side = Math.min(targetSize.width, targetSize.height);
                const x = Math.floor((targetSize.width - side) / 2);
                const y = Math.floor((targetSize.height - side) / 2);
                pass.setViewport(x, y, side, side, 0, 1);
                pass.setScissorRect(x, y, side, side);
                resources.relightPipeline.with(pass).with(attachment.relightBindGroup).with(frameBindGroup).draw(3);
            },
        });
    }

    private writeRelightParams(uvTransform: MonocularUvTransform, swapAxes: boolean): void {
        const resources = this.resources;
        const mode = { relit: RelightMode.RELIT, camera: RelightMode.CAMERA, depth: RelightMode.DEPTH, normals: RelightMode.NORMALS }[this.settings.mode];
        resources.relightParams.write({
            uvTransform: d.mat2x2f(...uvTransform),
            lightColor: d.vec4f(...this.settings.lightColor, 1),
            lightPosition: d.vec2f(...this.settings.lightPosition),
            lightZ: this.settings.lightZ,
            exposure: this.settings.exposure,
            intensity: this.settings.intensity,
            relief: this.settings.relief,
            specular: this.settings.specular,
            shadow: this.settings.shadow,
            occlusion: this.settings.occlusion,
            swapAxes: swapAxes ? 1 : 0,
            mirror: this.settings.mirror ? 1 : 0,
            mode,
        });
    }

    private destroyAttachment(): void {
        destroyModelAttachment(this.attachment);
        this.attachment = null;
    }

    private requireAttachment(method: string): ModelAttachment {
        if (!this.attachment) throw new Error(`MonocularLightInjection.setModelBundle() must complete before ${method}().`);
        return this.attachment;
    }

    private assertIdle(method: string): void {
        if (this.pendingFrame) {
            throw new Error(`MonocularLightInjection.${method}() cannot run while a recorded frame is pending; settle its commit() or discard() first.`);
        }
    }

    private beginAsyncOperation(operation: 'setModelBundle'): number {
        if (this.asyncOperation) {
            throw new Error(`MonocularLightInjection.${operation}() cannot run while ${this.asyncOperation}() is still pending.`);
        }
        this.asyncOperation = operation;
        return ++this.asyncGeneration;
    }

    private assertAsyncOperationCurrent(operation: 'setModelBundle', generation: number): void {
        if (this.isDestroyed || this.asyncOperation !== operation || this.asyncGeneration !== generation) {
            throw new Error(`MonocularLightInjection.${operation}() was cancelled because the workload was disposed.`);
        }
    }

    private finishAsyncOperation(operation: 'setModelBundle', generation: number): void {
        if (this.asyncOperation === operation && this.asyncGeneration === generation) {
            this.asyncOperation = null;
        }
    }

    private assertNotDestroyed(): void {
        if (this.isDestroyed) throw new Error('MonocularLightInjection has been destroyed.');
    }
}

function createCommonResources(device: GPUDevice, outputFormat: GPUTextureFormat): CommonResources {
    const root = tgpu.initFromDevice({ device });
    const frameRange = root.createBuffer(d.vec2f, d.vec2f(0, 1)).$usage('storage').$name('monocular.frame-range');
    const stableRange = root.createBuffer(d.vec2f, d.vec2f(0, 1)).$usage('storage').$name('monocular.stable-range');
    const depthParams = root.createBuffer(DepthParams, { outputSize: d.vec2u(1), reset: 1 }).$usage('uniform').$name('monocular.depth-params');
    const relightParams = root.createBuffer(RelightParams).$usage('uniform').$name('monocular.relight-params');
    const sampler = root.createSampler({ magFilter: 'linear', minFilter: 'linear' }).$name('monocular.sampler');
    const rangeBindGroup = root.createBindGroup(rangeStabilityLayout, {
        params: depthParams,
        frameRange,
        stableRange,
    });
    return {
        root,
        frameRange,
        stableRange,
        depthParams,
        relightParams,
        sampler,
        rangeBindGroup,
        stabilizePipeline: root.createComputePipeline({ compute: stabilizeRangeKernel }).$name('monocular.stabilize'),
        depthPipeline: root.createComputePipeline({ compute: depthPrepareKernel }).$name('monocular.depth-prepare'),
        surfacePipeline: root.createComputePipeline({ compute: surfaceKernel }).$name('monocular.surface'),
        relightPipeline: root.createRenderPipeline({
            vertex: common.fullScreenTriangle,
            fragment: relightFragment,
            targets: { format: outputFormat },
        }).$name('monocular.relight'),
    };
}

function createModelAttachment(
    resources: CommonResources,
    plan: DepthInferencePlan,
    rangeEstimator: DepthDisparityRangeEstimator,
    usesShaderF16: boolean,
): ModelAttachment {
    const [width, height] = plan.outputSize;
    const pixelCount = width * height;
    const disparity = resources.root
        .createBuffer(d.arrayOf(d.vec4f, pixelCount), plan.outputBuffer)
        .$usage('storage')
        .$name('monocular.disparity');
    let history: ModelAttachment['history'] | undefined;
    let surface: SurfaceTexture | undefined;
    try {
        history = resources.root
            .createBuffer(d.arrayOf(d.f32, pixelCount))
            .$usage('storage')
            .$name('monocular.history');
        surface = resources.root
            .createTexture({ size: [width, height], format: 'rgba16float' })
            .$usage('storage', 'sampled')
            .$name('monocular.surface') as SurfaceTexture;
        rangeEstimator.attach(disparity, resources.frameRange, pixelCount);
        return {
        plan,
        rangeEstimator,
        disparity,
        history,
        surface,
        depthBindGroup: resources.root.createBindGroup(depthPrepareLayout, {
            params: resources.depthParams,
            disparity,
            stableRange: resources.stableRange,
            history,
        }),
        surfaceBindGroup: resources.root.createBindGroup(surfaceLayout, {
            params: resources.depthParams,
            depth: history,
            surface: surface.createView(d.textureStorage2d('rgba16float', 'write-only')),
        }),
        relightBindGroup: resources.root.createBindGroup(relightLayout, {
            params: resources.relightParams,
            surface: surface.createView(),
            sampler: resources.sampler,
        }),
        depthWorkgroups: Math.ceil(pixelCount / DEPTH_WORKGROUP_SIZE),
        fieldWorkgroups: [
            Math.ceil(width / SURFACE_WORKGROUP_SIZE),
            Math.ceil(height / SURFACE_WORKGROUP_SIZE),
        ],
        metadata: {
            model: plan.model,
            outputSize: [width, height],
            dispatchCount: plan.dispatchCount + 7,
            usesShaderF16,
        },
        };
    } catch (error) {
        history?.destroy();
        surface?.destroy();
        throw error;
    }
}

function importRelightResources(
    graph: FrameGraphRecording,
    resources: CommonResources,
    attachment: ModelAttachment,
    surfaceDefined: boolean,
): RelightFrameGraphHandles {
    return {
        relightParams: graph.importBuffer(resources.root.unwrap(resources.relightParams), { label: 'monocular.relight-params' }),
        surface: graph.importTexture(resources.root.unwrap(attachment.surface), { label: 'monocular.surface', initialContents: surfaceDefined ? 'defined' : 'undefined' }),
    };
}

function importDepthResources(
    graph: FrameGraphRecording,
    resources: CommonResources,
    attachment: ModelAttachment,
    relight: RelightFrameGraphHandles,
): DepthFrameGraphHandles {
    // Native WebGPU allocations start zero-initialized. Scratch can be sparsely
    // written within the fused inference pass, so its access must preserve.
    // Only surface validity depends on a prior successful depth submission.
    const importBuffer = (buffer: GPUBuffer, label: string) => graph.importBuffer(buffer, { label, initialContents: 'defined' });
    return {
        ...relight,
        arena: attachment.plan.arenaBuffers.map((buffer, index) => importBuffer(buffer, `monocular.arena.${index}`)),
        weights: attachment.plan.weightBuffers.map((buffer, index) => importBuffer(buffer, `monocular.weights.${index}`)),
        inferenceUniforms: attachment.plan.uniformBuffers.map((buffer, index) => importBuffer(buffer, `monocular.inference-uniform.${index}`)),
        mutableInferenceStorage: attachment.plan.mutableStorageBuffers.map((buffer, index) => importBuffer(buffer, `monocular.inference-storage.mutable.${index}`)),
        readonlyInferenceStorage: attachment.plan.readonlyStorageBuffers.map((buffer, index) => importBuffer(buffer, `monocular.inference-storage.readonly.${index}`)),
        rangeUniform: importBuffer(attachment.rangeEstimator.uniformBuffer, 'monocular.range-uniform'),
        rangeStorage: importBuffer(attachment.rangeEstimator.storageBuffer, 'monocular.range-storage'),
        frameRange: importBuffer(resources.root.unwrap(resources.frameRange), 'monocular.frame-range'),
        stableRange: importBuffer(resources.root.unwrap(resources.stableRange), 'monocular.stable-range'),
        depthParams: importBuffer(resources.root.unwrap(resources.depthParams), 'monocular.depth-params'),
        history: importBuffer(resources.root.unwrap(attachment.history), 'monocular.history'),
    };
}

function destroyModelAttachment(attachment: ModelAttachment | null): void {
    if (!attachment) return;
    attachment.rangeEstimator.destroy();
    attachment.history.destroy();
    attachment.surface.destroy();
    attachment.plan.destroy();
}

function destroyCommonResources(resources: CommonResources): void {
    resources.frameRange.destroy();
    resources.stableRange.destroy();
    resources.depthParams.destroy();
    resources.relightParams.destroy();
    resources.root.destroy();
}

function validatePlanLimits(device: GPUDevice, plan: DepthInferencePlan): void {
    const [width, height] = plan.outputSize;
    if (width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D) {
        throw new Error(`Depth surface ${width}x${height} exceeds maxTextureDimension2D ${device.limits.maxTextureDimension2D}.`);
    }
    const pixelCount = width * height;
    if (Math.ceil(pixelCount / DEPTH_WORKGROUP_SIZE) > device.limits.maxComputeWorkgroupsPerDimension) {
        throw new Error('Depth preparation dispatch exceeds maxComputeWorkgroupsPerDimension.');
    }
    for (const buffer of [...plan.arenaBuffers, ...plan.weightBuffers, ...plan.mutableStorageBuffers, ...plan.readonlyStorageBuffers]) {
        if (buffer.size > device.limits.maxBufferSize) {
            throw new Error(`Depth tensor arena requires ${buffer.size} bytes, exceeding maxBufferSize ${device.limits.maxBufferSize}.`);
        }
        if (buffer.size > device.limits.maxStorageBufferBindingSize) {
            throw new Error(`Depth tensor arena requires ${buffer.size} bytes, exceeding maxStorageBufferBindingSize ${device.limits.maxStorageBufferBindingSize}.`);
        }
    }
    for (const buffer of plan.uniformBuffers) {
        if (buffer.size > device.limits.maxUniformBufferBindingSize) {
            throw new Error(`Depth inference uniform requires ${buffer.size} bytes, exceeding maxUniformBufferBindingSize ${device.limits.maxUniformBufferBindingSize}.`);
        }
    }
}

function validateColorTarget(
    graph: FrameGraphRecording,
    color: TextureHandle,
    outputFormat: GPUTextureFormat,
): { width: number; height: number } {
    const desc = graph.getTextureDesc(color);
    if (desc.format !== outputFormat) {
        throw new Error(`MonocularLightInjection color format must be ${outputFormat}, received ${desc.format}.`);
    }
    if ((desc.sampleCount ?? 1) !== 1) {
        throw new Error('MonocularLightInjection color target must be single-sampled.');
    }
    const [width, height] = textureSizeTuple(desc.size);
    return { width, height };
}

function textureSizeTuple(size: Readonly<GPUExtent3DDictStrict> | Iterable<number>): readonly [number, number] {
    if (Symbol.iterator in Object(size)) {
        const [width = 1, height = 1] = Array.from(size as Iterable<number>);
        return [width, height];
    }
    const dict = size as GPUExtent3DDictStrict;
    return [dict.width, dict.height ?? 1];
}

function mergeSettings(
    base: MonocularLightInjectionSettings,
    patch: Partial<MonocularLightInjectionSettings>,
): MonocularLightInjectionSettings {
    const mode = patch.mode ?? base.mode;
    if (!['relit', 'camera', 'depth', 'normals'].includes(mode)) {
        throw new Error(`Unknown monocular light injection mode: ${String(mode)}.`);
    }
    if (patch.mirror !== undefined && typeof patch.mirror !== 'boolean') {
        throw new Error('Monocular light injection mirror must be a boolean.');
    }
    return {
        lightPosition: validateVec2(patch.lightPosition ?? base.lightPosition, -1, 2, 'lightPosition'),
        lightZ: validateFiniteInRange(patch.lightZ ?? base.lightZ, MONOCULAR_LIGHT_INJECTION_LIGHT_Z_MIN, MONOCULAR_LIGHT_INJECTION_LIGHT_Z_MAX, 'lightZ'),
        mirror: patch.mirror ?? base.mirror,
        lightColor: validateVec3(patch.lightColor ?? base.lightColor, 0, 1, 'lightColor'),
        exposure: validateFiniteInRange(patch.exposure ?? base.exposure, 0, 1.2, 'exposure'),
        intensity: validateFiniteInRange(patch.intensity ?? base.intensity, 0, 3.5, 'intensity'),
        relief: validateFiniteInRange(patch.relief ?? base.relief, 0, 2.5, 'relief'),
        specular: validateFiniteInRange(patch.specular ?? base.specular, 0, 1, 'specular'),
        shadow: validateFiniteInRange(patch.shadow ?? base.shadow, 0, 1, 'shadow'),
        occlusion: validateFiniteInRange(patch.occlusion ?? base.occlusion, 0, 1, 'occlusion'),
        mode,
    };
}

function cloneSettings(settings: MonocularLightInjectionSettings): MonocularLightInjectionSettings {
    return {
        ...settings,
        lightPosition: [...settings.lightPosition],
        lightColor: [...settings.lightColor],
    };
}

function validateUvTransform(value: MonocularUvTransform): MonocularUvTransform {
    if (value.length !== 4 || value.some((component) => !Number.isFinite(component))) {
        throw new Error('Monocular light injection uvTransform must contain four finite values.');
    }
    return [...value];
}

function validateVec2(value: readonly number[], min: number, max: number, label: string): readonly [number, number] {
    if (value.length !== 2) throw new Error(`Monocular light injection ${label} must contain two components.`);
    return [
        validateFiniteInRange(value[0]!, min, max, label),
        validateFiniteInRange(value[1]!, min, max, label),
    ];
}

function validateVec3(value: readonly number[], min: number, max: number, label: string): readonly [number, number, number] {
    if (value.length !== 3) throw new Error(`Monocular light injection ${label} must contain three components.`);
    return [
        validateFiniteInRange(value[0]!, min, max, label),
        validateFiniteInRange(value[1]!, min, max, label),
        validateFiniteInRange(value[2]!, min, max, label),
    ];
}

function validateFiniteInRange(value: number, min: number, max: number, label: string): number {
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`Monocular light injection ${label} must be a finite value in [${min}, ${max}].`);
    }
    return value;
}

/** Creates an independent GPU workload; the caller owns device and submission. */
export async function createMonocularLightInjection(options: CreateMonocularLightInjectionOptions): Promise<MonocularLightInjectionWorkload> {
    const settings = mergeSettings(DEFAULT_SETTINGS, options.initialSettings ?? {});
    const resources = createCommonResources(options.device, options.outputFormat);
    try {
        await Promise.all([
            resources.stabilizePipeline.initAsync(), resources.depthPipeline.initAsync(),
            resources.surfacePipeline.initAsync(), resources.relightPipeline.initAsync(),
        ]);
        return new MonocularLightInjection(options.outputFormat, settings, resources);
    } catch (error) {
        destroyCommonResources(resources);
        throw error;
    }
}

export type MonocularLightInjectionWorkload = Pick<MonocularLightInjection,
    'setModelBundle' | 'setSettings' | 'getSettings' | 'resetHistory' | 'recordFrame' | 'getRuntimeStats' | 'dispose'>;
