import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { BufferAccess, FrameGraph, TextureAccess, type FrameGraphCompilationReport, type FrameGraphGpuTimingReport } from '@zenfg/webgpu';
import { resolvePointerPressure } from './backgroundInteraction.ts';
import { resolveCanvasDimensions } from './backgroundLayout.ts';
import {
	bloomBlurShader,
	bloomExtractShader,
	compositeShader,
	flowFieldShader,
	latticeShader,
} from './backgroundShaders.ts';

const frameParamsFloatCount = 16;
const fieldDownsample = 6;
const desktopTargetFrameRate = 60;
const mobileTargetFrameRate = 36;
const pointerFollowRate = 30;
const pointerVelocityDecayRate = 7;
const pointerDownPressure = 0.08;

export type ZenBackgroundOptions = {
	readonly interactionTarget?: Window | HTMLElement;
	readonly onReady?: () => void;
	readonly onError?: (error: Error) => void;
};

export type ZenBackgroundController = {
	readonly captureSnapshot: () => Promise<FrameGraphSnapshot | undefined>;
	readonly dispose: () => void;
};

type RenderPipelines = {
	readonly flow: GPUComputePipeline;
	readonly lattice: GPURenderPipeline;
	readonly bloomExtract: GPURenderPipeline;
	readonly bloomBlur: GPURenderPipeline;
	readonly composite: GPURenderPipeline;
};

type BackgroundResources = {
	readonly device: GPUDevice;
	readonly context: GPUCanvasContext;
	readonly format: GPUTextureFormat;
	readonly graph: FrameGraph;
	readonly uniformBuffer: GPUBuffer;
	readonly linearSampler: GPUSampler;
	readonly pipelines: RenderPipelines;
};

type PendingCapture = {
	readonly promise: Promise<FrameGraphSnapshot | undefined>;
	readonly resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
};

class ZenBackground implements ZenBackgroundController {
	private readonly uniformData = new Float32Array(frameParamsFloatCount);
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	private readonly coarsePointer = window.matchMedia('(pointer: coarse)');
	private readonly interactionTarget: EventTarget;
	private readonly resizeObserver: ResizeObserver | undefined;
	private animationFrame = 0;
	private previousFrameTime = 0;
	private frameIndex = 0;
	private width = 1;
	private height = 1;
	private fieldWidth = 1;
	private fieldHeight = 1;
	private bloomWidth = 1;
	private bloomHeight = 1;
	private targetPointerX = 0.76;
	private targetPointerY = 0.42;
	private pointerX = this.targetPointerX;
	private pointerY = this.targetPointerY;
	private velocityX = 0;
	private velocityY = 0;
	private pointerPressure = 0;
	private pendingPointerTravel = 0;
	private hasPointerSample = false;
	private resizePending = true;
	private dirty = true;
	private disposed = false;
	private readyReported = false;
	private reportCaptured = false;
	private pendingCapture: PendingCapture | undefined;
	private captureInFlight = false;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly resources: BackgroundResources,
		private readonly options: ZenBackgroundOptions,
	) {
		this.interactionTarget = options.interactionTarget ?? canvas;
		this.resizeObserver = typeof ResizeObserver === 'undefined'
			? undefined
			: new ResizeObserver(this.handleResize);
	}

	start(): void {
		window.addEventListener('resize', this.handleResize, { passive: true });
		this.resizeObserver?.observe(this.canvas);
		this.interactionTarget.addEventListener('pointermove', this.handlePointer as EventListener, { passive: true });
		this.interactionTarget.addEventListener('pointerdown', this.handlePointer as EventListener, { passive: true });
		window.addEventListener('pageshow', this.handlePageShow);
		document.addEventListener('visibilitychange', this.handleVisibility);
		this.reducedMotion.addEventListener('change', this.handleMotionPreference);
		this.coarsePointer.addEventListener('change', this.handleResize);
		void this.resources.device.lost.then((info) => {
			if (this.disposed) return;
			this.fail(new Error(`Interactive background WebGPU device was lost: ${info.message || info.reason}`));
		});
		this.requestFrame();
	}

	captureSnapshot(): Promise<FrameGraphSnapshot | undefined> {
		if (this.disposed) return Promise.resolve(undefined);
		if (this.pendingCapture) return this.pendingCapture.promise;

		let resolveCapture: PendingCapture['resolve'] = () => undefined;
		const promise = new Promise<FrameGraphSnapshot | undefined>((resolve) => {
			resolveCapture = resolve;
		});
		this.pendingCapture = { promise, resolve: resolveCapture };
		this.dirty = true;
		this.requestFrame();
		return promise;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		cancelAnimationFrame(this.animationFrame);
		this.animationFrame = 0;
		window.removeEventListener('resize', this.handleResize);
		this.resizeObserver?.disconnect();
		this.interactionTarget.removeEventListener('pointermove', this.handlePointer as EventListener);
		this.interactionTarget.removeEventListener('pointerdown', this.handlePointer as EventListener);
		window.removeEventListener('pageshow', this.handlePageShow);
		document.removeEventListener('visibilitychange', this.handleVisibility);
		this.reducedMotion.removeEventListener('change', this.handleMotionPreference);
		this.coarsePointer.removeEventListener('change', this.handleResize);
		this.pendingCapture?.resolve(undefined);
		this.pendingCapture = undefined;
		this.resources.graph.destroy();
		this.resources.uniformBuffer.destroy();
		this.resources.context.unconfigure();
		this.resources.device.destroy();
	}

	private readonly handleResize = (): void => {
		this.resizePending = true;
		this.dirty = true;
		this.requestFrame();
	};

	private readonly handlePointer = (event: PointerEvent): void => {
		if (!event.isPrimary) return;
		const bounds = this.canvas.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return;
		const nextX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
		const nextY = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
		if (!this.hasPointerSample) {
			this.pointerX = nextX;
			this.pointerY = nextY;
			this.hasPointerSample = true;
		}
		else {
			const deltaX = nextX - this.targetPointerX;
			const deltaY = nextY - this.targetPointerY;
			const pointerAspect = this.width / this.height;
			this.pendingPointerTravel += Math.hypot(deltaX * pointerAspect, deltaY);
			this.velocityX = this.velocityX * 0.35 + deltaX * 0.65;
			this.velocityY = this.velocityY * 0.35 + deltaY * 0.65;
		}
		this.targetPointerX = nextX;
		this.targetPointerY = nextY;
		if (event.type === 'pointerdown') {
			this.pointerPressure = Math.max(this.pointerPressure, pointerDownPressure);
		}
		this.dirty = true;
		this.requestFrame();
	};

	private readonly handleVisibility = (): void => {
		if (document.visibilityState === 'visible') this.resumeRendering();
	};

	private readonly handlePageShow = (event: PageTransitionEvent): void => {
		if (event.persisted) this.resumeRendering();
	};

	private readonly handleMotionPreference = (): void => {
		this.previousFrameTime = 0;
		this.dirty = true;
		this.requestFrame();
	};

	private resumeRendering(): void {
		if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
		this.animationFrame = 0;
		this.previousFrameTime = 0;
		this.dirty = true;
		this.requestFrame();
	}

	private requestFrame(): void {
		if (this.disposed || this.animationFrame !== 0 || document.visibilityState === 'hidden') return;
		this.animationFrame = requestAnimationFrame(this.renderFrame);
	}

	private readonly renderFrame = (now: number): void => {
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

	private resizeCanvas(): void {
		const bounds = this.canvas.getBoundingClientRect();
		const cssWidth = Math.max(1, bounds.width || this.canvas.clientWidth);
		const cssHeight = Math.max(1, bounds.height || this.canvas.clientHeight);
		const dimensions = resolveCanvasDimensions(
			cssWidth,
			cssHeight,
			window.devicePixelRatio,
			this.coarsePointer.matches,
			fieldDownsample,
		);
		this.width = dimensions.width;
		this.height = dimensions.height;
		this.fieldWidth = dimensions.fieldWidth;
		this.fieldHeight = dimensions.fieldHeight;
		this.bloomWidth = dimensions.bloomWidth;
		this.bloomHeight = dimensions.bloomHeight;
		if (this.canvas.width !== this.width) this.canvas.width = this.width;
		if (this.canvas.height !== this.height) this.canvas.height = this.height;
		this.resizePending = false;
	}

	private updatePointer(deltaSeconds: number): void {
		this.pointerPressure = resolvePointerPressure(
			this.pointerPressure,
			this.pendingPointerTravel,
			deltaSeconds,
			this.reducedMotion.matches,
		);
		this.pendingPointerTravel = 0;
		const response = 1 - Math.exp(-deltaSeconds * pointerFollowRate);
		this.pointerX += (this.targetPointerX - this.pointerX) * response;
		this.pointerY += (this.targetPointerY - this.pointerY) * response;
		const velocityDecay = Math.exp(-deltaSeconds * pointerVelocityDecayRate);
		this.velocityX *= velocityDecay;
		this.velocityY *= velocityDecay;
	}

	private updateUniforms(timeSeconds: number, deltaSeconds: number): void {
		this.uniformData.set([
			this.width,
			this.height,
			this.fieldWidth,
			this.fieldHeight,
			this.pointerX,
			this.pointerY,
			this.velocityX,
			this.velocityY,
			timeSeconds,
			deltaSeconds,
			this.width / this.height,
			this.pointerPressure,
			this.frameIndex,
			this.reducedMotion.matches ? 1 : 0,
			1 - this.pointerPressure,
			this.coarsePointer.matches ? 1 : 0,
		]);
		this.resources.device.queue.writeBuffer(this.resources.uniformBuffer, 0, this.uniformData);
	}

	private recordAndExecuteFrame(): void {
		const { context, format, graph, linearSampler, pipelines, uniformBuffer } = this.resources;
		const recorder = graph.beginFrame();
		const frameUniforms = recorder.importBuffer(uniformBuffer, { label: 'background-frame-params' });
		const flowField = recorder.createTexture({
			label: 'interactive-flow-field',
			format: 'rgba8unorm',
			size: [this.fieldWidth, this.fieldHeight],
		});
		const hdrScene = recorder.createTexture({
			label: 'hdr-lattice-scene-color',
			format: 'rgba16float',
			size: [this.width, this.height],
		});
		const bloomSeed = recorder.createTexture({
			label: 'half-resolution-bloom-seed',
			format: 'rgba16float',
			size: [this.bloomWidth, this.bloomHeight],
		});
		const bloomSoft = recorder.createTexture({
			label: 'half-resolution-soft-bloom',
			format: 'rgba16float',
			size: [this.bloomWidth, this.bloomHeight],
		});
		const backbuffer = recorder.importSwapchainTexture(context.getCurrentTexture(), {
			label: `background-${format}-backbuffer`,
		});

		const computeUniforms = recorder.use(frameUniforms, BufferAccess.Uniform);
		const flowWrite = recorder.use(flowField, TextureAccess.StorageWrite, { contents: 'overwrite' });
		recorder.compute({
			label: '01 · advect flow field',
			uses: [computeUniforms, flowWrite],
			encode: ({ device, pass, unwrap }) => {
				pass.setPipeline(pipelines.flow);
				pass.setBindGroup(0, device.createBindGroup({
					layout: pipelines.flow.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: { buffer: unwrap(computeUniforms) } },
						{ binding: 1, resource: unwrap(flowWrite) },
					],
				}));
				pass.dispatchWorkgroups(Math.ceil(this.fieldWidth / 8), Math.ceil(this.fieldHeight / 8));
			},
		});

		const latticeUniforms = recorder.use(frameUniforms, BufferAccess.Uniform);
		const flowSample = recorder.use(flowField, TextureAccess.Sampled);
		recorder.render({
			label: '02 · resolve HDR luminous lattice',
			uses: [latticeUniforms, flowSample],
			colorAttachments: [{
				target: hdrScene,
				loadOp: 'clear',
				storeOp: 'store',
				clearValue: { r: 0.0025, g: 0.0045, b: 0.0075, a: 1 },
			}],
			encode: ({ device, pass, unwrap }) => {
				pass.setPipeline(pipelines.lattice);
				pass.setBindGroup(0, device.createBindGroup({
					layout: pipelines.lattice.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: { buffer: unwrap(latticeUniforms) } },
						{ binding: 1, resource: unwrap(flowSample) },
					],
				}));
				pass.draw(3);
			},
		});

		const bloomSceneSample = recorder.use(hdrScene, TextureAccess.Sampled);
		recorder.render({
			label: '03 · extract & downsample bloom',
			uses: [bloomSceneSample],
			colorAttachments: [{
				target: bloomSeed,
				loadOp: 'clear',
				storeOp: 'store',
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
			}],
			encode: ({ device, pass, unwrap }) => {
				pass.setPipeline(pipelines.bloomExtract);
				pass.setBindGroup(0, device.createBindGroup({
					layout: pipelines.bloomExtract.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: unwrap(bloomSceneSample) },
					],
				}));
				pass.draw(3);
			},
		});

		const bloomSeedSample = recorder.use(bloomSeed, TextureAccess.Sampled);
		recorder.render({
			label: '04 · soften bloom',
			uses: [bloomSeedSample],
			colorAttachments: [{
				target: bloomSoft,
				loadOp: 'clear',
				storeOp: 'store',
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
			}],
			encode: ({ device, pass, unwrap }) => {
				pass.setPipeline(pipelines.bloomBlur);
				pass.setBindGroup(0, device.createBindGroup({
					layout: pipelines.bloomBlur.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: linearSampler },
						{ binding: 1, resource: unwrap(bloomSeedSample) },
					],
				}));
				pass.draw(3);
			},
		});

		const compositeUniforms = recorder.use(frameUniforms, BufferAccess.Uniform);
		const hdrSceneSample = recorder.use(hdrScene, TextureAccess.Sampled);
		const bloomSample = recorder.use(bloomSoft, TextureAccess.Sampled);
		recorder.render({
			label: '05 · tone map & present',
			uses: [compositeUniforms, hdrSceneSample, bloomSample],
			colorAttachments: [{
				target: backbuffer,
				loadOp: 'clear',
				storeOp: 'store',
				clearValue: { r: 0.008, g: 0.014, b: 0.022, a: 1 },
			}],
			encode: ({ device, pass, unwrap }) => {
				pass.setPipeline(pipelines.composite);
				pass.setBindGroup(0, device.createBindGroup({
					layout: pipelines.composite.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: { buffer: unwrap(compositeUniforms) } },
						{ binding: 1, resource: unwrap(hdrSceneSample) },
						{ binding: 2, resource: unwrap(bloomSample) },
						{ binding: 3, resource: linearSampler },
					],
				}));
				pass.draw(3);
			},
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

	private async finishCapture(
		capture: PendingCapture,
		compilation: FrameGraphCompilationReport,
		gpuTiming: Promise<FrameGraphGpuTimingReport>,
	): Promise<void> {
		try {
			const [timing, { createFrameGraphSnapshot }] = await Promise.all([
				gpuTiming,
				import('@zenfg/webgpu/snapshot'),
			]);
			if (this.disposed || this.pendingCapture !== capture) return;
			capture.resolve(createFrameGraphSnapshot({
				compilation,
				gpuTiming: timing,
				resourcePool: this.resources.graph.getResourcePoolStats(),
			}));
		}
		catch {
			if (!this.disposed && this.pendingCapture === capture) capture.resolve(undefined);
		}
		finally {
			if (this.pendingCapture === capture) this.pendingCapture = undefined;
			this.captureInFlight = false;
		}
	}

	private notifyReady(): void {
		try {
			this.options.onReady?.();
		}
		catch {
			// Host notifications must not break the renderer.
		}
	}

	private fail(error: Error): void {
		try {
			this.options.onError?.(error);
		}
		catch {
			// Host notifications must not obscure the rendering failure.
		}
		this.dispose();
	}
}

async function createPipelines(device: GPUDevice, format: GPUTextureFormat): Promise<RenderPipelines> {
	const flowModule = device.createShaderModule({ label: 'ZenFG background flow shader', code: flowFieldShader });
	const latticeModule = device.createShaderModule({ label: 'ZenFG background lattice shader', code: latticeShader });
	const bloomExtractModule = device.createShaderModule({ label: 'ZenFG background bloom extraction shader', code: bloomExtractShader });
	const bloomBlurModule = device.createShaderModule({ label: 'ZenFG background bloom blur shader', code: bloomBlurShader });
	const compositeModule = device.createShaderModule({ label: 'ZenFG background composite shader', code: compositeShader });
	const [flow, lattice, bloomExtract, bloomBlur, composite] = await Promise.all([
		device.createComputePipelineAsync({
			label: 'ZenFG background · flow field',
			layout: 'auto',
			compute: { module: flowModule, entryPoint: 'flow_main' },
		}),
		device.createRenderPipelineAsync({
			label: 'ZenFG background · lattice',
			layout: 'auto',
			vertex: { module: latticeModule, entryPoint: 'fullscreen_vertex' },
			fragment: { module: latticeModule, entryPoint: 'lattice_fragment', targets: [{ format: 'rgba16float' }] },
			primitive: { topology: 'triangle-list' },
		}),
		device.createRenderPipelineAsync({
			label: 'ZenFG background · bloom extraction',
			layout: 'auto',
			vertex: { module: bloomExtractModule, entryPoint: 'fullscreen_vertex' },
			fragment: { module: bloomExtractModule, entryPoint: 'bloom_extract_fragment', targets: [{ format: 'rgba16float' }] },
			primitive: { topology: 'triangle-list' },
		}),
		device.createRenderPipelineAsync({
			label: 'ZenFG background · bloom blur',
			layout: 'auto',
			vertex: { module: bloomBlurModule, entryPoint: 'fullscreen_vertex' },
			fragment: { module: bloomBlurModule, entryPoint: 'bloom_blur_fragment', targets: [{ format: 'rgba16float' }] },
			primitive: { topology: 'triangle-list' },
		}),
		device.createRenderPipelineAsync({
			label: 'ZenFG background · composite',
			layout: 'auto',
			vertex: { module: compositeModule, entryPoint: 'fullscreen_vertex' },
			fragment: { module: compositeModule, entryPoint: 'composite_fragment', targets: [{ format }] },
			primitive: { topology: 'triangle-list' },
		}),
	]);
	return { flow, lattice, bloomExtract, bloomBlur, composite };
}

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
		const pipelines = await createPipelines(device, format);
		const uniformBuffer = device.createBuffer({
			label: 'ZenFG background frame params',
			size: frameParamsFloatCount * Float32Array.BYTES_PER_ELEMENT,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const linearSampler = device.createSampler({
			label: 'ZenFG background linear clamp sampler',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
			magFilter: 'linear',
			minFilter: 'linear',
		});
		const background = new ZenBackground(canvas, {
			device,
			context,
			format,
			graph: new FrameGraph(device),
			uniformBuffer,
			linearSampler,
			pipelines,
		}, options);
		background.start();
		return background;
	}
	catch (error) {
		device?.destroy();
		notifyStartError(options, toError(error));
		return undefined;
	}
}

function notifyStartError(options: ZenBackgroundOptions, error: Error): void {
	try {
		options.onError?.(error);
	}
	catch {
		// Host notifications must not obscure the initialization failure.
	}
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
