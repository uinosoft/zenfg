import { FrameGraph } from '@zenfg/webgpu';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { createMonocularLightInjection, type MonocularLightInjectionWorkload } from './monocularLightInjection.ts';
import type { MonocularLightInjectionSettings, PendingMonocularFrame } from './types.ts';
import { MonocularCameraSession, type CameraFacing, type MonocularCameraFrame } from './camera-session.ts';
import { LatestTransition } from './latest-transition.ts';
import { setupLightInput } from './light-input.ts';
import { cachingEnabled, clearDownloads, fetchModel, isModelCached, modelLabel, modelVariant, setCachingEnabled, type ModelSize } from './model-store.ts';

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

/** Starts the browser host without waiting for network-dependent initialization. */
export async function startMonocularLightInjection(canvas: HTMLCanvasElement, options: StartMonocularOptions = {}): Promise<MonocularController> {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    if (typeof VideoFrame === 'undefined') throw new Error('This example requires VideoFrame support for still images.');
    options.signal?.throwIfAborted();
    options.onLoading?.('Requesting WebGPU device…');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    options.signal?.throwIfAborted();
    const requiredFeatures: GPUFeatureName[] = [];
    for (const feature of ['shader-f16', 'timestamp-query'] as const) {
        if (adapter.features.has(feature)) requiredFeatures.push(feature);
    }
    const device = await adapter.requestDevice({ requiredFeatures });
    const cancelInitialization = () => device.destroy();
    options.signal?.addEventListener('abort', cancelInitialization, { once: true });
    let context: GPUCanvasContext | null = null;
    let workload: MonocularLightInjectionWorkload | undefined;
    let graph: FrameGraph | undefined;
    try {
        options.signal?.throwIfAborted();
        context = canvas.getContext('webgpu');
        if (!context) throw new Error('Unable to acquire a WebGPU canvas context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        options.onLoading?.('Preparing lighting pipelines…');
        workload = await createMonocularLightInjection({ device, outputFormat: format });
        options.signal?.throwIfAborted();
        graph = new FrameGraph(device);
        return createBrowserHost(canvas, device, context, graph, workload, options);
    } catch (error) {
        workload?.dispose();
        graph?.destroy();
        context?.unconfigure();
        device.destroy();
        throw error;
    } finally {
        options.signal?.removeEventListener('abort', cancelInitialization);
    }
}

function createBrowserHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    workload: MonocularLightInjectionWorkload, options: StartMonocularOptions): MonocularController {
    const abort = new AbortController();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.hidden = true;
    video.setAttribute('aria-hidden', 'true');
    document.body.append(video);
    const transition = new LatestTransition<SourceMode>('demo');
    let disposed = false;
    let pageHidden = false;
    let initializing = true;
    let animationFrame = 0;
    let frameIndex = 0;
    let depthDirty = true;
    let modelBusy = false;
    let uploadGeneration = 0;
    let preparingUpload = 0;
    let demo: ImageBitmap | undefined;
    let uploaded: ImageBitmap | undefined;
    let activeImage: ImageBitmap | undefined;
    let reportedReady = false;
    let sourceBusy = false;
    let sourceGeneration = 0;
    const capturesInFlight = new Set<(value: FrameGraphSnapshot | undefined) => void>();
    let capture: { promise: Promise<FrameGraphSnapshot | undefined>; resolve: (value: FrameGraphSnapshot | undefined) => void } | undefined;
    let state: MonocularState = {
        model: 'small', source: 'demo', camera: 'user', busy: false, ready: false,
        status: 'Preparing', cacheModels: cachingEnabled(), cached: false, shaderF16: device.features.has('shader-f16'),
    };
    const publish = (patch: Partial<MonocularState>) => {
        if (disposed) return;
        state = { ...state, ...patch };
        options.onStateChange?.({ ...state });
    };
    const fail = (error: unknown) => {
        if (disposed) return;
        const normalized = error instanceof Error ? error : new Error(String(error));
        publish({ status: normalized.message });
        options.onError?.(normalized);
        settleCapture();
    };
    const settleCapture = () => {
        capture?.resolve(undefined); capture = undefined;
        for (const resolve of capturesInFlight) resolve(undefined);
        capturesInFlight.clear();
    };
    const canAwaitFrame = () => initializing || modelBusy || sourceBusy || preparingUpload !== 0
        || (state.ready && Boolean(activeImage || camera.active));
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
    const render = (frame: MonocularCameraFrame, updateDepth: boolean): boolean => {
        if (disposed || pageHidden || modelBusy || !state.ready || document.visibilityState === 'hidden') return false;
        let pending: PendingMonocularFrame | undefined;
        try {
            resize();
            light.orbitTick();
            const recording = graph.beginFrame();
            const color = recording.importSwapchainTexture(context.getCurrentTexture(), { label: 'monocular.backbuffer' });
            pending = workload.recordFrame(recording, { ...frame, color, updateDepth });
            recording.markPresent(color);
            // Keep displaying the committed source while its replacement prepares,
            // but bind a waiting capture only after the latest source is installed.
            const requested = sourceBusy || preparingUpload ? undefined : capture;
            const afterSubmit = (): undefined => { pending!.commit(); depthDirty = false; return undefined; };
            if (requested || !reportedReady) {
                const compiled = recording.compile({ report: true });
                canvas.dataset.frameGraph = compiled.compilationReport.nodes.map((node) => node.label).join(' → ');
                canvas.dataset.frameGraphPasses = String(compiled.compilationReport.nodes.length);
                if (requested) {
                    capturesInFlight.add(requested.resolve);
                    const timing = compiled.execute({ frameIndex: frameIndex++, afterSubmit, gpuTiming: true });
                    capture = undefined;
                    void Promise.all([timing, import('@zenfg/webgpu/snapshot')]).then(([gpuTiming, { createFrameGraphSnapshot }]) => {
                        if (!capturesInFlight.has(requested.resolve)) return;
                        requested.resolve(disposed ? undefined : createFrameGraphSnapshot({
                            compilation: compiled.compilationReport, gpuTiming, resourcePool: graph.getResourcePoolStats(),
                        }));
                    }).catch(() => requested.resolve(undefined)).finally(() => capturesInFlight.delete(requested.resolve));
                } else compiled.execute({ frameIndex: frameIndex++, afterSubmit });
            } else recording.compile().execute({ frameIndex: frameIndex++, afterSubmit });
            if (!reportedReady) {
                reportedReady = true;
                publish({ status: `Live · ${state.model}` });
                options.onReady?.('Live · TypeGPU depth inference + ZenFG');
            }
            return true;
        } catch (error) {
            pending?.discard();
            fail(error);
            return false;
        }
    };
    const stopStatic = () => { cancelAnimationFrame(animationFrame); animationFrame = 0; activeImage = undefined; };
    const requestStatic = () => {
        if (disposed || pageHidden || animationFrame || !activeImage || document.visibilityState === 'hidden') return;
        animationFrame = requestAnimationFrame(() => {
            animationFrame = 0;
            if (disposed || !activeImage) return;
            let frame: VideoFrame | undefined;
            try {
                frame = new VideoFrame(activeImage, { timestamp: Math.round(performance.now() * 1000) });
                render({ source: frame, uvTransform: [1, 0, 0, 1], swapAxes: false }, depthDirty);
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
        getState: () => ({ ...state }),
        getSettings: () => workload.getSettings(),
        setSettings: (patch) => { if (!disposed) workload.setSettings(patch); },
        async selectModel(size) {
            if (disposed || modelBusy || sourceBusy || preparingUpload) return;
            const variant = modelVariant(size, state.shaderF16);
            if (!variant) { fail(new Error(`${size} requires shader-f16 support.`)); return; }
            modelBusy = true;
            const previousReadyNotification = reportedReady;
            reportedReady = false;
            publish({ busy: true, status: `Downloading ${modelLabel(size, variant)}` });
            options.onLoading?.(state.status);
            try {
                const bytes = await fetchModel(variant, abort.signal);
                if (disposed) return;
                publish({ status: `Compiling ${modelLabel(size, variant)}` });
                options.onLoading?.(state.status);
                await workload.setModelBundle(bytes);
                if (disposed) return;
                depthDirty = true;
                publish({ model: size, ready: true, cached: await isModelCached(variant), status: `Ready · ${size}` });
            } catch (error) {
                reportedReady = previousReadyNotification;
                fail(error);
            }
            finally { modelBusy = false; publish({ busy: sourceBusy || preparingUpload !== 0 }); }
            if (disposed || !state.ready) return;
            if (!activeImage && transition.committed !== 'camera') await controller.selectSource(state.source);
        },
        async selectSource(source) {
            if (disposed || modelBusy) return;
            const token = transition.begin(source);
            sourceGeneration += 1;
            preparingUpload = 0;
            sourceBusy = true;
            // Cancel a pending camera request when a newer static source is requested.
            if (source !== 'camera' && transition.committed !== 'camera') camera.stop();
            publish({ busy: true, status: `Preparing ${source}…` });
            options.onLoading?.(state.status);
            try {
                if (source === 'camera') {
                    const started = await camera.start(state.camera);
                    if (!started || !transition.isCurrent(token) || disposed) return;
                    stopStatic();
                    workload.setSettings({ mirror: camera.facingMode === 'user' });
                } else {
                    let bitmap = source === 'upload' ? uploaded : demo;
                    if (source === 'demo' && !bitmap) {
                        const response = await fetch(DEMO_IMAGE_URL, { signal: abort.signal });
                        if (!response.ok) throw new Error(`Demo photo download failed (${response.status}).`);
                        bitmap = await createImageBitmap(await response.blob());
                        if (!transition.isCurrent(token) || disposed) { bitmap.close(); return; }
                        demo = bitmap;
                    }
                    if (!bitmap) throw new Error('Choose an image first.');
                    if (!transition.isCurrent(token) || disposed) return;
                    camera.stop();
                    stopStatic();
                    activeImage = bitmap;
                    workload.setSettings({ mirror: false });
                    requestStatic();
                }
                if (state.ready) workload.resetHistory();
                depthDirty = true;
                reportedReady = false;
                transition.commit(token);
                publish({ source, status: state.ready ? 'Preparing frame…' : 'Load a model to start' });
            } catch (error) { if (transition.isCurrent(token)) fail(error); }
            finally {
                if (transition.isCurrent(token)) { sourceBusy = false; publish({ busy: modelBusy || preparingUpload !== 0 }); }
            }
        },
        async selectCamera(facing) {
            if (disposed || state.busy) return;
            if (state.source !== 'camera') { publish({ camera: facing }); return; }
            const previous = state.camera;
            publish({ camera: facing });
            await controller.selectSource('camera');
            if (camera.facingMode !== facing) publish({ camera: previous });
        },
        async uploadImage(file) {
            if (disposed || modelBusy) return;
            const generation = ++uploadGeneration;
            preparingUpload = generation;
            const sourceAtStart = sourceGeneration;
            publish({ busy: true, status: 'Preparing upload…' });
            options.onLoading?.(state.status);
            try {
                const next = await createImageBitmap(file);
                if (disposed || generation !== uploadGeneration || sourceAtStart !== sourceGeneration) { next.close(); return; }
                const previous = uploaded;
                uploaded = next;
                await controller.selectSource('upload');
                if (activeImage !== previous) previous?.close();
            } catch (error) {
                if (generation === uploadGeneration && sourceAtStart === sourceGeneration) fail(error);
            } finally {
                if (preparingUpload === generation) {
                    preparingUpload = 0;
                    publish({ busy: modelBusy || sourceBusy });
                }
                if (!canAwaitFrame()) settleCapture();
            }
        },
        setCacheEnabled(enabled) { setCachingEnabled(enabled); publish({ cacheModels: enabled }); },
        async clearDownloads() {
            await clearDownloads();
            const variant = modelVariant(state.model, state.shaderF16)!;
            publish({ cached: await isModelCached(variant) });
        },
        captureSnapshot() {
            if (disposed || pageHidden || document.visibilityState === 'hidden' || !canAwaitFrame()) return Promise.resolve(undefined);
            if (capture) return capture.promise;
            let resolve!: (value: FrameGraphSnapshot | undefined) => void;
            const promise = new Promise<FrameGraphSnapshot | undefined>((done) => { resolve = done; });
            capture = { promise, resolve };
            requestStatic();
            return promise;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
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
            workload.dispose();
            graph.destroy();
            context.unconfigure();
            device.destroy();
        },
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') settleCapture();
        else requestStatic();
    }, { signal: abort.signal });
    window.addEventListener('pagehide', () => {
        pageHidden = true;
        camera.stop();
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        settleCapture();
    }, { signal: abort.signal });
    window.addEventListener('pageshow', (event) => {
        pageHidden = false;
        if (!event.persisted || disposed) return;
        if (state.source === 'camera') void controller.selectSource('camera');
        else requestStatic();
    }, { signal: abort.signal });
    device.addEventListener('uncapturederror', (event) => { fail(new Error(event.error.message)); controller.dispose(); }, { signal: abort.signal });
    void device.lost.then((info) => {
        if (!disposed) { fail(new Error(`WebGPU device lost: ${info.message || info.reason}`)); controller.dispose(); }
    });
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    // Preserve requests across the model -> default source initialization handoff.
    void controller.selectModel('small').finally(() => {
        initializing = false;
        if (!canAwaitFrame()) settleCapture();
    });
    return controller;
}
