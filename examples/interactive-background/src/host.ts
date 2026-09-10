import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import { resolvePointerPressure } from './backgroundInteraction.ts';
import { resolveCanvasDimensions } from './backgroundLayout.ts';
import { frameParamsFloatCount, type BackgroundResources } from './resources.ts';

const fieldDownsample = 6;

const pointerFollowRate = 30;

const pointerVelocityDecayRate = 7;

const pointerDownPressure = 0.08;

export type ZenBackgroundOptions = {
    readonly interactionTarget?: Window | HTMLElement;
    /** Called after a frame is submitted; observational only. */
    readonly onFrame?: () => void;
    readonly onReady?: () => void;
    readonly onError?: (error: Error) => void;
};

export type ZenBackgroundController = {
    readonly captureSnapshot: () => Promise<FrameGraphSnapshot | undefined>;
    readonly dispose: () => void;
};

type PendingCapture = {
    readonly promise: Promise<FrameGraphSnapshot | undefined>;
    readonly resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
};

export function notifyStartError(options: ZenBackgroundOptions, error: Error): void {
    try {
        options.onError?.(error);
    }
    catch {
        // Host notifications must not obscure the initialization failure.
    }
}

export function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export abstract class BackgroundBrowserHost implements ZenBackgroundController {
    protected readonly uniformData = new Float32Array(frameParamsFloatCount);
    protected readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    protected readonly coarsePointer = window.matchMedia('(pointer: coarse)');
    protected readonly interactionTarget: EventTarget;
    protected readonly resizeObserver: ResizeObserver | undefined;
    protected animationFrame = 0;
    protected previousFrameTime = 0;
    protected frameIndex = 0;
    protected width = 1;
    protected height = 1;
    protected fieldWidth = 1;
    protected fieldHeight = 1;
    protected bloomWidth = 1;
    protected bloomHeight = 1;
    protected targetPointerX = 0.76;
    protected targetPointerY = 0.42;
    protected pointerX = this.targetPointerX;
    protected pointerY = this.targetPointerY;
    protected velocityX = 0;
    protected velocityY = 0;
    protected pointerPressure = 0;
    protected pendingPointerTravel = 0;
    protected hasPointerSample = false;
    protected resizePending = true;
    protected dirty = true;
    protected disposed = false;
    protected readyReported = false;
    protected reportCaptured = false;
    protected pendingCapture: PendingCapture | undefined;
    protected captureInFlight = false;

    constructor(
        protected readonly canvas: HTMLCanvasElement,
        protected readonly resources: BackgroundResources,
        protected readonly options: ZenBackgroundOptions,
    ) {
        this.interactionTarget = options.interactionTarget ?? canvas;
        this.resizeObserver = typeof ResizeObserver === 'undefined'
            ? undefined
            : new ResizeObserver(this.handleResize);
    }

    start(): void {
        window.addEventListener('resize', this.handleResize, { passive: true });
        this.resizeObserver?.observe(this.canvas);
        this.interactionTarget.addEventListener('pointermove', this.handlePointer as EventListener, { passive: true });
        this.interactionTarget.addEventListener('pointerdown', this.handlePointer as EventListener, { passive: true });
        window.addEventListener('pageshow', this.handlePageShow);
        document.addEventListener('visibilitychange', this.handleVisibility);
        this.reducedMotion.addEventListener('change', this.handleMotionPreference);
        this.coarsePointer.addEventListener('change', this.handleResize);
        void this.resources.device.lost.then((info) => {
            if (this.disposed) return;
            this.fail(new Error(`Interactive background WebGPU device was lost: ${info.message || info.reason}`));
        });
        this.requestFrame();
    }

    captureSnapshot(): Promise<FrameGraphSnapshot | undefined> {
        if (this.disposed) return Promise.resolve(undefined);
        if (this.pendingCapture) return this.pendingCapture.promise;

        let resolveCapture: PendingCapture['resolve'] = () => undefined;
        const promise = new Promise<FrameGraphSnapshot | undefined>((resolve) => {
            resolveCapture = resolve;
        });
        this.pendingCapture = { promise, resolve: resolveCapture };
        this.dirty = true;
        this.requestFrame();
        return promise;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = 0;
        window.removeEventListener('resize', this.handleResize);
        this.resizeObserver?.disconnect();
        this.interactionTarget.removeEventListener('pointermove', this.handlePointer as EventListener);
        this.interactionTarget.removeEventListener('pointerdown', this.handlePointer as EventListener);
        window.removeEventListener('pageshow', this.handlePageShow);
        document.removeEventListener('visibilitychange', this.handleVisibility);
        this.reducedMotion.removeEventListener('change', this.handleMotionPreference);
        this.coarsePointer.removeEventListener('change', this.handleResize);
        this.pendingCapture?.resolve(undefined);
        this.pendingCapture = undefined;
    }

    protected readonly handleResize = (): void => {
        this.resizePending = true;
        this.dirty = true;
        this.requestFrame();
    };

    protected readonly handlePointer = (event: PointerEvent): void => {
        if (!event.isPrimary) return;
        const bounds = this.canvas.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return;
        const nextX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
        const nextY = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
        if (!this.hasPointerSample) {
            this.pointerX = nextX;
            this.pointerY = nextY;
            this.hasPointerSample = true;
        }
        else {
            const deltaX = nextX - this.targetPointerX;
            const deltaY = nextY - this.targetPointerY;
            const pointerAspect = this.width / this.height;
            this.pendingPointerTravel += Math.hypot(deltaX * pointerAspect, deltaY);
            this.velocityX = this.velocityX * 0.35 + deltaX * 0.65;
            this.velocityY = this.velocityY * 0.35 + deltaY * 0.65;
        }
        this.targetPointerX = nextX;
        this.targetPointerY = nextY;
        if (event.type === 'pointerdown') {
            this.pointerPressure = Math.max(this.pointerPressure, pointerDownPressure);
        }
        this.dirty = true;
        this.requestFrame();
    };

    protected readonly handleVisibility = (): void => {
        if (document.visibilityState === 'visible') this.resumeRendering();
    };

    protected readonly handlePageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) this.resumeRendering();
    };

    protected readonly handleMotionPreference = (): void => {
        this.previousFrameTime = 0;
        this.dirty = true;
        this.requestFrame();
    };

    protected resumeRendering(): void {
        if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = 0;
        this.previousFrameTime = 0;
        this.dirty = true;
        this.requestFrame();
    }

    protected requestFrame(): void {
        if (this.disposed || this.animationFrame !== 0 || document.visibilityState === 'hidden') return;
        this.animationFrame = requestAnimationFrame(this.renderFrame);
    }
    protected abstract readonly renderFrame: (now: number) => void;

    protected resizeCanvas(): void {
        const bounds = this.canvas.getBoundingClientRect();
        const cssWidth = Math.max(1, bounds.width || this.canvas.clientWidth);
        const cssHeight = Math.max(1, bounds.height || this.canvas.clientHeight);
        const dimensions = resolveCanvasDimensions(
            cssWidth,
            cssHeight,
            window.devicePixelRatio,
            this.coarsePointer.matches,
            fieldDownsample,
        );
        this.width = dimensions.width;
        this.height = dimensions.height;
        this.fieldWidth = dimensions.fieldWidth;
        this.fieldHeight = dimensions.fieldHeight;
        this.bloomWidth = dimensions.bloomWidth;
        this.bloomHeight = dimensions.bloomHeight;
        if (this.canvas.width !== this.width) this.canvas.width = this.width;
        if (this.canvas.height !== this.height) this.canvas.height = this.height;
        this.resizePending = false;
    }

    protected updatePointer(deltaSeconds: number): void {
        this.pointerPressure = resolvePointerPressure(
            this.pointerPressure,
            this.pendingPointerTravel,
            deltaSeconds,
            this.reducedMotion.matches,
        );
        this.pendingPointerTravel = 0;
        const response = 1 - Math.exp(-deltaSeconds * pointerFollowRate);
        this.pointerX += (this.targetPointerX - this.pointerX) * response;
        this.pointerY += (this.targetPointerY - this.pointerY) * response;
        const velocityDecay = Math.exp(-deltaSeconds * pointerVelocityDecayRate);
        this.velocityX *= velocityDecay;
        this.velocityY *= velocityDecay;
    }

    protected updateUniforms(timeSeconds: number, deltaSeconds: number): void {
        this.uniformData.set([
            this.width,
            this.height,
            this.fieldWidth,
            this.fieldHeight,
            this.pointerX,
            this.pointerY,
            this.velocityX,
            this.velocityY,
            timeSeconds,
            deltaSeconds,
            this.width / this.height,
            this.pointerPressure,
            this.frameIndex,
            this.reducedMotion.matches ? 1 : 0,
            1 - this.pointerPressure,
            this.coarsePointer.matches ? 1 : 0,
        ]);
        this.resources.device.queue.writeBuffer(this.resources.uniformBuffer, 0, this.uniformData);
    }
    protected abstract recordAndExecuteFrame(): void;

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
        }
        catch {
            if (!this.disposed && this.pendingCapture === capture) capture.resolve(undefined);
        }
        finally {
            if (this.pendingCapture === capture) this.pendingCapture = undefined;
            this.captureInFlight = false;
        }
    }

    protected notifyReady(): void {
        try {
            this.options.onReady?.();
        }
        catch {
            // Host notifications must not break the renderer.
        }
    }

    protected fail(error: Error): void {
        try {
            this.options.onError?.(error);
        }
        catch {
            // Host notifications must not obscure the rendering failure.
        }
        this.dispose();
    }
}
