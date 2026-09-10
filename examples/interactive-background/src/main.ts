/**
 * Source: Original ZenFG repository showcase.
 * Demonstrates: Transient textures and a five-pass compute/render graph.
 * Flow: Initialize device and pipelines; update pointer/frame parameters; record flow,
 * HDR lattice, bloom extraction, blur and tone mapping; submit and dispose.
 * Read next: backgroundGraph.ts (five passes), resources.ts (pipelines),
 * backgroundShaders.ts (WGSL), host.ts (input, scheduling and snapshots).
 */
import { recordBackground } from './backgroundGraph.ts';
import { BackgroundBrowserHost, desktopTargetFrameRate, mobileTargetFrameRate, notifyStartError, toError, type ZenBackgroundController, type ZenBackgroundOptions } from './host.ts';
import { createBackgroundResources } from './resources.ts';
export type { ZenBackgroundController, ZenBackgroundOptions } from './host.ts';

export async function startZenBackground(
    canvas: HTMLCanvasElement,
    options: ZenBackgroundOptions = {},
): Promise<ZenBackgroundController | undefined> {
    if (!navigator.gpu) {
        notifyStartError(options, new Error('WebGPU is not available in this browser.'));
        return undefined;
    }

    let device: GPUDevice | undefined;
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
        const context = canvas.getContext('webgpu');
        if (!context) {
            device.destroy();
            notifyStartError(options, new Error('The canvas could not create a WebGPU context.'));
            return undefined;
        }
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        const resources = await createBackgroundResources(device, context, format);
        const background = new ZenBackground(canvas, resources, options);
        background.start();
        return background;
    }
    catch (error) {
        device?.destroy();
        notifyStartError(options, toError(error));
        return undefined;
    }
}

class ZenBackground extends BackgroundBrowserHost {
    protected override readonly renderFrame = (now: number): void => {
        this.animationFrame = 0;
        if (this.disposed || document.visibilityState === 'hidden') return;

        const targetFrameRate = this.coarsePointer.matches ? mobileTargetFrameRate : desktopTargetFrameRate;
        const targetInterval = 1000 / targetFrameRate;
        if (!this.reducedMotion.matches && this.previousFrameTime > 0 && now - this.previousFrameTime < targetInterval) {
            this.requestFrame();
            return;
        }
        if (this.reducedMotion.matches && !this.dirty && !this.pendingCapture) return;

        try {
            if (this.resizePending) this.resizeCanvas();
            const deltaSeconds = this.previousFrameTime === 0
                ? 1 / 60
                : Math.min(0.05, (now - this.previousFrameTime) / 1000);
            this.previousFrameTime = now;
            this.updatePointer(deltaSeconds);
            this.updateUniforms(now / 1000, deltaSeconds);
            this.recordAndExecuteFrame();
            this.frameIndex += 1;
            try { this.options.onFrame?.(); } catch { /* Telemetry must not interrupt rendering. */ }
            this.dirty = false;
            if (!this.readyReported) {
                this.readyReported = true;
                this.notifyReady();
            }
        }
        catch (error) {
            this.fail(toError(error));
            return;
        }

        if (!this.reducedMotion.matches || this.pendingCapture) this.requestFrame();
    };

    protected override recordAndExecuteFrame(): void {
        const recorder = this.resources.graph.beginFrame();
        // Flow -> HDR lattice -> bloom extraction -> blur -> tone mapping.
        const backbuffer = recordBackground(recorder, this.resources, {
            width: this.width, height: this.height, fieldWidth: this.fieldWidth, fieldHeight: this.fieldHeight,
            bloomWidth: this.bloomWidth, bloomHeight: this.bloomHeight,
        });
        recorder.markPresent(backbuffer);
        const capture = this.pendingCapture;
        const shouldCapture = Boolean(capture) && !this.captureInFlight;
        const shouldReport = !this.reportCaptured || shouldCapture;
        if (!shouldReport) {
            recorder.compile().execute({ frameIndex: this.frameIndex });
            return;
        }

        const compiled = recorder.compile({ report: true });
        if (!this.reportCaptured) {
            this.canvas.dataset.frameGraph = compiled.compilationReport.nodes.map((node) => node.label).join(' → ');
            this.canvas.dataset.frameGraphPasses = String(compiled.compilationReport.nodes.length);
            this.reportCaptured = true;
        }
        if (!capture || !shouldCapture) {
            compiled.execute({ frameIndex: this.frameIndex });
            return;
        }

        this.captureInFlight = true;
        const timing = compiled.execute({
            frameIndex: this.frameIndex,
            gpuTiming: true,
        });
        void this.finishCapture(capture, compiled.compilationReport, timing);
    }

    override dispose(): void {
        if (this.disposed) return;
        super.dispose();
        this.resources.graph.destroy();
        this.resources.uniformBuffer.destroy();
        this.resources.context.unconfigure();
        this.resources.device.destroy();
    }
}
