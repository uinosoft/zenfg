import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import environmentUrl from './assets/quarry_cloudy_1k.hdr?url';
import { Particles4All } from './Particles4AllFeature.ts';
import type { Particles4AllSettings } from './particles4allTypes.ts';
import { installPointerControls } from './pointerControls.ts';
import { parseImportedSettings } from './settings.ts';

export type Workload = Pick<Particles4All, 'recordFrameGraph' | 'dispose' | 'resize' | 'getSettings' | 'setSettings'
    | 'getPresetSettings' | 'applyPreset' | 'applyImportedSettings' | 'reset' | 'resetCamera' | 'togglePour'
    | 'stopPour' | 'getStats' | 'loadEnvironment' | 'clearEnvironment' | 'beginBodyDrag' | 'updateBodyDrag'
    | 'endBodyDrag' | 'applyPointerImpulse' | 'orbit' | 'pan' | 'zoom'>;

export interface Particles4AllState {
    readonly paused: boolean;
    readonly ready: boolean;
    readonly status: string;
}

export interface StartParticles4AllOptions {
    readonly signal?: AbortSignal;
    readonly initialSettings?: Partial<Particles4AllSettings>;
    readonly onLoading?: (message: string) => void;
    /** Called after a frame is submitted; observational only. */
    readonly onFrame?: () => void;
    readonly onReady?: (message?: string) => void;
    readonly onError?: (error: Error) => void;
    readonly onWarning?: (message?: string) => void;
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

export function resolveCanvasBackingSize(canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight' | 'getBoundingClientRect'>,
    devicePixelRatio: number, maxTextureDimension2D: number): { width: number; height: number } {
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(2, Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
    const width = Math.max(1, Math.round((bounds.width || canvas.clientWidth || 1) * dpr));
    const height = Math.max(1, Math.round((bounds.height || canvas.clientHeight || 1) * dpr));
    const scale = Math.min(1, maxTextureDimension2D / width, maxTextureDimension2D / height);
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function notify(callback: () => void): void { try { callback(); } catch { /* Notifications do not own rendering. */ } }

export function toError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }

/** Browser inputs, asynchronous preparation and lifecycle for this example. */
export function createHostSupport(canvas: HTMLCanvasElement, device: GPUDevice, graph: FrameGraph, workload: Workload, options: StartParticles4AllOptions,
    render: (now: number) => void, release: () => void) {
    const abort = new AbortController();
    const frameState = {
        disposed: false,
        frameId: 0,
        frameIndex: 0,
        previousTime: undefined as number | undefined,
        pendingCapture: undefined as PendingCapture | undefined,
        capturing: undefined as PendingCapture | undefined,
        transientResourceKey: undefined as string | undefined,
        ready: false,
        status: 'Preparing first frame…',
    };
    let pageHidden = false;
    let environmentRevision = 0;
    let observer: ResizeObserver | undefined;
    const getState = (): Particles4AllState => ({ ready: frameState.ready, status: frameState.status, paused: workload.getSettings().paused });
    const changed = () => notify(() => options.onStateChange?.(getState()));
    const setWarning = (message?: string) => {
        notify(() => options.onWarning?.(message));
    };
    const warn = (message: string) => {
        if (frameState.disposed) return;
        frameState.status = message;
        setWarning(message);
        changed();
    };
    const settleCapture = () => {
        frameState.pendingCapture?.resolve(undefined);
        frameState.pendingCapture = undefined;
        frameState.capturing = undefined;
    };
    const dispose = () => {
        if (frameState.disposed) return;
        frameState.disposed = true;
        ++environmentRevision;
        abort.abort();
        options.signal?.removeEventListener('abort', dispose);
        cancelAnimationFrame(frameState.frameId);
        frameState.frameId = 0;
        observer?.disconnect();
        settleCapture();
        release();
    };
    const fail = (error: unknown) => {
        if (frameState.disposed) return;
        notify(() => options.onError?.(toError(error)));
        dispose();
    };
    const suspended = () => pageHidden || document.visibilityState === 'hidden';
    const requestFrame = () => {
        if (!frameState.disposed && !frameState.frameId && !suspended()) frameState.frameId = requestAnimationFrame(render);
    };
    const resize = () => {
        if (frameState.disposed) return;
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
            if (!frameState.disposed && frameState.pendingCapture === capture) capture.resolve(createFrameGraphSnapshot({ compilation, gpuTiming, resourcePool }));
        } catch {
            if (frameState.pendingCapture === capture) capture.resolve(undefined);
        } finally {
            if (frameState.pendingCapture === capture) frameState.pendingCapture = undefined;
            if (frameState.capturing === capture) frameState.capturing = undefined;
        }
    };
    const suspend = () => {
        cancelAnimationFrame(frameState.frameId);
        frameState.frameId = 0;
        frameState.previousTime = undefined;
        workload.endBodyDrag();
        settleCapture();
    };
    const resume = () => { frameState.previousTime = undefined; requestFrame(); };
    const active = () => { if (frameState.disposed) throw new Error('Particles4All host is disposed.'); };
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
            frameState.status = warnings.join(' · ') || 'INI settings loaded';
            setWarning(warnings.join(' · ') || undefined);
            changed();
            return imported;
        },
        async loadEnvironment(source) {
            active();
            const revision = ++environmentRevision;
            frameState.status = 'Loading environment…'; changed();
            try {
                await workload.loadEnvironment(source);
                if (frameState.disposed || revision !== environmentRevision) return;
                setWarning();
                frameState.status = 'Environment loaded'; changed();
            } catch (error) {
                if (frameState.disposed || revision !== environmentRevision) return;
                warn(`Environment load failed: ${toError(error).message}`);
            }
        },
        clearEnvironment() {
            active(); ++environmentRevision;
            workload.clearEnvironment(); setWarning(); frameState.status = 'Procedural sky'; changed();
        },
        captureSnapshot() {
            if (frameState.disposed || suspended()) return Promise.resolve(undefined);
            if (frameState.pendingCapture) return frameState.pendingCapture.promise;
            let resolve!: PendingCapture['resolve'];
            const promise = new Promise<FrameGraphSnapshot | undefined>((done) => { resolve = done; });
            frameState.pendingCapture = { promise, resolve };
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
    if (!frameState.disposed) {
        requestFrame();
        if (options.loadDefaultEnvironment !== false) void controller.loadEnvironment(environmentUrl);
    }
    return { frameState, controller, suspended, settleCapture, resize, finishCapture, changed, fail, requestFrame };
}
