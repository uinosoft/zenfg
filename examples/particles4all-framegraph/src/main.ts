/**
 * Source: Adapted from matsuoka-601/Particles4All, commit
 * 58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0, with t3d-next integration references.
 * See THIRD_PARTY_NOTICES.md for source revisions and asset attribution.
 * Demonstrates: Fluid/rigid-body simulation, transient allocation and four rendering modes.
 * Flow: Create device/workload and connect interaction; record simulation,
 * diagnostics and rendering; refresh changed resource pools; commit after submit.
 * Read next: Particles4AllFeature.ts (workload), settings.ts (presets),
 * upstream/* (algorithms/WGSL), host.ts (input, environment, disposal and snapshots).
 */
import { FrameGraph } from '@zenfg/webgpu';
import { createHostSupport, notify, particles4AllDeviceDescriptor, resolveCanvasBackingSize, type Particles4AllController, type StartParticles4AllOptions, type Workload } from './host.ts';
import { Particles4All } from './Particles4AllFeature.ts';
export { particles4AllDeviceDescriptor, resolveCanvasBackingSize } from './host.ts';
export type { Particles4AllController, Particles4AllState, StartParticles4AllOptions } from './host.ts';

export async function startParticles4All(canvas: HTMLCanvasElement, options: StartParticles4AllOptions = {}): Promise<Particles4AllController> {
    options.signal?.throwIfAborted();
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    notify(() => options.onLoading?.('Requesting WebGPU device…'));
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    options.signal?.throwIfAborted();
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    const device = await adapter.requestDevice(particles4AllDeviceDescriptor(adapter));
    let context: GPUCanvasContext | null = null;
    let graph: FrameGraph | undefined;
    let workload: Particles4All | undefined;
    try {
        options.signal?.throwIfAborted();
        context = canvas.getContext('webgpu');
        if (!context) throw new Error('Unable to acquire a WebGPU canvas context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        const size = resolveCanvasBackingSize(canvas, window.devicePixelRatio, device.limits.maxTextureDimension2D);
        canvas.width = size.width;
        canvas.height = size.height;
        context.configure({ device, format, alphaMode: 'opaque' });
        notify(() => options.onLoading?.('Preparing fluid simulation and rendering pipelines…'));
        workload = new Particles4All({ device, viewport: size, outputFormat: format, initialSettings: options.initialSettings });
        graph = new FrameGraph(device);
        options.signal?.throwIfAborted();
        return createParticles4AllHost(canvas, device, context, graph, workload, options);
    } catch (error) {
        workload?.dispose();
        graph?.destroy();
        context?.unconfigure();
        device.destroy();
        throw error;
    }
}

export function createParticles4AllHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext,
    graph: FrameGraph, workload: Workload, options: StartParticles4AllOptions): Particles4AllController {
    const host = createHostSupport(canvas, device, graph, workload, options, render, () => {
        workload.dispose();
        graph.destroy();
        context.unconfigure();
        device.destroy();
    });
    const frameState = host.frameState;

    function render(now: number): void {
        frameState.frameId = 0;
        if (frameState.disposed || host.suspended()) { host.settleCapture(); return; }
        let pending: ReturnType<Workload['recordFrameGraph']> | undefined;
        try {
            host.resize();
            // The workload applies timeScale after this browser-frame clamp, like upstream.
            const deltaTime = frameState.previousTime === undefined ? 0 : Math.min(0.05, Math.max(0, (now - frameState.previousTime) / 1000));
            frameState.previousTime = now;
            const recording = graph.beginFrame();
            const color = recording.importSwapchainTexture(context.getCurrentTexture(), { label: 'particles4all.backbuffer' });
            pending = workload.recordFrameGraph(recording, { color, deltaTime });
            // Preparation can resize the simulation box or append particles. Its
            // actual descriptors are known here, before compile allocates resources.
            if (frameState.transientResourceKey !== undefined && frameState.transientResourceKey !== pending.transientResourceKey) graph.clearResourcePool();
            frameState.transientResourceKey = pending.transientResourceKey;
            recording.markPresent(color);
            const afterSubmit = (): undefined => { pending!.commit(); return undefined; };
            const capture = frameState.pendingCapture;
            if (capture && !frameState.capturing) {
                const compiled = recording.compile({ report: true });
                frameState.capturing = capture;
                const timing = compiled.execute({ frameIndex: frameState.frameIndex, afterSubmit, gpuTiming: true });
                void host.finishCapture(capture, compiled.compilationReport, timing);
            } else {
                recording.compile().execute({ frameIndex: frameState.frameIndex, afterSubmit });
            }
            frameState.frameIndex++;
            notify(() => options.onFrame?.());
            if (!frameState.ready) {
                frameState.ready = true;
                if (frameState.status === 'Preparing first frame…') frameState.status = 'Running';
                notify(() => options.onReady?.('Live · Particles4All simulation + ZenFG'));
                host.changed();
            }
        } catch (error) {
            pending?.discard();
            host.fail(error);
            return;
        }
        host.requestFrame();
    }

    return host.controller;
}
