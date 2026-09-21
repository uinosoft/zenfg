/**
 * Source: PixiJS container_tinting, composed with the ZenFG Reference Renderer.
 * Demonstrates: Pixi writes a shared texture sampled by a curved 3D screen.
 * Flow: Host owns device/texture; Pixi submits its writes; ZenFG draws and presents.
 * Read next: graph.ts for ownership and dependencies, pixi.ts for ordinary Pixi APIs,
 * screen.ts/present.ts for the two small shaders, host.ts for lifecycle details.
 */
import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../reference-renderer/src/index.ts';
import { createSharedTexture, recordSurface } from './graph.ts';
import { createHostSupport, notifyError, observe, type PixiController, type StartPixiOptions } from './host.ts';
import { SurfacePixi } from './pixi.ts';
import { createScreen } from './screen.ts';
import { createPresenter } from './present.ts';
import { createScene } from './scene.ts';
import { createControls } from './controls.ts';
import { renderSize, viewProjection } from './view.ts';
export type { PixiController, StartPixiOptions } from './host.ts';

export async function startPixiSurface(canvas: HTMLCanvasElement, options: StartPixiOptions = {}): Promise<PixiController | undefined> {
    let device: GPUDevice | undefined, context: GPUCanvasContext | undefined, graph: FrameGraph | undefined;
    let reference: ReturnType<typeof createReferenceRenderer> | undefined;
    let pixi: SurfacePixi | undefined, shared: GPUTexture | undefined;
    let screen: ReturnType<typeof createScreen> | undefined, controls: ReturnType<typeof createControls> | undefined;
    const release = () => {
        controls?.destroy(); pixi?.destroy(); screen?.destroy(); reference?.destroy();
        shared?.destroy(); graph?.destroy(); context?.unconfigure(); device?.destroy();
    };
    try {
        options.signal?.throwIfAborted();
        if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
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
        reference = createReferenceRenderer(device, { maxInstances: 3 });
        shared = createSharedTexture(device);
        screen = createScreen(device);
        const present = createPresenter(device, format);
        pixi = await SurfacePixi.create({ adapter, device }, shared, options.signal);
        options.signal?.throwIfAborted();
        const animation = pixi;
        controls = createControls(canvas, () => animation.reset(), options.controlsHost);
        return run(canvas, device, context, graph, reference, pixi, shared, screen, present, controls, options, release);
    } catch (error) {
        release();
        if (!options.signal?.aborted) notifyError(options, error);
        return undefined;
    }
}

function run(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    reference: ReturnType<typeof createReferenceRenderer>, pixi: SurfacePixi, shared: GPUTexture,
    screen: ReturnType<typeof createScreen>, present: ReturnType<typeof createPresenter>,
    controls: ReturnType<typeof createControls>, options: StartPixiOptions, release: () => void): PixiController {
    let lastTime = performance.now();
    const host = createHostSupport(device, graph, options, renderFrame, release, controls.cancel);
    const state = host.state;
    function renderFrame(): void {
        state.animationFrame = 0;
        if (state.disposed || state.suspended) return;
        try {
            const now = performance.now();
            const dt = controls.state.paused ? 0 : Math.min(0.04, (now - lastTime) / 1000);
            lastTime = now;
            controls.state.time += dt; pixi.update(dt);
            reference.setInstances(createScene(controls.state.time));
            const bounds = canvas.getBoundingClientRect();
            const size = renderSize(Math.max(1, bounds.width), Math.max(1, bounds.height), window.devicePixelRatio || 1, device.limits.maxTextureDimension2D);
            if (canvas.width !== size.width || canvas.height !== size.height) {
                controls.cancel(); graph.clearResourcePool();
                canvas.width = size.width; canvas.height = size.height;
            }
            const matrix = viewProjection(controls.camera, size.width / size.height);
            screen.update(matrix);

            // Update state → record dependencies → compile and execute synchronously.
            const frame = graph.beginFrame();
            frame.markPresent(recordSurface(frame, reference, pixi, shared, context.getCurrentTexture(), size.scene, matrix, screen, present));
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
            if (!state.ready) { state.ready = true; observe(options.onReady, undefined); }
        } catch (error) { host.fail(error); return; }
        host.requestFrame();
    }
    host.requestFrame();
    return host.controller;
}
