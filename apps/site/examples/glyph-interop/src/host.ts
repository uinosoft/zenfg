import type { FrameGraphCaptureRequest } from '@zenfg/inspector';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import type { FrameGraph, FrameGraphCompilationReport, FrameGraphExecutionTiming } from '@zenfg/webgpu';
import { attachOrbitControls } from './camera.ts';
import { initialCamera } from './scene.ts';
import { defaults, textChanged, updateSettings, type GlyphSettings } from './settings.ts';

export interface GlyphStatistics { glyphs: number; lines: number; }
export interface StartGlyphOptions {
    signal?: AbortSignal;
    onFrame?: () => void;
    onReady?: () => void;
    onLoading?: (message: string) => void;
    onWarning?: (message?: string) => void;
    onPaused?: (paused: boolean) => void;
    onStatistics?: (statistics: GlyphStatistics) => void;
    onError?: (error: Error) => void;
}
export interface GlyphController {
    getSettings(): GlyphSettings;
    setSettings(patch: Partial<GlyphSettings>): void;
    resetView(): void;
    captureSnapshot(request?: FrameGraphCaptureRequest): Promise<FrameGraphSnapshot | undefined>;
    dispose(): void;
}
interface PendingCapture {
    timing: FrameGraphCaptureRequest['timing'];
    promise: Promise<FrameGraphSnapshot | undefined>;
    resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
}
/** Browser scheduling and lifecycle stay outside the frame composition. */
export function createHostSupport(canvas: HTMLCanvasElement, device: GPUDevice, graph: FrameGraph,
    options: StartGlyphOptions, renderFrame: () => void, release: () => void) {
    const state = {
        settings: { ...defaults }, camera: { ...initialCamera },
        disposed: false, suspended: document.visibilityState === 'hidden',
        animationFrame: 0, frameIndex: 0, ready: false, textDirty: true, textHeight: 0, pixelRatio: 0,
        capture: undefined as PendingCapture | undefined, captureInFlight: undefined as PendingCapture | undefined,
    };
    function requestFrame(): void {
        if (!state.disposed && !state.suspended && state.animationFrame === 0) state.animationFrame = requestAnimationFrame(renderFrame);
    }
    function suspend(): void {
        state.suspended = true;
        cancelAnimationFrame(state.animationFrame);
        state.animationFrame = 0;
        state.capture?.resolve(undefined);
        state.capture = undefined;
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
    const stopOrbit = attachOrbitControls(canvas, state.camera, requestFrame);
    const resize = new ResizeObserver(requestFrame);
    resize.observe(canvas);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    device.addEventListener('uncapturederror', uncapturedError);
    const controller: GlyphController = {
        getSettings: () => ({ ...state.settings }),
        setSettings(patch) {
            if (state.disposed) throw new Error('Glyph example has been disposed.');
            const next = updateSettings(state.settings, patch);
            state.textDirty ||= textChanged(state.settings, next);
            state.settings = next;
            requestFrame();
        },
        resetView() {
            if (state.disposed) return;
            Object.assign(state.camera, initialCamera);
            state.settings = { ...state.settings, scale: defaults.scale, tilt: defaults.tilt };
            requestFrame();
        },
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
            stopOrbit();
            resize.disconnect();
            window.removeEventListener('pagehide', suspend);
            window.removeEventListener('pageshow', resume);
            document.removeEventListener('visibilitychange', visibility);
            device.removeEventListener('uncapturederror', uncapturedError);
            options.signal?.removeEventListener('abort', controller.dispose);
            release();
        },
    };
    options.signal?.addEventListener('abort', controller.dispose, { once: true });
    void device.lost.then(info => fail(new Error('Glyph WebGPU device lost: ' + (info.message || info.reason))));
    observe(options.onPaused, state.suspended);
    return { state, controller, requestFrame, finishCapture, fail };
}
/** Notification handlers cannot break the rendering or teardown lifecycle. */
export function observe<T>(callback: ((value: T) => void) | undefined, value: T): void {
    try { callback?.(value); } catch { /* Observational only. */ }
}
export function notifyError(options: StartGlyphOptions, error: unknown): void {
    observe(options.onError, error instanceof Error ? error : new Error(String(error)));
}
export function resolveCanvasBackingSize(canvas: HTMLCanvasElement, limit: number) {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    const scale = Math.min(1, limit / width, limit / height);
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)),
        pixelRatio: ratio * scale };
}
