import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Particles4All } from './Particles4AllFeature.ts';
import type { Particles4AllSettings } from './particles4allTypes.ts';
import { parseImportedSettings } from './settings.ts';
import { installPointerControls } from './pointerControls.ts';
import environmentUrl from './assets/quarry_cloudy_1k.hdr?url';

type Workload = Pick<Particles4All, 'recordFrameGraph' | 'dispose' | 'resize' | 'getSettings' | 'setSettings'
    | 'getPresetSettings' | 'applyPreset' | 'applyImportedSettings' | 'reset' | 'resetCamera' | 'togglePour'
    | 'stopPour' | 'getStats' | 'loadEnvironment' | 'clearEnvironment' | 'beginBodyDrag' | 'updateBodyDrag'
    | 'endBodyDrag' | 'applyPointerImpulse' | 'orbit' | 'pan' | 'zoom'>;
export interface Particles4AllState {
    readonly ready: boolean;
    readonly status: string;
}
export interface StartParticles4AllOptions {
    readonly signal?: AbortSignal;
    readonly initialSettings?: Partial<Particles4AllSettings>;
    readonly onLoading?: (message: string) => void;
    readonly onReady?: (message?: string) => void;
    readonly onError?: (error: Error) => void;
    readonly onWarning?: (message: string) => void;
    readonly onStateChange?: (state: Particles4AllState) => void;
    /** False keeps the procedural sky; uploads remain available. */
    readonly loadDefaultEnvironment?: boolean;
}
export interface Particles4AllController extends Omit<Workload, 'recordFrameGraph' | 'resize'> {
    getState(): Particles4AllState;
    importSettings(text: string): ReturnType<typeof parseImportedSettings>;
    captureSnapshot(): Promise<FrameGraphSnapshot | undefined>;
}
interface PendingCapture {
    readonly promise: Promise<FrameGraphSnapshot | undefined>;
    readonly resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
}

/** Requests only the upstream shader requirements, including on standard eight-storage-buffer devices. */
export function particles4AllDeviceDescriptor(adapter: Pick<GPUAdapter, 'features' | 'limits'>): GPUDeviceDescriptor {
    const limits = adapter.limits;
    if (limits.maxStorageBuffersPerShaderStage < 8 || limits.maxComputeInvocationsPerWorkgroup < 256
        || limits.maxComputeWorkgroupSizeX < 256) {
        throw new Error('Particles4All requires eight storage buffers per shader stage and 256-thread workgroups.');
    }
    return {
        requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
        requiredLimits: {
            maxStorageBuffersPerShaderStage: 8,
            maxStorageBufferBindingSize: Math.min(2 ** 30, limits.maxStorageBufferBindingSize),
            maxBufferSize: Math.min(2 ** 30, limits.maxBufferSize),
            maxComputeInvocationsPerWorkgroup: 256,
            maxComputeWorkgroupSizeX: 256,
        },
    };
}

export async function startParticles4All(canvas: HTMLCanvasElement, options: StartParticles4AllOptions = {}): Promise<Particles4AllController> {
    options.signal?.throwIfAborted();
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    notify(() => options.onLoading?.('Requesting WebGPU device…'));
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    options.signal?.throwIfAborted();
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    const device = await adapter.requestDevice(particles4AllDeviceDescriptor(adapter));
    let context: GPUCanvasContext | null = null;
    let graph: FrameGraph | undefined;
    let workload: Particles4All | undefined;
    try {
        options.signal?.throwIfAborted();
        context = canvas.getContext('webgpu');
        if (!context) throw new Error('Unable to acquire a WebGPU canvas context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
        canvas.width = size.width;
        canvas.height = size.height;
        context.configure({ device, format, alphaMode: 'opaque' });
        notify(() => options.onLoading?.('Preparing fluid simulation and rendering pipelines…'));
        workload = new Particles4All({ device, viewport: size, outputFormat: format, initialSettings: options.initialSettings });
        graph = new FrameGraph(device);
        options.signal?.throwIfAborted();
        return createParticles4AllHost(canvas, device, context, graph, workload, options);
    } catch (error) {
        workload?.dispose();
        graph?.destroy();
        context?.unconfigure();
        device.destroy();
        throw error;
    }
}

/** Browser ownership boundary, exported from this module for lifecycle tests. */
export function createParticles4AllHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext,
    graph: FrameGraph, workload: Workload, options: StartParticles4AllOptions): Particles4AllController {
    const abort = new AbortController();
    let disposed = false;
    let frameId = 0;
    let frameIndex = 0;
    let previousTime: number | undefined;
    let pendingCapture: PendingCapture | undefined;
    let capturing: PendingCapture | undefined;
    let pageHidden = false;
    let environmentRevision = 0;
    let transientResourceKey: string | undefined;
    let ready = false;
    let status = 'Preparing first frame…';
    let observer: ResizeObserver | undefined;
    const getState = (): Particles4AllState => ({ ready, status });
    const changed = () => notify(() => options.onStateChange?.(getState()));
    const warn = (message: string) => {
        if (disposed) return;
        status = message;
        notify(() => options.onWarning?.(message));
        changed();
    };
    const settleCapture = () => {
        pendingCapture?.resolve(undefined);
        pendingCapture = undefined;
        capturing = undefined;
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        ++environmentRevision;
        abort.abort();
        options.signal?.removeEventListener('abort', dispose);
        cancelAnimationFrame(frameId);
        frameId = 0;
        observer?.disconnect();
        settleCapture();
        workload.dispose();
        graph.destroy();
        context.unconfigure();
        device.destroy();
    };
    const fail = (error: unknown) => {
        if (disposed) return;
        notify(() => options.onError?.(toError(error)));
        dispose();
    };
    const suspended = () => pageHidden || document.visibilityState === 'hidden';
    const requestFrame = () => {
        if (!disposed && !frameId && !suspended()) frameId = requestAnimationFrame(render);
    };
    const resize = () => {
        if (disposed) return;
        const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
        if (canvas.width === size.width && canvas.height === size.height) return;
        workload.resize(size.width, size.height);
        canvas.width = size.width;
        canvas.height = size.height;
        graph.clearResourcePool();
    };
    const finishCapture = async (capture: PendingCapture, compilation: FrameGraphCompilationReport,
        timing: Promise<FrameGraphGpuTimingReport>) => {
        const resourcePool = graph.getResourcePoolStats();
        try {
            const [gpuTiming, { createFrameGraphSnapshot }] = await Promise.all([timing, import('@zenfg/webgpu/snapshot')]);
            if (!disposed && pendingCapture === capture) capture.resolve(createFrameGraphSnapshot({ compilation, gpuTiming, resourcePool }));
        } catch {
            if (pendingCapture === capture) capture.resolve(undefined);
        } finally {
            if (pendingCapture === capture) pendingCapture = undefined;
            if (capturing === capture) capturing = undefined;
        }
    };
    function render(now: number): void {
        frameId = 0;
        if (disposed || suspended()) { settleCapture(); return; }
        let pending: ReturnType<Workload['recordFrameGraph']> | undefined;
        try {
            resize();
            // The workload applies timeScale after this browser-frame clamp, like upstream.
            const deltaTime = previousTime === undefined ? 0 : Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
            previousTime = now;
            const recording = graph.beginFrame();
            const color = recording.importSwapchainTexture(context.getCurrentTexture(), { label: 'particles4all.backbuffer' });
            pending = workload.recordFrameGraph(recording, { color, deltaTime });
            // Preparation can resize the simulation box or append particles. Its
            // actual descriptors are known here, before compile allocates resources.
            if (transientResourceKey !== undefined && transientResourceKey !== pending.transientResourceKey) graph.clearResourcePool();
            transientResourceKey = pending.transientResourceKey;
            recording.markPresent(color);
            const afterSubmit = (): undefined => { pending!.commit(); return undefined; };
            const capture = pendingCapture;
            if (capture && !capturing) {
                const compiled = recording.compile({ report: true });
                capturing = capture;
                const timing = compiled.execute({ frameIndex, afterSubmit, gpuTiming: true });
                void finishCapture(capture, compiled.compilationReport, timing);
            } else {
                recording.compile().execute({ frameIndex, afterSubmit });
            }
            frameIndex++;
            if (!ready) {
                ready = true;
                if (status === 'Preparing first frame…') status = 'Running';
                notify(() => options.onReady?.('Live · Particles4All simulation + ZenFG'));
                changed();
            }
        } catch (error) {
            pending?.discard();
            fail(error);
            return;
        }
        requestFrame();
    }
    const suspend = () => {
        cancelAnimationFrame(frameId);
        frameId = 0;
        previousTime = undefined;
        workload.endBodyDrag();
        settleCapture();
    };
    const resume = () => { previousTime = undefined; requestFrame(); };
    const active = () => { if (disposed) throw new Error('Particles4All host is disposed.'); };
    const mutate = (action: () => void, clearPool = false) => {
        active();
        action();
        if (clearPool) graph.clearResourcePool();
        changed();
    };
    const controller: Particles4AllController = {
        getState, getSettings: () => workload.getSettings(), getStats: () => workload.getStats(),
        getPresetSettings: (preset) => workload.getPresetSettings(preset),
        setSettings(patch) {
            mutate(() => workload.setSettings(patch));
        },
        applyPreset: (preset) => mutate(() => workload.applyPreset(preset), true),
        applyImportedSettings: (settings, overrides) => mutate(() => workload.applyImportedSettings(settings, overrides), true),
        reset: () => mutate(() => workload.reset(), true),
        resetCamera: () => mutate(() => workload.resetCamera()),
        togglePour: () => mutate(() => workload.togglePour()),
        stopPour: () => mutate(() => workload.stopPour()),
        beginBodyDrag: (...args) => workload.beginBodyDrag(...args),
        updateBodyDrag: (...args) => workload.updateBodyDrag(...args),
        endBodyDrag: () => workload.endBodyDrag(),
        applyPointerImpulse: (...args) => workload.applyPointerImpulse(...args),
        orbit: (...args) => workload.orbit(...args),
        pan: (...args) => workload.pan(...args),
        zoom: (...args) => workload.zoom(...args),
        importSettings(text) {
            active();
            const imported = parseImportedSettings(text, workload.getSettings().preset);
            controller.applyImportedSettings(imported.settings, imported.sceneOverrides);
            const warnings = [
                imported.skipped.length ? `Unsupported INI fields: ${imported.skipped.join(', ')}` : '',
                imported.missingPanorama ? `Load the INI panorama separately: ${imported.missingPanorama}` : '',
            ].filter(Boolean);
            status = warnings.join(' · ') || 'INI settings loaded';
            if (warnings.length) notify(() => options.onWarning?.(status));
            changed();
            return imported;
        },
        async loadEnvironment(source) {
            active();
            const revision = ++environmentRevision;
            status = 'Loading environment…'; changed();
            try {
                await workload.loadEnvironment(source);
                if (disposed || revision !== environmentRevision) return;
                status = 'Environment loaded'; changed();
            } catch (error) {
                if (disposed || revision !== environmentRevision) return;
                warn(`Environment load failed: ${toError(error).message}`);
            }
        },
        clearEnvironment() {
            active(); ++environmentRevision;
            workload.clearEnvironment(); status = 'Procedural sky'; changed();
        },
        captureSnapshot() {
            if (disposed || suspended()) return Promise.resolve(undefined);
            if (pendingCapture) return pendingCapture.promise;
            let resolve!: PendingCapture['resolve'];
            const promise = new Promise<FrameGraphSnapshot | undefined>((done) => { resolve = done; });
            pendingCapture = { promise, resolve };
            requestFrame();
            return promise;
        },
        dispose,
    };
    installPointerControls(canvas, controller, abort.signal, changed);
    window.addEventListener('resize', () => { try { resize(); } catch (error) { fail(error); } }, { signal: abort.signal });
    window.addEventListener('pagehide', () => { pageHidden = true; suspend(); }, { signal: abort.signal });
    window.addEventListener('pageshow', () => { pageHidden = false; resume(); }, { signal: abort.signal });
    document.addEventListener('visibilitychange', () => { if (suspended()) suspend(); else resume(); }, { signal: abort.signal });
    device.addEventListener('uncapturederror', (event) => fail(event.error), { signal: abort.signal });
    void device.lost.then((info) => fail(new Error(`WebGPU device lost: ${info.message || info.reason}`)));
    observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { try { resize(); } catch (error) { fail(error); } });
    observer?.observe(canvas);
    options.signal?.addEventListener('abort', dispose, { once: true });
    if (options.signal?.aborted) dispose();
    if (!disposed) {
        requestFrame();
        if (options.loadDefaultEnvironment !== false) void controller.loadEnvironment(environmentUrl);
    }
    return controller;
}

export function resolveCanvasBackingSize(canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight' | 'getBoundingClientRect'>,
    devicePixelRatio: number, maxTextureDimension2D: number): { width: number; height: number } {
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(2, Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
    const width = Math.max(1, Math.round((bounds.width || canvas.clientWidth || 1) * dpr));
    const height = Math.max(1, Math.round((bounds.height || canvas.clientHeight || 1) * dpr));
    const scale = Math.min(1, maxTextureDimension2D / width, maxTextureDimension2D / height);
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
function notify(callback: () => void): void { try { callback(); } catch { /* Notifications do not own rendering. */ } }
function toError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
