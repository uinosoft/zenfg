import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import { BabylonBridge } from './bridge.ts';

export interface BabylonInteropSettings { readonly reverseZ: boolean; }

export interface StartBabylonInteropOptions {
    readonly signal?: AbortSignal;
    /** Called after a frame is submitted; observational only. */
    readonly onFrame?: () => void;
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

/** Browser events, controls and snapshot delivery for this example. */
export function createHostSupport(canvas: HTMLCanvasElement,
    device: GPUDevice,
    graph: FrameGraph,
    initialBridge: BabylonBridge,
    options: StartBabylonInteropOptions,
    renderFrame: () => void, release: () => void) {
    const state = {
        bridge: initialBridge,
        settings: { reverseZ: true } as BabylonInteropSettings,
        disposed: false,
        switching: false,
        suspended: document.visibilityState === 'hidden',
        animationFrame: 0,
        frameIndex: 0,
        ready: false,
        capture: undefined as PendingCapture | undefined,
        captureInFlight: undefined as PendingCapture | undefined,
    };
    const previousTouchAction = canvas.style.touchAction;
    const previousOutline = canvas.style.outline;
    const previousTabIndex = canvas.getAttribute('tabindex');
    state.bridge.attachControls(canvas);
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
        if (!state.disposed && !state.suspended && !state.switching && state.animationFrame === 0) state.animationFrame = requestAnimationFrame(renderFrame);
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

    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(requestFrame);
    resizeObserver?.observe(canvas);
    window.addEventListener('resize', requestFrame);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    device.addEventListener('uncapturederror', uncapturedError);
    const controller: BabylonInteropController = {
        getSettings: () => ({ ...state.settings }),
        async setSettings(patch) {
            if (state.disposed) throw new Error('The Babylon.js co-rendering demo has been disposed.');
            const next = { ...state.settings, ...patch };
            if (typeof next.reverseZ !== 'boolean') throw new Error('reverseZ must be boolean.');
            if (state.switching) throw new Error('A depth convention change is already in progress.');
            if (next.reverseZ === state.settings.reverseZ) return;
            state.switching = true;
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = 0;
            settleCapture();
            try {
                state.bridge.setReverseZ(next.reverseZ);
                state.settings = next;
            } catch (error) {
                fail(error);
                throw error;
            } finally {
                state.switching = false;
                requestFrame();
            }
        },
        captureSnapshot() {
            if (state.disposed || state.suspended || state.switching) return Promise.resolve(undefined);
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
            release();
            if (previousTabIndex === null) canvas.removeAttribute('tabindex');
            else canvas.setAttribute('tabindex', previousTabIndex);
        },
    };
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    void device.lost.then(info => fail(new Error(`Babylon.js co-rendering WebGPU device was lost: ${info.message || info.reason}`)));
    return { state, controller, requestFrame, fail, finishCapture };
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

export function notifyError(options: StartBabylonInteropOptions, error: unknown): void {
    try { options.onError?.(error instanceof Error ? error : new Error(String(error))); } catch { /* Preserve the original failure. */ }
}
