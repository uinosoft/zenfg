import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import {
    FrameGraph,
    type FrameGraphCompilationReport,
    type FrameGraphGpuTimingReport,
} from '@zenfg/webgpu';
import { TypeGpuSlimeMold } from './slimeMold.ts';
import type {
    PendingSlimeMoldFrame,
    SlimeMoldSettings,
    StartTypeGpuSlimeMoldOptions,
    TypeGpuSlimeMoldController,
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

class TypeGpuSlimeMoldHost implements TypeGpuSlimeMoldController {
    private readonly resizeObserver: ResizeObserver | undefined;
    private animationFrame = 0;
    private previousFrameTime: number | undefined;
    private frameIndex = 0;
    private resizePending = false;
    private disposed = false;
    private readyReported = false;
    private reportCaptured = false;
    private captureInFlight = false;
    private pendingCapture: PendingCapture | undefined;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly resources: SlimeMoldHostResources,
        private readonly options: StartTypeGpuSlimeMoldOptions,
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
        this.resources.simulation.destroy();
        this.resources.graph.destroy();
        this.resources.context.unconfigure();
        this.resources.device.destroy();
    }

    private readonly handleResize = (): void => {
        this.resizePending = true;
    };

    private readonly handleVisibility = (): void => {
        if (document.visibilityState === 'visible') this.resumeRendering();
    };

    private readonly handlePageShow = (event: PageTransitionEvent): void => {
        if (event.persisted) this.resumeRendering();
    };

    private readonly handleUncapturedError = (event: GPUUncapturedErrorEvent): void => {
        this.fail(new Error(event.error.message));
    };

    private resumeRendering(): void {
        if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = 0;
        this.previousFrameTime = undefined;
        this.requestFrame();
    }

    private requestFrame(): void {
        if (
            this.disposed
            || this.animationFrame !== 0
            || document.visibilityState === 'hidden'
        ) return;
        this.animationFrame = requestAnimationFrame(this.renderFrame);
    }

    private readonly renderFrame = (now: number): void => {
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

    private resizeCanvas(): void {
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

    private recordAndExecuteFrame(deltaTime: number): void {
        const { context, format, graph, simulation } = this.resources;
        const recorder = graph.beginFrame();
        const backbuffer = recorder.importSwapchainTexture(context.getCurrentTexture(), {
            label: `slime-mold.${format}.backbuffer`,
        });
        let pending: PendingSlimeMoldFrame | undefined;

        try {
            pending = simulation.recordFrameGraph(recorder, {
                color: backbuffer,
                deltaTime,
            });
            recorder.markPresent(backbuffer);

            const capture = this.pendingCapture;
            const shouldCapture = Boolean(capture) && !this.captureInFlight;
            const shouldReport = !this.reportCaptured || shouldCapture;
            const afterSubmit = (): undefined => {
                pending?.commit();
                return undefined;
            };
            if (!shouldReport) {
                recorder.compile().execute({ frameIndex: this.frameIndex, afterSubmit });
                return;
            }

            const compiled = recorder.compile({ report: true });
            if (!this.reportCaptured) {
                this.canvas.dataset.frameGraph = compiled.compilationReport.nodes
                    .map((node) => node.label)
                    .join(' → ');
                this.canvas.dataset.frameGraphPasses = String(
                    compiled.compilationReport.nodes.length,
                );
                this.reportCaptured = true;
            }

            if (!capture || !shouldCapture) {
                compiled.execute({ frameIndex: this.frameIndex, afterSubmit });
                return;
            }

            this.captureInFlight = true;
            const timing = compiled.execute({
                frameIndex: this.frameIndex,
                gpuTiming: true,
                afterSubmit,
            });
            void this.finishCapture(capture, compiled.compilationReport, timing);
        } catch (error) {
            pending?.discard();
            throw error;
        }
    }

    private async finishCapture(
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

    private notifyReady(): void {
        try {
            this.options.onReady?.('200,000 TypeGPU agents · 4 ZenFG passes');
        } catch {
            // Host notifications must not break the renderer.
        }
    }

    private fail(error: Error): void {
        try {
            this.options.onError?.(error);
        } catch {
            // Host notifications must not obscure the rendering failure.
        }
        this.dispose();
    }
}

export async function startTypeGpuSlimeMold(
    canvas: HTMLCanvasElement,
    options: StartTypeGpuSlimeMoldOptions = {},
): Promise<TypeGpuSlimeMoldController | undefined> {
    if (!navigator.gpu) {
        notifyStartError(options, new Error('WebGPU is not available in this browser.'));
        return undefined;
    }

    let device: GPUDevice | undefined;
    let context: GPUCanvasContext | undefined;
    let graph: FrameGraph | undefined;
    let simulation: TypeGpuSlimeMold | undefined;
    try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) {
            notifyStartError(options, new Error('No compatible WebGPU adapter was found.'));
            return undefined;
        }
        const requiredFeatures: GPUFeatureName[] = adapter.features.has('timestamp-query')
            ? ['timestamp-query']
            : [];
        device = await adapter.requestDevice({ requiredFeatures });
        context = canvas.getContext('webgpu') ?? undefined;
        if (!context) {
            device.destroy();
            notifyStartError(options, new Error('The canvas could not create a WebGPU context.'));
            return undefined;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        const size = resolveCanvasBackingSize(
            canvas,
            window.devicePixelRatio,
            device.limits.maxTextureDimension2D,
        );
        canvas.width = size.width;
        canvas.height = size.height;
        context.configure({
            device,
            format,
            alphaMode: 'premultiplied',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        graph = new FrameGraph(device);
        simulation = new TypeGpuSlimeMold({
            device,
            viewport: size,
            outputFormat: format,
        });
        const host = new TypeGpuSlimeMoldHost(
            canvas,
            { device, context, format, graph, simulation },
            options,
        );
        host.start();
        return host;
    } catch (error) {
        simulation?.destroy();
        graph?.destroy();
        context?.unconfigure();
        device?.destroy();
        notifyStartError(options, toError(error));
        return undefined;
    }
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

function notifyStartError(options: StartTypeGpuSlimeMoldOptions, error: Error): void {
    try {
        options.onError?.(error);
    } catch {
        // Host notifications must not obscure the initialization failure.
    }
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
