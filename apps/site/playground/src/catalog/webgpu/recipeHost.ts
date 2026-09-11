import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { FrameGraph, type FrameGraphRecorder } from '@zenfg/webgpu';
import { createFrameGraphSnapshot } from '@zenfg/webgpu/snapshot';
import type { PlaygroundMountContext } from '../../types.ts';

export type RecipeCanvasSize = {
	readonly width: number;
	readonly height: number;
};

type DestroyableGpuResource = {
	destroy(): void;
};

export type WebGpuRecipeHost = {
	readonly canvas: HTMLCanvasElement;
	readonly device: GPUDevice;
	readonly context: GPUCanvasContext;
	readonly format: GPUTextureFormat;
	readonly graph: FrameGraph;
	readonly size: () => RecipeCanvasSize;
	readonly nextFrameIndex: () => number;
	readonly own: <T extends DestroyableGpuResource>(resource: T) => T;
	readonly release: (resource: DestroyableGpuResource) => void;
	readonly renderOnResize: (render: (size: RecipeCanvasSize) => void | Promise<void>) => () => void;
	readonly capture: (
		record: (recorder: FrameGraphRecorder, frameIndex: number) => void,
	) => Promise<FrameGraphSnapshot>;
	readonly dispose: () => void;
};

export async function createWebGpuRecipeHost(
	mountContext: PlaygroundMountContext,
): Promise<WebGpuRecipeHost | undefined> {
	const initialized = await initializeWebGpu(mountContext);
	if (!initialized) return undefined;
	const { context, device, format } = initialized;

	const graph = new FrameGraph(device);
	const ownedResources = new Set<DestroyableGpuResource>();
	const resizeCleanups = new Set<() => void>();
	let frameIndex = 0;
	let disposed = false;
	let captureTail: Promise<void> = Promise.resolve();

	function resizeCanvas(): RecipeCanvasSize {
		const scale = Math.min(window.devicePixelRatio || 1, 2);
		const limit = device.limits.maxTextureDimension2D;
		const width = Math.max(1, Math.min(limit, Math.round(mountContext.canvas.clientWidth * scale)));
		const height = Math.max(1, Math.min(limit, Math.round(mountContext.canvas.clientHeight * scale)));
		if (mountContext.canvas.width !== width) mountContext.canvas.width = width;
		if (mountContext.canvas.height !== height) mountContext.canvas.height = height;
		return { width, height };
	}

	const host: WebGpuRecipeHost = {
		canvas: mountContext.canvas,
		device,
		context,
		format,
		graph,
		size: resizeCanvas,
		nextFrameIndex: () => frameIndex++,
		own<T extends DestroyableGpuResource>(resource: T): T {
			if (disposed) {
				resource.destroy();
				throw new Error('The WebGPU recipe host has been disposed.');
			}
			ownedResources.add(resource);
			return resource;
		},
		release(resource) {
			if (!ownedResources.delete(resource)) return;
			resource.destroy();
		},
		renderOnResize(render) {
			if (disposed) return () => undefined;
			let stopped = false;
			let running = false;
			let pending = true;
			const run = async (): Promise<void> => {
				if (running || stopped || disposed) return;
				running = true;
				try {
					while (pending && !stopped && !disposed) {
						pending = false;
						await render(resizeCanvas());
					}
				}
				catch (error) {
					mountContext.onError(toError(error));
				}
				finally {
					running = false;
				}
			};
			const requestRender = (): void => {
				pending = true;
				void run();
			};
			const observer = typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver(requestRender);
			observer?.observe(mountContext.canvas);
			window.addEventListener('resize', requestRender, { passive: true });
			requestRender();
			const stop = (): void => {
				if (stopped) return;
				stopped = true;
				observer?.disconnect();
				window.removeEventListener('resize', requestRender);
				resizeCleanups.delete(stop);
			};
			resizeCleanups.add(stop);
			return stop;
		},
		capture(record) {
			const result = captureTail.then(async () => {
				if (disposed) throw new Error('The WebGPU recipe host has been disposed.');
				const capturedFrameIndex = frameIndex++;
				const recorder = graph.beginFrame();
				record(recorder, capturedFrameIndex);
				const compiled = recorder.compile({ report: true });
				const timingPromise = compiled.execute({
					frameIndex: capturedFrameIndex,
					gpuTiming: true,
				});
				const resourcePool = graph.getResourcePoolStats();
				const gpuTiming = await timingPromise;
				return createFrameGraphSnapshot({
					compilation: compiled.compilationReport,
					gpuTiming,
					resourcePool,
				});
			});
			captureTail = result.then(() => undefined, () => undefined);
			return result;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const stop of [...resizeCleanups]) stop();
			for (const resource of ownedResources) safely(() => resource.destroy());
			ownedResources.clear();
			safely(() => graph.destroy());
			safely(() => context.unconfigure());
			safely(() => device.destroy());
		},
	};
	void device.lost.then((info) => {
		if (disposed || info.reason === 'destroyed') return;
		notifyError(mountContext, new Error(`WebGPU device was lost: ${info.message || info.reason}`));
		host.dispose();
	});

	return host;
}

async function initializeWebGpu(mountContext: PlaygroundMountContext): Promise<{
	readonly device: GPUDevice;
	readonly context: GPUCanvasContext;
	readonly format: GPUTextureFormat;
} | undefined> {
	if (!navigator.gpu) {
		notifyError(mountContext, new Error('WebGPU is not available in this browser.'));
		return undefined;
	}
	let device: GPUDevice | undefined;
	let context: GPUCanvasContext | null = null;
	try {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			notifyError(mountContext, new Error('No compatible WebGPU adapter was found.'));
			return undefined;
		}
		const requiredFeatures: GPUFeatureName[] = adapter.features.has('timestamp-query')
			? ['timestamp-query']
			: [];
		device = await adapter.requestDevice({ requiredFeatures });
		context = mountContext.canvas.getContext('webgpu');
		if (!context) {
			device.destroy();
			notifyError(mountContext, new Error('Could not acquire the canvas WebGPU context.'));
			return undefined;
		}
		const format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({
			device,
			format,
			alphaMode: 'opaque',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
		});
		return { device, context, format };
	}
	catch (error) {
		if (context) safely(() => context?.unconfigure());
		if (device) safely(() => device?.destroy());
		notifyError(mountContext, toError(error));
		return undefined;
	}
}

export function createRenderPipeline(
	device: GPUDevice,
	format: GPUTextureFormat,
	code: string,
	fragmentEntryPoint: string,
): GPURenderPipeline {
	const module = device.createShaderModule({ code });
	return device.createRenderPipeline({
		layout: 'auto',
		vertex: { module, entryPoint: 'vertexMain' },
		fragment: { module, entryPoint: fragmentEntryPoint, targets: [{ format }] },
		primitive: { topology: 'triangle-list' },
	});
}

export function createComputePipeline(device: GPUDevice, code: string): GPUComputePipeline {
	return device.createComputePipeline({
		layout: 'auto',
		compute: {
			module: device.createShaderModule({ code }),
			entryPoint: 'computeMain',
		},
	});
}

export function presentTexture(
	host: WebGpuRecipeHost,
	texture: GPUTexture,
	size: RecipeCanvasSize,
): void {
	const encoder = host.device.createCommandEncoder({ label: 'playground-present-texture' });
	encoder.copyTextureToTexture(
		{ texture },
		{ texture: host.context.getCurrentTexture() },
		{ width: size.width, height: size.height },
	);
	host.device.queue.submit([encoder.finish()]);
}

export function presentStorageBuffer(
	host: WebGpuRecipeHost,
	pipeline: GPURenderPipeline,
	buffer: GPUBuffer,
): void {
	const encoder = host.device.createCommandEncoder({ label: 'playground-present-compute-output' });
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
			view: host.context.getCurrentTexture().createView(),
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 },
		}],
	});
	const bindGroup = host.device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [{ binding: 0, resource: { buffer } }],
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.draw(3);
	pass.end();
	host.device.queue.submit([encoder.finish()]);
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function notifyError(context: PlaygroundMountContext, error: Error): void {
	try {
		context.onError(error);
	}
	catch {
		// Host notifications must not obscure initialization or device-loss cleanup.
	}
}

function safely(action: () => void): void {
	try {
		action();
	}
	catch {
		// Cleanup is best-effort so one WebGPU failure cannot skip later releases.
	}
}
