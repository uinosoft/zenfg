/**
 * Source: Original ZenFG showcase using the repository Reference Renderer.
 * Demonstrates: GPU culling, indirect drawing and explicit color/depth attachments.
 * Flow: Create device, renderer and scene; update the camera; record rendering
 * and presentation; compile, execute and release caller-owned resources.
 * Read next: renderer.ts (GPU workload), scene.ts and camera.ts (scene/view),
 * present.ts (tone mapping), host.ts (controls, events and snapshots).
 */
import { createReferenceRenderer } from '@zenfg-example/reference-renderer';
import { FrameGraph } from '@zenfg/webgpu';
import { createViewProjection } from './camera.ts';
import { createHostSupport, notifyError, resolveCanvasBackingSize, type ReferenceRendererController, type StartReferenceRendererOptions } from './host.ts';
import { createPresenter } from './present.ts';
import { createDemoInstances } from './scene.ts';
export { resolveCanvasBackingSize } from './host.ts';
export type { ReferenceRendererController, ReferenceRendererSettings, StartReferenceRendererOptions } from './host.ts';

export async function startReferenceRenderer(canvas: HTMLCanvasElement, options: StartReferenceRendererOptions = {}): Promise<ReferenceRendererController | undefined> {
    let device: GPUDevice | undefined;
    let context: GPUCanvasContext | undefined;
    let graph: FrameGraph | undefined;
    let renderer: ReturnType<typeof createReferenceRenderer> | undefined;
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
        renderer = createReferenceRenderer(device, { maxInstances: 10_000 });
        renderer.setInstances(createDemoInstances(1_000));
        const present = createPresenter(device, format);
        return createHost(canvas, device, context, graph, renderer, present, options);
    } catch (error) {
        renderer?.destroy();
        graph?.destroy();
        context?.unconfigure();
        device?.destroy();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    }
}

function createHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    renderer: ReturnType<typeof createReferenceRenderer>, present: ReturnType<typeof createPresenter>,
    options: StartReferenceRendererOptions): ReferenceRendererController {
    const host = createHostSupport(canvas, device, graph, renderer, options, renderFrame, () => {
        renderer.destroy();
        graph.destroy();
        context.unconfigure();
        device.destroy();
    });
    const state = host.state;

    function renderFrame(): void {
        state.animationFrame = 0;
        if (state.disposed || state.suspended) return;
        try {
            const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
            if (canvas.width !== size.width) canvas.width = size.width;
            if (canvas.height !== size.height) canvas.height = size.height;
            const frame = graph.beginFrame();
            const scene = frame.createTexture({ label: 'reference.scene-color', format: 'rgba16float', size: [size.width, size.height] });
            const depth = frame.createTexture({ label: 'reference.scene-depth', format: 'depth32float', size: [size.width, size.height] });
            const backbuffer = frame.importSwapchainTexture(context.getCurrentTexture(), { label: 'reference.backbuffer' });
            renderer.record(frame, {
                viewProjection: createViewProjection(
                    { ...state.camera, distance: state.camera.distance * Math.max(1, size.height / size.width) },
                    size.width / size.height,
                    state.settings.depthConvention === 'reverse-z',
                ),
                depthConvention: state.settings.depthConvention,
                culling: state.settings.culling,
                color: { target: scene, loadOp: 'clear', storeOp: 'store', clearValue: [0.012, 0.019, 0.028, 1] },
                depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: state.settings.depthConvention === 'reverse-z' ? 0 : 1 },
            });
            present(frame, scene, backbuffer);
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
                try { options.onReady?.('Live · GPU culling + indirect drawing'); } catch { /* Notifications do not own rendering. */ }
            }
        } catch (error) { host.fail(error); }
    }

    host.start();
    return host.controller;
}
