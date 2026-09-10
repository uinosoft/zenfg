/**
 * Source: Bridge adapted from t3d-next BabylonFrameGraphAdapter; Babylon.js 9.4.0
 * owns the device. See THIRD_PARTY_NOTICES.md for attribution.
 * Demonstrates: Engine-owned device sharing and color/depth attachment normalization.
 * Flow: Create bridge and renderer; update camera; record Babylon, attachment
 * resolve and native drawing; present and submit; release through the bridge.
 * Read next: graph.ts (composition), bridge.ts (engine), resolve.ts (attachments),
 * scene.ts and present.ts, host.ts (input, depth switching and snapshots).
 */
import { createReferenceRenderer } from '@zenfg-example/reference-renderer';
import { FrameGraph } from '@zenfg/webgpu';
import { BabylonBridge } from './bridge.ts';
import { recordCoRendering } from './graph.ts';
import { createHostSupport, notifyError, resolveCanvasBackingSize, type BabylonInteropController, type StartBabylonInteropOptions } from './host.ts';
import { createPresenter } from './present.ts';
import { createAttachmentResolver, type AttachmentResolver } from './resolve.ts';
import { createReferenceInstances } from './scene.ts';
export { resolveCanvasBackingSize } from './host.ts';
export type { BabylonInteropController, BabylonInteropSettings, StartBabylonInteropOptions } from './host.ts';

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
    const host = createHostSupport(canvas, device, graph, initialBridge, options, renderFrame, () => {
        reference.destroy();
        graph.destroy();
        context.unconfigure();
        state.bridge.destroy();
    });
    const state = host.state;

    function renderFrame(): void {
        state.animationFrame = 0;
        if (state.disposed || state.suspended || state.switching) return;
        try {
            const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
            if (canvas.width !== size.width) canvas.width = size.width;
            if (canvas.height !== size.height) canvas.height = size.height;
            state.bridge.resize(size.width, size.height);
            const viewProjection = state.bridge.updateCamera();
            const frame = graph.beginFrame();
            const { color } = recordCoRendering(frame, state.bridge, reference, viewProjection, resolve);
            const backbuffer = frame.importSwapchainTexture(context.getCurrentTexture(), { label: 'babylon-interop.backbuffer' });
            present(frame, color, backbuffer);
            frame.markPresent(backbuffer);
            const pending = state.capture !== state.captureInFlight ? state.capture : undefined;
            if (!state.ready || pending) {
                const compiled = frame.compile({ report: true });
                canvas.dataset.frameGraph = compiled.compilationReport.nodes.map(node => node.label).join(' → ');
                canvas.dataset.frameGraphPasses = String(compiled.compilationReport.nodes.length);
                if (pending) {
                    state.captureInFlight = pending;
                    void host.finishCapture(pending, compiled.compilationReport, compiled.execute({ frameIndex: state.frameIndex++, gpuTiming: true }));
                } else compiled.execute({ frameIndex: state.frameIndex++ });
            } else frame.compile().execute({ frameIndex: state.frameIndex++ });
            try { options.onFrame?.(); } catch { /* Telemetry must not interrupt rendering. */ }
            if (!state.ready) {
                state.ready = true;
                try { options.onReady?.('Live · Babylon.js + Reference Renderer · shared color and depth'); } catch { /* Notifications do not own rendering. */ }
            }
        } catch (error) { host.fail(error); }
    }

    host.start();
    return host.controller;
}
