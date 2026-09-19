/**
 * Source: Original ZenFG composition; Glyph integration follows pmndrs/glyph
 * 0.1.0 (2d543ee). See THIRD_PARTY_NOTICES.md for font and upstream attribution.
 * Demonstrates: Bitmap, MSDF and Slug text sharing color/depth with opaque meshes.
 * Flow: Host owns the device; Glyph owns text resources; Reference Renderer owns
 * meshes; ZenFG records attachments/passes and submits the frame; host disposes.
 * Read next: glyph.ts (official integration), settings.ts (text parameters),
 * scene.ts/camera.ts (transforms), present.ts (color), host.ts (browser lifecycle).
 */
import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { createGlyphLayer } from './glyph.ts';
import { createViewProjection } from './camera.ts';
import { createScene, textMatrix } from './scene.ts';
import { defaults } from './settings.ts';
import { createPresenter } from './present.ts';
import { createHostSupport, notifyError, observe, resolveCanvasBackingSize,
    type StartGlyphOptions, type GlyphController } from './host.ts';
export type { StartGlyphOptions, GlyphController, GlyphStatistics } from './host.ts';
export type { GlyphSettings } from './settings.ts';

export async function startGlyphInterop(canvas: HTMLCanvasElement, options: StartGlyphOptions = {}): Promise<GlyphController | undefined> {
    let device: GPUDevice | undefined, context: GPUCanvasContext | undefined, graph: FrameGraph | undefined;
    let meshes: ReturnType<typeof createReferenceRenderer> | undefined;
    let text: Awaited<ReturnType<typeof createGlyphLayer>> | undefined;
    const release = () => {
        text?.destroy(); meshes?.destroy(); graph?.destroy(); context?.unconfigure(); device?.destroy();
    };
    options.signal?.addEventListener('abort', release, { once: true });
    try {
        options.signal?.throwIfAborted();
        if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
        observe(options.onLoading, 'Preparing WebGPU…');
        const adapter = await navigator.gpu.requestAdapter();
        options.signal?.throwIfAborted();
        if (!adapter) throw new Error('No compatible WebGPU adapter was found.');
        device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
        options.signal?.throwIfAborted();
        context = canvas.getContext('webgpu') ?? undefined;
        if (!context) throw new Error('Could not create a WebGPU canvas.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        graph = new FrameGraph(device);
        meshes = createReferenceRenderer(device, { maxInstances: 2 });
        meshes.setInstances(createScene());
        observe(options.onLoading, 'Loading Glyph and three baked font formats…');
        text = await createGlyphLayer(device, defaults, options.signal);
        options.signal?.throwIfAborted();
        return run(canvas, device, context, graph, meshes, text, createPresenter(device, format), options, release);
    } catch (error) {
        release();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    } finally { options.signal?.removeEventListener('abort', release); }
}

function run(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    meshes: ReturnType<typeof createReferenceRenderer>, text: Awaited<ReturnType<typeof createGlyphLayer>>,
    present: ReturnType<typeof createPresenter>, options: StartGlyphOptions, release: () => void): GlyphController {
    const host = createHostSupport(canvas, device, graph, options, renderFrame, release);
    const state = host.state;
    function renderFrame(): void {
        state.animationFrame = 0;
        if (state.disposed || state.suspended) return;
        try {
            const size = resolveCanvasBackingSize(canvas, device.limits.maxTextureDimension2D);
            if (canvas.width !== size.width || canvas.height !== size.height) graph.clearResourcePool();
            if (canvas.width !== size.width) canvas.width = size.width;
            if (canvas.height !== size.height) canvas.height = size.height;
            if (state.textDirty || size.pixelRatio !== state.pixelRatio) {
                const metrics = text.update(state.settings, size.pixelRatio);
                state.textHeight = metrics.height;
                state.pixelRatio = size.pixelRatio;
                state.textDirty = false;
                observe(options.onStatistics, { glyphs: metrics.glyphCount, lines: metrics.lineCount });
                observe(options.onWarning, metrics.missingGlyphCount ? 'This font covers printable ASCII; some characters are missing.' : undefined);
            }
            const viewProjection = createViewProjection({ ...state.camera,
                distance: state.camera.distance * Math.max(1, size.height / size.width) }, size.width / size.height, false);
            text.setMatrix(textMatrix(viewProjection, state.settings, state.textHeight));
            const frame = graph.beginFrame();
            const color = frame.createTexture({ label: 'glyph.color', format: 'rgba16float', size: [size.width, size.height] });
            const depth = frame.createTexture({ label: 'glyph.depth', format: 'depth32float', size: [size.width, size.height] });
            const backbuffer = frame.importSwapchainTexture(context.getCurrentTexture(), { label: 'glyph.backbuffer' });
            meshes.record(frame, {
                viewProjection, depthConvention: 'forward-z',
                color: { target: color, loadOp: 'clear', storeOp: 'store', clearValue: [0.012, 0.019, 0.028, 1] },
                depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
            });
            frame.render({
                label: 'glyph.text',
                colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
                depthStencilAttachment: { target: depth, depthReadOnly: true },
                encode: ({ pass }) => { text.draw(pass, size.width, size.height); },
            });
            present(frame, color, backbuffer);
            frame.markPresent(backbuffer);
            const pending = state.capture !== state.captureInFlight ? state.capture : undefined;
            if (!state.ready || pending) {
                const compiled = frame.compile({ report: true });
                canvas.dataset.frameGraph = compiled.compilationReport.nodes.map(node => node.label).join(' → ');
                if (pending) {
                    state.captureInFlight = pending;
                    void host.finishCapture(pending, compiled.compilationReport,
                        compiled.executeWithTiming({ frameIndex: state.frameIndex++, timing: pending.timing }));
                } else compiled.execute({ frameIndex: state.frameIndex++ });
            } else frame.compile().execute({ frameIndex: state.frameIndex++ });
            observe(options.onFrame, undefined);
            if (!state.ready) { state.ready = true; observe(options.onReady, undefined); }
        } catch (error) { host.fail(error); return; }
        host.requestFrame();
    }
    host.requestFrame();
    return host.controller;
}
