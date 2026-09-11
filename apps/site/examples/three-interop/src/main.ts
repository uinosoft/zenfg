/**
 * Source: Bridge adapted from t3d-next ThreeFrameGraphAdapter and three-interop;
 * the procedural scene is local. See THIRD_PARTY_NOTICES.md for attribution.
 * Demonstrates: Three.js and Reference Renderer co-rendering on shared color/depth.
 * Flow: Create device and engine bridge; update the camera; record external
 * rendering and native work; present and submit; dispose the owned device.
 * Read next: graph.ts (composition), bridge.ts (Three.js integration), scene.ts
 * (geometry), present.ts (presentation), host.ts (controls and snapshots).
 */
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { FrameGraph } from '@zenfg/webgpu';
import { ThreeBridge, updateCamera } from './bridge.ts';
import { recordCoRendering } from './graph.ts';
import { createHostSupport, notifyError, resolveCanvasBackingSize, type StartThreeInteropOptions, type ThreeInteropController } from './host.ts';
import { createPresenter } from './present.ts';
import { createReferenceInstances } from './scene.ts';
export { resolveCanvasBackingSize } from './host.ts';
export type { StartThreeInteropOptions, ThreeInteropController, ThreeInteropSettings } from './host.ts';

export async function startThreeInterop(canvas: HTMLCanvasElement, options: StartThreeInteropOptions = {}): Promise<ThreeInteropController | undefined> {
    let device: GPUDevice | undefined;
    let context: GPUCanvasContext | undefined;
    let graph: FrameGraph | undefined;
    let reference: ReturnType<typeof createReferenceRenderer> | undefined;
    let bridge: ThreeBridge | undefined;
    try {
        options.signal?.throwIfAborted();
        if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
        const adapter = await navigator.gpu.requestAdapter();
        options.signal?.throwIfAborted();
        if (!adapter) throw new Error('No compatible WebGPU adapter was found.');
        device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
        options.signal?.throwIfAborted();
        context = canvas.getContext('webgpu') ?? undefined;
        if (!context) throw new Error('The canvas could not create a WebGPU context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        graph = new FrameGraph(device);
        reference = createReferenceRenderer(device, { maxInstances: 32 });
        reference.setInstances(createReferenceInstances());
        const present = createPresenter(device, format);
        const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
        bridge = await ThreeBridge.create(device, size.width, size.height, true);
        options.signal?.throwIfAborted();
        return createHost(canvas, device, context, graph, reference, bridge, present, options);
    } catch (error) {
        bridge?.destroy();
        reference?.destroy();
        graph?.destroy();
        context?.unconfigure();
        device?.destroy();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    }
}

function createHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    reference: ReturnType<typeof createReferenceRenderer>, initialBridge: ThreeBridge,
    present: ReturnType<typeof createPresenter>, options: StartThreeInteropOptions): ThreeInteropController {
    const host = createHostSupport(canvas, device, graph, initialBridge, options, renderFrame, () => {
        state.bridge.destroy();
        reference.destroy();
        graph.destroy();
        context.unconfigure();
        device.destroy();
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
            // Match the base demo's narrow-screen framing without changing the orbit state.
            state.bridge.camera.zoom = Math.min(1, size.width / size.height);
            const viewProjection = updateCamera(state.bridge.camera, size.width / size.height, state.settings.reverseZ);
            const frame = graph.beginFrame();
            const { color } = recordCoRendering(frame, state.bridge, reference, viewProjection);
            const backbuffer = frame.importSwapchainTexture(context.getCurrentTexture(), { label: 'three-interop.backbuffer' });
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
                try { options.onReady?.('Live · Three.js + Reference Renderer · shared color and depth'); } catch { /* Notifications do not own rendering. */ }
            }
        } catch (error) {
            host.fail(error);
            return;
        }
        host.requestFrame();
    }

    host.requestFrame();
    return host.controller;
}
