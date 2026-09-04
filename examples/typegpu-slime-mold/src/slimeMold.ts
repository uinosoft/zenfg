// Based on the TypeGPU Slime Mold example by Software Mansion. See THIRD_PARTY_NOTICES.md.
import { randf } from '@typegpu/noise';
import {
    d,
    std,
    tgpu,
    type TgpuBindGroup,
    type TgpuBuffer,
    type TgpuComputePipeline,
    type TgpuFixedSampler,
    type TgpuRenderPipeline,
    type TgpuRoot,
    type TgpuTexture,
} from 'typegpu';
import {
    BufferAccess,
    TextureAccess,
    type BufferHandle,
    type FrameGraphRecording,
    type TextureHandle,
} from '@zenfg/webgpu';
import type {
    PendingSlimeMoldFrame,
    SlimeMoldSettings,
    TypeGpuSlimeMoldFrameOptions,
    TypeGpuSlimeMoldOptions,
} from './types.ts';

const Agent = d.struct({
    position: d.vec2f,
    angle: d.f32,
});

const Params = d.struct({
    moveSpeed: d.f32,
    sensorAngle: d.f32,
    sensorDistance: d.f32,
    turnSpeed: d.f32,
    evaporationRate: d.f32,
});

export const DEFAULT_SLIME_MOLD_AGENT_COUNT = 200_000;

export const DEFAULT_SLIME_MOLD_SETTINGS: Readonly<SlimeMoldSettings> = Object.freeze({
    moveSpeed: 50,
    sensorAngle: 0.5,
    sensorDistance: 15,
    turnSpeed: 2,
    evaporationRate: 0.05,
});

const AGENT_WORKGROUP_SIZE = 64;
const TEXTURE_WORKGROUP_SIZE = 16;

type TrailIndex = 0 | 1;

interface SlimeMoldFrameGraphHandles {
    readonly agents: BufferHandle;
    readonly params: BufferHandle;
    readonly deltaTime: BufferHandle;
    readonly resolution: BufferHandle;
    readonly trails: readonly [TextureHandle, TextureHandle];
}

interface SlimeMoldPipelines {
    readonly initialize: TgpuComputePipeline;
    readonly clear: TgpuComputePipeline;
    readonly diffuse: TgpuComputePipeline;
    readonly simulate: TgpuComputePipeline;
    readonly render: TgpuRenderPipeline;
}

interface SlimeMoldBindGroups {
    readonly initialize: TgpuBindGroup;
    readonly clear: readonly [TgpuBindGroup, TgpuBindGroup];
    readonly compute: readonly [TgpuBindGroup, TgpuBindGroup];
    readonly render: readonly [TgpuBindGroup, TgpuBindGroup];
}

/**
 * Records the official TypeGPU Slime Mold simulation into a caller-owned ZenFG
 * frame. This class never creates a device or submits command buffers.
 */
export class TypeGpuSlimeMold {
    private readonly agentCount: number;
    private readonly outputFormat: GPUTextureFormat;
    private readonly resources: SlimeMoldGpuResources;
    private settings: SlimeMoldSettings;
    private committedTrailIndex: TrailIndex = 0;
    private resetPending = true;
    private persistentStateDefined = false;
    private pendingFrame: symbol | undefined;
    private destroyed = false;

    constructor(options: TypeGpuSlimeMoldOptions) {
        this.agentCount = validatePositiveInteger(
            options.agentCount ?? DEFAULT_SLIME_MOLD_AGENT_COUNT,
            'agentCount',
        );
        this.outputFormat = options.outputFormat;
        this.settings = mergeSettings(DEFAULT_SLIME_MOLD_SETTINGS, options.initialSettings ?? {});
        const viewport = resolveViewportSize(options.viewport.width, options.viewport.height);
        validateDeviceLimits(options.device, this.agentCount, viewport.width, viewport.height);
        this.resources = new SlimeMoldGpuResources({
            device: options.device,
            agentCount: this.agentCount,
            width: viewport.width,
            height: viewport.height,
            outputFormat: this.outputFormat,
            settings: this.settings,
        });
    }

    resize(width: number, height: number): void {
        this.assertUsable('resize');
        const size = resolveViewportSize(width, height);
        validateTextureSize(this.resources.device, size.width, size.height);
        if (!this.resources.resize(size.width, size.height)) return;

        this.committedTrailIndex = 0;
        this.resetPending = true;
        this.persistentStateDefined = false;
    }

    setSettings(settings: Partial<SlimeMoldSettings>): void {
        this.assertNotDestroyed();
        this.settings = mergeSettings(this.settings, settings);
        this.resources.writeSettings(this.settings);
    }

    getSettings(): Readonly<SlimeMoldSettings> {
        this.assertNotDestroyed();
        return { ...this.settings };
    }

    reset(): void {
        this.assertUsable('reset');
        this.resetPending = true;
        this.persistentStateDefined = false;
    }

    recordFrameGraph(
        graph: FrameGraphRecording,
        options: TypeGpuSlimeMoldFrameOptions,
    ): PendingSlimeMoldFrame {
        this.assertUsable('recordFrameGraph');
        const deltaTime = validateFiniteInRange(options.deltaTime, 0, 0.1, 'deltaTime');
        validateColorTarget(graph, options.color, this.outputFormat);

        const readIndex = this.committedTrailIndex;
        const writeIndex = oppositeTrail(readIndex);
        const resetRecorded = this.resetPending;
        this.resources.writeDeltaTime(deltaTime);

        const handles = this.resources.importInto(graph, this.persistentStateDefined);
        if (resetRecorded) {
            this.recordReset(graph, handles);
        }
        this.recordDiffuse(graph, handles, readIndex, writeIndex);
        this.recordSimulation(graph, handles, readIndex, writeIndex);
        this.recordRender(graph, handles, options.color, writeIndex);
        graph.markPersistentState(handles.agents);
        graph.markPersistentState(handles.trails[writeIndex]);

        const identity = Symbol('pending-slime-mold-frame');
        this.pendingFrame = identity;
        let settled = false;
        const settle = (commit: boolean): void => {
            if (settled) return;
            settled = true;
            if (this.pendingFrame !== identity) return;
            this.pendingFrame = undefined;
            if (!commit || this.destroyed) return;
            this.committedTrailIndex = writeIndex;
            this.persistentStateDefined = true;
            if (resetRecorded) this.resetPending = false;
        };

        return Object.freeze({
            commit: () => settle(true),
            discard: () => settle(false),
        });
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.pendingFrame = undefined;
        this.resources.destroy();
    }

    private recordReset(graph: FrameGraphRecording, handles: SlimeMoldFrameGraphHandles): void {
        graph.compute({
            label: 'slime-mold.reset',
            uses: [
                graph.use(handles.agents, BufferAccess.StorageWrite, { contents: 'overwrite' }),
                graph.use(handles.resolution, BufferAccess.Uniform),
                graph.use(handles.trails[0], TextureAccess.StorageWrite, { contents: 'overwrite' }),
                graph.use(handles.trails[1], TextureAccess.StorageWrite, { contents: 'overwrite' }),
            ],
            encode: ({ pass }) => {
                this.resources.pipelines.initialize
                    .with(this.resources.bindGroups.initialize)
                    .with(pass)
                    .dispatchWorkgroups(Math.ceil(this.agentCount / AGENT_WORKGROUP_SIZE));
                for (const bindGroup of this.resources.bindGroups.clear) {
                    this.resources.pipelines.clear
                        .with(bindGroup)
                        .with(pass)
                        .dispatchWorkgroups(
                            Math.ceil(this.resources.width / TEXTURE_WORKGROUP_SIZE),
                            Math.ceil(this.resources.height / TEXTURE_WORKGROUP_SIZE),
                        );
                }
            },
        });
    }

    private recordDiffuse(
        graph: FrameGraphRecording,
        handles: SlimeMoldFrameGraphHandles,
        readIndex: TrailIndex,
        writeIndex: TrailIndex,
    ): void {
        graph.compute({
            label: 'slime-mold.diffuse',
            uses: [
                graph.use(handles.params, BufferAccess.Uniform),
                graph.use(handles.trails[readIndex], TextureAccess.StorageRead),
                graph.use(handles.trails[writeIndex], TextureAccess.StorageWrite, { contents: 'overwrite' }),
            ],
            encode: ({ pass }) => {
                this.resources.pipelines.diffuse
                    .with(this.resources.bindGroups.compute[readIndex])
                    .with(pass)
                    .dispatchWorkgroups(
                        Math.ceil(this.resources.width / TEXTURE_WORKGROUP_SIZE),
                        Math.ceil(this.resources.height / TEXTURE_WORKGROUP_SIZE),
                    );
            },
        });
    }

    private recordSimulation(
        graph: FrameGraphRecording,
        handles: SlimeMoldFrameGraphHandles,
        readIndex: TrailIndex,
        writeIndex: TrailIndex,
    ): void {
        graph.compute({
            label: 'slime-mold.simulate',
            uses: [
                graph.use(handles.agents, BufferAccess.StorageRead),
                graph.use(handles.agents, BufferAccess.StorageWrite, { contents: 'overwrite' }),
                graph.use(handles.params, BufferAccess.Uniform),
                graph.use(handles.deltaTime, BufferAccess.Uniform),
                graph.use(handles.trails[readIndex], TextureAccess.StorageRead),
                graph.use(handles.trails[writeIndex], TextureAccess.StorageWrite, { contents: 'preserve' }),
            ],
            encode: ({ pass }) => {
                this.resources.pipelines.simulate
                    .with(this.resources.bindGroups.compute[readIndex])
                    .with(pass)
                    .dispatchWorkgroups(Math.ceil(this.agentCount / AGENT_WORKGROUP_SIZE));
            },
        });
    }

    private recordRender(
        graph: FrameGraphRecording,
        handles: SlimeMoldFrameGraphHandles,
        color: TextureHandle,
        trailIndex: TrailIndex,
    ): void {
        graph.render({
            label: 'slime-mold.render',
            uses: [graph.use(handles.trails[trailIndex], TextureAccess.Sampled)],
            colorAttachments: [{
                target: color,
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                storeOp: 'store',
            }],
            encode: ({ pass }) => {
                this.resources.pipelines.render
                    .with(this.resources.bindGroups.render[trailIndex])
                    .with(pass)
                    .draw(3);
            },
        });
    }

    private assertUsable(method: string): void {
        this.assertNotDestroyed();
        if (this.pendingFrame) {
            throw new Error(
                `TypeGpuSlimeMold.${method}() cannot run while a frame is pending; commit() or discard() it first.`,
            );
        }
    }

    private assertNotDestroyed(): void {
        if (this.destroyed) throw new Error('TypeGpuSlimeMold has been destroyed.');
    }
}

class SlimeMoldGpuResources {
    readonly root: TgpuRoot;
    readonly pipelines: SlimeMoldPipelines;
    bindGroups: SlimeMoldBindGroups;
    width: number;
    height: number;
    private readonly agentBuffer!: TgpuBuffer<any>;
    private readonly paramsBuffer!: TgpuBuffer<any>;
    private readonly deltaTimeBuffer!: TgpuBuffer<any>;
    private readonly resolutionBuffer!: TgpuBuffer<any>;
    private readonly filteringSampler: TgpuFixedSampler;
    private trails!: [TgpuTexture, TgpuTexture];
    private readonly createBindGroupsForTrails!: (
        trails: readonly [TgpuTexture, TgpuTexture],
    ) => SlimeMoldBindGroups;
    private destroyed = false;

    constructor(options: {
        readonly device: GPUDevice;
        readonly agentCount: number;
        readonly width: number;
        readonly height: number;
        readonly outputFormat: GPUTextureFormat;
        readonly settings: SlimeMoldSettings;
    }) {
        this.root = tgpu.initFromDevice({ device: options.device });
        try {
            this.width = options.width;
            this.height = options.height;

            const agentArray = d.arrayOf(Agent, options.agentCount);
            this.agentBuffer = this.root.createBuffer(agentArray).$usage('storage').$name('slime-mold.agents');
            this.paramsBuffer = this.root.createBuffer(Params, options.settings).$usage('uniform').$name('slime-mold.params');
            this.deltaTimeBuffer = this.root.createBuffer(d.f32, 0).$usage('uniform').$name('slime-mold.delta-time');
            this.resolutionBuffer = this.root.createBuffer(
                d.vec2f,
                d.vec2f(options.width, options.height),
            ).$usage('uniform').$name('slime-mold.resolution');
            this.filteringSampler = this.root.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            }).$name('slime-mold.filtering-sampler');

            const initializeLayout = tgpu.bindGroupLayout({
                agents: { storage: agentArray, access: 'mutable', visibility: ['compute'] },
                resolution: { uniform: d.vec2f, visibility: ['compute'] },
            }).$name('slime-mold.initialize-layout');
            const clearLayout = tgpu.bindGroupLayout({
                state: {
                    storageTexture: d.textureStorage2d('rgba8unorm', 'write-only'),
                    visibility: ['compute'],
                },
            }).$name('slime-mold.clear-layout');
            const computeLayout = tgpu.bindGroupLayout({
                agents: { storage: agentArray, access: 'mutable', visibility: ['compute'] },
                params: { uniform: Params, visibility: ['compute'] },
                deltaTime: { uniform: d.f32, visibility: ['compute'] },
                oldState: {
                    storageTexture: d.textureStorage2d('rgba8unorm', 'read-only'),
                    visibility: ['compute'],
                },
                newState: {
                    storageTexture: d.textureStorage2d('rgba8unorm', 'write-only'),
                    visibility: ['compute'],
                },
            }).$name('slime-mold.compute-layout');
            const renderLayout = tgpu.bindGroupLayout({
                state: { texture: d.texture2d(), visibility: ['fragment'] },
                sampler: { sampler: 'filtering', visibility: ['fragment'] },
            }).$name('slime-mold.render-layout');

            const initializeAgents = tgpu.computeFn({
                in: { gid: d.builtin.globalInvocationId },
                workgroupSize: [AGENT_WORKGROUP_SIZE],
            })(({ gid }) => {
                'use gpu';
                if (gid.x >= options.agentCount) return;
                randf.seed(gid.x / options.agentCount + 0.1);
                const resolution = initializeLayout.$.resolution;
                const position = std.add(
                    std.mul(randf.inUnitCircle(), resolution.x / 2 - 10),
                    std.div(resolution, 2),
                );
                const angle = std.atan2(
                    resolution.y / 2 - position.y,
                    resolution.x / 2 - position.x,
                );
                initializeLayout.$.agents[gid.x] = Agent({ position, angle });
            }).$name('slime-mold.initialize-agents');

            const clearTrail = tgpu.computeFn({
                in: { gid: d.builtin.globalInvocationId },
                workgroupSize: [TEXTURE_WORKGROUP_SIZE, TEXTURE_WORKGROUP_SIZE],
            })(({ gid }) => {
                'use gpu';
                const dims = std.textureDimensions(clearLayout.$.state);
                if (gid.x >= dims.x || gid.y >= dims.y) return;
                std.textureStore(clearLayout.$.state, gid.xy, d.vec4f(0, 0, 0, 0));
            }).$name('slime-mold.clear-trail');

            const sense = tgpu.fn([d.vec2f, d.f32, d.f32], d.f32)(
                (position, angle, sensorAngleOffset) => {
                    'use gpu';
                    const sensorAngle = angle + sensorAngleOffset;
                    const sensorDirection = d.vec2f(std.cos(sensorAngle), std.sin(sensorAngle));
                    const sensorPosition = std.add(
                        position,
                        std.mul(sensorDirection, computeLayout.$.params.sensorDistance),
                    );
                    const dims = std.textureDimensions(computeLayout.$.oldState);
                    const dimsFloat = d.vec2f(dims);
                    const sensorPixel = d.vec2u(std.clamp(
                        sensorPosition,
                        d.vec2f(0),
                        std.sub(dimsFloat, 1),
                    ));
                    const color = std.textureLoad(computeLayout.$.oldState, sensorPixel).rgb;
                    return color.x + color.y + color.z;
                },
            ).$name('slime-mold.sense');

            const diffuse = tgpu.computeFn({
                in: { gid: d.builtin.globalInvocationId },
                workgroupSize: [TEXTURE_WORKGROUP_SIZE, TEXTURE_WORKGROUP_SIZE],
            })(({ gid }) => {
                'use gpu';
                const dims = std.textureDimensions(computeLayout.$.oldState);
                if (gid.x >= dims.x || gid.y >= dims.y) return;
                let sum = d.vec3f();
                let count = d.f32();
                for (const offsetY of tgpu.unroll([-1, 0, 1])) {
                    for (const offsetX of tgpu.unroll([-1, 0, 1])) {
                        const samplePosition = std.add(
                            d.vec2i(gid.xy),
                            d.vec2i(offsetX, offsetY),
                        );
                        const dimsInt = d.vec2i(dims);
                        if (
                            samplePosition.x >= 0
                            && samplePosition.x < dimsInt.x
                            && samplePosition.y >= 0
                            && samplePosition.y < dimsInt.y
                        ) {
                            sum = std.add(
                                sum,
                                std.textureLoad(
                                    computeLayout.$.oldState,
                                    d.vec2u(samplePosition),
                                ).rgb,
                            );
                            count += 1;
                        }
                    }
                }
                const blurred = std.div(sum, count);
                const color = std.saturate(std.sub(
                    blurred,
                    computeLayout.$.params.evaporationRate,
                ));
                std.textureStore(computeLayout.$.newState, gid.xy, d.vec4f(color, 1));
            }).$name('slime-mold.diffuse');

            const simulate = tgpu.computeFn({
                in: { gid: d.builtin.globalInvocationId },
                workgroupSize: [AGENT_WORKGROUP_SIZE],
            })(({ gid }) => {
                'use gpu';
                if (gid.x >= options.agentCount) return;
                randf.seed(gid.x / options.agentCount + 0.1);
                const dims = std.textureDimensions(computeLayout.$.oldState);
                const agent = computeLayout.$.agents[gid.x];
                const random = randf.sample();
                const forward = sense(agent.position, agent.angle, d.f32(0));
                const left = sense(
                    agent.position,
                    agent.angle,
                    computeLayout.$.params.sensorAngle,
                );
                const right = sense(
                    agent.position,
                    agent.angle,
                    -computeLayout.$.params.sensorAngle,
                );
                let angle = agent.angle;

                if (forward > left && forward > right) {
                    // Continue straight.
                } else if (forward < left && forward < right) {
                    angle += (random * 2 - 1)
                        * computeLayout.$.params.turnSpeed
                        * computeLayout.$.deltaTime;
                } else if (right > left) {
                    angle -= computeLayout.$.params.turnSpeed * computeLayout.$.deltaTime;
                } else if (left > right) {
                    angle += computeLayout.$.params.turnSpeed * computeLayout.$.deltaTime;
                }

                const direction = d.vec2f(std.cos(angle), std.sin(angle));
                let newPosition = std.add(
                    agent.position,
                    std.mul(
                        direction,
                        computeLayout.$.params.moveSpeed * computeLayout.$.deltaTime,
                    ),
                );
                const dimsFloat = d.vec2f(dims);
                if (
                    newPosition.x < 0
                    || newPosition.x > dimsFloat.x
                    || newPosition.y < 0
                    || newPosition.y > dimsFloat.y
                ) {
                    newPosition = std.clamp(
                        newPosition,
                        d.vec2f(0),
                        std.sub(dimsFloat, 1),
                    );
                    if (newPosition.x <= 0 || newPosition.x >= dimsFloat.x - 1) {
                        angle = Math.PI - angle;
                    }
                    if (newPosition.y <= 0 || newPosition.y >= dimsFloat.y - 1) {
                        angle = -angle;
                    }
                    angle += (random - 0.5) * 0.1;
                }

                computeLayout.$.agents[gid.x] = Agent({ position: newPosition, angle });
                const oldState = std.textureLoad(
                    computeLayout.$.oldState,
                    d.vec2u(newPosition),
                ).rgb;
                std.textureStore(
                    computeLayout.$.newState,
                    d.vec2u(newPosition),
                    d.vec4f(std.add(oldState, 1), 1),
                );
            }).$name('slime-mold.simulate');

            const fullScreenTriangle = tgpu.vertexFn({
                in: { vertexIndex: d.builtin.vertexIndex },
                out: { position: d.builtin.position, uv: d.vec2f },
            })(({ vertexIndex }) => {
                'use gpu';
                const positions = [d.vec2f(-1, -1), d.vec2f(3, -1), d.vec2f(-1, 3)];
                const uvs = [d.vec2f(0, 1), d.vec2f(2, 1), d.vec2f(0, -1)];
                return {
                    position: d.vec4f(positions[vertexIndex], 0, 1),
                    uv: uvs[vertexIndex],
                };
            }).$name('slime-mold.fullscreen-vertex');
            const presentTrail = tgpu.fragmentFn({
                in: { uv: d.vec2f },
                out: d.vec4f,
            })(({ uv }) => {
                'use gpu';
                return std.textureSample(renderLayout.$.state, renderLayout.$.sampler, uv);
            }).$name('slime-mold.present-fragment');

            this.pipelines = {
                initialize: this.root.createComputePipeline({ compute: initializeAgents })
                    .$name('slime-mold.initialize-pipeline'),
                clear: this.root.createComputePipeline({ compute: clearTrail })
                    .$name('slime-mold.clear-pipeline'),
                diffuse: this.root.createComputePipeline({ compute: diffuse })
                    .$name('slime-mold.diffuse-pipeline'),
                simulate: this.root.createComputePipeline({ compute: simulate })
                    .$name('slime-mold.simulate-pipeline'),
                render: this.root.createRenderPipeline({
                    vertex: fullScreenTriangle,
                    fragment: presentTrail,
                    targets: { format: options.outputFormat },
                }).$name('slime-mold.render-pipeline'),
            };
            for (const pipeline of Object.values(this.pipelines)) pipeline.initSync();

            this.createBindGroupsForTrails = (trails) => ({
                initialize: this.root.createBindGroup(initializeLayout, {
                    agents: this.root.unwrap(this.agentBuffer),
                    resolution: this.root.unwrap(this.resolutionBuffer),
                }),
                clear: [
                    this.root.createBindGroup(clearLayout, {
                        state: this.root.unwrap(trails[0]),
                    }),
                    this.root.createBindGroup(clearLayout, {
                        state: this.root.unwrap(trails[1]),
                    }),
                ],
                compute: [
                    this.root.createBindGroup(computeLayout, {
                        agents: this.root.unwrap(this.agentBuffer),
                        params: this.root.unwrap(this.paramsBuffer),
                        deltaTime: this.root.unwrap(this.deltaTimeBuffer),
                        oldState: this.root.unwrap(trails[0]),
                        newState: this.root.unwrap(trails[1]),
                    }),
                    this.root.createBindGroup(computeLayout, {
                        agents: this.root.unwrap(this.agentBuffer),
                        params: this.root.unwrap(this.paramsBuffer),
                        deltaTime: this.root.unwrap(this.deltaTimeBuffer),
                        oldState: this.root.unwrap(trails[1]),
                        newState: this.root.unwrap(trails[0]),
                    }),
                ],
                render: [
                    this.root.createBindGroup(renderLayout, {
                        state: this.root.unwrap(trails[0]),
                        sampler: this.root.unwrap(this.filteringSampler),
                    }),
                    this.root.createBindGroup(renderLayout, {
                        state: this.root.unwrap(trails[1]),
                        sampler: this.root.unwrap(this.filteringSampler),
                    }),
                ],
            });
            this.trails = this.createTrails(options.width, options.height);
            this.bindGroups = this.createBindGroupsForTrails(this.trails);
        } catch (error) {
            this.agentBuffer?.destroy();
            this.paramsBuffer?.destroy();
            this.deltaTimeBuffer?.destroy();
            this.resolutionBuffer?.destroy();
            this.trails?.forEach((trail) => trail.destroy());
            this.root.destroy();
            throw error;
        }
    }

    get device(): GPUDevice {
        return this.root.device;
    }

    writeSettings(settings: SlimeMoldSettings): void {
        this.assertNotDestroyed();
        this.paramsBuffer.write(settings);
    }

    writeDeltaTime(deltaTime: number): void {
        this.assertNotDestroyed();
        this.deltaTimeBuffer.write(deltaTime);
    }

    resize(width: number, height: number): boolean {
        this.assertNotDestroyed();
        if (this.width === width && this.height === height) return false;

        const trails = this.createTrails(width, height);
        let bindGroups: SlimeMoldBindGroups;
        try {
            bindGroups = this.createBindGroupsForTrails(trails);
            this.resolutionBuffer.write(d.vec2f(width, height));
        } catch (error) {
            for (const trail of trails) trail.destroy();
            throw error;
        }

        const previousTrails = this.trails;
        this.trails = trails;
        this.bindGroups = bindGroups;
        this.width = width;
        this.height = height;
        for (const trail of previousTrails) trail.destroy();
        return true;
    }

    importInto(
        graph: FrameGraphRecording,
        persistentStateDefined: boolean,
    ): SlimeMoldFrameGraphHandles {
        this.assertNotDestroyed();
        const persistentImport = { initialContents: persistentStateDefined ? 'defined' : 'undefined' } as const;
        const importBuffer = (buffer: TgpuBuffer<any>, label: string, persistent = false) => graph.importBuffer(
            this.root.unwrap(buffer),
            persistent ? { label, ...persistentImport } : { label },
        );
        return {
            agents: importBuffer(this.agentBuffer, 'slime-mold.agents', true),
            params: importBuffer(this.paramsBuffer, 'slime-mold.params'),
            deltaTime: importBuffer(this.deltaTimeBuffer, 'slime-mold.delta-time'),
            resolution: importBuffer(this.resolutionBuffer, 'slime-mold.resolution'),
            trails: this.trails.map((trail, index) => graph.importTexture(
                this.root.unwrap(trail),
                { label: `slime-mold.trail.${index}`, ...persistentImport },
            )) as [TextureHandle, TextureHandle],
        };
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.agentBuffer.destroy();
        this.paramsBuffer.destroy();
        this.deltaTimeBuffer.destroy();
        this.resolutionBuffer.destroy();
        for (const trail of this.trails) trail.destroy();
        this.root.destroy();
    }

    private createTrails(width: number, height: number): [TgpuTexture, TgpuTexture] {
        const createTrail = (index: number) => this.root.createTexture({
            size: [width, height] as [number, number],
            format: 'rgba8unorm' as const,
            mipLevelCount: 1,
        }).$usage('sampled', 'storage').$name(`slime-mold.trail.${index}`);
        return [createTrail(0), createTrail(1)];
    }

    private assertNotDestroyed(): void {
        if (this.destroyed) throw new Error('Slime Mold GPU resources have been destroyed.');
    }
}

function mergeSettings(
    base: Readonly<SlimeMoldSettings>,
    patch: Partial<SlimeMoldSettings>,
): SlimeMoldSettings {
    return {
        moveSpeed: validateFiniteInRange(patch.moveSpeed ?? base.moveSpeed, 0, 100, 'moveSpeed'),
        sensorAngle: validateFiniteInRange(patch.sensorAngle ?? base.sensorAngle, 0, 3.14, 'sensorAngle'),
        sensorDistance: validateFiniteInRange(patch.sensorDistance ?? base.sensorDistance, 1, 50, 'sensorDistance'),
        turnSpeed: validateFiniteInRange(patch.turnSpeed ?? base.turnSpeed, 0, 10, 'turnSpeed'),
        evaporationRate: validateFiniteInRange(
            patch.evaporationRate ?? base.evaporationRate,
            0,
            0.5,
            'evaporationRate',
        ),
    };
}

function resolveViewportSize(width: number, height: number): { width: number; height: number } {
    return {
        width: Math.max(1, Math.floor(validatePositiveFinite(width, 'viewport.width'))),
        height: Math.max(1, Math.floor(validatePositiveFinite(height, 'viewport.height'))),
    };
}

function validateDeviceLimits(
    device: GPUDevice,
    agentCount: number,
    width: number,
    height: number,
): void {
    validateTextureSize(device, width, height);
    const agentBufferBytes = d.sizeOf(d.arrayOf(Agent, agentCount));
    if (agentBufferBytes > device.limits.maxBufferSize) {
        throw new Error(
            `Slime Mold agents require ${agentBufferBytes} bytes, exceeding maxBufferSize ${device.limits.maxBufferSize}.`,
        );
    }
    if (agentBufferBytes > device.limits.maxStorageBufferBindingSize) {
        throw new Error(
            `Slime Mold agents require ${agentBufferBytes} bytes, exceeding maxStorageBufferBindingSize ${device.limits.maxStorageBufferBindingSize}.`,
        );
    }
    if (
        Math.ceil(agentCount / AGENT_WORKGROUP_SIZE)
        > device.limits.maxComputeWorkgroupsPerDimension
    ) {
        throw new Error('Slime Mold agent dispatch exceeds maxComputeWorkgroupsPerDimension.');
    }
}

function validateTextureSize(device: GPUDevice, width: number, height: number): void {
    const limit = device.limits.maxTextureDimension2D;
    if (width > limit || height > limit) {
        throw new Error(
            `Slime Mold simulation size ${width}x${height} exceeds maxTextureDimension2D ${limit}.`,
        );
    }
}

function validateColorTarget(
    graph: FrameGraphRecording,
    color: TextureHandle,
    outputFormat: GPUTextureFormat,
): void {
    const desc = graph.getTextureDesc(color);
    if (desc.format !== outputFormat) {
        throw new Error(
            `TypeGpuSlimeMold color format must be ${outputFormat}, received ${desc.format}.`,
        );
    }
    if ((desc.sampleCount ?? 1) !== 1) {
        throw new Error('TypeGpuSlimeMold color target must be single-sampled.');
    }
}

function validatePositiveInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Slime Mold ${label} must be a positive safe integer.`);
    }
    return value;
}

function validatePositiveFinite(value: number, label: string): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Slime Mold ${label} must be a positive finite value.`);
    }
    return value;
}

function validateFiniteInRange(value: number, min: number, max: number, label: string): number {
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`Slime Mold ${label} must be a finite value in [${min}, ${max}].`);
    }
    return value;
}

function oppositeTrail(index: TrailIndex): TrailIndex {
    return index === 0 ? 1 : 0;
}
