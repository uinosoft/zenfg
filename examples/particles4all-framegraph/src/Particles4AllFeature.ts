import {
    BufferAccess,
    type BufferHandle,
    type FrameGraphRecording,
    type ResourceUse,
    TextureAccess,
    type TextureHandle,
    type TextureUse,
} from '@zenfg/webgpu';
import { createPresetSettings, getPresetScene, validateParticles4AllSettings, validateSceneOverrides } from './settings.ts';
import type {
    Particles4AllDisplayMode,
    Particles4AllOptions,
    PendingParticles4AllFrame,
    Particles4AllFrameGraphOptions,
    Particles4AllPreset,
    Particles4AllSceneOverrides,
    Particles4AllSettings,
    Particles4AllStats,
} from './particles4allTypes.ts';

// The upstream implementation is intentionally kept as JavaScript so its mature WGSL and
// numerical code remain reviewable against the pinned source snapshot.
// @ts-expect-error The vendored upstream module is JavaScript by design.
import { Sim } from './upstream/sim.js';
// @ts-expect-error The vendored upstream module is JavaScript by design.
import { Camera, Renderer, screenRay } from './upstream/render.js';
// @ts-expect-error The vendored upstream module is JavaScript by design.
import { SurfaceMesh } from './upstream/mesh.js';
// @ts-expect-error The vendored upstream module is JavaScript by design.
import { Solids, halfExtent } from './upstream/solids.js';
// @ts-expect-error The vendored upstream module is JavaScript by design.
import { RayMarch } from './upstream/ray.js';
// @ts-expect-error The vendored upstream module is JavaScript by design.
import { FluidSSFR } from './upstream/ssfr.js';
// @ts-expect-error The vendored upstream module is JavaScript by design.
import { Environment } from './upstream/env.js';
// @ts-expect-error The vendored upstream module is JavaScript by design.
import { defaultParams, buildScene } from './upstream/scene.js';

const DISPLAY_INDEX: Record<Particles4AllDisplayMode, number> = {
    particles: 0,
    'surface-mesh': 1,
    'ray-march': 2,
    ssfr: 3,
};
const POUR_SLACK = 1.25;

const INTERNAL_SIM_INPUTS = new Set(['bpos', 'bpsi', 'bcellStart', 'bodyInfo']);
type RenderOptions = Particles4AllFrameGraphOptions & { readonly depth?: TextureHandle };

type NativeObjects = {
    sim: any;
    renderer: any;
    camera: any;
    mesh: any;
    solids: any;
    ray: any;
    ssfr: any;
    environment: any;
};

type ImportedResources = {
    readonly buffers: Map<GPUBuffer, BufferHandle>;
    readonly pourUpload?: BufferHandle;
};

type SsfrTransientResources = {
    readonly smoothPosition: BufferHandle;
    readonly anisotropy: BufferHandle;
    readonly eyeZ: readonly [TextureHandle, TextureHandle];
    readonly rawDepth: TextureHandle;
    readonly thickness: TextureHandle;
    readonly thicknessTemporary: TextureHandle;
    readonly solidDistance: TextureHandle;
    readonly depth: TextureHandle;
};

type SurfaceTransientResources = {
    readonly field: BufferHandle;
    readonly fieldTemporary: BufferHandle;
    readonly normalField: BufferHandle;
    readonly vertices: BufferHandle;
    readonly counter: BufferHandle;
    readonly indirect: BufferHandle;
};

type RayTransientResources = {
    readonly eyeZ: TextureHandle;
    readonly normal: TextureHandle;
    readonly depth: TextureHandle;
};

type SimulationTransientResources = {
    readonly predA: BufferHandle;
    readonly predB: BufferHandle;
    readonly lambda: BufferHandle;
    readonly slot: BufferHandle;
    readonly correction: BufferHandle;
    readonly normal: BufferHandle;
    readonly cellCount: BufferHandle;
    readonly blockSum: BufferHandle;
    readonly cursor: BufferHandle;
    readonly bodyAccumulation: BufferHandle;
    readonly bodyCovariance: BufferHandle;
    readonly bodyIndices: BufferHandle;
    readonly bodyIndexCount: BufferHandle;
};

type SimulationFramePlan = {
    readonly substeps: number;
    readonly dt: number;
};

type PourStateCommit = {
    readonly remaining: number;
    readonly pouring: boolean;
    readonly extruded: number;
    readonly nextLayer: number;
    readonly seed: number;
};

type PourUploadBatch = {
    readonly startParticle: number;
    readonly count: number;
    readonly positionOffset: number;
    readonly velocityOffset: number;
    readonly densityOffset: number;
    readonly zeroOffset: number;
};

type PourFrameSchedule = {
    readonly startCount: number;
    readonly finalCount: number;
    readonly activeCounts: readonly number[];
    readonly batches: readonly (PourUploadBatch | null)[];
    readonly uploadBuffer: GPUBuffer | null;
    readonly commit: PourStateCommit;
};

type PendingSimulationState = {
    readonly n: number;
    readonly parity: number;
    readonly predParity: number;
    readonly timeBank: number;
    readonly simTime: number;
    readonly lastSubsteps: number;
    readonly lastAdvanced: number;
    readonly primePending: boolean;
    readonly pendingImpulse: boolean;
    readonly pendingResizeBindGroup: GPUBindGroup | null;
    readonly statsReadbackArmed: boolean;
    readonly poseReadbackArmed: boolean;
};

type RecordedSimulationCommit = {
    readonly n: number;
    readonly parity: number;
    readonly predParity: number;
    readonly timeBank: number;
    readonly lastSubsteps: number;
    readonly lastAdvanced: number;
    readonly simTime: number;
    readonly primePending: boolean;
    readonly pendingImpulse: boolean;
    readonly pendingResizeBindGroup: GPUBindGroup | null;
    readonly statsReadbackArmed: boolean;
    readonly poseReadbackArmed: boolean;
    readonly statsReadbackSlot: number;
    readonly poseReadbackSlot: number;
    readonly statsFrame: number;
    readonly poseFrame: number;
};

type RecordedDiagnosticsCommit = Pick<RecordedSimulationCommit,
    'statsReadbackArmed' | 'poseReadbackArmed' | 'statsReadbackSlot' | 'poseReadbackSlot' | 'statsFrame' | 'poseFrame'>;

type RecordedMeshCommit = {
    readonly frame: number;
    readonly readbackSlot: number | null;
};

/** Native graph workload adapted from the pinned Particles4All solver. */
export class Particles4All {
    private settings: Particles4AllSettings = createPresetSettings('small');
    private readonly outputFormat: GPUTextureFormat;
    private readonly device: GPUDevice;
    private pendingToken: object | null = null;
    private native: NativeObjects | null = null;
    private width = 1;
    private height = 1;
    private baseBoxX = 1;
    private pourRemaining = 0;
    private pouring = false;
    private pourExtruded = 0;
    private pourNextLayer = 0;
    private pourSeed = 22_222;
    private dragOffset: [number, number, number] = [0, 0, 0];
    private sceneOverrides: Particles4AllSceneOverrides | null = null;
    private pointerOrigin: [number, number, number] = [0, 0, 0];
    private pointerDirection: [number, number, number] = [0, 0, -1];
    private pointerImpulse: [number, number, number] = [0, 0, 0];
    private pendingPointerImpulseCommit: [number, number, number] | null = null;
    private isDestroyed = false;
    private framePending = false;
    private pendingFrameRecorded = false;
    private pendingSimulationState: PendingSimulationState | null = null;
    private pendingSimulationCommit: RecordedSimulationCommit | null = null;
    private pendingPourCommit: PourStateCommit | null = null;
    private pendingMeshCommit: RecordedMeshCommit | null = null;
    private pourUploadBuffers: GPUBuffer[] = [];
    private pourUploadCapacity = 0;

    constructor(options: Particles4AllOptions) {
        this.device = options.device;
        this.outputFormat = options.outputFormat;
        const preset = options.initialSettings?.preset ?? 'small';
        this.settings = validateParticles4AllSettings({ ...createPresetSettings(preset), ...options.initialSettings });
        try { this.setup(options); } catch (error) { this.dispose(); throw error; }
    }

    private setup(ctx: Particles4AllOptions): void {
        this.assertNotDestroyed();
        this.width = Math.max(1, ctx.viewport.width);
        this.height = Math.max(1, ctx.viewport.height);
        if (ctx.device.limits.maxStorageBuffersPerShaderStage < 8
            || ctx.device.limits.maxComputeInvocationsPerWorkgroup < 256
            || ctx.device.limits.maxComputeWorkgroupSizeX < 256) {
            throw new Error('Particles4All requires 8 storage buffers per shader stage and 256-thread workgroups.');
        }
        // Install each owner before constructing the next, so partial setup can be disposed.
        const native = {} as NativeObjects;
        this.native = native;
        const sim = native.sim = new Sim(ctx.device);
        const renderer = native.renderer = new Renderer(ctx.device, this.outputFormat);
        native.mesh = new SurfaceMesh(ctx.device, this.outputFormat);
        native.solids = new Solids(ctx.device, this.outputFormat);
        const ray = native.ray = new RayMarch(ctx.device, this.outputFormat);
        const ssfr = native.ssfr = new FluidSSFR(ctx.device, this.outputFormat);
        const environment = native.environment = new Environment(ctx.device);
        native.camera = new Camera();
        ray.env = environment;
        ssfr.env = environment;
        sim.bodyPhases = false;
        this.rebuildScene(this.native, true);
        renderer.resize(this.width, this.height);
    }

    resize(width: number, height: number): void {
        this.assertIdle('resize');
        if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= this.device.limits.maxTextureDimension2D)) {
            throw new Error('Particles4All viewport exceeds maxTextureDimension2D or is not a positive integer.');
        }
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        this.requireNative('resize').renderer.resize(this.width, this.height);
    }

    getSettings(): Particles4AllSettings {
        this.assertNotDestroyed();
        return { ...this.settings, transmission: [...this.settings.transmission] };
    }

    getPresetSettings(preset: Particles4AllPreset): Particles4AllSettings {
        this.assertNotDestroyed();
        return createPresetSettings(preset);
    }

    setSettings(patch: Partial<Particles4AllSettings>): void {
        this.assertIdle('setSettings');
        const presetChanged = patch.preset !== undefined && patch.preset !== this.settings.preset;
        const bodiesChanged = patch.rigidBodiesEnabled !== undefined
            && patch.rigidBodiesEnabled !== this.settings.rigidBodiesEnabled;
        const candidate = validateParticles4AllSettings({
            ...(presetChanged ? createPresetSettings(patch.preset!) : this.settings), ...patch,
        });
        if (presetChanged) {
            this.replaceScene(candidate, null, true);
            return;
        }
        const native = this.native;
        if (native && bodiesChanged) {
            this.replaceScene(candidate, this.sceneOverrides, false);
        } else if (native) {
            this.validateResizePathCapacity(candidate, native.sim.params.box, native.sim.params.spacing, native.sim.cap, this.baseBoxX);
            this.settings = candidate;
            this.applyRuntimeSettings(native);
        }
    }

    applyPreset(preset: Particles4AllPreset): void {
        this.assertIdle('applyPreset');
        this.replaceScene(createPresetSettings(preset), null, true);
    }

    applyImportedSettings(
        settings: Particles4AllSettings,
        sceneOverrides: Particles4AllSceneOverrides,
    ): void {
        this.assertIdle('applyImportedSettings');
        const candidate = validateParticles4AllSettings({
            ...settings,
            transmission: [...settings.transmission],
        });
        this.replaceScene(candidate, validateSceneOverrides(sceneOverrides), true);
    }

    private replaceScene(settings: Particles4AllSettings, overrides: Particles4AllSceneOverrides | null, resetCamera: boolean): void {
        const previousSettings = this.settings;
        const previousOverrides = this.sceneOverrides;
        this.settings = settings;
        this.sceneOverrides = overrides;
        try {
            this.rebuildScene(this.requireNative('replaceScene'), resetCamera);
        } catch (error) {
            this.settings = previousSettings;
            this.sceneOverrides = previousOverrides;
            throw error;
        }
    }

    private rebuildScene(native: NativeObjects, resetCamera: boolean): void {
        const profile = getPresetScene(this.settings.preset);
        const overrides = this.sceneOverrides;
        const params = defaultParams(this.settings.preset);
        params.targetParticleCount = overrides?.targetParticleCount ?? profile.targetParticleCount;
        params.spacing = overrides?.spacing ?? params.spacing;
        const sceneBox = overrides?.box ?? profile.box!;
        params.box = resetCamera || !native.sim.params?.box
            ? sceneBox.slice()
            : native.sim.params.box.slice();
        params.bodies = this.settings.rigidBodiesEnabled
            ? (overrides?.bodies ?? profile.bodies ?? []).slice()
            : [];
        params.bodySize = overrides?.bodySize ?? profile.bodySize;
        params.substeps = this.settings.substeps;
        params.iterations = this.settings.iterations;
        params.cfmEpsilonRel = this.settings.cfm;
        params.omega = this.settings.omega;
        params.sorAverage = this.settings.sorAverage;
        params.xsphC = this.settings.xsph;
        params.sCorrK = this.settings.scorr;
        params.sCorrDq = this.settings.scorrDq;
        params.surfaceTensionK = this.settings.tension;
        params.gravity = this.settings.gravity;
        this.validateGridCapacity(params.box, params.spacing);
        const scene = buildScene(params);
        this.validateSceneCapacity(params, scene);
        this.pointerImpulse = [0, 0, 0];
        this.pendingPointerImpulseCommit = null;
        native.sim.reset(params, scene);
        native.renderer.bindSim(native.sim);
        native.renderer.setBox(params.box);
        native.solids.build(native.sim);
        native.mesh.resetReadbacks();
        if (resetCamera) {
            const camera = overrides?.camera ?? profile.camera!;
            native.camera.az = camera[0];
            native.camera.el = camera[1];
            native.camera.dist = camera[2];
            native.camera.target = camera.length >= 6 ? camera.slice(3) : [0.5, 0.4, 0.3];
        }
        this.baseBoxX = sceneBox[0];
        this.pourRemaining = native.sim.pourBudget;
        this.pouring = false;
        this.pourExtruded = 0;
        this.pourNextLayer = 0;
        this.applyRuntimeSettings(native);
    }

    reset(): void {
        this.assertIdle('reset');
        this.rebuildScene(this.requireNative('reset'), false);
    }

    togglePour(): void {
        this.assertIdle('togglePour');
        if (this.pourRemaining <= 0) return;
        this.pouring = !this.pouring;
    }

    stopPour(): void {
        this.assertIdle('stopPour');
        this.pouring = false;
    }

    async loadEnvironment(source: string | Blob): Promise<void> {
        this.assertIdle('loadEnvironment');
        const native = this.requireNative('loadEnvironment');
        await native.environment.load(source);
    }

    clearEnvironment(): void {
        this.assertIdle('clearEnvironment');
        this.requireNative('clearEnvironment').environment.clear();
    }

    orbit(deltaX: number, deltaY: number): void {
        this.assertIdle('orbit');
        const camera = this.requireNative('orbit').camera;
        camera.orbit(
            -deltaX * 0.008 * this.settings.cameraSpeed,
            deltaY * 0.008 * this.settings.cameraSpeed,
        );
    }

    pan(deltaX: number, deltaY: number): void {
        this.assertIdle('pan');
        this.requireNative('pan').camera.pan(
            deltaX * 0.0012 * this.settings.cameraSpeed,
            deltaY * 0.0012 * this.settings.cameraSpeed,
        );
    }

    zoom(deltaY: number): void {
        this.assertIdle('zoom');
        this.requireNative('zoom').camera.zoom(deltaY > 0 ? 1.1 : 0.9);
    }

    resetCamera(): void {
        this.assertIdle('resetCamera');
        const native = this.requireNative('resetCamera');
        native.camera.frame(native.sim.params.box);
    }

    applyPointerImpulse(fromU: number, fromV: number, toU: number, toV: number): void {
        if (!this.settings.forceEnabled || this.settings.paused) return;
        const native = this.requireNative('applyPointerImpulse');
        const aspect = this.width / Math.max(1, this.height);
        const a = screenRay(native.camera, fromU, fromV, aspect);
        const b = screenRay(native.camera, toU, toV, aspect);
        this.pointerOrigin = [b.origin[0], b.origin[1], b.origin[2]];
        this.pointerDirection = [b.dir[0], b.dir[1], b.dir[2]];
        this.pointerImpulse = [
            this.pointerImpulse[0] + this.settings.forceStrength * (b.dir[0] - a.dir[0]),
            this.pointerImpulse[1] + this.settings.forceStrength * (b.dir[1] - a.dir[1]),
            this.pointerImpulse[2] + this.settings.forceStrength * (b.dir[2] - a.dir[2]),
        ];
    }

    beginBodyDrag(u: number, v: number): boolean {
        this.assertIdle('beginBodyDrag');
        if (!this.settings.grabEnabled) return false;
        const native = this.requireNative('beginBodyDrag');
        const ray = screenRay(native.camera, u, v, this.width / Math.max(1, this.height));
        const hit = pickBody(native.sim, ray.origin, ray.dir);
        if (hit.body < 1) return false;
        native.sim.__dragBody = hit.body;
        native.sim.__dragDepth = hit.t;
        const centre = native.sim.bodyPose[hit.body - 1].centre;
        this.dragOffset = [
            ray.origin[0] + ray.dir[0] * hit.t - centre[0],
            ray.origin[1] + ray.dir[1] * hit.t - centre[1],
            ray.origin[2] + ray.dir[2] * hit.t - centre[2],
        ];
        this.updateBodyDrag(u, v);
        return true;
    }

    updateBodyDrag(u: number, v: number): void {
        this.assertIdle('updateBodyDrag');
        const native = this.requireNative('updateBodyDrag');
        const body = native.sim.__dragBody ?? -1;
        if (body < 1 || this.settings.paused) return;
        const ray = screenRay(native.camera, u, v, this.width / Math.max(1, this.height));
        const depth = native.sim.__dragDepth ?? 1;
        const desired = ray.origin.map((value: number, index: number) => (
            value + ray.dir[index] * depth - this.dragOffset[index]
        ));
        const target = clampBodyTarget(
            desired,
            native.sim.bodies[body - 1],
            native.sim.bodyPose[body - 1],
            native.sim.params.box,
        );
        native.sim.holdBody(body, target, this.settings.grabStrength, this.settings.forceLimit);
    }

    endBodyDrag(): void {
        const native = this.native;
        if (!native) return;
        this.assertIdle('endBodyDrag');
        native.sim.__dragBody = -1;
        this.dragOffset = [0, 0, 0];
        native.sim.releaseBody();
    }

    getStats(): Particles4AllStats {
        const native = this.requireNative('getStats');
        const sim = native.sim;
        return {
            preset: this.settings.preset,
            displayMode: this.settings.displayMode,
            particleCount: sim.n ?? 0,
            fluidParticleCount: sim.n - (sim.scene?.nBody ?? 0),
            rigidParticleCount: sim.scene?.nBody ?? 0,
            boundaryParticleCount: sim.nBoundary ?? 0,
            bodyCount: sim.nBodies ?? 0,
            lastSubsteps: sim.lastSubsteps ?? 0,
            averageDensity: sim.stats?.avgRho ?? 0,
            maximumDensity: sim.stats?.maxRho ?? 0,
            maximumSpeed: sim.stats?.maxSpeed ?? 0,
            kineticEnergy: sim.stats?.ke ?? 0,
            meshTriangles: native.mesh.lastTriangles ?? 0,
            pourRemaining: this.pourRemaining,
        };
    }

    recordFrameGraph(graph: FrameGraphRecording, frameOptions: Particles4AllFrameGraphOptions): PendingParticles4AllFrame {
        this.assertIdle('recordFrameGraph');
        const options: RenderOptions = frameOptions;
        const native = this.requireNative('recordFrameGraph');
        validateTargets(graph, options.color, this.outputFormat, this.width, this.height);
        if (!Number.isFinite(options.deltaTime) || options.deltaTime < 0) throw new Error('Particles4All deltaTime must be finite and non-negative.');
        const token = {};
        this.pendingToken = token;
        this.framePending = true;
        this.pendingSimulationState = captureSimulationState(native.sim);
        try {
            this.applyRuntimeSettings(native);
            this.updateBox(native, Math.min(0.05, options.deltaTime));
            // Resizing schedules work for the next submission. Keep that work pending on discard.
            this.pendingSimulationState = captureSimulationState(native.sim);
            this.pendingPointerImpulseCommit = this.flushPointerImpulse(native);
            const framePlan: SimulationFramePlan = this.settings.paused
                ? { substeps: 0, dt: (1 / 60) / Math.max(1, native.sim.params.substeps) }
                : native.sim.planFrame(Math.min(0.05, options.deltaTime) * this.settings.timeScale);
            const pourSchedule = this.preparePourSchedule(native.sim, framePlan);
            this.pendingPourCommit = pourSchedule.commit;
            const frameUniforms = native.sim.prepareFrameUniforms(framePlan.dt, pourSchedule.activeCounts);
            const nativeRenderOptions = this.createNativeRenderOptions(native);
            const renderFrame = native.renderer.prepare(
                native.sim, native.camera, nativeRenderOptions, pourSchedule.finalCount,
            );
            renderFrame.parity = native.sim.parity
                ^ (native.sim.primePending ? 1 : 0)
                ^ (framePlan.substeps & 1);
            if (renderFrame.meshOn) native.mesh.prepareSurfaceFrame(native.sim, nativeRenderOptions.meshIso);
            let ssfrFrame: any = null;
            let rayFrame: any = null;
            if (renderFrame.ssfrOn) {
                native.mesh.anisoLimitToField = false;
                const originalParity = native.sim.parity;
                native.sim.parity = originalParity ^ (framePlan.substeps & 1);
                try {
                    const anisoCount = native.mesh.prepareAnisotropy(native.sim, pourSchedule.finalCount);
                    ssfrFrame = native.ssfr.prepareFrame(
                        native.sim,
                        native.mesh,
                        native.solids,
                        renderFrame.viewM,
                        renderFrame.proj,
                        renderFrame.invViewProj,
                        renderFrame.invView,
                        renderFrame.eye,
                        this.width,
                        this.height,
                        native.sim.params.spacing,
                        native.sim.h,
                        pourSchedule.finalCount,
                    );
                    ssfrFrame.anisoCount = anisoCount;
                    ssfrFrame.parity = renderFrame.parity;
                } finally {
                    native.sim.parity = originalParity;
                }
            } else {
                native.mesh.anisoLimitToField = true;
            }
            if (renderFrame.rayOn) {
                const useSurface = nativeRenderOptions.raySurface === 1;
                if (useSurface) {
                    native.mesh.resizeSurface(this.width, this.height);
                }
                rayFrame = native.ray.prepareFrame(
                    native.mesh,
                    native.sim,
                    native.camera,
                    renderFrame.viewM,
                    renderFrame.proj,
                    renderFrame.invViewProj,
                    renderFrame.invView,
                    native.solids.count || 0,
                    nativeRenderOptions.meshIso,
                    useSurface,
                    native.solids.gen || 0,
                );
            }
            graph.withDebugGroup('Particles4All', () => {
                const imported = this.importResources(graph, native);
                const simulation = graph.withDebugGroup('Simulation', () => {
                    const resources = this.createSimulationTransientResources(graph, native.sim);
                    const simulationImports = { ...imported, pourUpload: pourSchedule.uploadBuffer
                        ? this.importBuffer(graph, imported, pourSchedule.uploadBuffer, 'particles4all.pour-upload')
                        : undefined };
                    return this.recordSimulation(
                        graph, native, simulationImports, resources, framePlan, pourSchedule, frameUniforms,
                    );
                });
                const readbacks = graph.withDebugGroup('Diagnostics', () => this.recordDiagnostics(
                    graph, native, imported, simulation.parity, pourSchedule.finalCount,
                    frameUniforms[framePlan.substeps] ?? frameUniforms[0] ?? native.sim.uni,
                ));
                this.pendingSimulationCommit = { ...simulation, ...readbacks };
                graph.withDebugGroup('Render', () => {
                    const depth = this.settings.displayMode === 'particles' || this.settings.displayMode === 'surface-mesh'
                        ? graph.createTexture({ label: 'particles4all.render.depth', format: 'depth24plus',
                            size: [this.width, this.height] }) : undefined;
                    const surfaceResources = renderFrame.meshOn ? this.createSurfaceTransientResources(graph, native.mesh) : null;
                    const ssfrResources = renderFrame.ssfrOn ? this.createSsfrTransientResources(graph, native.ssfr, pourSchedule.finalCount) : null;
                    const rayResources = renderFrame.rayOn && nativeRenderOptions.raySurface === 1
                        ? this.createRayTransientResources(graph) : null;
                    const solidPacked = native.solids.count > 0
                        ? graph.createBuffer({ label: 'particles4all.solids.packed', size: native.solids.count * 6 * 16 }) : null;
                    if (renderFrame.meshOn && (!renderFrame.rayOn || nativeRenderOptions.raySurface === 1)) {
                        const slot = native.mesh.frame % native.mesh.triRing.length;
                        if (native.mesh.triState[slot] === 0) this.importBuffer(
                            graph, imported, native.mesh.triRing[slot], 'particles4all.triangle-readback.' + slot,
                        );
                    }
                    this.recordRender(graph, native, imported, { ...options, depth }, nativeRenderOptions,
                        renderFrame, ssfrFrame, ssfrResources, solidPacked, rayFrame, rayResources, surfaceResources);
                });
            });
            this.pendingFrameRecorded = true;
            // planFrame computes against temporary CPU timing state; publish it only on commit.
            native.sim.timeBank = this.pendingSimulationState.timeBank;
            native.sim.lastSubsteps = this.pendingSimulationState.lastSubsteps;
            native.sim.lastAdvanced = this.pendingSimulationState.lastAdvanced;
            return {
                transientResourceKey: this.transientResourceKey(native, pourSchedule.finalCount),
                commit: () => { if (this.pendingToken === token) this.afterSubmit(); },
                discard: () => { if (this.pendingToken === token) this.afterFrameDiscard(); },
            };
        } catch (error) {
            this.afterFrameDiscard();
            throw error;
        }
    }

    private afterSubmit(): void {
        if (!this.framePending) return;
        if (!this.pendingFrameRecorded) {
            throw new Error('Particles4AllFeature.afterFrameDiscard() is required after a recording failure.');
        }
        this.pendingToken = null;
        const native = this.requireNative('afterSubmit');
        const commit = this.pendingSimulationCommit;
        if (!commit) throw new Error('Particles4All simulation commit was not recorded.');
        Object.assign(native.sim, commit);
        if (this.pendingPourCommit) this.commitPourState(this.pendingPourCommit);
        this.pendingPourCommit = null;
        this.commitPointerImpulse(this.pendingPointerImpulseCommit);
        this.pendingPointerImpulseCommit = null;
        native.sim.afterSubmit();
        if (this.pendingMeshCommit) {
            native.mesh.frame = this.pendingMeshCommit.frame;
            if (this.pendingMeshCommit.readbackSlot !== null) {
                native.mesh.triState[this.pendingMeshCommit.readbackSlot] = 1;
            }
        }
        native.mesh.pollTriangles();
        this.framePending = false;
        this.pendingFrameRecorded = false;
        this.pendingSimulationState = null;
        this.pendingSimulationCommit = null;
        this.pendingPourCommit = null;
        this.pendingMeshCommit = null;
    }

    private afterFrameDiscard(): void {
        this.pendingToken = null;
        if (this.native && this.pendingSimulationState) {
            restoreSimulationState(this.native.sim, this.pendingSimulationState);
        }
        this.framePending = false;
        this.pendingFrameRecorded = false;
        this.pendingSimulationState = null;
        this.pendingSimulationCommit = null;
        this.pendingPourCommit = null;
        this.pendingPointerImpulseCommit = null;
        this.pendingMeshCommit = null;
    }

    dispose(): void {
        if (this.isDestroyed) return;
        this.afterFrameDiscard();
        this.isDestroyed = true;
        const native = this.native;
        this.native = null;
        for (const buffer of this.pourUploadBuffers) buffer.destroy();
        this.pourUploadBuffers = [];
        this.pourUploadCapacity = 0;
        if (!native) return;
        native.environment?.destroy();
        native.sim?.destroy();
        native.mesh?.destroy();
        // The supplied device belongs to the host, even though native modules reference it.
        const seen = new Set<object>([this.device]);
        for (const buffer of Object.values(native.sim?.buf ?? {}) as GPUBuffer[]) {
            if (!seen.has(buffer)) {
                seen.add(buffer);
                buffer.destroy();
            }
        }
        for (const owner of Object.values(native)) destroyGpuMembers(owner, seen);
    }

    private flushPointerImpulse(native: NativeObjects): [number, number, number] | null {
        const impulse: [number, number, number] = [
            this.pointerImpulse[0],
            this.pointerImpulse[1],
            this.pointerImpulse[2],
        ];
        if (Math.hypot(...impulse) <= Number.EPSILON) return null;
        native.sim.applyRayImpulse(
            this.pointerOrigin,
            this.pointerDirection,
            impulse,
            this.settings.forceRadius,
            this.settings.forceLimit,
        );
        return impulse;
    }

    private commitPointerImpulse(committed: [number, number, number] | null): void {
        if (!committed) return;
        for (let index = 0; index < 3; index++) {
            const remaining = this.pointerImpulse[index] - committed[index];
            this.pointerImpulse[index] = Math.abs(remaining) < 1e-12 ? 0 : remaining;
        }
    }

    private recordSimulation(
        graph: FrameGraphRecording,
        native: NativeObjects,
        imported: ImportedResources,
        transient: SimulationTransientResources,
        framePlan: SimulationFramePlan,
        pourSchedule: PourFrameSchedule = createIdlePourSchedule(native.sim.n, framePlan.substeps),
        frameUniforms: readonly GPUBuffer[] = Array.from(
            { length: framePlan.substeps + 1 }, () => native.sim.uni,
        ),
    ): Omit<RecordedSimulationCommit, keyof RecordedDiagnosticsCommit> {
        const sim = native.sim;
        let activeParticleCount = pourSchedule.startCount;
        const handles: Record<string, BufferHandle> = {
            predA: transient.predA,
            predB: transient.predB,
            lambda: transient.lambda,
            slot: transient.slot,
            corr: transient.correction,
            normal: transient.normal,
            cellCount: transient.cellCount,
            blockSum: transient.blockSum,
            cursor: transient.cursor,
            bodyAccum: transient.bodyAccumulation,
            bodyCov: transient.bodyCovariance,
            bodyIdx: transient.bodyIndices,
            bodyIdxCount: transient.bodyIndexCount,
        };
        for (const [name, buffer] of Object.entries(sim.buf) as Array<[string, GPUBuffer]>) {
            const importedHandle = imported.buffers.get(buffer);
            if (importedHandle) handles[name] = importedHandle;
        }
        const handle = (name: string): BufferHandle => {
            const resource = handles[name];
            if (!resource) throw new Error(`Particles4All simulation buffer ${name} is not graph-visible.`);
            return resource;
        };
        const sizeOf = (name: string): number => {
            if (/^(pos|vel|pred|body|rest|corr|normal)[AB]?$/.test(name)) {
                return Math.max(16, activeParticleCount * 16);
            }
            if (name === 'density' || name === 'lambda' || name === 'slot') {
                return Math.max(4, activeParticleCount * 4);
            }
            if (name === 'cellCount' || name === 'cursor') return Math.max(16, (sim.nCells + 1) * 4);
            if (name === 'cellStart' || name === 'bcellStart') return Math.max(16, (sim.nCells + 2) * 4);
            if (name === 'blockSum') return Math.max(16, (Math.ceil(sim.nCells / 256) + 2) * 4);
            if (name === 'bodyAccum') return Math.max(16, sim.nBodies * 16);
            if (name === 'bodyCov') return Math.max(16, sim.nBodies * 36);
            if (name === 'bodyIdx') return sim.nBodyParts * 4;
            if (name === 'bodyIdxCount') return 4;
            if (name === 'statsOut') return 32;
            return Math.max(16, (sim.buf[name] as GPUBuffer | undefined)?.size ?? 16);
        };
        type WriteSpec = readonly [name: string, contents: 'overwrite' | 'preserve'];
        const recordCompute = (
            label: string,
            reads: readonly string[],
            writes: readonly WriteSpec[],
            _uniforms: readonly GPUBuffer[],
            encode: (pass: GPUComputePassEncoder, buffers: Record<string, GPUBuffer>) => void,
        ): void => {
            const uses: ResourceUse[] = [];
            const physicalUses = new Map<string, ResourceUse>();
            for (const name of reads) {
                if (INTERNAL_SIM_INPUTS.has(name)) continue;
                const use = graph.use(handle(name), BufferAccess.StorageRead, {
                    range: { offset: 0, size: sizeOf(name) },
                });
                uses.push(use);
                physicalUses.set(name, use);
            }
            for (const [name, contents] of writes) {
                const use = graph.use(handle(name), BufferAccess.StorageWrite, {
                    range: { offset: 0, size: sizeOf(name) }, contents,
                });
                uses.push(use);
                physicalUses.set(name, use);
            }
            graph.compute({
                label,
                sideEffect: false,
                uses,
                encode: ({ pass, unwrap }) => {
                    const buffers: Record<string, GPUBuffer> = Object.fromEntries(
                        [...INTERNAL_SIM_INPUTS].map((name) => [name, sim.buf[name]]),
                    );
                    for (const [name, use] of physicalUses) buffers[name] = unwrap(use) as GPUBuffer;
                    encode(pass, buffers);
                },
            });
        };
        let uni = [frameUniforms[0] ?? sim.uni] as GPUBuffer[];
        const initialUniform = uni[0]!;
        const initialActiveCount = activeParticleCount;
        const suffix = (value: number): 'A' | 'B' => value === 0 ? 'A' : 'B';
        let parity = sim.parity as number;
        let predParity = sim.predParity as number;

        if (sim.primePending || sim.pendingResizeBindGroup || sim.pendingImpulse) {
            graph.withDebugGroup('Initialization', () => {
                if (sim.primePending) {
                    graph.withDebugGroup('Grid Prime', () => {
                        const primeSourceParity = parity;
                        const sourceSuffix = suffix(primeSourceParity);
                        graph.copy({
                            label: 'particles4all.initialization.prediction-prime',
                            operations: [{
                                type: 'buffer-to-buffer', source: handle(`pos${sourceSuffix}`),
                                destination: handle(`pred${sourceSuffix}`), size: initialActiveCount * 16,
                            }],
                        });
                        graph.clearBuffer({
                            label: 'particles4all.initialization.grid-clear',
                            operations: [
                                { target: handle('cellCount') },
                                { target: handle('blockSum') },
                                { target: handle('cursor') },
                            ],
                        });
                        recordCompute('particles4all.initialization.grid-count',
                            [`pred${sourceSuffix}`], [['cellCount', 'preserve']], uni,
                            (pass, buffers) => sim.encodeGridCount(
                                pass, primeSourceParity, buffers, initialActiveCount, initialUniform,
                            ));
                        recordCompute('particles4all.initialization.grid-prefix-scan',
                            ['cellCount', 'blockSum', 'cellStart'],
                            [['blockSum', 'preserve'], ['cellStart', 'preserve']], uni,
                            (pass, buffers) => sim.encodeGridScan(pass, buffers, initialUniform));
                        const outputSuffix = suffix(primeSourceParity ^ 1);
                        recordCompute('particles4all.initialization.grid-scatter', [
                            `pred${sourceSuffix}`, 'cellStart',
                            `pos${sourceSuffix}`, `vel${sourceSuffix}`,
                            `body${sourceSuffix}`, `rest${sourceSuffix}`,
                        ], [
                            ['cursor', 'preserve'], ['slot', 'overwrite'],
                            [`pos${outputSuffix}`, 'overwrite'], [`vel${outputSuffix}`, 'overwrite'],
                            [`pred${outputSuffix}`, 'overwrite'], [`body${outputSuffix}`, 'overwrite'],
                            [`rest${outputSuffix}`, 'overwrite'],
                        ], uni, (pass, buffers) => sim.encodeGridScatter(
                            pass, primeSourceParity, buffers, initialActiveCount, initialUniform,
                        ));
                        parity ^= 1;
                        predParity = parity;
                    });
                }
                if (sim.pendingResizeBindGroup) {
                    const livePosition = `pos${suffix(parity)}`;
                    graph.withDebugGroup('Resize', () => recordCompute(
                        'particles4all.initialization.resize', [livePosition],
                        [[livePosition, 'preserve']], [sim.resizeUni],
                        (pass, buffers) => sim.encodeResize(pass, initialActiveCount, buffers[livePosition]),
                    ));
                }
                if (sim.pendingImpulse) {
                    const impulseParity = parity;
                    const liveSuffix = suffix(impulseParity);
                    graph.withDebugGroup('Pointer Impulse', () => recordCompute(
                        'particles4all.initialization.pointer-impulse',
                        [`pos${liveSuffix}`, `vel${liveSuffix}`],
                        [[`vel${liveSuffix}`, 'preserve']], [sim.rayUni],
                        (pass, buffers) => sim.encodeImpulse(pass, impulseParity, buffers, initialActiveCount),
                    ));
                }
            });
        }

        // Body indices are transient, while dragging runs before the first substep's
        // grid sort and rigid preparation. Build the current parity's compact list
        // explicitly instead of reading the previous frame's transient allocation.
        if (sim.heldBody >= 1 && sim.nBodyParts > 0 && framePlan.substeps > 0) {
            const dragBodySuffix = suffix(parity);
            graph.withDebugGroup('Body Drag Index', () => {
                graph.clearBuffer({
                    label: 'particles4all.initialization.drag-index-clear',
                    operations: [{ target: handle('bodyIdxCount'), offset: 0, size: 4 }],
                });
                recordCompute('particles4all.initialization.drag-index',
                    [`body${dragBodySuffix}`], [['bodyIdx', 'overwrite'], ['bodyIdxCount', 'preserve']], uni,
                    (pass, buffers) => {
                        pass.setPipeline(sim.pipe.bodyCompact);
                        pass.setBindGroup(0, sim.bg('bodyCompact', [
                            buffers[`body${dragBodySuffix}`], buffers.bodyIdx, buffers.bodyIdxCount,
                        ], initialUniform));
                        pass.dispatchWorkgroups(Math.max(1, Math.ceil(initialActiveCount / 256)));
                    });
            });
        }

        for (let substep = 0; substep < framePlan.substeps; substep++) {
            const substepActiveCount = pourSchedule.activeCounts[substep] ?? activeParticleCount;
            activeParticleCount = substepActiveCount;
            const substepUniform = frameUniforms[substep] ?? initialUniform;
            uni = [substepUniform];
            graph.withDebugGroup(`Substep ${substep + 1}`, () => {
                const predictParity = parity;
                const predictSuffix = suffix(predictParity);
                const predictReads = [`pos${predictSuffix}`, `vel${predictSuffix}`];
                const predictWrites: WriteSpec[] = [[`pred${predictSuffix}`, 'overwrite']];
                const predictUniforms = [substepUniform] as GPUBuffer[];
                if (sim.heldBody >= 1 && sim.nBodyParts > 0) {
                    predictReads.push(`body${predictSuffix}`, 'bodyIdx', 'bodyCentre');
                    predictWrites.push([`vel${predictSuffix}`, 'preserve']);
                    predictUniforms.push(sim.dragUni);
                }
                recordCompute(`particles4all.substep-${substep + 1}.predict`,
                    predictReads, predictWrites, predictUniforms,
                    (pass, buffers) => sim.encodePredict(
                        pass, predictParity, buffers, substepActiveCount, substepUniform,
                    ));
                graph.withDebugGroup('Grid', () => {
                    graph.clearBuffer({
                        label: `particles4all.substep-${substep + 1}.grid-clear`,
                        operations: [
                            { target: handle('cellCount') },
                            { target: handle('blockSum') },
                            { target: handle('cursor') },
                        ],
                    });
                    recordCompute(`particles4all.substep-${substep + 1}.grid-count`,
                        [`pred${predictSuffix}`], [['cellCount', 'preserve']], uni,
                        (pass, buffers) => sim.encodeGridCount(
                            pass, predictParity, buffers, substepActiveCount, substepUniform,
                        ));
                    recordCompute(`particles4all.substep-${substep + 1}.grid-prefix-scan`,
                        ['cellCount', 'blockSum', 'cellStart'],
                        [['blockSum', 'preserve'], ['cellStart', 'preserve']], uni,
                        (pass, buffers) => sim.encodeGridScan(pass, buffers, substepUniform));
                    const outputSuffix = suffix(predictParity ^ 1);
                    recordCompute(`particles4all.substep-${substep + 1}.grid-scatter`, [
                        `pred${predictSuffix}`, 'cellStart',
                        `pos${predictSuffix}`, `vel${predictSuffix}`,
                        `body${predictSuffix}`, `rest${predictSuffix}`,
                    ], [
                        ['cursor', 'preserve'], ['slot', 'overwrite'],
                        [`pos${outputSuffix}`, 'overwrite'], [`vel${outputSuffix}`, 'overwrite'],
                        [`pred${outputSuffix}`, 'overwrite'], [`body${outputSuffix}`, 'overwrite'],
                        [`rest${outputSuffix}`, 'overwrite'],
                    ], uni, (pass, buffers) => sim.encodeGridScatter(
                        pass, predictParity, buffers, substepActiveCount, substepUniform,
                    ));
                });
                parity ^= 1;
                predParity = parity;
                if (sim.nBodyParts > 0) {
                    const rigidParity = parity;
                    const rigidPredParity = predParity;
                    const rigidSuffix = suffix(rigidParity);
                    const rigidPredSuffix = suffix(rigidPredParity);
                    recordCompute(`particles4all.substep-${substep + 1}.rigid-preparation`, [
                        `body${rigidSuffix}`, `pred${rigidPredSuffix}`, 'bodyRef', 'bodyCentre',
                    ], [
                        ['bodyAccum', 'overwrite'], ['bodyCov', 'overwrite'],
                        ['bodyIdxCount', 'overwrite'], ['bodyIdx', 'overwrite'],
                        ['bodyCentre', 'preserve'], ['bodyRef', 'preserve'],
                    ], uni, (pass, buffers) => sim.encodeRigidPreparation(
                        pass, rigidParity, rigidPredParity, buffers, substepActiveCount, substepUniform,
                    ));
                }
                graph.withDebugGroup('Constraints', () => {
                    for (let iteration = 0; iteration < this.settings.iterations; iteration++) {
                        graph.withDebugGroup(`Iteration ${iteration + 1}`, () => {
                            const iterationParity = parity;
                            const lambdaPredParity = predParity;
                            const lambdaSuffix = suffix(lambdaPredParity);
                            recordCompute(
                                `particles4all.substep-${substep + 1}.iteration-${iteration + 1}.lambda`,
                                [`pred${lambdaSuffix}`, 'cellStart', 'bpos', 'bpsi', 'bcellStart'],
                                [['lambda', 'overwrite'], ['density', 'overwrite']], uni,
                                (pass, buffers) => sim.encodeLambda(
                                    pass, iterationParity, lambdaPredParity, buffers,
                                    substepActiveCount, substepUniform,
                                ),
                            );
                            const deltaOutputSuffix = suffix(lambdaPredParity ^ 1);
                            recordCompute(
                                `particles4all.substep-${substep + 1}.iteration-${iteration + 1}.delta`,
                                [`pred${lambdaSuffix}`, 'lambda', 'cellStart', 'bpos', 'bpsi', 'bcellStart'],
                                [[`pred${deltaOutputSuffix}`, 'overwrite']], uni,
                                (pass, buffers) => sim.encodeDelta(
                                    pass, iterationParity, lambdaPredParity, buffers,
                                    substepActiveCount, substepUniform,
                                ),
                            );
                            predParity ^= 1;
                            if (sim.nBodyParts > 0) {
                                const projectionPredParity = predParity;
                                const projectionSuffix = suffix(projectionPredParity);
                                const bodySuffix = suffix(iterationParity);
                                recordCompute(
                                    `particles4all.substep-${substep + 1}.iteration-${iteration + 1}.rigid-projection`,
                                    [
                                        `pred${projectionSuffix}`, `body${bodySuffix}`, `rest${bodySuffix}`,
                                        'bodyIdx', 'bodyRef', 'bodyInfo', 'bodyCentre', 'bodyRot',
                                    ], [
                                        ['bodyAccum', 'overwrite'], ['bodyCov', 'overwrite'],
                                        ['bodyIdxCount', 'overwrite'], ['bodyCentre', 'preserve'],
                                        ['bodyRef', 'preserve'], ['bodyRot', 'preserve'], [`pred${projectionSuffix}`, 'preserve'],
                                    ], uni, (pass, buffers) => sim.encodeRigidProjection(
                                        pass, iterationParity, projectionPredParity, buffers,
                                        substepActiveCount, substepUniform,
                                    ),
                                );
                            }
                        });
                    }
                });
                graph.withDebugGroup('Finalize', () => {
                    if (predParity !== parity) {
                        const source = handle(predParity === 0 ? 'predA' : 'predB');
                        const destination = handle(parity === 0 ? 'predA' : 'predB');
                        graph.copy({
                            label: `particles4all.substep-${substep + 1}.prediction-sync`,
                            operations: [{
                                type: 'buffer-to-buffer', source, destination, size: substepActiveCount * 16,
                            }],
                        });
                        predParity = parity;
                    }
                    const finalParity = parity;
                    const finalSuffix = suffix(finalParity);
                    recordCompute(`particles4all.substep-${substep + 1}.velocity`,
                        [`pos${finalSuffix}`, `vel${finalSuffix}`, `pred${finalSuffix}`],
                        [[`vel${finalSuffix}`, 'preserve']], uni,
                        (pass, buffers) => sim.encodeVelocity(
                            pass, finalParity, buffers, substepActiveCount, substepUniform,
                        ));
                    recordCompute(`particles4all.substep-${substep + 1}.xsph`,
                        [`pred${finalSuffix}`, `vel${finalSuffix}`, 'density', 'cellStart'],
                        [['corr', 'overwrite']], uni,
                        (pass, buffers) => sim.encodeXsph(
                            pass, finalParity, buffers, substepActiveCount, substepUniform,
                        ));
                    if (sim.params.surfaceTensionK > 0) {
                        graph.withDebugGroup('Surface Tension', () => {
                            recordCompute(`particles4all.substep-${substep + 1}.normals`,
                                [`pred${finalSuffix}`, 'density', 'cellStart'],
                                [['normal', 'overwrite']], uni,
                                (pass, buffers) => sim.encodeNormals(
                                    pass, finalParity, buffers, substepActiveCount, substepUniform,
                                ));
                            recordCompute(`particles4all.substep-${substep + 1}.tension`,
                                [`pred${finalSuffix}`, 'density', 'normal', 'corr', 'cellStart'],
                                [['corr', 'preserve']], uni,
                                (pass, buffers) => sim.encodeTension(
                                    pass, finalParity, buffers, substepActiveCount, substepUniform,
                                ));
                        });
                    }
                    recordCompute(`particles4all.substep-${substep + 1}.commit`,
                        [`pos${finalSuffix}`, `vel${finalSuffix}`, `pred${finalSuffix}`, 'corr'],
                        [[`pos${finalSuffix}`, 'preserve'], [`vel${finalSuffix}`, 'preserve']], uni,
                        (pass, buffers) => sim.encodeCommit(
                            pass, finalParity, buffers, substepActiveCount, substepUniform,
                        ));
                });
                const batch = pourSchedule.batches[substep];
                if (batch) {
                    const upload = imported.pourUpload;
                    if (!upload) throw new Error('Particles4All pour upload buffer is not graph-visible.');
                    const destinationOffset4 = batch.startParticle * 16;
                    const destinationOffset1 = batch.startParticle * 4;
                    const liveSuffix = suffix(parity);
                    graph.withDebugGroup('Pour', () => graph.copy({
                        label: `particles4all.substep-${substep + 1}.pour-injection`,
                        operations: [
                            {
                                type: 'buffer-to-buffer', source: upload, sourceOffset: batch.positionOffset,
                                destination: handle(`pos${liveSuffix}`), destinationOffset: destinationOffset4,
                                size: batch.count * 16,
                            },
                            {
                                type: 'buffer-to-buffer', source: upload, sourceOffset: batch.velocityOffset,
                                destination: handle(`vel${liveSuffix}`), destinationOffset: destinationOffset4,
                                size: batch.count * 16,
                            },
                            {
                                type: 'buffer-to-buffer', source: upload, sourceOffset: batch.densityOffset,
                                destination: handle('density'), destinationOffset: destinationOffset1,
                                size: batch.count * 4,
                            },
                            ...(['A', 'B'] as const).flatMap((bufferSuffix) => [
                                {
                                    type: 'buffer-to-buffer' as const, source: upload,
                                    sourceOffset: batch.zeroOffset, destination: handle(`body${bufferSuffix}`),
                                    destinationOffset: destinationOffset4, size: batch.count * 16,
                                },
                                {
                                    type: 'buffer-to-buffer' as const, source: upload,
                                    sourceOffset: batch.zeroOffset, destination: handle(`rest${bufferSuffix}`),
                                    destinationOffset: destinationOffset4, size: batch.count * 16,
                                },
                            ]),
                        ],
                    }));
                    activeParticleCount += batch.count;
                }
            });
        }

        activeParticleCount = pourSchedule.finalCount;
        for (const name of [
            `pos${suffix(parity)}`, `vel${suffix(parity)}`, `body${suffix(parity)}`,
            `rest${suffix(parity)}`, 'bodyCentre', 'bodyRef', 'bodyRot', 'density', 'cellStart',
        ]) {
            graph.markPersistentState(handle(name), { offset: 0, size: sizeOf(name) });
        }
        return {
            n: pourSchedule.finalCount,
            parity,
            predParity,
            timeBank: sim.timeBank,
            lastSubsteps: framePlan.substeps,
            lastAdvanced: framePlan.substeps * framePlan.dt,
            simTime: sim.simTime + framePlan.substeps * framePlan.dt,
            primePending: false,
            pendingImpulse: false,
            pendingResizeBindGroup: null,
        };
    }

    private recordDiagnostics(
        graph: FrameGraphRecording, native: NativeObjects, imported: ImportedResources,
        parity: number, activeParticleCount: number, uniform: GPUBuffer,
    ): RecordedDiagnosticsCommit {
        const sim = native.sim;
        const handle = (name: string) => imported.buffers.get(sim.buf[name])!;
        const statsReduction = graph.createBuffer({ label: 'particles4all.simulation.stats-reduction', size: 32 });
        const statsReadbacks = sim.statsRing.map((buffer: GPUBuffer, index: number) =>
            sim.statsState[index] === 0 ? this.importBuffer(graph, imported, buffer, 'particles4all.stats-readback.' + index) : undefined);
        const poseReadbacks = sim.poseRing.map((buffer: GPUBuffer, index: number) =>
            sim.nBodies > 0 && sim.poseState[index] === 0 ? this.importBuffer(graph, imported, buffer, 'particles4all.pose-readback.' + index) : undefined);
        const statsReadbackSlot = sim.statsFrame % Math.max(1, statsReadbacks.length);
        const poseReadbackSlot = sim.poseFrame % Math.max(1, poseReadbacks.length);
        const statsReadback = statsReadbacks[statsReadbackSlot];
        const poseReadback = poseReadbacks[poseReadbackSlot];
        const statsReadbackArmed = Boolean(statsReadback) && sim.statsState[statsReadbackSlot] === 0;
        const poseReadbackArmed = sim.nBodies > 0
            && Boolean(poseReadback)
            && sim.poseState[poseReadbackSlot] === 0;
        graph.clearBuffer({
            label: 'particles4all.diagnostics.stats-clear',
            operations: [{ target: statsReduction }],
        });
        const density = graph.use(handle('density'), BufferAccess.StorageRead, { range: { offset: 0, size: Math.max(4, activeParticleCount * 4) } });
        const velocityName = 'vel' + (parity === 0 ? 'A' : 'B');
        const velocity = graph.use(handle(velocityName), BufferAccess.StorageRead, { range: { offset: 0, size: Math.max(16, activeParticleCount * 16) } });
        const output = graph.use(statsReduction, BufferAccess.StorageWrite, { range: { offset: 0, size: 32 }, contents: 'preserve' });
        graph.compute({ label: 'particles4all.diagnostics.stats-reduction', sideEffect: false,
            uses: [density, velocity, output], encode: ({ pass, unwrap }) => sim.encodeStats(
                pass, parity, { density: unwrap(density), [velocityName]: unwrap(velocity), statsOut: unwrap(output) }, activeParticleCount, uniform,
            ) });
        const operations: Array<any> = [];
        if (statsReadbackArmed && statsReadback) {
            operations.push({
                type: 'buffer-to-buffer', source: statsReduction,
                destination: statsReadback, size: 32,
            });
            graph.markReadback(statsReadback);
        }
        if (poseReadbackArmed && poseReadback) {
            operations.push(
                {
                    type: 'buffer-to-buffer', source: handle('bodyCentre'),
                    destination: poseReadback, size: sim.nBodies * 16,
                },
                {
                    type: 'buffer-to-buffer', source: handle('bodyRot'),
                    destination: poseReadback,
                    destinationOffset: sim.nBodies * 16, size: sim.nBodies * 48,
                },
            );
            graph.markReadback(poseReadback);
        }
        if (operations.length > 0) graph.copy({
            label: 'particles4all.diagnostics.readback-copies', operations,
        });

        return {
            statsReadbackArmed, poseReadbackArmed,
            statsReadbackSlot: statsReadbackArmed ? statsReadbackSlot : -1,
            poseReadbackSlot: poseReadbackArmed ? poseReadbackSlot : -1,
            statsFrame: sim.statsFrame + (statsReadbackArmed ? 1 : 0),
            poseFrame: sim.poseFrame + (poseReadbackArmed ? 1 : 0),
        };
    }

    private recordRender(
        graph: FrameGraphRecording,
        native: NativeObjects,
        imported: ImportedResources,
        options: RenderOptions,
        nativeRenderOptions: any,
        renderFrame: any,
        ssfrFrame: any,
        ssfrResources: SsfrTransientResources | null,
        solidPacked: BufferHandle | null,
        rayFrame: any,
        rayResources: RayTransientResources | null,
        surfaceResources: SurfaceTransientResources | null,
    ): void {
        const bufferHandle = (buffer: GPUBuffer, label: string): BufferHandle => {
            const handle = imported.buffers.get(buffer);
            if (!handle) throw new Error(`Particles4All ${label} buffer was not imported.`);
            return handle;
        };
        const readBuffer = (buffer: GPUBuffer, label: string): ResourceUse => graph.use(
            bufferHandle(buffer, label), BufferAccess.StorageRead,
        );
        const branchLabel: Record<Particles4AllDisplayMode, string> = {
            particles: 'Particle',
            'surface-mesh': 'Surface Mesh',
            'ray-march': 'Ray March',
            ssfr: 'SSFR',
        };
        if (renderFrame.meshOn) {
            if (!surfaceResources) throw new Error('Surface transient resources were not prepared.');
            this.pendingMeshCommit = this.recordSurfaceBuild(
                graph, native, imported, nativeRenderOptions, renderFrame, surfaceResources,
            );
        }
        const solidPackedWrite = solidPacked
            ? graph.use(solidPacked, BufferAccess.StorageWrite, { contents: 'overwrite' })
            : null;
        const solidPackedRead = solidPacked
            ? graph.use(solidPacked, BufferAccess.StorageRead)
            : null;
        if (solidPackedWrite) graph.withDebugGroup('Solid Packing', () => {
            graph.compute({
                label: 'particles4all.render.solid-packing',
                sideEffect: false,
                uses: [

                    readBuffer(native.sim.buf.bodyCentre, 'body centre'),
                    readBuffer(native.sim.buf.bodyRot, 'body rotation'),

                    solidPackedWrite,
                ],
                encode: ({ pass, unwrap }) => {
                    native.renderer.encodeSolidPacking(
                        pass, native.sim, renderFrame, unwrap(solidPackedWrite),
                    );
                },
            });
        });
        graph.withDebugGroup(branchLabel[this.settings.displayMode], () => {
            if (renderFrame.ssfrOn) {
                if (!ssfrResources) throw new Error('SSFR transient resources were not prepared.');
                this.recordSsfr(
                    graph,
                    native,
                    imported,
                    options.color,
                    ssfrFrame,
                    ssfrResources,
                    solidPackedRead,
                );
                return;
            }
            if (renderFrame.rayOn) {
                this.recordRayMarch(
                    graph, native, options, nativeRenderOptions,
                    renderFrame, solidPackedRead, rayFrame, rayResources, imported,
                    surfaceResources,
                );
                return;
            }
            const surfaceVertices = renderFrame.meshOn && surfaceResources
                ? graph.use(surfaceResources.vertices, BufferAccess.StorageRead)
                : null;
            const surfaceIndirect = renderFrame.meshOn && surfaceResources
                ? graph.use(surfaceResources.indirect, BufferAccess.Indirect)
                : null;
            const rasterUses: ResourceUse[] = [

            ];
            if (!renderFrame.meshOn) {
                const paritySuffix = renderFrame.parity === 0 ? 'A' : 'B';
                rasterUses.push(
                    readBuffer(native.sim.buf[`pos${paritySuffix}`], 'particle positions'),
                    readBuffer(native.sim.buf[`vel${paritySuffix}`], 'particle velocities'),
                    readBuffer(native.sim.buf[`body${paritySuffix}`], 'particle body phases'),
                );
            }
            graph.render({
                label: `particles4all.render.${this.settings.displayMode}`,
                sideEffect: false,
                uses: [
                    ...rasterUses,
                    ...(renderFrame.meshOn && solidPackedRead ? [solidPackedRead] : []),
                    ...(surfaceVertices ? [surfaceVertices] : []),
                    ...(surfaceIndirect ? [surfaceIndirect] : []),
                ],
                colorAttachments: [{
                    target: options.color,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0.09, g: 0.10, b: 0.12, a: 1 },
                }],
                depthStencilAttachment: {
                    target: options.depth!,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                    depthClearValue: 1,
                },
                encode: ({ pass, unwrap }) => {
                    const packed = renderFrame.meshOn && solidPackedRead ? unwrap(solidPackedRead) : null;
                    native.renderer.encodeRaster(pass, native.sim, renderFrame, packed, surfaceVertices && surfaceIndirect
                        ? { vertices: unwrap(surfaceVertices), indirect: unwrap(surfaceIndirect) }
                        : null);
                },
            });
        });
    }

    private recordRayMarch(
        graph: FrameGraphRecording,
        native: NativeObjects,
        options: RenderOptions,
        nativeRenderOptions: any,
        renderFrame: any,
        solidPackedRead: ResourceUse | null,
        rayFrame: any,
        rayResources: RayTransientResources | null,
        _imported: ImportedResources,
        surfaceResources: SurfaceTransientResources | null,
    ): void {
        let eyeZSample: TextureUse | undefined;
        let normalSample: TextureUse | undefined;
        if (rayResources) {
            if (!surfaceResources) throw new Error('Ray surface resources were not prepared.');
            const vertices = graph.use(surfaceResources.vertices, BufferAccess.StorageRead);
            const indirect = graph.use(surfaceResources.indirect, BufferAccess.Indirect);
            graph.withDebugGroup('Surface GBuffer', () => {
                graph.render({
                    label: 'particles4all.ray.surface-gbuffer',
                    uses: [


                        vertices,
                        indirect,
                    ],
                    colorAttachments: [
                        {
                            target: rayResources.eyeZ,
                            loadOp: 'clear', storeOp: 'store',
                            clearValue: { r: -1e4, g: 0, b: 0, a: 0 },
                        },
                        {
                            target: rayResources.normal,
                            loadOp: 'clear', storeOp: 'store',
                            clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        },
                    ],
                    depthStencilAttachment: {
                        target: rayResources.depth,
                        depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1,
                    },
                    encode: ({ pass, unwrap }) => {
                        native.mesh.drawSurface(
                            pass, native.renderer.uni, unwrap(vertices), unwrap(indirect),
                        );
                    },
                });
            });
            eyeZSample = graph.use(rayResources.eyeZ, TextureAccess.Sampled);
            normalSample = graph.use(rayResources.normal, TextureAccess.Sampled);
        }
        if (!surfaceResources) throw new Error('Ray March field resource was not prepared.');
        const field = graph.use(surfaceResources.field, BufferAccess.StorageRead);
        graph.render({
            label: 'particles4all.ray.composite',
            uses: [
                ...(solidPackedRead ? [solidPackedRead] : []),
                ...(eyeZSample ? [eyeZSample] : []),
                ...(normalSample ? [normalSample] : []),
                field,
            ],
            colorAttachments: [{
                target: options.color,
                loadOp: 'clear', storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
            encode: ({ pass, unwrap }) => {
                const packed = solidPackedRead ? unwrap(solidPackedRead) : null;
                const bind = native.ray.createBind(
                    renderFrame.mesh,
                    packed,
                    { z: eyeZSample ? unwrap(eyeZSample) : native.ray.fallbackZ.createView(),
                      n: normalSample ? unwrap(normalSample) : native.ray.fallbackNormal.createView() },
                    unwrap(field),
                );
                native.ray.draw(pass, bind, rayFrame, nativeRenderOptions);
            },
        });
    }

    private recordSurfaceBuild(
        graph: FrameGraphRecording,
        native: NativeObjects,
        imported: ImportedResources,
        nativeRenderOptions: any,
        renderFrame: any,
        resources: SurfaceTransientResources,
    ): RecordedMeshCommit {
        const mesh = native.mesh;
        const importedHandle = (buffer: GPUBuffer): BufferHandle => {
            const handle = imported.buffers.get(buffer);
            if (!handle) throw new Error('Particles4All surface buffer was not imported.');
            return handle;
        };
        const fieldOnly = renderFrame.rayOn && nativeRenderOptions.raySurface === 0;
        graph.withDebugGroup('Surface Build', () => {

            const position = graph.use(importedHandle(native.sim.buf[renderFrame.parity === 0 ? 'posA' : 'posB']), BufferAccess.StorageRead);
            const body = graph.use(importedHandle(native.sim.buf[renderFrame.parity === 0 ? 'bodyA' : 'bodyB']), BufferAccess.StorageRead);
            const density = graph.use(importedHandle(native.sim.buf.density), BufferAccess.StorageRead);
            const cellStart = graph.use(importedHandle(native.sim.buf.cellStart), BufferAccess.StorageRead);
            const fieldWrite = graph.use(resources.field, BufferAccess.StorageWrite, { contents: 'overwrite' });
            graph.compute({
                label: 'particles4all.surface.density-field',
                uses: [position, body, density, cellStart, fieldWrite],
                encode: ({ pass, unwrap }) => {
                    mesh.encodeDensityField(pass, native.sim, {
                        parity: renderFrame.parity,
                        field: unwrap(fieldWrite),
                    });
                },
            });

            let sourceIsField = true;
            if (nativeRenderOptions.fieldSmooth > 0) {
                graph.withDebugGroup('Field Blur', () => {
                    for (let iteration = 0; iteration < nativeRenderOptions.fieldSmooth; iteration++) {
                        graph.withDebugGroup(`Pass ${iteration + 1}`, () => {
                            for (let axis = 0; axis < 3; axis++) {
                                const recordedSourceIsField = sourceIsField;
                                const sourceHandle = recordedSourceIsField ? resources.field : resources.fieldTemporary;
                                const destinationHandle = recordedSourceIsField ? resources.fieldTemporary : resources.field;

                                const source = graph.use(sourceHandle, BufferAccess.StorageRead);
                                const destination = graph.use(
                                    destinationHandle, BufferAccess.StorageWrite, { contents: 'overwrite' },
                                );
                                graph.compute({
                                    label: `particles4all.surface.field-blur-${iteration + 1}-${axisName(axis)}`,
                                    uses: [source, destination],
                                    encode: ({ pass, unwrap }) => {
                                        mesh.encodeFieldBlur(
                                            pass, axis, unwrap(source), unwrap(destination),
                                        );
                                    },
                                });
                                sourceIsField = !sourceIsField;
                            }
                        });
                    }
                });
                if (!sourceIsField) {
                    graph.copy({
                        label: 'particles4all.surface.field-normalize',
                        operations: [{
                            type: 'buffer-to-buffer',
                            source: resources.fieldTemporary, destination: resources.field,
                            size: mesh.nVerts * 4,
                        }],
                    });
                }
            }

            if (fieldOnly) return;

            const normalSteps = 3 * mesh.normalSmoothPasses;
            if (normalSteps > 0) {
                graph.withDebugGroup('Normal Field', () => {
                    let toNormal = (normalSteps % 2) === 1;
                    for (let step = 0; step < normalSteps; step++) {
                        const route = step === 0
                            ? (toNormal ? 'field-to-normal' : 'field-to-field2')
                            : (toNormal ? 'field2-to-normal' : 'normal-to-field2');
                        const axis = step % 3;
                        const sourceHandle = route === 'field-to-normal' || route === 'field-to-field2'
                            ? resources.field
                            : route === 'field2-to-normal' ? resources.fieldTemporary : resources.normalField;
                        const destinationHandle = route === 'field-to-normal' || route === 'field2-to-normal'
                            ? resources.normalField : resources.fieldTemporary;

                        const source = graph.use(sourceHandle, BufferAccess.StorageRead);
                        const destination = graph.use(
                            destinationHandle, BufferAccess.StorageWrite, { contents: 'overwrite' },
                        );
                        graph.compute({
                            label: `particles4all.surface.normal-blur-${Math.floor(step / 3) + 1}-${axisName(axis)}`,
                            uses: [source, destination],
                            encode: ({ pass, unwrap }) => {
                                mesh.encodeNormalBlur(
                                    pass, axis, unwrap(source), unwrap(destination),
                                );
                            },
                        });
                        toNormal = !toNormal;
                    }
                });
            }
            graph.clearBuffer({
                label: 'particles4all.surface.counter-clear',
                // Marching cubes emits a GPU-selected prefix. Initialize its full declared range.
                operations: [{ target: resources.counter }, { target: resources.vertices }],
            });

            const marchField = graph.use(resources.field, BufferAccess.StorageRead);
            const marchNormal = normalSteps > 0
                ? graph.use(resources.normalField, BufferAccess.StorageRead)
                : null;
            const vertices = graph.use(resources.vertices, BufferAccess.StorageWrite, { contents: 'preserve' });
            const counter = graph.use(resources.counter, BufferAccess.StorageWrite, { contents: 'preserve' });
            graph.compute({
                label: 'particles4all.surface.marching-cubes',
                uses: [marchField, ...(marchNormal ? [marchNormal] : []), vertices, counter],
                encode: ({ pass, unwrap }) => {
                    mesh.encodeMarchingCubes(pass, {
                        field: unwrap(marchField),
                        normalField: marchNormal ? unwrap(marchNormal) : unwrap(marchField),
                        vertices: unwrap(vertices),
                        counter: unwrap(counter),
                    }, normalSteps > 0);
                },
            });

            const counterRead = graph.use(resources.counter, BufferAccess.StorageRead);
            const indirectWrite = graph.use(resources.indirect, BufferAccess.StorageWrite, { contents: 'overwrite' });
            graph.compute({
                label: 'particles4all.surface.indirect-args',
                uses: [counterRead, indirectWrite],
                encode: ({ pass, unwrap }) => {
                    mesh.encodeIndirectArgs(
                        pass, unwrap(counterRead), unwrap(indirectWrite),
                    );
                },
            });
        });

        if (fieldOnly) return { frame: mesh.frame, readbackSlot: null };
        const slot = mesh.frame % mesh.triRing.length;
        const readbackSlot = mesh.triState[slot] === 0 ? slot : null;
        if (readbackSlot !== null) {
            const staging = importedHandle(mesh.triRing[readbackSlot]);
            graph.copy({
                label: 'particles4all.surface.triangle-count-readback',
                operations: [{
                    type: 'buffer-to-buffer', source: resources.counter, destination: staging, size: 4,
                }],
            });
            graph.markReadback(staging);
        }
        return { frame: mesh.frame + 1, readbackSlot };
    }

    private recordSsfr(
        graph: FrameGraphRecording,
        native: NativeObjects,
        imported: ImportedResources,
        color: TextureHandle,
        frame: any,
        resources: SsfrTransientResources,
        solidPackedRead: ResourceUse | null,
    ): void {
        const bufferUse = (
            buffer: GPUBuffer,
            access: BufferAccess.Uniform | BufferAccess.StorageRead,
        ): ResourceUse => {
            const handle = imported.buffers.get(buffer);
            if (!handle) throw new Error('Particles4All SSFR buffer was not imported.');
            return graph.use(handle, access);
        };
        const paritySuffix = frame.parity === 0 ? 'A' : 'B';
        const position = bufferUse(native.sim.buf[`pos${paritySuffix}`], BufferAccess.StorageRead);
        const body = bufferUse(native.sim.buf[`body${paritySuffix}`], BufferAccess.StorageRead);
        const cellStart = bufferUse(native.sim.buf.cellStart, BufferAccess.StorageRead);
        const smoothPositionWrite = graph.use(
            resources.smoothPosition, BufferAccess.StorageWrite, { contents: 'overwrite' },
        );
        const anisotropyWrite = graph.use(
            resources.anisotropy, BufferAccess.StorageWrite, { contents: 'overwrite' },
        );
        graph.compute({
            label: 'particles4all.ssfr.anisotropy',
            sideEffect: false,
            uses: [

                position,
                cellStart,
                smoothPositionWrite,
                anisotropyWrite,
            ],
            encode: ({ pass, unwrap }) => {
                native.mesh.buildAnisotropy(pass, native.sim, frame.anisoCount, {
                    position: frame.sim.buf[frame.parity === 0 ? 'posA' : 'posB'],
                    smoothPosition: unwrap(smoothPositionWrite),
                    anisotropy: unwrap(anisotropyWrite),
                });
            },
        });
        graph.render({
            label: 'particles4all.ssfr.solid-distance',
            sideEffect: false,
            uses: [

                ...(solidPackedRead ? [solidPackedRead] : []),
            ],
            colorAttachments: [{
                target: resources.solidDistance,
                loadOp: 'clear', storeOp: 'store',
                clearValue: { r: 1e30, g: 0, b: 0, a: 0 },
            }],
            encode: ({ pass, unwrap }) => {
                native.ssfr.encodeSolidDistance(
                    pass,
                    frame,
                    {
                        bodies: solidPackedRead ? unwrap(solidPackedRead) : undefined,
                    },
                );
            },
        });

        const smoothPositionReadForDepth = graph.use(resources.smoothPosition, BufferAccess.StorageRead);
        const anisotropyReadForDepth = graph.use(resources.anisotropy, BufferAccess.StorageRead);
        graph.render({
            label: 'particles4all.ssfr.depth-splat',
            sideEffect: false,
            uses: [

                body,
                smoothPositionReadForDepth,
                anisotropyReadForDepth,
            ],
            colorAttachments: [{
                target: resources.eyeZ[0], loadOp: 'clear', storeOp: 'store',
                clearValue: { r: -1e4, g: 0, b: 0, a: 0 },
            }],
            depthStencilAttachment: {
                target: resources.depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1,
            },
            encode: ({ pass, unwrap }) => {
                native.ssfr.encodeDepth(pass, frame, {
                    smoothPosition: unwrap(smoothPositionReadForDepth),
                    anisotropy: unwrap(anisotropyReadForDepth),
                    body: native.sim.buf[frame.parity === 0 ? 'bodyA' : 'bodyB'],
                });
            },
        });

        const smoothPositionReadForThickness = graph.use(resources.smoothPosition, BufferAccess.StorageRead);
        const anisotropyReadForThickness = graph.use(resources.anisotropy, BufferAccess.StorageRead);
        graph.render({
            label: 'particles4all.ssfr.thickness-splat',
            sideEffect: false,
            uses: [

                body,
                smoothPositionReadForThickness,
                anisotropyReadForThickness,
            ],
            colorAttachments: [{
                target: resources.thickness, loadOp: 'clear', storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
            }],
            encode: ({ pass, unwrap }) => {
                native.ssfr.encodeThickness(pass, frame, {
                    smoothPosition: unwrap(smoothPositionReadForThickness),
                    anisotropy: unwrap(anisotropyReadForThickness),
                    body: native.sim.buf[frame.parity === 0 ? 'bodyA' : 'bodyB'],
                });
            },
        });
        if (native.ssfr.thicknessFilterSize > 0) {
            graph.withDebugGroup('Thickness Blur', () => {
                const horizontalInput = graph.use(resources.thickness, TextureAccess.Sampled);
                graph.render({
                    label: 'particles4all.ssfr.thickness-blur-horizontal',
                    sideEffect: false,
                    uses: [horizontalInput],
                    colorAttachments: [{
                        target: resources.thicknessTemporary, loadOp: 'clear', storeOp: 'store',
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    }],
                    encode: ({ pass, unwrap }) => {
                        native.ssfr.encodeThicknessBlur(pass, frame, 0, {
                            thick: unwrap(horizontalInput),
                        });
                    },
                });
                const verticalInput = graph.use(resources.thicknessTemporary, TextureAccess.Sampled);
                graph.render({
                    label: 'particles4all.ssfr.thickness-blur-vertical',
                    sideEffect: false,
                    uses: [verticalInput],
                    colorAttachments: [{
                        target: resources.thickness, loadOp: 'clear', storeOp: 'store',
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    }],
                    encode: ({ pass, unwrap }) => {
                        native.ssfr.encodeThicknessBlur(pass, frame, 1, {
                            thickTmp: unwrap(verticalInput),
                        });
                    },
                });
            });
        }
        graph.copy({
            label: 'particles4all.ssfr.raw-depth-copy',
            operations: [{
                type: 'texture-to-texture',
                source: resources.eyeZ[0],
                destination: resources.rawDepth,
                copySize: [native.ssfr.w, native.ssfr.h, 1],
            }],
        });

        let sourceIndex = 0;
        graph.withDebugGroup('Narrow Range Filter', () => {
            for (let iteration = 0; iteration < Math.max(0, native.ssfr.filterIterations) * 2; iteration++) {
                const destinationIndex = 1 - sourceIndex;
                const filterInput = graph.use(resources.eyeZ[sourceIndex], TextureAccess.Sampled);
                graph.render({
                    label: `particles4all.ssfr.filter-${iteration + 1}`,
                    sideEffect: false,
                    uses: [filterInput],
                    colorAttachments: [{
                        target: resources.eyeZ[destinationIndex], loadOp: 'clear', storeOp: 'store',
                        clearValue: { r: -1e4, g: 0, b: 0, a: 0 },
                    }],
                    encode: ({ pass, unwrap }) => {
                        native.ssfr.encodeFilter(pass, iteration % 2, unwrap(filterInput));
                    },
                });
                sourceIndex = destinationIndex;
            }
            if (native.ssfr.cleanupPass && native.ssfr.filterIterations > 0) {
                const destinationIndex = 1 - sourceIndex;
                const filterInput = graph.use(resources.eyeZ[sourceIndex], TextureAccess.Sampled);
                graph.render({
                    label: 'particles4all.ssfr.filter-cleanup',
                    sideEffect: false,
                    uses: [filterInput],
                    colorAttachments: [{
                        target: resources.eyeZ[destinationIndex], loadOp: 'clear', storeOp: 'store',
                        clearValue: { r: -1e4, g: 0, b: 0, a: 0 },
                    }],
                    encode: ({ pass, unwrap }) => {
                        native.ssfr.encodeFilter(pass, 2, unwrap(filterInput));
                    },
                });
                sourceIndex = destinationIndex;
            }
        });

        const filteredDepth = graph.use(resources.eyeZ[sourceIndex], TextureAccess.Sampled);
        const rawDepth = graph.use(resources.rawDepth, TextureAccess.Sampled);
        const thickness = graph.use(resources.thickness, TextureAccess.Sampled);
        const solidDistance = graph.use(resources.solidDistance, TextureAccess.Sampled);
        graph.render({
            label: 'particles4all.ssfr.composite',
            sideEffect: false,
            uses: [

                ...(solidPackedRead ? [solidPackedRead] : []),
                filteredDepth,
                rawDepth,
                thickness,
                solidDistance,
            ],
            colorAttachments: [{
                target: color, loadOp: 'clear', storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
            encode: ({ pass, unwrap }) => {
                native.ssfr.encodeComposite(pass, frame, {
                    eyeZ: unwrap(filteredDepth),
                    raw: unwrap(rawDepth),
                    thick: unwrap(thickness),
                    bodyT: unwrap(solidDistance),
                    bodies: solidPackedRead ? unwrap(solidPackedRead) : undefined,
                });
            },
        });
    }

    private createSsfrTransientResources(
        graph: FrameGraphRecording,
        ssfr: any,
        particleCount: number,
    ): SsfrTransientResources {
        const create = (label: string, format: GPUTextureFormat, width: number, height: number): TextureHandle => (
            graph.createTexture({ label, format, size: [Math.max(1, width), Math.max(1, height)] })
        );
        return {
            smoothPosition: graph.createBuffer({
                label: 'particles4all.ssfr.smooth-position', size: Math.max(16, particleCount * 16),
            }),
            anisotropy: graph.createBuffer({
                label: 'particles4all.ssfr.anisotropy', size: Math.max(16, particleCount * 32),
            }),
            eyeZ: [
                create('particles4all.ssfr.eye-z-0', 'r32float', ssfr.w, ssfr.h),
                create('particles4all.ssfr.eye-z-1', 'r32float', ssfr.w, ssfr.h),
            ],
            rawDepth: create('particles4all.ssfr.raw-depth', 'r32float', ssfr.w, ssfr.h),
            thickness: create('particles4all.ssfr.thickness', 'r16float', ssfr.tw, ssfr.th),
            thicknessTemporary: create('particles4all.ssfr.thickness-temporary', 'r16float', ssfr.tw, ssfr.th),
            solidDistance: create('particles4all.ssfr.solid-distance', 'r32float', ssfr.w, ssfr.h),
            depth: create('particles4all.ssfr.depth', 'depth24plus', ssfr.w, ssfr.h),
        };
    }

    private createSimulationTransientResources(
        graph: FrameGraphRecording,
        sim: any,
    ): SimulationTransientResources {
        const create = (label: string, size: number): BufferHandle => graph.createBuffer({
            label: `particles4all.simulation.${label}`,
            size: Math.max(16, size),
        });
        const particleVec4Bytes = sim.cap * 16;
        const bodyCount = Math.max(1, sim.nBodies);
        return {
            predA: create('pred-a', particleVec4Bytes),
            predB: create('pred-b', particleVec4Bytes),
            lambda: create('lambda', sim.cap * 4),
            slot: create('slot', sim.cap * 4),
            correction: create('correction', particleVec4Bytes),
            normal: create('normal', particleVec4Bytes),
            cellCount: create('cell-count', (sim.nCells + 1) * 4),
            blockSum: create('scan-block', (Math.ceil(sim.nCells / 256) + 2) * 4),
            cursor: create('grid-cursor', (sim.nCells + 1) * 4),
            bodyAccumulation: create('body-accumulation', bodyCount * 16),
            bodyCovariance: create('body-covariance', bodyCount * 36),
            bodyIndices: create('body-indices', Math.max(1, sim.nBodyParts) * 4),
            bodyIndexCount: create('body-index-count', 16),
        };
    }

    private createSurfaceTransientResources(
        graph: FrameGraphRecording,
        mesh: any,
    ): SurfaceTransientResources {
        return {
            field: graph.createBuffer({ label: 'particles4all.surface.field', size: mesh.nVerts * 4 }),
            fieldTemporary: graph.createBuffer({
                label: 'particles4all.surface.field-temporary', size: mesh.nVerts * 4,
            }),
            normalField: graph.createBuffer({ label: 'particles4all.surface.normal-field', size: mesh.nVerts * 4 }),
            vertices: graph.createBuffer({
                label: 'particles4all.surface.vertices', size: Math.max(16, mesh.vertCapacity),
            }),
            counter: graph.createBuffer({ label: 'particles4all.surface.counter', size: 16 }),
            indirect: graph.createBuffer({ label: 'particles4all.surface.indirect', size: 16 }),
        };
    }

    private createRayTransientResources(graph: FrameGraphRecording): RayTransientResources {
        const size: readonly [number, number] = [this.width, this.height];
        return {
            eyeZ: graph.createTexture({ label: 'particles4all.ray.eye-z', format: 'r32float', size }),
            normal: graph.createTexture({ label: 'particles4all.ray.normal', format: 'rgba16float', size }),
            depth: graph.createTexture({ label: 'particles4all.ray.depth', format: 'depth24plus', size }),
        };
    }

    private createNativeRenderOptions(native: NativeObjects): any {
        return {
            radius: this.settings.particleRadius * native.sim.params.spacing,
            speedMax: this.settings.speedMax,
            display: DISPLAY_INDEX[this.settings.displayMode],
            mesh: native.mesh,
            solids: native.solids,
            ray: native.ray,
            ssfr: native.ssfr,
            raySurface: this.settings.raySurface === 'mesh' ? 1 : 0,
            meshRes: this.settings.meshResolution,
            meshIso: this.settings.meshIso,
            fieldSmooth: this.settings.fieldSmooth,
        };
    }

    private importResources(graph: FrameGraphRecording, native: NativeObjects): ImportedResources {
        const imported: ImportedResources = { buffers: new Map() };
        for (const name of ['posA', 'posB', 'velA', 'velB', 'bodyA', 'bodyB', 'restA', 'restB',
            'density', 'cellStart', 'bodyCentre', 'bodyRef', 'bodyRot']) {
            this.importBuffer(graph, imported, native.sim.buf[name], 'particles4all.sim.' + name);
        }
        return imported;
    }

    private importBuffer(graph: FrameGraphRecording, imported: ImportedResources, buffer: GPUBuffer, label: string): BufferHandle {
        const existing = imported.buffers.get(buffer);
        if (existing) return existing;
        const handle = graph.importBuffer(buffer, { label });
        imported.buffers.set(buffer, handle);
        return handle;
    }

    private applyRuntimeSettings(native: NativeObjects): void {
        const settings = this.settings;
        const params = native.sim.params;
        if (params) {
            params.substeps = settings.substeps;
            params.iterations = settings.iterations;
            params.cfmEpsilonRel = settings.cfm;
            params.omega = settings.omega;
            params.sorAverage = settings.sorAverage;
            params.xsphC = settings.xsph;
            params.sCorrK = settings.scorr;
            params.sCorrDq = settings.scorrDq;
            params.surfaceTensionK = settings.tension;
            params.gravity = settings.gravity;
        }
        native.mesh.normalSmoothPasses = settings.normalSmooth;
        native.mesh.anisoRatio = settings.anisotropyRatio;
        native.mesh.anisoLambda = settings.anisotropyLambda;
        native.mesh.anisoMinNeighbours = settings.anisotropyNeighbours;
        native.mesh.anisoLonely = settings.anisotropyLonely;
        native.mesh.anisoRadiusScale = settings.anisotropyRadius;
        native.mesh.anisoStretch = settings.anisotropyStretch;
        native.mesh.anisoKs = settings.anisotropyKs;
        native.ray.ior = settings.ior;
        native.ray.debug = settings.rayDebug;
        native.ray.thicknessSteps = settings.rayThicknessSteps;
        native.ray.absorption = settings.absorption;
        native.ray.transmit = settings.transmission.slice();
        native.ray.roughness = settings.roughness;
        native.ray.exposure = settings.exposure;
        native.ray.sunIntensity = settings.sunIntensity;
        native.ray.sunElevation = settings.sunElevation;
        native.ray.sunAzimuth = settings.sunAzimuth;
        native.ray.groundReflection = settings.groundReflection;
        native.ray.floorPlane = settings.floorPlane;
        native.ssfr.ior = settings.ior;
        native.ssfr.debug = settings.ssfrDebug;
        native.ssfr.absorption = settings.absorption;
        native.ssfr.transmit = settings.transmission.slice();
        native.ssfr.roughness = settings.roughness;
        native.ssfr.exposure = settings.exposure;
        native.ssfr.sunIntensity = settings.sunIntensity;
        native.ssfr.sunElevation = settings.sunElevation;
        native.ssfr.sunAzimuth = settings.sunAzimuth;
        native.ssfr.groundReflection = settings.groundReflection;
        native.ssfr.floorPlane = settings.floorPlane;
        native.ssfr.renderScale = settings.ssfrScale;
        native.ssfr.splatRadius = settings.ssfrRadius;
        native.ssfr.filter = settings.ssfrFilter;
        native.ssfr.filterIterations = settings.ssfrIterations;
        native.ssfr.filterSigma = settings.ssfrSigma;
        native.ssfr.narrowDelta = settings.ssfrDelta;
        native.ssfr.narrowMu = settings.ssfrMu;
        native.ssfr.bilateralRange = settings.ssfrBilateralRange;
        native.ssfr.cleanupPass = settings.ssfrCleanupPass;
        native.ssfr.thicknessRadius = settings.ssfrThicknessRadius;
        native.ssfr.thicknessScale = settings.ssfrThicknessScale;
        native.ssfr.thicknessFilterSize = settings.ssfrThicknessBlur;
        native.ssfr.depthCullFraction = settings.ssfrDepthCull;
        native.environment.intensity = settings.environmentIntensity;
        native.environment.yaw = settings.environmentYawDegrees * Math.PI / 180;
        native.environment.floorPlane = settings.floorPlane;
        const radius = native.mesh.anisoRadiusScale * (native.sim.h ?? 0);
        const full = 4.18879 * Math.pow(radius / Math.max(native.sim.params?.spacing ?? 1, 1e-6), 3);
        native.ssfr.depthCullNeighbours = settings.ssfrDepthCull > 0 ? Math.floor(settings.ssfrDepthCull * full) : 0;
    }

    private updateBox(native: NativeObjects, deltaTime: number): void {
        // A discarded recording still owns a queued old-box → new-box deformation.
        // Submit that deformation before overwriting its uniform with another step.
        if (this.settings.paused || native.sim.pendingResizeBindGroup) return;
        const wanted = this.baseBoxX * this.settings.boxScaleX;
        const current = native.sim.params.box[0];
        const gap = wanted - current;
        const step = Math.sign(gap) * Math.min(Math.abs(gap), 2 * Math.max(0, deltaTime));
        if (Math.abs(step) <= 1e-6) return;
        const box = [current + step, native.sim.params.box[1], native.sim.params.box[2]];
        this.validateGridCapacity(box, native.sim.params.spacing);
        this.validateRenderCapacity(this.settings, box, native.sim.cap);
        native.sim.resizeBox(box);
        native.renderer.setBox(native.sim.params.box);
    }

    private preparePourSchedule(sim: any, framePlan: SimulationFramePlan): PourFrameSchedule {
        let remaining = this.pourRemaining;
        let pouring = this.pouring;
        let extruded = this.pourExtruded;
        let nextLayer = this.pourNextLayer;
        let seed = this.pourSeed;
        let activeCount = sim.n as number;
        const activeCounts = [activeCount];
        const generated: Array<{
            startParticle: number;
            positions: number[];
            velocities: number[];
        } | null> = [];
        const jitter = (spacing: number): number => {
            seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
            return ((((seed >>> 8) & 0xffff) / 65_535) - 0.5) * 0.002 * spacing;
        };

        for (let substep = 0; substep < framePlan.substeps; substep++) {
            let batch: (typeof generated)[number] = null;
            const room = Math.max(0, (sim.cap ?? activeCount) - activeCount);
            const limit = Math.min(remaining, room);
            if (pouring && limit > 0 && framePlan.dt > 0) {
                const spacing = sim.params.spacing;
                const layerStep = spacing * POUR_SLACK;
                extruded += this.settings.pourSpeed * framePlan.dt;
                let layers = 0;
                for (let layer = nextLayer; layer * layerStep <= extruded; layer++) layers++;
                layers = Math.min(layers, 32);
                if (layers > 0) {
                    const across = Math.max(1, Math.round(
                        this.settings.pourWidth / Math.max(spacing, 1e-4),
                    ));
                    const span = (across - 1) * spacing;
                    const box = sim.params.box;
                    const nozzle = [sim.h + spacing, this.settings.pourHeight * box[1], 0.5 * box[2]];
                    const tilt = this.settings.pourTilt * Math.PI / 180;
                    const jet = [
                        this.settings.pourSpeed * Math.cos(tilt),
                        -this.settings.pourSpeed * Math.sin(tilt),
                        0,
                    ];
                    const positions: number[] = [];
                    const velocities: number[] = [];
                    for (let layer = 0; layer < layers && positions.length / 3 < limit; layer++) {
                        const index = nextLayer + layer;
                        const behind = extruded - index * layerStep;
                        const time = behind / Math.max(this.settings.pourSpeed, 1e-6);
                        const x = nozzle[0] + jet[0] * time;
                        const centerY = nozzle[1] + jet[1] * time
                            - 0.5 * sim.params.gravity * time * time;
                        const velocityY = jet[1] - sim.params.gravity * time;
                        if (x >= box[0] - spacing || centerY <= spacing) break;
                        for (let yIndex = 0;
                            yIndex < across && positions.length / 3 < limit;
                            yIndex++) {
                            for (let zIndex = 0;
                                zIndex < across && positions.length / 3 < limit;
                                zIndex++) {
                                const y = centerY - 0.5 * span + yIndex * spacing + jitter(spacing);
                                if (y <= spacing || y >= box[1] - spacing) continue;
                                positions.push(
                                    x + jitter(spacing),
                                    y,
                                    nozzle[2] - 0.5 * span + zIndex * spacing + jitter(spacing),
                                );
                                velocities.push(jet[0], velocityY, 0);
                            }
                        }
                    }
                    nextLayer += layers;
                    const count = positions.length / 3;
                    if (count > 0) {
                        batch = { startParticle: activeCount, positions, velocities };
                        activeCount += count;
                        remaining = Math.max(0, remaining - count);
                        if (remaining === 0) pouring = false;
                    }
                }
            } else if (pouring && room === 0) {
                pouring = false;
            }
            generated.push(batch);
            activeCounts.push(activeCount);
        }

        let uploadBuffer: GPUBuffer | null = null;
        const batches: Array<PourUploadBatch | null> = Array(framePlan.substeps).fill(null);
        const totalBytes = generated.reduce((total, batch) => {
            const count = batch ? batch.positions.length / 3 : 0;
            return total + count * 52;
        }, 0);
        if (totalBytes > 0) {
            const payload = new Float32Array(totalBytes / 4);
            let byteOffset = 0;
            for (let substep = 0; substep < generated.length; substep++) {
                const batch = generated[substep];
                if (!batch) continue;
                const count = batch.positions.length / 3;
                const positionOffset = byteOffset;
                for (let index = 0; index < count; index++) {
                    const target = byteOffset / 4 + index * 4;
                    payload[target] = batch.positions[index * 3];
                    payload[target + 1] = batch.positions[index * 3 + 1];
                    payload[target + 2] = batch.positions[index * 3 + 2];
                    payload[target + 3] = 1;
                }
                byteOffset += count * 16;
                const velocityOffset = byteOffset;
                for (let index = 0; index < count; index++) {
                    const target = byteOffset / 4 + index * 4;
                    payload[target] = batch.velocities[index * 3];
                    payload[target + 1] = batch.velocities[index * 3 + 1];
                    payload[target + 2] = batch.velocities[index * 3 + 2];
                }
                byteOffset += count * 16;
                const densityOffset = byteOffset;
                payload.fill(sim.params.restDensity, byteOffset / 4, byteOffset / 4 + count);
                byteOffset += count * 4;
                const zeroOffset = byteOffset;
                byteOffset += count * 16;
                batches[substep] = {
                    startParticle: batch.startParticle,
                    count,
                    positionOffset,
                    velocityOffset,
                    densityOffset,
                    zeroOffset,
                };
            }
            uploadBuffer = this.preparePourUpload(sim.dev, payload);
        }

        return {
            startCount: sim.n,
            finalCount: activeCount,
            activeCounts,
            batches,
            uploadBuffer,
            commit: { remaining, pouring, extruded, nextLayer, seed },
        };
    }

    private preparePourUpload(device: GPUDevice, payload: Float32Array): GPUBuffer {
        if (payload.byteLength > this.pourUploadCapacity) {
            this.pourUploadCapacity = Math.max(256, 2 ** Math.ceil(Math.log2(payload.byteLength)));
            this.pourUploadBuffers.push(device.createBuffer({
                label: `particles4all.pour-upload.${this.pourUploadBuffers.length}`,
                size: this.pourUploadCapacity,
                usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            }));
        }
        const buffer = this.pourUploadBuffers.at(-1);
        if (!buffer) throw new Error('Particles4All failed to allocate the pour upload buffer.');
        device.queue.writeBuffer(buffer, 0, payload);
        return buffer;
    }

    private commitPourState(commit: PourStateCommit): void {
        this.pourRemaining = commit.remaining;
        this.pouring = commit.pouring;
        this.pourExtruded = commit.extruded;
        this.pourNextLayer = commit.nextLayer;
        this.pourSeed = commit.seed;
    }
    private requireNative(method: string): NativeObjects {
        this.assertNotDestroyed();
        if (!this.native) throw new Error(`Particles4AllFeature.setup() must complete before ${method}().`);
        return this.native;
    }

    private validateBufferCapacity(label: string, bytes: number): void {
        const limits = this.device.limits;
        if (!Number.isSafeInteger(bytes) || bytes > limits.maxBufferSize || bytes > limits.maxStorageBufferBindingSize) {
            throw new Error(`Particles4All ${label} requires ${bytes} bytes, exceeding this device's buffer limits.`);
        }
    }

    private validateGridCapacity(box: readonly number[], spacing: number): void {
        const grid = box.map(value => Math.max(1, Math.floor(value / (2 * spacing))));
        const cells = grid.reduce((a, b) => a * b, 1);
        this.validateBufferCapacity('spatial grid', (cells + 2) * 4);
        const boundary = box.map(value => Math.max(2, Math.ceil(value / spacing) + 1));
        const [x, y, z] = boundary;
        this.validateBufferCapacity('boundary samples', 2 * (x * y + y * z + x * z) * 16);
        const groups = Math.ceil((cells + 1) / 256);
        if (groups > this.device.limits.maxComputeWorkgroupsPerDimension) {
            throw new Error('Particles4All spatial grid exceeds the compute dispatch limit.');
        }
    }

    private validateSceneCapacity(params: any, scene: any): void {
        const capacity = scene.n + (params.pour === false ? 0 : scene.nFluid);
        this.validateBufferCapacity('particle state', capacity * 16);
        this.validateBufferCapacity('boundary samples', Math.max(1, scene.boundary.count) * 16);
        if (Math.ceil(capacity / 256) > this.device.limits.maxComputeWorkgroupsPerDimension) {
            throw new Error('Particles4All particle capacity exceeds the compute dispatch limit.');
        }
        const baseBoxX = (this.sceneOverrides?.box ?? getPresetScene(this.settings.preset).box!)[0];
        this.validateResizePathCapacity(this.settings, params.box, params.spacing, capacity, baseBoxX);
    }

    private validateResizePathCapacity(settings: Particles4AllSettings, box: readonly number[], spacing: number,
        capacity: number, baseBoxX: number): void {
        const targetWidth = baseBoxX * settings.boxScaleX;
        const widths = [box[0], targetWidth];
        // Field resolution follows the longest axis. Its largest allocation can
        // occur between the endpoints when the moving X axis becomes longest.
        const crossover = Math.max(box[1], box[2]);
        if (crossover > Math.min(...widths) && crossover < Math.max(...widths)) widths.push(crossover);
        for (const width of widths) {
            const candidate = [width, box[1], box[2]];
            this.validateGridCapacity(candidate, spacing);
            this.validateRenderCapacity(settings, candidate, capacity);
        }
    }

    private validateRenderCapacity(settings: Particles4AllSettings, box: readonly number[], capacity: number): void {
        if (settings.displayMode === 'ssfr') {
            this.validateBufferCapacity('anisotropy', Math.max(16, capacity * 32));
        } else if (settings.displayMode !== 'particles') {
            const voxel = Math.max(...box) / settings.meshResolution;
            const vertices = box.reduce((count, value) => count * (Math.ceil(value / voxel) + 3), 1);
            const fieldBytes = vertices * 4;
            this.validateBufferCapacity('surface field', fieldBytes);
            if (settings.displayMode === 'surface-mesh' || settings.raySurface === 'mesh') {
                this.validateBufferCapacity('surface vertices', 3_000_000 * 3 * 8);
            }
        }
    }

    private transientResourceKey(native: NativeObjects, particleCount: number): string {
        const { sim, mesh, ssfr } = native;
        const settings = this.settings;
        const sizes: Array<string | number | boolean> = [
            settings.displayMode, this.width, this.height, sim.cap, sim.nCells, sim.nBodies, sim.nBodyParts,
        ];
        if (settings.displayMode === 'ssfr') {
            sizes.push(particleCount, ssfr.w, ssfr.h, ssfr.tw, ssfr.th,
                settings.ssfrIterations > 0, settings.ssfrCleanupPass, settings.ssfrThicknessBlur > 0);
        } else if (settings.displayMode !== 'particles') {
            sizes.push(mesh.nVerts, mesh.vertCapacity, settings.fieldSmooth > 0, settings.normalSmooth > 0);
            if (settings.displayMode === 'ray-march') sizes.push(settings.raySurface);
        }
        return sizes.join('/');
    }

    private assertIdle(method: string): void {
        this.assertNotDestroyed();
        if (this.framePending) {
            throw new Error(`Particles4AllFeature.${method}() cannot run while a recorded frame is pending.`);
        }
    }

    private assertNotDestroyed(): void {
        if (this.isDestroyed) throw new Error('Particles4AllFeature has been destroyed.');
    }
}

function createIdlePourSchedule(startCount: number, substeps: number): PourFrameSchedule {
    return {
        startCount,
        finalCount: startCount,
        activeCounts: Array(substeps + 1).fill(startCount),
        batches: Array(substeps).fill(null),
        uploadBuffer: null,
        commit: { remaining: 0, pouring: false, extruded: 0, nextLayer: 0, seed: 0 },
    };
}

function captureSimulationState(sim: any): PendingSimulationState {
    return {
        n: sim.n ?? 0,
        parity: sim.parity ?? 0,
        predParity: sim.predParity ?? 0,
        timeBank: sim.timeBank ?? 0,
        simTime: sim.simTime ?? 0,
        lastSubsteps: sim.lastSubsteps ?? 0,
        lastAdvanced: sim.lastAdvanced ?? 0,
        primePending: Boolean(sim.primePending),
        pendingImpulse: Boolean(sim.pendingImpulse),
        pendingResizeBindGroup: sim.pendingResizeBindGroup ?? null,
        statsReadbackArmed: Boolean(sim.statsReadbackArmed),
        poseReadbackArmed: Boolean(sim.poseReadbackArmed),
    };
}

function restoreSimulationState(sim: any, state: PendingSimulationState): void {
    sim.n = state.n;
    sim.parity = state.parity;
    sim.predParity = state.predParity;
    sim.timeBank = state.timeBank;
    sim.simTime = state.simTime;
    sim.lastSubsteps = state.lastSubsteps;
    sim.lastAdvanced = state.lastAdvanced;
    sim.primePending = state.primePending;
    sim.pendingImpulse = state.pendingImpulse;
    sim.pendingResizeBindGroup = state.pendingResizeBindGroup;
    sim.statsReadbackArmed = state.statsReadbackArmed;
    sim.poseReadbackArmed = state.poseReadbackArmed;
}

function validateTargets(graph: FrameGraphRecording, color: TextureHandle, format: GPUTextureFormat, width: number, height: number): void {
    const desc = graph.getTextureDesc(color);
    if (desc.format !== format || (desc.sampleCount ?? 1) !== 1) {
        throw new Error('Particles4All color must match its single-sampled output format.');
    }
    const size = 'width' in desc.size ? [desc.size.width, desc.size.height ?? 1] : Array.from(desc.size);
    if (size[0] !== width || (size[1] ?? 1) !== height) throw new Error('Particles4All color dimensions must match the viewport.');
}

function axisName(axis: number): string {
    return axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
}

function destroyGpuMembers(owner: unknown, seen: Set<object>): void {
    if (!owner || typeof owner !== 'object') return;
    for (const value of Object.values(owner)) {
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        if (Array.isArray(value)) {
            value.forEach((entry) => {
                if (entry && typeof entry === 'object' && !seen.has(entry) && 'destroy' in entry) {
                    seen.add(entry);
                    (entry as { destroy(): void }).destroy();
                }
            });
            continue;
        }
        if ('destroy' in value && typeof (value as { destroy?: unknown }).destroy === 'function') {
            seen.add(value);
            (value as { destroy(): void }).destroy();
        }
    }
}

function pickBody(sim: any, origin: number[], direction: number[]): { body: number; t: number } {
    let bestBody = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < (sim.bodies?.length ?? 0); index++) {
        const body = sim.bodies[index];
        const pose = sim.bodyPose[index];
        const rotation = pose.rot;
        const worldOffset = origin.map((value, axis) => value - pose.centre[axis]);
        const localOrigin = [
            rotation[0] * worldOffset[0] + rotation[1] * worldOffset[1] + rotation[2] * worldOffset[2],
            rotation[3] * worldOffset[0] + rotation[4] * worldOffset[1] + rotation[5] * worldOffset[2],
            rotation[6] * worldOffset[0] + rotation[7] * worldOffset[1] + rotation[8] * worldOffset[2],
        ];
        const localDirection = [
            rotation[0] * direction[0] + rotation[1] * direction[1] + rotation[2] * direction[2],
            rotation[3] * direction[0] + rotation[4] * direction[1] + rotation[5] * direction[2],
            rotation[6] * direction[0] + rotation[7] * direction[1] + rotation[8] * direction[2],
        ];
        const half = halfExtent(body);
        let distance = -1;
        if (body.shape === 'box') {
            let near = Number.NEGATIVE_INFINITY;
            let far = Number.POSITIVE_INFINITY;
            let missed = false;
            for (let axis = 0; axis < 3; axis++) {
                if (Math.abs(localDirection[axis]) < 1e-9) {
                    if (localOrigin[axis] < -half[axis] || localOrigin[axis] > half[axis]) missed = true;
                    continue;
                }
                let a = (-half[axis] - localOrigin[axis]) / localDirection[axis];
                let b = (half[axis] - localOrigin[axis]) / localDirection[axis];
                if (a > b) [a, b] = [b, a];
                near = Math.max(near, a);
                far = Math.min(far, b);
            }
            if (!missed && far > Math.max(near, 0)) distance = near > 0 ? near : far;
        } else {
            const radius = body.shape === 'sphere' ? half[0] : half[0] + half[1];
            const projected = localOrigin[0] * localDirection[0]
                + localOrigin[1] * localDirection[1]
                + localOrigin[2] * localDirection[2];
            const constant = localOrigin[0] ** 2 + localOrigin[1] ** 2 + localOrigin[2] ** 2 - radius ** 2;
            const discriminant = projected ** 2 - constant;
            if (discriminant > 0) {
                const root = Math.sqrt(discriminant);
                const near = -projected - root;
                const far = -projected + root;
                if (far > 0) distance = near > 0 ? near : far;
            }
        }
        if (distance >= 0 && distance < bestDistance) {
            bestBody = index + 1;
            bestDistance = distance;
        }
    }
    return { body: bestBody, t: bestDistance };
}

function clampBodyTarget(wanted: number[], body: any, pose: any, box: number[]): number[] {
    const local = halfExtent(body);
    const half = body.shape === 'sphere'
        ? [local[0], local[0], local[0]]
        : body.shape === 'torus'
            ? [local[0] + local[1], local[1], local[0] + local[1]]
            : local;
    const rotation = pose.rot;
    return wanted.map((value, axis) => {
        const extent = Math.abs(rotation[axis]) * half[0]
            + Math.abs(rotation[3 + axis]) * half[1]
            + Math.abs(rotation[6 + axis]) * half[2];
        return Math.min(Math.max(value, extent), box[axis] - extent);
    });
}
