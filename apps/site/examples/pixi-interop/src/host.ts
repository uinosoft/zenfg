import type { FrameGraphCaptureRequest } from '@zenfg/inspector';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import type { FrameGraph, FrameGraphCompilationReport, FrameGraphExecutionTiming } from '@zenfg/webgpu';

export interface StartPixiOptions {
    signal?: AbortSignal;
    onFrame?: () => void;
    onReady?: () => void;
    onPaused?: (paused: boolean) => void;
    onError?: (error: Error) => void;
}
export interface PixiController {
    captureSnapshot(request?: FrameGraphCaptureRequest): Promise<FrameGraphSnapshot | undefined>;
    dispose(): void;
}
interface PendingCapture {
    timing: FrameGraphCaptureRequest['timing'];
    promise: Promise<FrameGraphSnapshot | undefined>;
    resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
}

/** Browser scheduling and Snapshot delivery, independent of Pixi's scene and graph recording. */
export function createHostSupport(device: GPUDevice, graph: FrameGraph, options: StartPixiOptions,
    renderFrame: () => void, release: () => void, cancelInteraction: () => void) {
    const state = {
        disposed: false, suspended: document.visibilityState === 'hidden',
        animationFrame: 0, frameIndex: 0, ready: false,
        capture: undefined as PendingCapture | undefined, captureInFlight: undefined as PendingCapture | undefined,
    };
    function requestFrame(): void {
        if (!state.disposed && !state.suspended && !state.animationFrame) state.animationFrame = requestAnimationFrame(renderFrame);
    }
    function suspend(): void {
        state.suspended = true;
        cancelAnimationFrame(state.animationFrame);
        state.animationFrame = 0;
        cancelInteraction();
        state.capture?.resolve(undefined);
        state.capture = undefined;
        state.captureInFlight = undefined;
        observe(options.onPaused, true);
    }
    function resume(): void {
        state.suspended = document.visibilityState === 'hidden';
        observe(options.onPaused, state.suspended);
        requestFrame();
    }
    const visibility = () => document.visibilityState === 'hidden' ? suspend() : resume();
    function fail(error: unknown): void {
        if (state.disposed) return;
        notifyError(options, error);
        controller.dispose();
    }
    const uncapturedError = (event: GPUUncapturedErrorEvent) => fail(event.error);
    async function finishCapture(pending: PendingCapture, compilation: FrameGraphCompilationReport, timing: FrameGraphExecutionTiming) {
        const resourcePool = { ...graph.getResourcePoolStats() };
        try {
            const [gpuTiming, { createFrameGraphSnapshot }] = await Promise.all([timing.gpu, import('@zenfg/webgpu/snapshot')]);
            if (!state.disposed && state.capture === pending) pending.resolve(createFrameGraphSnapshot({
                frameIndex: timing.frameIndex, cpuTiming: timing.cpu, compilation, gpuTiming, resourcePool,
            }));
        } catch { if (state.capture === pending) pending.resolve(undefined); }
        finally {
            if (state.capture === pending) state.capture = undefined;
            if (state.captureInFlight === pending) state.captureInFlight = undefined;
        }
    }
    const controller: PixiController = {
        captureSnapshot(request = { timing: 'both' }) {
            if (state.disposed || state.suspended) return Promise.resolve(undefined);
            if (state.capture) return state.capture.promise;
            let resolveCapture: PendingCapture['resolve'] = () => undefined;
            const promise = new Promise<FrameGraphSnapshot | undefined>(resolve => { resolveCapture = resolve; });
            state.capture = { timing: request.timing, promise, resolve: resolveCapture };
            requestFrame();
            return promise;
        },
        dispose() {
            if (state.disposed) return;
            state.disposed = true;
            suspend();
            window.removeEventListener('pagehide', suspend);
            window.removeEventListener('pageshow', resume);
            document.removeEventListener('visibilitychange', visibility);
            device.removeEventListener('uncapturederror', uncapturedError);
            options.signal?.removeEventListener('abort', controller.dispose);
            release();
        },
    };
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    device.addEventListener('uncapturederror', uncapturedError);
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    void device.lost.then(info => fail(new Error('Portal WebGPU device lost: ' + (info.message || info.reason))));
    observe(options.onPaused, state.suspended);
    return { state, controller, requestFrame, finishCapture, fail };
}
export function observe<T>(callback: ((value: T) => void) | undefined, value: T): void {
    try { callback?.(value); } catch { /* Notifications do not own rendering or cleanup. */ }
}
export function notifyError(options: StartPixiOptions, error: unknown): void {
    observe(options.onError, error instanceof Error ? error : new Error(String(error)));
}