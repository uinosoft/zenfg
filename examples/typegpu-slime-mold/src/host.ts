import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import {
    FrameGraph,
    type FrameGraphCompilationReport,
    type FrameGraphGpuTimingReport,
} from '@zenfg/webgpu';
import { TypeGpuSlimeMold } from './slimeMold.ts';
import type {
    SlimeMoldSettings,
    StartTypeGpuSlimeMoldOptions,
    TypeGpuSlimeMoldController
} from './types.ts';

const MAX_DEVICE_PIXEL_RATIO = 2;

interface PendingCapture {
    readonly promise: Promise<FrameGraphSnapshot | undefined>;
    readonly resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
}

interface SlimeMoldHostResources {
    readonly device: GPUDevice;
    readonly context: GPUCanvasContext;
    readonly format: GPUTextureFormat;
    readonly graph: FrameGraph;
    readonly simulation: TypeGpuSlimeMold;
}

export function resolveCanvasBackingSize(
    canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight' | 'getBoundingClientRect'>,
    devicePixelRatio: number,
    maxTextureDimension2D: number,
): { width: number; height: number } {
    const bounds = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, bounds.width || canvas.clientWidth || 1);
    const cssHeight = Math.max(1, bounds.height || canvas.clientHeight || 1);
    const dpr = Math.min(
        MAX_DEVICE_PIXEL_RATIO,
        Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1),
    );
    const rawWidth = Math.max(1, Math.round(cssWidth * dpr));
    const rawHeight = Math.max(1, Math.round(cssHeight * dpr));
    const limit = Math.max(1, Math.floor(maxTextureDimension2D));
    const scale = Math.min(1, limit / rawWidth, limit / rawHeight);
    return {
        width: Math.max(1, Math.floor(rawWidth * scale)),
        height: Math.max(1, Math.floor(rawHeight * scale)),
    };
}

export function notifyStartError(options: StartTypeGpuSlimeMoldOptions, error: Error): void {
    try {
        options.onError?.(error);
    } catch {
        // Host notifications must not obscure the initialization failure.
    }
}

export function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export abstract class SlimeMoldBrowserHost implements TypeGpuSlimeMoldController {
    protected readonly resizeObserver: ResizeObserver | undefined;
    protected animationFrame = 0;
    protected previousFrameTime: number | undefined;
    protected frameIndex = 0;
    protected resizePending = false;
    protected disposed = false;
    protected readyReported = false;
    protected reportCaptured = false;
    protected captureInFlight = false;
    protected pendingCapture: PendingCapture | undefined;

    constructor(
        protected readonly canvas: HTMLCanvasElement,
        protected readonly resources: SlimeMoldHostResources,
        protected readonly options: StartTypeGpuSlimeMoldOptions,
    ) {
        this.resizeObserver = typeof ResizeObserver === 'undefined'
            ? undefined
            : new ResizeObserver(this.handleResize);
    }

    start(): void {
        this.previousFrameTime = undefined;
        window.addEventListener('resize', this.handleResize, { passive: true });
        window.addEventListener('pageshow', this.handlePageShow);
        document.addEventListener('visibilitychange', this.handleVisibility);
        this.resources.device.addEventListener('uncapturederror', this.handleUncapturedError);
        this.resizeObserver?.observe(this.canvas);
        void this.resources.device.lost.then((info) => {
            if (this.disposed) return;
            this.fail(new Error(
                `TypeGPU Slime Mold WebGPU device was lost: ${info.message || info.reason}`,
            ));
        });
        this.requestFrame();
    }

    getSettings(): Readonly<SlimeMoldSettings> {
        return this.resources.simulation.getSettings();
    }

    setSettings(settings: Partial<SlimeMoldSettings>): void {
        this.resources.simulation.setSettings(settings);
    }

    captureSnapshot(): Promise<FrameGraphSnapshot | undefined> {
        if (this.disposed) return Promise.resolve(undefined);
        if (this.pendingCapture) return this.pendingCapture.promise;

        let resolveCapture: PendingCapture['resolve'] = () => undefined;
        const promise = new Promise<FrameGraphSnapshot | undefined>((resolve) => {
            resolveCapture = resolve;
        });
        this.pendingCapture = { promise, resolve: resolveCapture };
        this.requestFrame();
        return promise;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = 0;
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('pageshow', this.handlePageShow);
        document.removeEventListener('visibilitychange', this.handleVisibility);
        this.resources.device.removeEventListener('uncapturederror', this.handleUncapturedError);
        this.resizeObserver?.disconnect();
        this.pendingCapture?.resolve(undefined);
        this.pendingCapture = undefined;
    }

    protected readonly handleResize = (): void => {
        this.resizePending = true;
    };

    protected readonly handleVisibility = (): void => {
        if (document.visibilityState === 'visible') this.resumeRendering();
    };

    protected readonly handlePageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) this.resumeRendering();
    };

    protected readonly handleUncapturedError = (event: GPUUncapturedErrorEvent): void => {
        this.fail(new Error(event.error.message));
    };

    protected resumeRendering(): void {
        if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = 0;
        this.previousFrameTime = undefined;
        this.requestFrame();
    }

    protected requestFrame(): void {
        if (
            this.disposed
            || this.animationFrame !== 0
            || document.visibilityState === 'hidden'
        ) return;
        this.animationFrame = requestAnimationFrame(this.renderFrame);
    }

    protected readonly renderFrame = (now: number): void => {
        this.animationFrame = 0;
        if (this.disposed || document.visibilityState === 'hidden') return;

        try {
            if (this.resizePending) this.resizeCanvas();
            const deltaSeconds = Math.min(
                this.previousFrameTime === undefined
                    ? 0
                    : Math.max(0, (now - this.previousFrameTime) / 1_000),
                0.1,
            );
            this.previousFrameTime = now;
            this.recordAndExecuteFrame(deltaSeconds);
            this.frameIndex += 1;
            if (!this.readyReported) {
                this.readyReported = true;
                this.notifyReady();
            }
        } catch (error) {
            this.fail(toError(error));
            return;
        }

        this.requestFrame();
    };

    protected resizeCanvas(): void {
        const size = resolveCanvasBackingSize(
            this.canvas,
            window.devicePixelRatio,
            this.resources.device.limits.maxTextureDimension2D,
        );
        if (this.canvas.width !== size.width) this.canvas.width = size.width;
        if (this.canvas.height !== size.height) this.canvas.height = size.height;
        this.resources.simulation.resize(size.width, size.height);
        this.resizePending = false;
    }
    protected abstract recordAndExecuteFrame(deltaTime: number): void;

    protected async finishCapture(
        capture: PendingCapture,
        compilation: FrameGraphCompilationReport,
        gpuTiming: Promise<FrameGraphGpuTimingReport>,
    ): Promise<void> {
        try {
            const [timing, { createFrameGraphSnapshot }] = await Promise.all([
                gpuTiming,
                import('@zenfg/webgpu/snapshot'),
            ]);
            if (this.disposed || this.pendingCapture !== capture) return;
            capture.resolve(createFrameGraphSnapshot({
                compilation,
                gpuTiming: timing,
                resourcePool: this.resources.graph.getResourcePoolStats(),
            }));
        } catch {
            if (!this.disposed && this.pendingCapture === capture) {
                capture.resolve(undefined);
            }
        } finally {
            if (this.pendingCapture === capture) this.pendingCapture = undefined;
            this.captureInFlight = false;
        }
    }

    protected notifyReady(): void {
        try {
            this.options.onReady?.('200,000 TypeGPU agents · 4 ZenFG passes');
        } catch {
            // Host notifications must not break the renderer.
        }
    }

    protected fail(error: Error): void {
        try {
            this.options.onError?.(error);
        } catch {
            // Host notifications must not obscure the rendering failure.
        }
        this.dispose();
    }
}
