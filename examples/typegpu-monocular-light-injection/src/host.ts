import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import { MonocularCameraSession, type CameraFacing, type MonocularCameraFrame } from './camera-session.ts';
import { LatestTransition } from './latest-transition.ts';
import { setupLightInput } from './light-input.ts';
import { cachingEnabled, clearDownloads, fetchModel, isModelCached, modelLabel, modelVariant, setCachingEnabled, type ModelSize } from './model-store.ts';
import { type MonocularLightInjectionWorkload } from './monocularLightInjection.ts';
import type { MonocularLightInjectionSettings } from './types.ts';

const DEMO_IMAGE_URL = 'https://raw.githubusercontent.com/software-mansion/TypeGPU/2adbc1b3636f2c7c1be00d242171e23c85c73898/apps/typegpu-docs/public/assets/depthart/demo.jpg';

export type SourceMode = 'demo' | 'camera' | 'upload';

export interface MonocularState {
    readonly model: ModelSize;
    readonly source: SourceMode;
    readonly camera: CameraFacing;
    readonly busy: boolean;
    readonly ready: boolean;
    readonly status: string;
    readonly cacheModels: boolean;
    readonly cached: boolean;
    readonly shaderF16: boolean;
}

export interface StartMonocularOptions {
    readonly signal?: AbortSignal;
    readonly onStateChange?: (state: MonocularState) => void;
    readonly onLoading?: (message: string) => void;
    readonly onReady?: (message?: string) => void;
    readonly onError?: (error: Error) => void;
}

export interface MonocularController {
    getState(): MonocularState;
    getSettings(): Readonly<MonocularLightInjectionSettings>;
    setSettings(patch: Partial<MonocularLightInjectionSettings>): void;
    selectModel(size: ModelSize): Promise<void>;
    selectSource(source: SourceMode): Promise<void>;
    selectCamera(facing: CameraFacing): Promise<void>;
    uploadImage(file: Blob): Promise<void>;
    setCacheEnabled(enabled: boolean): void;
    clearDownloads(): Promise<void>;
    /** Waits for the next capturable frame, including asynchronous preparation; settles on failure or suspension. */
    captureSnapshot(): Promise<FrameGraphSnapshot | undefined>;
    dispose(): void;
}

/** Browser inputs, asynchronous preparation and lifecycle for this example. */
export function createHostSupport(canvas: HTMLCanvasElement, device: GPUDevice, graph: FrameGraph, workload: MonocularLightInjectionWorkload, options: StartMonocularOptions,
    render: (frame: MonocularCameraFrame, updateDepth: boolean) => boolean, release: () => void) {
    const abort = new AbortController();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.hidden = true;
    video.setAttribute('aria-hidden', 'true');
    document.body.append(video);
    const transition = new LatestTransition<SourceMode>('demo');
    const frameState = {
        disposed: false,
        pageHidden: false,
        frameIndex: 0,
        depthDirty: true,
        modelBusy: false,
        preparingUpload: 0,
        reportedReady: false,
        sourceBusy: false,
        capturesInFlight: new Set<(value: FrameGraphSnapshot | undefined) => void>(),
        capture: undefined as { promise: Promise<FrameGraphSnapshot | undefined>; resolve: (value: FrameGraphSnapshot | undefined) => void } | undefined,
        state: {
            model: 'small', source: 'demo', camera: 'user', busy: false, ready: false,
            status: 'Preparing', cacheModels: cachingEnabled(), cached: false, shaderF16: device.features.has('shader-f16'),
        } as MonocularState,
    };
    let initializing = true;
    let animationFrame = 0;
    let uploadGeneration = 0;
    let demo: ImageBitmap | undefined;
    let uploaded: ImageBitmap | undefined;
    let activeImage: ImageBitmap | undefined;
    let sourceGeneration = 0;
    const publish = (patch: Partial<MonocularState>) => {
        if (frameState.disposed) return;
        frameState.state = { ...frameState.state, ...patch };
        options.onStateChange?.({ ...frameState.state });
    };
    const fail = (error: unknown) => {
        if (frameState.disposed) return;
        const normalized = error instanceof Error ? error : new Error(String(error));
        publish({ status: normalized.message });
        options.onError?.(normalized);
        settleCapture();
    };
    const settleCapture = () => {
        frameState.capture?.resolve(undefined); frameState.capture = undefined;
        for (const resolve of frameState.capturesInFlight) resolve(undefined);
        frameState.capturesInFlight.clear();
    };
    const canAwaitFrame = () => initializing || frameState.modelBusy || frameState.sourceBusy || frameState.preparingUpload !== 0
        || (frameState.state.ready && Boolean(activeImage || camera.active));
    const light = setupLightInput(canvas, workload.getSettings(), (patch) => workload.setSettings(patch), abort.signal);
    const resize = () => {
        const bounds = canvas.getBoundingClientRect();
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const width = Math.max(1, Math.round((bounds.width || canvas.clientWidth || 1) * dpr));
        const height = Math.max(1, Math.round((bounds.height || canvas.clientHeight || 1) * dpr));
        const scale = Math.min(1, device.limits.maxTextureDimension2D / width, device.limits.maxTextureDimension2D / height);
        const w = Math.max(1, Math.floor(width * scale));
        const h = Math.max(1, Math.floor(height * scale));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    };
    const stopStatic = () => { cancelAnimationFrame(animationFrame); animationFrame = 0; activeImage = undefined; };
    const requestStatic = () => {
        if (frameState.disposed || frameState.pageHidden || animationFrame || !activeImage || document.visibilityState === 'hidden') return;
        animationFrame = requestAnimationFrame(() => {
            animationFrame = 0;
            if (frameState.disposed || !activeImage) return;
            let frame: VideoFrame | undefined;
            try {
                frame = new VideoFrame(activeImage, { timestamp: Math.round(performance.now() * 1000) });
                render({ source: frame, uvTransform: [1, 0, 0, 1], swapAxes: false }, frameState.depthDirty);
            } catch (error) { fail(error); }
            finally { frame?.close(); }
            requestStatic();
        });
    };
    const camera = new MonocularCameraSession(video, {
        onFrame: (frame) => { if (transition.committed === 'camera') render(frame, true); },
        onError: fail,
        onEnded: () => fail(new Error('The camera stream ended. Select a source to resume.')),
    }, 'user');

    const controller: MonocularController = {
        getState: () => ({ ...frameState.state }),
        getSettings: () => workload.getSettings(),
        setSettings: (patch) => { if (!frameState.disposed) workload.setSettings(patch); },
        async selectModel(size) {
            if (frameState.disposed || frameState.modelBusy || frameState.sourceBusy || frameState.preparingUpload) return;
            const variant = modelVariant(size, frameState.state.shaderF16);
            if (!variant) { fail(new Error(`${size} requires shader-f16 support.`)); return; }
            frameState.modelBusy = true;
            const previousReadyNotification = frameState.reportedReady;
            frameState.reportedReady = false;
            publish({ busy: true, status: `Downloading ${modelLabel(size, variant)}` });
            options.onLoading?.(frameState.state.status);
            try {
                const bytes = await fetchModel(variant, abort.signal);
                if (frameState.disposed) return;
                publish({ status: `Compiling ${modelLabel(size, variant)}` });
                options.onLoading?.(frameState.state.status);
                await workload.setModelBundle(bytes);
                if (frameState.disposed) return;
                frameState.depthDirty = true;
                publish({ model: size, ready: true, cached: await isModelCached(variant), status: `Ready · ${size}` });
            } catch (error) {
                frameState.reportedReady = previousReadyNotification;
                fail(error);
            }
            finally { frameState.modelBusy = false; publish({ busy: frameState.sourceBusy || frameState.preparingUpload !== 0 }); }
            if (frameState.disposed || !frameState.state.ready) return;
            if (!activeImage && transition.committed !== 'camera') await controller.selectSource(frameState.state.source);
        },
        async selectSource(source) {
            if (frameState.disposed || frameState.modelBusy) return;
            const token = transition.begin(source);
            sourceGeneration += 1;
            frameState.preparingUpload = 0;
            frameState.sourceBusy = true;
            // Cancel a pending camera request when a newer static source is requested.
            if (source !== 'camera' && transition.committed !== 'camera') camera.stop();
            publish({ busy: true, status: `Preparing ${source}…` });
            options.onLoading?.(frameState.state.status);
            try {
                if (source === 'camera') {
                    const started = await camera.start(frameState.state.camera);
                    if (!started || !transition.isCurrent(token) || frameState.disposed) return;
                    stopStatic();
                    workload.setSettings({ mirror: camera.facingMode === 'user' });
                } else {
                    let bitmap = source === 'upload' ? uploaded : demo;
                    if (source === 'demo' && !bitmap) {
                        const response = await fetch(DEMO_IMAGE_URL, { signal: abort.signal });
                        if (!response.ok) throw new Error(`Demo photo download failed (${response.status}).`);
                        bitmap = await createImageBitmap(await response.blob());
                        if (!transition.isCurrent(token) || frameState.disposed) { bitmap.close(); return; }
                        demo = bitmap;
                    }
                    if (!bitmap) throw new Error('Choose an image first.');
                    if (!transition.isCurrent(token) || frameState.disposed) return;
                    camera.stop();
                    stopStatic();
                    activeImage = bitmap;
                    workload.setSettings({ mirror: false });
                    requestStatic();
                }
                if (frameState.state.ready) workload.resetHistory();
                frameState.depthDirty = true;
                frameState.reportedReady = false;
                transition.commit(token);
                publish({ source, status: frameState.state.ready ? 'Preparing frame…' : 'Load a model to start' });
            } catch (error) { if (transition.isCurrent(token)) fail(error); }
            finally {
                if (transition.isCurrent(token)) { frameState.sourceBusy = false; publish({ busy: frameState.modelBusy || frameState.preparingUpload !== 0 }); }
            }
        },
        async selectCamera(facing) {
            if (frameState.disposed || frameState.state.busy) return;
            if (frameState.state.source !== 'camera') { publish({ camera: facing }); return; }
            const previous = frameState.state.camera;
            publish({ camera: facing });
            await controller.selectSource('camera');
            if (camera.facingMode !== facing) publish({ camera: previous });
        },
        async uploadImage(file) {
            if (frameState.disposed || frameState.modelBusy) return;
            const generation = ++uploadGeneration;
            frameState.preparingUpload = generation;
            const sourceAtStart = sourceGeneration;
            publish({ busy: true, status: 'Preparing upload…' });
            options.onLoading?.(frameState.state.status);
            try {
                const next = await createImageBitmap(file);
                if (frameState.disposed || generation !== uploadGeneration || sourceAtStart !== sourceGeneration) { next.close(); return; }
                const previous = uploaded;
                uploaded = next;
                await controller.selectSource('upload');
                if (activeImage !== previous) previous?.close();
            } catch (error) {
                if (generation === uploadGeneration && sourceAtStart === sourceGeneration) fail(error);
            } finally {
                if (frameState.preparingUpload === generation) {
                    frameState.preparingUpload = 0;
                    publish({ busy: frameState.modelBusy || frameState.sourceBusy });
                }
                if (!canAwaitFrame()) settleCapture();
            }
        },
        setCacheEnabled(enabled) { setCachingEnabled(enabled); publish({ cacheModels: enabled }); },
        async clearDownloads() {
            await clearDownloads();
            const variant = modelVariant(frameState.state.model, frameState.state.shaderF16)!;
            publish({ cached: await isModelCached(variant) });
        },
        captureSnapshot() {
            if (frameState.disposed || frameState.pageHidden || document.visibilityState === 'hidden' || !canAwaitFrame()) return Promise.resolve(undefined);
            if (frameState.capture) return frameState.capture.promise;
            let resolve!: (value: FrameGraphSnapshot | undefined) => void;
            const promise = new Promise<FrameGraphSnapshot | undefined>((done) => { resolve = done; });
            frameState.capture = { promise, resolve };
            requestStatic();
            return promise;
        },
        dispose() {
            if (frameState.disposed) return;
            frameState.disposed = true;
            transition.invalidate();
            uploadGeneration += 1;
            abort.abort();
            options.signal?.removeEventListener('abort', controller.dispose);
            stopStatic();
            camera.destroy();
            video.remove();
            demo?.close();
            uploaded?.close();
            settleCapture();
            release();
        },
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') settleCapture();
        else requestStatic();
    }, { signal: abort.signal });
    window.addEventListener('pagehide', () => {
        frameState.pageHidden = true;
        camera.stop();
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        settleCapture();
    }, { signal: abort.signal });
    window.addEventListener('pageshow', (event) => {
        frameState.pageHidden = false;
        if (!event.persisted || frameState.disposed) return;
        if (frameState.state.source === 'camera') void controller.selectSource('camera');
        else requestStatic();
    }, { signal: abort.signal });
    device.addEventListener('uncapturederror', (event) => { fail(new Error(event.error.message)); controller.dispose(); }, { signal: abort.signal });
    void device.lost.then((info) => {
        if (!frameState.disposed) { fail(new Error(`WebGPU device lost: ${info.message || info.reason}`)); controller.dispose(); }
    });
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    // Preserve requests across the model -> default source initialization handoff.
    void controller.selectModel('small').finally(() => {
        initializing = false;
        if (!canAwaitFrame()) settleCapture();
    });
    function finishCapture(requested: NonNullable<typeof frameState.capture>,
        compilation: FrameGraphCompilationReport, timing: Promise<FrameGraphGpuTimingReport>): Promise<void> {
        return Promise.all([timing, import('@zenfg/webgpu/snapshot')]).then(([gpuTiming, { createFrameGraphSnapshot }]) => {
            if (!frameState.capturesInFlight.has(requested.resolve)) return;
            requested.resolve(frameState.disposed ? undefined : createFrameGraphSnapshot({
                compilation: compilation, gpuTiming, resourcePool: graph.getResourcePoolStats(),
            }));
        }).catch(() => requested.resolve(undefined)).finally(() => frameState.capturesInFlight.delete(requested.resolve));
    }
    return { frameState, controller, resize, fail, publish, light, finishCapture };
}
