/**
 * Source: Adapted from Software Mansion TypeGPU Slime Mold, commit
 * 8d923c9f7a170a2bfad15c2de7e3df3914d36f30. See THIRD_PARTY_NOTICES.md.
 * Demonstrates: TypeGPU-owned shaders/resources recorded as native ZenFG passes.
 * Flow: Create the device and simulation; record reset, diffusion, agents and
 * rendering; commit persistent state only after submission; dispose on exit.
 * Read next: slimeMold.ts (simulation and passes), types.ts (workload contract),
 * host.ts (frame scheduling, resize, controls and snapshots).
 */
import {
    FrameGraph
} from '@zenfg/webgpu';
import { SlimeMoldBrowserHost, notifyStartError, resolveCanvasBackingSize, toError } from './host.ts';
import { TypeGpuSlimeMold } from './slimeMold.ts';
import type {
    PendingSlimeMoldFrame,
    StartTypeGpuSlimeMoldOptions,
    TypeGpuSlimeMoldController
} from './types.ts';
export { resolveCanvasBackingSize } from './host.ts';

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

class TypeGpuSlimeMoldHost extends SlimeMoldBrowserHost {
    protected override recordAndExecuteFrame(deltaTime: number): void {
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

    override dispose(): void {
        if (this.disposed) return;
        super.dispose();
        this.resources.simulation.destroy();
        this.resources.graph.destroy();
        this.resources.context.unconfigure();
        this.resources.device.destroy();
    }
}
