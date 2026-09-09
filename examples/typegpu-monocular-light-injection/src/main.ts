/**
 * Source: Migrated from the t3d-next integration of TypeGPU Monocular Light Injection,
 * TypeGPU upstream commit 2adbc1b3636f2c7c1be00d242171e23c85c73898.
 * See THIRD_PARTY_NOTICES.md for the migration and inference-model attribution.
 * Demonstrates: DepthART inference, persistent depth history and image-space relighting.
 * Flow: Create device/workload; connect model and image/camera loading; record
 * depth when dirty and relight each frame; commit after submit; release inputs/GPU.
 * Read next: monocularLightInjection.ts (workload), model-store.ts (models),
 * monocularLightInjectionShaders.ts (shaders), host.ts (input and lifecycle).
 */
import { FrameGraph } from '@zenfg/webgpu';
import { type MonocularCameraFrame } from './camera-session.ts';
import { createHostSupport, type MonocularController, type StartMonocularOptions } from './host.ts';
import { createMonocularLightInjection, type MonocularLightInjectionWorkload } from './monocularLightInjection.ts';
import type { PendingMonocularFrame } from './types.ts';
export type { MonocularController, MonocularState, SourceMode, StartMonocularOptions } from './host.ts';


export async function startMonocularLightInjection(canvas: HTMLCanvasElement, options: StartMonocularOptions = {}): Promise<MonocularController> {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    if (typeof VideoFrame === 'undefined') throw new Error('This example requires VideoFrame support for still images.');
    options.signal?.throwIfAborted();
    options.onLoading?.('Requesting WebGPU device…');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    options.signal?.throwIfAborted();
    const requiredFeatures: GPUFeatureName[] = [];
    for (const feature of ['shader-f16', 'timestamp-query'] as const) {
        if (adapter.features.has(feature)) requiredFeatures.push(feature);
    }
    const device = await adapter.requestDevice({ requiredFeatures });
    const cancelInitialization = () => device.destroy();
    options.signal?.addEventListener('abort', cancelInitialization, { once: true });
    let context: GPUCanvasContext | null = null;
    let workload: MonocularLightInjectionWorkload | undefined;
    let graph: FrameGraph | undefined;
    try {
        options.signal?.throwIfAborted();
        context = canvas.getContext('webgpu');
        if (!context) throw new Error('Unable to acquire a WebGPU canvas context.');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        options.onLoading?.('Preparing lighting pipelines…');
        workload = await createMonocularLightInjection({ device, outputFormat: format });
        options.signal?.throwIfAborted();
        graph = new FrameGraph(device);
        return createBrowserHost(canvas, device, context, graph, workload, options);
    } catch (error) {
        workload?.dispose();
        graph?.destroy();
        context?.unconfigure();
        device.destroy();
        throw error;
    } finally {
        options.signal?.removeEventListener('abort', cancelInitialization);
    }
}

function createBrowserHost(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, graph: FrameGraph,
    workload: MonocularLightInjectionWorkload, options: StartMonocularOptions): MonocularController {
    const host = createHostSupport(canvas, device, graph, workload, options, render, () => {
        workload.dispose();
        graph.destroy();
        context.unconfigure();
        device.destroy();
    });
    const frameState = host.frameState;

    function render(frame: MonocularCameraFrame, updateDepth: boolean): boolean {
        if (frameState.disposed || frameState.pageHidden || frameState.modelBusy || !frameState.state.ready || document.visibilityState === 'hidden') return false;
        let pending: PendingMonocularFrame | undefined;
        try {
            host.resize();
            host.light.orbitTick();
            const recording = graph.beginFrame();
            const color = recording.importSwapchainTexture(context.getCurrentTexture(), { label: 'monocular.backbuffer' });
            pending = workload.recordFrame(recording, { ...frame, color, updateDepth });
            recording.markPresent(color);
            // Keep displaying the committed source while its replacement prepares,
            // but bind a waiting capture only after the latest source is installed.
            const requested = frameState.sourceBusy || frameState.preparingUpload ? undefined : frameState.capture;
            const afterSubmit = (): undefined => { pending!.commit(); frameState.depthDirty = false; return undefined; };
            if (requested || !frameState.reportedReady) {
                const compiled = recording.compile({ report: true });
                canvas.dataset.frameGraph = compiled.compilationReport.nodes.map((node) => node.label).join(' → ');
                canvas.dataset.frameGraphPasses = String(compiled.compilationReport.nodes.length);
                if (requested) {
                    frameState.capturesInFlight.add(requested.resolve);
                    const timing = compiled.execute({ frameIndex: frameState.frameIndex++, afterSubmit, gpuTiming: true });
                    frameState.capture = undefined;
                    void host.finishCapture(requested, compiled.compilationReport, timing);
                } else compiled.execute({ frameIndex: frameState.frameIndex++, afterSubmit });
            } else recording.compile().execute({ frameIndex: frameState.frameIndex++, afterSubmit });
            if (!frameState.reportedReady) {
                frameState.reportedReady = true;
                host.publish({ status: `Live · ${frameState.state.model}` });
                options.onReady?.('Live · TypeGPU depth inference + ZenFG');
            }
            return true;
        } catch (error) {
            pending?.discard();
            host.fail(error);
            return false;
        }
    }

    return host.controller;
}
