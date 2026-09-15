/**
 * Source: Adapted from t3d-next GSplat interop at d25a49c0a1bc3f6c994b3a4698c1ef7ce0f56710.
 * Uses PlayCanvas 2.21.4; see THIRD_PARTY_NOTICES.md for code and asset terms.
 * Demonstrates: Shared depth, external rendering and premultiplied GSplat composition.
 * Flow: PlayCanvas owns the device and attachments; Reference draws first,
 * PlayCanvas submits next, then the graph composites to the borrowed canvas.
 * Read next: scene.ts (content), shared graph.ts and bridge.ts (integration),
 * composite.ts (encoding), camera.ts and host.ts (input and lifecycle).
 */
import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { PlayCanvasSplatBridge } from '../../playcanvas-gsplat-shared/src/bridge.ts';
import { ExampleCamera } from '../../playcanvas-gsplat-shared/src/camera.ts';
import { createComposite } from '../../playcanvas-gsplat-shared/src/composite.ts';
import { recordCoRendering } from '../../playcanvas-gsplat-shared/src/graph.ts';
import { createHostSupport, notifyError, resolveCanvasBackingSize, type StartSplatOptions, type SplatController } from '../../playcanvas-gsplat-shared/src/host.ts';
import { source, createInstances } from './scene.ts';

export async function startPlayCanvasGsplatInterop(canvas: HTMLCanvasElement, options: StartSplatOptions = {}): Promise<SplatController | undefined> {
    const label = 'playcanvas-gsplat-interop';
    let bridge: PlayCanvasSplatBridge | undefined;
    let graph: FrameGraph | undefined;
    let reference: ReturnType<typeof createReferenceRenderer> | undefined;
    let context: GPUCanvasContext | undefined;
    const camera = new ExampleCamera(source.streaming);
    const release = () => {
        camera.destroyControls(); reference?.destroy(); graph?.destroy();
        context?.unconfigure(); bridge?.destroy();
    };
    try {
        options.signal?.throwIfAborted();
        if (!navigator.gpu) throw new Error('WebGPU is required.');
        delete canvas.dataset.renderedSplats; delete canvas.dataset.loadingSplats;
        options.onLoading?.('Loading ' + source.name + ' from its external host…');
        const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, 2048);
        bridge = await PlayCanvasSplatBridge.create(source, size.width, size.height, options.signal, message => options.onWarning?.(message));
        options.signal?.throwIfAborted();
        const device = bridge.device;
        context = canvas.getContext('webgpu') ?? undefined;
        if (!context) throw new Error('The canvas could not create a WebGPU context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        graph = new FrameGraph(device);
        reference = createReferenceRenderer(device, { maxInstances: 32 });
        reference.setInstances(createInstances());
        const composite = createComposite(device, format, label);
        const activeBridge = bridge, activeGraph = graph, activeReference = reference, activeContext = context;
        const host = createHostSupport(canvas, device, graph, camera, options, renderFrame, release);
        const state = host.state;
        let last = performance.now(), preparing = 0;
        function renderFrame(): void {
            state.animationFrame = 0;
            if (state.disposed || state.suspended) return;
            try {
                const now = performance.now(), delta = Math.min(0.05, (now - last) / 1000); last = now;
                const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
                if (canvas.width !== size.width || canvas.height !== size.height) {
                    activeGraph.clearResourcePool();
                    canvas.width = size.width; canvas.height = size.height;
                }
                activeBridge.resize(size.width, size.height);
                const matrices = camera.update(size.width / size.height, delta);
                activeBridge.syncCamera(matrices.world, matrices.projection, size.width / size.height);
                const frame = activeGraph.beginFrame();
                const { color, splatColor } = recordCoRendering(frame, activeBridge, activeReference, matrices.viewProjection, delta, label);
                const backbuffer = frame.importSwapchainTexture(activeContext.getCurrentTexture(), { label: label + '.backbuffer' });
                composite(frame, color, splatColor, backbuffer);
                frame.markPresent(backbuffer);
                const pending = state.capture !== state.captureInFlight ? state.capture : undefined;
                if (!state.ready || pending) {
                    const compiled = frame.compile({ report: true });
                    canvas.dataset.frameGraph = compiled.compilationReport.nodes.map(node => node.label).join(' → ');
                    if (pending) {
                        state.captureInFlight = pending;
                        void host.finishCapture(pending, compiled.compilationReport, compiled.executeWithTiming({ frameIndex: state.frameIndex++, timing: pending.timing }));
                    } else compiled.execute({ frameIndex: state.frameIndex++ });
                } else frame.compile().execute({ frameIndex: state.frameIndex++ });
                canvas.dataset.renderedSplats = String(activeBridge.renderedSplats);
                canvas.dataset.loadingSplats = String(activeBridge.loadingCount);
                try { options.onFrame?.(); } catch { /* Telemetry is observational. */ }
                if (!state.ready) {
                    preparing += delta;
                    if (activeBridge.renderedSplats > 0) {
                        state.ready = true;
                        try { options.onReady?.('Live · ' + source.name + ' + Reference Renderer'); } catch { /* Status is observational. */ }
                    } else if (preparing > 60) throw new Error('No visible splats arrived. Check the connection and retry.');
                }
            } catch (error) { host.fail(error); return; }
            host.requestFrame();
        }
        const controller: SplatController = {
            ...host.controller,
            setBudget: value => activeBridge.setBudget(value),
            resetView: () => camera.reset(),
        };
        host.requestFrame();
        return controller;
    } catch (error) {
        release();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    }
}
