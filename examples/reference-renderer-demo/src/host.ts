import { createReferenceRenderer } from '@zenfg-example/reference-renderer';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import { attachOrbitControls, type OrbitCamera } from './camera.ts';
import { createDemoInstances } from './scene.ts';

export interface ReferenceRendererSettings {
    readonly instanceCount: number;
    readonly culling: boolean;
    readonly depthConvention: 'reverse-z' | 'forward-z';
}

export interface StartReferenceRendererOptions {
    readonly signal?: AbortSignal;
    /** Called after a frame is submitted; observational only. */
    readonly onFrame?: () => void;
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

/** Browser events, controls and snapshot delivery for this example. */
export function createHostSupport(canvas: HTMLCanvasElement,
    device: GPUDevice,
    graph: FrameGraph,
    renderer: ReturnType<typeof createReferenceRenderer>,
    options: StartReferenceRendererOptions,
    renderFrame: () => void, release: () => void) {
    const state = {
        settings: { instanceCount: 1_000, culling: true, depthConvention: 'reverse-z' } as ReferenceRendererSettings,
        camera: { azimuth: 0.65, polar: 1.05, distance: 54 } as OrbitCamera,
        disposed: false,
        suspended: document.visibilityState === 'hidden',
        animationFrame: 0,
        frameIndex: 0,
        ready: false,
        capture: undefined as PendingCapture | undefined,
        captureInFlight: undefined as PendingCapture | undefined,
    };

    function requestFrame(): void {
        if (!state.disposed && !state.suspended && state.animationFrame === 0) state.animationFrame = requestAnimationFrame(renderFrame);
    }

    function settleCapture(): void {
        state.capture?.resolve(undefined);
        state.capture = undefined;
    }

    function suspend(): void {
        state.suspended = true;
        cancelAnimationFrame(state.animationFrame);
        state.animationFrame = 0;
        settleCapture();
    }

    function resume(): void {
        state.suspended = document.visibilityState === 'hidden';
        requestFrame();
    }

    function visibility(): void {
        if (document.visibilityState === 'hidden') suspend();
        else resume();
    }

    function fail(error: unknown): void {
        if (state.disposed) return;
        notifyError(options, error);
        controller.dispose();
    }

    function uncapturedError(event: GPUUncapturedErrorEvent): void { fail(event.error); }

    async function finishCapture(pending: PendingCapture, compilation: FrameGraphCompilationReport, timing: Promise<FrameGraphGpuTimingReport>): Promise<void> {
        try {
            const [gpuTiming, { createFrameGraphSnapshot }] = await Promise.all([timing, import('@zenfg/webgpu/snapshot')]);
            if (!state.disposed && state.capture === pending) pending.resolve(createFrameGraphSnapshot({ compilation, gpuTiming, resourcePool: graph.getResourcePoolStats() }));
        } catch {
            if (state.capture === pending) pending.resolve(undefined);
        } finally {
            if (state.capture === pending) state.capture = undefined;
            if (state.captureInFlight === pending) state.captureInFlight = undefined;
        }
    }

    const stopOrbit = attachOrbitControls(canvas, state.camera, requestFrame);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(requestFrame);
    resizeObserver?.observe(canvas);
    window.addEventListener('resize', requestFrame);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    device.addEventListener('uncapturederror', uncapturedError);
    const controller: ReferenceRendererController = {
        getSettings: () => ({ ...state.settings }),
        setSettings(patch) {
            if (state.disposed) throw new Error('The reference renderer demo has been disposed.');
            const next = { ...state.settings, ...patch };
            if (!Number.isInteger(next.instanceCount) || next.instanceCount < 0 || next.instanceCount > 10_000) throw new Error('instanceCount must be an integer from 0 to 10000.');
            if (typeof next.culling !== 'boolean') throw new Error('culling must be boolean.');
            if (next.depthConvention !== 'forward-z' && next.depthConvention !== 'reverse-z') throw new Error('Unknown depth convention.');
            if (next.instanceCount !== state.settings.instanceCount) {
                renderer.setInstances(createDemoInstances(next.instanceCount));
                state.camera.distance = Math.max(12, Math.cbrt(next.instanceCount) * 5.4);
            }
            state.settings = next;
            requestFrame();
        },
        captureSnapshot() {
            if (state.disposed || state.suspended) return Promise.resolve(undefined);
            if (state.capture) return state.capture.promise;
            let resolveCapture: PendingCapture['resolve'] = () => undefined;
            const promise = new Promise<FrameGraphSnapshot | undefined>(resolve => { resolveCapture = resolve; });
            state.capture = { promise, resolve: resolveCapture };
            requestFrame();
            return promise;
        },
        dispose() {
            if (state.disposed) return;
            state.disposed = true;
            suspend();
            stopOrbit();
            resizeObserver?.disconnect();
            window.removeEventListener('resize', requestFrame);
            window.removeEventListener('pagehide', suspend);
            window.removeEventListener('pageshow', resume);
            document.removeEventListener('visibilitychange', visibility);
            options.signal?.removeEventListener('abort', controller.dispose);
            device.removeEventListener('uncapturederror', uncapturedError);
            release();
        },
    };
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    void device.lost.then(info => fail(new Error(`Reference renderer WebGPU device was lost: ${info.message || info.reason}`)));
    return { state, controller, start: requestFrame, fail, finishCapture };
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

export function notifyError(options: StartReferenceRendererOptions, error: unknown): void {
    try { options.onError?.(error instanceof Error ? error : new Error(String(error))); } catch { /* Preserve the original failure. */ }
}
