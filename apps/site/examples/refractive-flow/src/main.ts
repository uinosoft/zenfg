/**
 * Source: Original ZenFG refractive flow cover.
 * Demonstrates: Compute-driven optical ribbons, transient textures and multi-scale bloom.
 * Flow: Initialize device and pipelines; update pointer/frame parameters; update ribbon springs,
 * render transparent optics, reconstruct bloom and composite; submit and dispose.
 * Read next: graph.ts (eight passes), resources.ts (pipelines),
 * shaders.ts (WGSL), host.ts (input, scheduling and snapshots).
 */
import { recordSurface } from './graph.ts';
import { SurfaceBrowserHost, notifyStartError, toError, type RefractiveFlowController, type RefractiveFlowOptions } from './host.ts';
import { createSurfaceResources } from './resources.ts';
export type { RefractiveFlowController, RefractiveFlowOptions } from './host.ts';

export async function startRefractiveFlow(
	canvas: HTMLCanvasElement,
	options: RefractiveFlowOptions = {},
): Promise<RefractiveFlowController | undefined> {
	if (!navigator.gpu) {
		notifyStartError(options, new Error('WebGPU is not available in this browser.'));
		return undefined;
	}

	let device: GPUDevice | undefined;
	let context: GPUCanvasContext | null = null;
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
		context = canvas.getContext('webgpu');
		if (!context) {
			device.destroy();
			notifyStartError(options, new Error('The canvas could not create a WebGPU context.'));
			return undefined;
		}
		const format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({ device, format, alphaMode: 'opaque' });
		const resources = await createSurfaceResources(device, context, format);
		const background = new RefractiveFlow(canvas, resources, options);
		background.start();
		return background;
	}
	catch (error) {
		context?.unconfigure();
		device?.destroy();
		notifyStartError(options, toError(error));
		return undefined;
	}
}

class RefractiveFlow extends SurfaceBrowserHost {
	protected override readonly renderFrame = (now: number): void => {
		this.animationFrame = 0;
		if (this.disposed || !this.active || document.visibilityState === 'hidden') return;

		if (this.reducedMotion.matches && !this.dirty && !this.pendingCapture) return;

		try {
			if (this.resizePending) this.resizeCanvas();
			const deltaSeconds = this.previousFrameTime === 0
				? 1 / 60
				: Math.min(0.05, (now - this.previousFrameTime) / 1000);
			this.previousFrameTime = now;
			this.updatePointer(deltaSeconds);
			if (!this.reducedMotion.matches) this.elapsed += deltaSeconds;
			this.updateUniforms(this.reducedMotion.matches ? 0 : this.elapsed, deltaSeconds);
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
		// Curl/springs -> optical MRT -> bloom pyramid -> bounded composite.
		const backbuffer = recordSurface(recorder, this.resources, {
			width: this.width, height: this.height,
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
		this.resources.restBuffer.destroy();
		this.resources.motionBuffer.destroy();
		this.resources.context.unconfigure();
		this.resources.device.destroy();
	}
}
