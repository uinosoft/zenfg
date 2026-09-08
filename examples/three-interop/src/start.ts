import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import { createReferenceRenderer } from '@zenfg-example/reference-renderer';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ThreeBridge, updateCamera } from './bridge.ts';
import { recordCoRendering } from './graph.ts';
import { CAMERA_TARGET, createReferenceInstances } from './scene.ts';
import { createPresenter } from './present.ts';

export interface ThreeInteropSettings { readonly reverseZ: boolean; }
export interface StartThreeInteropOptions {
    readonly signal?: AbortSignal;
    readonly onReady?: (message?: string) => void;
    readonly onError?: (error: Error) => void;
}
export interface ThreeInteropController {
    getSettings(): Readonly<ThreeInteropSettings>;
    setSettings(settings: Partial<ThreeInteropSettings>): Promise<void>;
    captureSnapshot(): Promise<FrameGraphSnapshot | undefined>;
    dispose(): void;
}
interface PendingCapture {
    readonly promise: Promise<FrameGraphSnapshot | undefined>;
    readonly resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
}

export async function startThreeInterop(canvas: HTMLCanvasElement, options: StartThreeInteropOptions = {}): Promise<ThreeInteropController | undefined> {
    let device: GPUDevice | undefined;
    let context: GPUCanvasContext | undefined;
    let graph: FrameGraph | undefined;
    let reference: ReturnType<typeof createReferenceRenderer> | undefined;
    let bridge: ThreeBridge | undefined;
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
        reference = createReferenceRenderer(device, { maxInstances: 32 });
        reference.setInstances(createReferenceInstances());
        const present = createPresenter(device, format);
        const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
        bridge = await ThreeBridge.create(device, size.width, size.height, true);
        options.signal?.throwIfAborted();
        return createHost(canvas, device, context, graph, reference, bridge, present, options);
    } catch (error) {
        bridge?.destroy();
        reference?.destroy();
        graph?.destroy();
        context?.unconfigure();
        device?.destroy();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    }
}

function createHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    reference: ReturnType<typeof createReferenceRenderer>, initialBridge: ThreeBridge,
    present: ReturnType<typeof createPresenter>, options: StartThreeInteropOptions): ThreeInteropController {
    let bridge = initialBridge;
    let settings: ThreeInteropSettings = { reverseZ: true };
    let disposed = false;
    let switching = false;
    let suspended = document.visibilityState === 'hidden';
    let animationFrame = 0;
    let frameIndex = 0;
    let ready = false;
    let capture: PendingCapture | undefined;
    let captureInFlight: PendingCapture | undefined;
    const previousTouchAction = canvas.style.touchAction;
    const controls = new OrbitControls(bridge.camera, canvas);
    controls.target.set(...CAMERA_TARGET);
    controls.minDistance = 4;
    controls.maxDistance = 28;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.update();

    function requestFrame(): void {
        if (!disposed && !suspended && !switching && animationFrame === 0) animationFrame = requestAnimationFrame(renderFrame);
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
        if (disposed || suspended || switching) return;
        try {
            const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
            if (canvas.width !== size.width) canvas.width = size.width;
            if (canvas.height !== size.height) canvas.height = size.height;
            bridge.resize(size.width, size.height);
            // Match the base demo's narrow-screen framing without changing the orbit state.
            bridge.camera.zoom = Math.min(1, size.width / size.height);
            const viewProjection = updateCamera(bridge.camera, size.width / size.height, settings.reverseZ);
            const frame = graph.beginFrame();
            const { color } = recordCoRendering(frame, bridge, reference, viewProjection);
            const backbuffer = frame.importSwapchainTexture(context.getCurrentTexture(), { label: 'three-interop.backbuffer' });
            present(frame, color, backbuffer);
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
                try { options.onReady?.('Live · Three.js + Reference Renderer · shared color and depth'); } catch { /* Notifications do not own rendering. */ }
            }
        } catch (error) { fail(error); }
    }

    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(requestFrame);
    resizeObserver?.observe(canvas);
    controls.addEventListener('change', requestFrame);
    window.addEventListener('resize', requestFrame);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    device.addEventListener('uncapturederror', uncapturedError);
    const controller: ThreeInteropController = {
        getSettings: () => ({ ...settings }),
        async setSettings(patch) {
            if (disposed) throw new Error('The Three.js co-rendering demo has been disposed.');
            const next = { ...settings, ...patch };
            if (typeof next.reverseZ !== 'boolean') throw new Error('reverseZ must be boolean.');
            if (switching) throw new Error('A depth convention change is already in progress.');
            if (next.reverseZ === settings.reverseZ) return;
            switching = true;
            controls.enabled = false;
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
            settleCapture();
            let replacement: ThreeBridge | undefined;
            try {
                const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
                replacement = await ThreeBridge.create(device, size.width, size.height, next.reverseZ);
                if (disposed) { replacement.destroy(); return; }
                // Rebuild constructor-bound Three state, retaining the host and exact orbit pose.
                replacement.camera.position.copy(bridge.camera.position);
                replacement.camera.quaternion.copy(bridge.camera.quaternion);
                replacement.camera.zoom = bridge.camera.zoom;
                const previous = bridge;
                bridge = replacement;
                controls.object = bridge.camera;
                controls.update();
                previous.destroy();
                settings = next;
            } catch (error) {
                if (replacement !== bridge) replacement?.destroy();
                fail(error);
                throw error;
            } finally {
                switching = false;
                if (!disposed) { controls.enabled = true; requestFrame(); }
            }
        },
        captureSnapshot() {
            if (disposed || suspended || switching) return Promise.resolve(undefined);
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
            controls.removeEventListener('change', requestFrame);
            controls.dispose();
            canvas.style.touchAction = previousTouchAction;
            resizeObserver?.disconnect();
            window.removeEventListener('resize', requestFrame);
            window.removeEventListener('pagehide', suspend);
            window.removeEventListener('pageshow', resume);
            document.removeEventListener('visibilitychange', visibility);
            options.signal?.removeEventListener('abort', controller.dispose);
            device.removeEventListener('uncapturederror', uncapturedError);
            bridge.destroy();
            reference.destroy();
            graph.destroy();
            context.unconfigure();
            device.destroy();
        },
    };
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    void device.lost.then(info => fail(new Error(`Three.js co-rendering WebGPU device was lost: ${info.message || info.reason}`)));
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

function notifyError(options: StartThreeInteropOptions, error: unknown): void {
    try { options.onError?.(error instanceof Error ? error : new Error(String(error))); } catch { /* Preserve the original failure. */ }
}
