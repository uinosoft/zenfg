/**
 * Source: Original ZenFG showcase using PixiJS 8.21.0 and the Reference Renderer.
 * Demonstrates: A live 3D texture composed with 2D artwork through a built-in Pixi filter.
 * Flow: The host owns device and viewport; Reference writes, Pixi borrows and samples,
 * then submits to the canvas. ZenFG orders both renderers through explicit resource uses.
 * Read next: graph.ts (complete graph), pixi.ts (Pixi setup), artwork.ts (2D scene),
 * scene.ts and view.ts (3D city/camera), host.ts (scheduling and snapshots).
 */
import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { createViewportTexture, recordPortal } from './graph.ts';
import { createHostSupport, notifyError, observe, type PixiController, type StartPixiOptions } from './host.ts';
import { PortalPixi } from './pixi.ts';
import { createCity } from './scene.ts';
import { backingSize, portalLayout, viewProjection } from './view.ts';
export type { PixiController, StartPixiOptions } from './host.ts';

const viewportRenderScale = 2; // Preserve detail when the lens enlarges the city.

export async function startPixiInterop(canvas: HTMLCanvasElement, options: StartPixiOptions = {}): Promise<PixiController | undefined> {
    let device: GPUDevice | undefined;
    let graph: FrameGraph | undefined;
    let reference: ReturnType<typeof createReferenceRenderer> | undefined;
    let pixi: PortalPixi | undefined;
    let viewport: { texture: GPUTexture } | undefined;
    const release = () => {
        pixi?.destroy();
        viewport?.texture.destroy();
        reference?.destroy();
        graph?.destroy();
        device?.destroy();
    };
    try {
        options.signal?.throwIfAborted();
        if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
        const adapter = await navigator.gpu.requestAdapter();
        options.signal?.throwIfAborted();
        if (!adapter) throw new Error('No compatible WebGPU adapter was found.');
        device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
        options.signal?.throwIfAborted();
        graph = new FrameGraph(device);
        reference = createReferenceRenderer(device, { maxInstances: 64 });
        reference.setInstances(createCity());
        viewport = { texture: createViewportTexture(device, 1) };
        pixi = await PortalPixi.create(canvas, { adapter, device }, viewport.texture, options.signal);
        options.signal?.throwIfAborted();
        return run(canvas, device, graph, reference, pixi, viewport, options, release);
    } catch (error) {
        release();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    }
}

function run(canvas: HTMLCanvasElement, device: GPUDevice, graph: FrameGraph,
    reference: ReturnType<typeof createReferenceRenderer>, pixi: PortalPixi, viewport: { texture: GPUTexture },
    options: StartPixiOptions, release: () => void): PixiController {
    let lastTime = performance.now();
    const host = createHostSupport(device, graph, options, renderFrame, release, () => pixi.cancelInteraction());
    const state = host.state;

    function renderFrame(): void {
        state.animationFrame = 0;
        if (state.disposed || state.suspended) return;
        try {
            const now = performance.now();
            const size = backingSize(canvas, device.limits.maxTextureDimension2D);
            const layout = portalLayout(size.width, size.height);
            const pixels = Math.max(1, Math.min(device.limits.maxTextureDimension2D,
                Math.round(layout.radius * 2 * size.resolution * viewportRenderScale)));
            pixi.resize(size.width, size.height, size.resolution);
            if (pixels !== viewport.texture.width) {
                const previous = viewport.texture;
                const next = createViewportTexture(device, pixels);
                try { pixi.setViewport(next); }
                catch (error) { next.destroy(); throw error; }
                viewport.texture = next; // Rebind before releasing the previous physical image.
                previous.destroy();
                graph.clearResourcePool();
            }
            pixi.update(Math.min(0.04, (now - lastTime) / 1000));
            lastTime = now;

            // After acquiring the canvas image, record and execute synchronously.
            const frame = graph.beginFrame();
            const output = recordPortal(frame, reference, pixi, viewport.texture, pixi.context.getCurrentTexture(),
                viewProjection(pixi.camera));
            frame.markPresent(output);
            const pending = state.capture !== state.captureInFlight ? state.capture : undefined;
            if (!state.ready || pending) {
                const compiled = frame.compile({ report: true });
                canvas.dataset.frameGraph = compiled.compilationReport.nodes.map(node => node.label).join(' → ');
                canvas.dataset.frameGraphPasses = String(compiled.compilationReport.nodes.length);
                if (pending) {
                    state.captureInFlight = pending;
                    void host.finishCapture(pending, compiled.compilationReport,
                        compiled.executeWithTiming({ frameIndex: state.frameIndex++, timing: pending.timing }));
                } else compiled.execute({ frameIndex: state.frameIndex++ });
            } else frame.compile().execute({ frameIndex: state.frameIndex++ });
            observe(options.onFrame, undefined);
            if (!state.ready) {
                state.ready = true;
                observe(options.onReady, undefined);
            }
        } catch (error) { host.fail(error); return; }
        host.requestFrame();
    }
    host.requestFrame();
    return host.controller;
}