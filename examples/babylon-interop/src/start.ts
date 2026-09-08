import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import { createReferenceRenderer } from '@zenfg-example/reference-renderer';
import { BabylonBridge } from './bridge.ts';
import { recordCoRendering } from './graph.ts';
import { createReferenceInstances } from './scene.ts';
import { createPresenter } from './present.ts';
import { createAttachmentResolver, type AttachmentResolver } from './resolve.ts';

export interface BabylonInteropSettings { readonly reverseZ: boolean; }
export interface StartBabylonInteropOptions {
    readonly signal?: AbortSignal;
    readonly onReady?: (message?: string) => void;
    readonly onError?: (error: Error) => void;
}
export interface BabylonInteropController {
    getSettings(): Readonly<BabylonInteropSettings>;
    setSettings(settings: Partial<BabylonInteropSettings>): Promise<void>;
    captureSnapshot(): Promise<FrameGraphSnapshot | undefined>;
    dispose(): void;
}
interface PendingCapture {
    readonly promise: Promise<FrameGraphSnapshot | undefined>;
    readonly resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
}

export async function startBabylonInterop(canvas: HTMLCanvasElement, options: StartBabylonInteropOptions = {}): Promise<BabylonInteropController | undefined> {
    let device: GPUDevice | undefined;
    let context: GPUCanvasContext | undefined;
    let graph: FrameGraph | undefined;
    let reference: ReturnType<typeof createReferenceRenderer> | undefined;
    let bridge: BabylonBridge | undefined;
    try {
        options.signal?.throwIfAborted();
        if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
        const initialSize = resolveCanvasBackingSize(canvas, window.devicePixelRatio, 2048);
        bridge = await BabylonBridge.create(initialSize.width, initialSize.height, true, options.signal);
        device = bridge.device;
        options.signal?.throwIfAborted();
        context = canvas.getContext('webgpu') ?? undefined;
        if (!context) throw new Error('The canvas could not create a WebGPU context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        graph = new FrameGraph(device);
        reference = createReferenceRenderer(device, { maxInstances: 32 });
        reference.setInstances(createReferenceInstances());
        const present = createPresenter(device, format);
        const resolve = createAttachmentResolver(device);
        options.signal?.throwIfAborted();
        return createHost(canvas, device, context, graph, reference, bridge, present, resolve, options);
    } catch (error) {
        reference?.destroy();
        graph?.destroy();
        context?.unconfigure();
        bridge?.destroy();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    }
}

function createHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    reference: ReturnType<typeof createReferenceRenderer>, initialBridge: BabylonBridge,
    present: ReturnType<typeof createPresenter>, resolve: AttachmentResolver, options: StartBabylonInteropOptions): BabylonInteropController {
    const bridge = initialBridge;
    let settings: BabylonInteropSettings = { reverseZ: true };
    let disposed = false;
    let switching = false;
    let suspended = document.visibilityState === 'hidden';
    let animationFrame = 0;
    let frameIndex = 0;
    let ready = false;
    let capture: PendingCapture | undefined;
    let captureInFlight: PendingCapture | undefined;
    const previousTouchAction = canvas.style.touchAction;
    const previousOutline = canvas.style.outline;
    const previousTabIndex = canvas.getAttribute('tabindex');
    bridge.attachControls(canvas);
    canvas.style.touchAction = 'none';
    // Babylon collects input synchronously; the queued frame consumes it once via camera.update().
    const inputEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown'] as const;
    function restoreOutline(): void { canvas.style.outline = previousOutline; }
    function input(event: Event): void {
        // Babylon calls focus() on pointer-down, which can also match :focus-visible.
        // Suppress only pointer focus; keyboard input and blur restore the host's style.
        if (event.type === 'pointerdown') canvas.style.outline = 'none';
        else if (event.type === 'keydown') restoreOutline();
        if (event.type === 'pointermove' && (event as PointerEvent).buttons === 0) return;
        requestFrame();
    }
    for (const event of inputEvents) canvas.addEventListener(event, input);
    canvas.addEventListener('blur', restoreOutline);

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
            const viewProjection = bridge.updateCamera();
            const frame = graph.beginFrame();
            const { color } = recordCoRendering(frame, bridge, reference, viewProjection, resolve);
            const backbuffer = frame.importSwapchainTexture(context.getCurrentTexture(), { label: 'babylon-interop.backbuffer' });
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
                try { options.onReady?.('Live · Babylon.js + Reference Renderer · shared color and depth'); } catch { /* Notifications do not own rendering. */ }
            }
        } catch (error) { fail(error); }
    }

    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(requestFrame);
    resizeObserver?.observe(canvas);
    window.addEventListener('resize', requestFrame);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    device.addEventListener('uncapturederror', uncapturedError);
    const controller: BabylonInteropController = {
        getSettings: () => ({ ...settings }),
        async setSettings(patch) {
            if (disposed) throw new Error('The Babylon.js co-rendering demo has been disposed.');
            const next = { ...settings, ...patch };
            if (typeof next.reverseZ !== 'boolean') throw new Error('reverseZ must be boolean.');
            if (switching) throw new Error('A depth convention change is already in progress.');
            if (next.reverseZ === settings.reverseZ) return;
            switching = true;
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
            settleCapture();
            try {
                bridge.setReverseZ(next.reverseZ);
                settings = next;
            } catch (error) {
                fail(error);
                throw error;
            } finally {
                switching = false;
                requestFrame();
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
            for (const event of inputEvents) canvas.removeEventListener(event, input);
            canvas.removeEventListener('blur', restoreOutline);
            restoreOutline();
            canvas.style.touchAction = previousTouchAction;
            resizeObserver?.disconnect();
            window.removeEventListener('resize', requestFrame);
            window.removeEventListener('pagehide', suspend);
            window.removeEventListener('pageshow', resume);
            document.removeEventListener('visibilitychange', visibility);
            options.signal?.removeEventListener('abort', controller.dispose);
            device.removeEventListener('uncapturederror', uncapturedError);
            reference.destroy();
            graph.destroy();
            context.unconfigure();
            bridge.destroy();
            if (previousTabIndex === null) canvas.removeAttribute('tabindex');
            else canvas.setAttribute('tabindex', previousTabIndex);
        },
    };
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    void device.lost.then(info => fail(new Error(`Babylon.js co-rendering WebGPU device was lost: ${info.message || info.reason}`)));
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

function notifyError(options: StartBabylonInteropOptions, error: unknown): void {
    try { options.onError?.(error instanceof Error ? error : new Error(String(error))); } catch { /* Preserve the original failure. */ }
}
