import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import { createReferenceRenderer } from '@zenfg-example/reference-renderer';
import { createDemoInstances } from './scene.ts';
import { attachOrbitControls, createViewProjection, type OrbitCamera } from './camera.ts';
import { createPresenter } from './present.ts';

export interface ReferenceRendererSettings {
    readonly instanceCount: number;
    readonly culling: boolean;
    readonly depthConvention: 'reverse-z' | 'forward-z';
}

export interface StartReferenceRendererOptions {
    readonly signal?: AbortSignal;
    readonly onReady?: (message?: string) => void;
    readonly onError?: (error: Error) => void;
}

export interface ReferenceRendererController {
    getSettings(): Readonly<ReferenceRendererSettings>;
    setSettings(settings: Partial<ReferenceRendererSettings>): void;
    captureSnapshot(): Promise<FrameGraphSnapshot | undefined>;
    dispose(): void;
}

interface PendingCapture {
    readonly promise: Promise<FrameGraphSnapshot | undefined>;
    readonly resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
}

/** Owns browser setup and presentation; the renderer only records into our graph. */
export async function startReferenceRenderer(canvas: HTMLCanvasElement, options: StartReferenceRendererOptions = {}): Promise<ReferenceRendererController | undefined> {
    let device: GPUDevice | undefined;
    let context: GPUCanvasContext | undefined;
    let graph: FrameGraph | undefined;
    let renderer: ReturnType<typeof createReferenceRenderer> | undefined;
    try {
        options.signal?.throwIfAborted();
        if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
        const adapter = await navigator.gpu.requestAdapter();
        options.signal?.throwIfAborted();
        if (!adapter) throw new Error('No compatible WebGPU adapter was found.');
        device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
        options.signal?.throwIfAborted();
        context = canvas.getContext('webgpu') ?? undefined;
        if (!context) throw new Error('The canvas could not create a WebGPU context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        graph = new FrameGraph(device);
        renderer = createReferenceRenderer(device, { maxInstances: 10_000 });
        const present = createPresenter(device, format);
        return createHost(canvas, device, context, graph, renderer, present, options);
    } catch (error) {
        renderer?.destroy();
        graph?.destroy();
        context?.unconfigure();
        device?.destroy();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    }
}

function createHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    renderer: ReturnType<typeof createReferenceRenderer>, present: ReturnType<typeof createPresenter>,
    options: StartReferenceRendererOptions): ReferenceRendererController {
    let settings: ReferenceRendererSettings = { instanceCount: 1_000, culling: true, depthConvention: 'reverse-z' };
    const camera: OrbitCamera = { azimuth: 0.65, polar: 1.05, distance: 54 };
    let disposed = false;
    let suspended = document.visibilityState === 'hidden';
    let animationFrame = 0;
    let frameIndex = 0;
    let ready = false;
    let capture: PendingCapture | undefined;
    let captureInFlight: PendingCapture | undefined;
    renderer.setInstances(createDemoInstances(settings.instanceCount));

    function requestFrame(): void {
        if (!disposed && !suspended && animationFrame === 0) animationFrame = requestAnimationFrame(renderFrame);
    }

    function settleCapture(): void {
        capture?.resolve(undefined);
        capture = undefined;
    }

    function suspend(): void {
        suspended = true;
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        settleCapture();
    }

    function resume(): void {
        suspended = document.visibilityState === 'hidden';
        requestFrame();
    }

    function visibility(): void {
        if (document.visibilityState === 'hidden') suspend();
        else resume();
    }

    function fail(error: unknown): void {
        if (disposed) return;
        notifyError(options, error);
        controller.dispose();
    }

    function uncapturedError(event: GPUUncapturedErrorEvent): void { fail(event.error); }

    async function finishCapture(pending: PendingCapture, compilation: FrameGraphCompilationReport, timing: Promise<FrameGraphGpuTimingReport>): Promise<void> {
        try {
            const [gpuTiming, { createFrameGraphSnapshot }] = await Promise.all([timing, import('@zenfg/webgpu/snapshot')]);
            if (!disposed && capture === pending) pending.resolve(createFrameGraphSnapshot({ compilation, gpuTiming, resourcePool: graph.getResourcePoolStats() }));
        } catch {
            if (capture === pending) pending.resolve(undefined);
        } finally {
            if (capture === pending) capture = undefined;
            if (captureInFlight === pending) captureInFlight = undefined;
        }
    }

    function renderFrame(): void {
        animationFrame = 0;
        if (disposed || suspended) return;
        try {
            const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
            if (canvas.width !== size.width) canvas.width = size.width;
            if (canvas.height !== size.height) canvas.height = size.height;
            const frame = graph.beginFrame();
            const scene = frame.createTexture({ label: 'reference.scene-color', format: 'rgba16float', size: [size.width, size.height] });
            const depth = frame.createTexture({ label: 'reference.scene-depth', format: 'depth32float', size: [size.width, size.height] });
            const backbuffer = frame.importSwapchainTexture(context.getCurrentTexture(), { label: 'reference.backbuffer' });
            renderer.record(frame, {
                viewProjection: createViewProjection(
                    { ...camera, distance: camera.distance * Math.max(1, size.height / size.width) },
                    size.width / size.height,
                    settings.depthConvention === 'reverse-z',
                ),
                depthConvention: settings.depthConvention,
                culling: settings.culling,
                color: { target: scene, loadOp: 'clear', storeOp: 'store', clearValue: [0.012, 0.019, 0.028, 1] },
                depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: settings.depthConvention === 'reverse-z' ? 0 : 1 },
            });
            present(frame, scene, backbuffer);
            frame.markPresent(backbuffer);
            const pending = capture !== captureInFlight ? capture : undefined;
            if (!ready || pending) {
                const compiled = frame.compile({ report: true });
                canvas.dataset.frameGraph = compiled.compilationReport.nodes.map(node => node.label).join(' → ');
                canvas.dataset.frameGraphPasses = String(compiled.compilationReport.nodes.length);
                if (pending) {
                    captureInFlight = pending;
                    void finishCapture(pending, compiled.compilationReport, compiled.execute({ frameIndex: frameIndex++, gpuTiming: true }));
                } else compiled.execute({ frameIndex: frameIndex++ });
            } else frame.compile().execute({ frameIndex: frameIndex++ });
            if (!ready) {
                ready = true;
                try { options.onReady?.('Live · GPU culling + indirect drawing'); } catch { /* Notifications do not own rendering. */ }
            }
        } catch (error) { fail(error); }
    }

    const stopOrbit = attachOrbitControls(canvas, camera, requestFrame);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(requestFrame);
    resizeObserver?.observe(canvas);
    window.addEventListener('resize', requestFrame);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    device.addEventListener('uncapturederror', uncapturedError);
    const controller: ReferenceRendererController = {
        getSettings: () => ({ ...settings }),
        setSettings(patch) {
            if (disposed) throw new Error('The reference renderer demo has been disposed.');
            const next = { ...settings, ...patch };
            if (!Number.isInteger(next.instanceCount) || next.instanceCount < 0 || next.instanceCount > 10_000) throw new Error('instanceCount must be an integer from 0 to 10000.');
            if (typeof next.culling !== 'boolean') throw new Error('culling must be boolean.');
            if (next.depthConvention !== 'forward-z' && next.depthConvention !== 'reverse-z') throw new Error('Unknown depth convention.');
            if (next.instanceCount !== settings.instanceCount) {
                renderer.setInstances(createDemoInstances(next.instanceCount));
                camera.distance = Math.max(12, Math.cbrt(next.instanceCount) * 5.4);
            }
            settings = next;
            requestFrame();
        },
        captureSnapshot() {
            if (disposed || suspended) return Promise.resolve(undefined);
            if (capture) return capture.promise;
            let resolveCapture: PendingCapture['resolve'] = () => undefined;
            const promise = new Promise<FrameGraphSnapshot | undefined>(resolve => { resolveCapture = resolve; });
            capture = { promise, resolve: resolveCapture };
            requestFrame();
            return promise;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            suspend();
            stopOrbit();
            resizeObserver?.disconnect();
            window.removeEventListener('resize', requestFrame);
            window.removeEventListener('pagehide', suspend);
            window.removeEventListener('pageshow', resume);
            document.removeEventListener('visibilitychange', visibility);
            options.signal?.removeEventListener('abort', controller.dispose);
            device.removeEventListener('uncapturederror', uncapturedError);
            renderer.destroy();
            graph.destroy();
            context.unconfigure();
            device.destroy();
        },
    };
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    void device.lost.then(info => fail(new Error(`Reference renderer WebGPU device was lost: ${info.message || info.reason}`)));
    requestFrame();
    return controller;
}

export function resolveCanvasBackingSize(canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight' | 'getBoundingClientRect'>,
    devicePixelRatio: number, maxTextureDimension2D: number): { width: number; height: number } {
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
    const width = Math.max(1, Math.round((bounds.width || canvas.clientWidth || 1) * dpr));
    const height = Math.max(1, Math.round((bounds.height || canvas.clientHeight || 1) * dpr));
    const scale = Math.min(1, maxTextureDimension2D / width, maxTextureDimension2D / height);
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function notifyError(options: StartReferenceRendererOptions, error: unknown): void {
    try { options.onError?.(error instanceof Error ? error : new Error(String(error))); } catch { /* Preserve the original failure. */ }
}
