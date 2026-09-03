import { BufferAccess, FrameGraph, TextureAccess } from '@zenfg/webgpu';
import { compositeShader, flowFieldShader, latticeShader } from './backgroundShaders.ts';

const uniformFloatCount = 16;
const fieldDownsample = 6;
const desktopTargetFrameRate = 60;
const mobileTargetFrameRate = 36;
const desktopPixelBudget = 3_600_000;
const mobilePixelBudget = 1_500_000;
const pointerFollowRate = 30;
const pointerVelocityDecayRate = 7;

type RenderPipelines = {
	readonly flow: GPUComputePipeline;
	readonly lattice: GPURenderPipeline;
	readonly composite: GPURenderPipeline;
};

type BackgroundResources = {
	readonly device: GPUDevice;
	readonly context: GPUCanvasContext;
	readonly format: GPUTextureFormat;
	readonly graph: FrameGraph;
	readonly uniformBuffer: GPUBuffer;
	readonly pipelines: RenderPipelines;
};

class ZenBackground {
	private readonly uniformData = new Float32Array(uniformFloatCount);
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	private readonly coarsePointer = window.matchMedia('(pointer: coarse)');
	private animationFrame = 0;
	private previousFrameTime = 0;
	private frameIndex = 0;
	private width = 1;
	private height = 1;
	private fieldWidth = 1;
	private fieldHeight = 1;
	private targetPointerX = 0.76;
	private targetPointerY = 0.42;
	private pointerX = this.targetPointerX;
	private pointerY = this.targetPointerY;
	private velocityX = 0;
	private velocityY = 0;
	private lastInteractionTime = -Infinity;
	private resizePending = true;
	private dirty = true;
	private disposed = false;
	private reportCaptured = false;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly resources: BackgroundResources,
	) {}

	start(): void {
		window.addEventListener('resize', this.handleResize, { passive: true });
		window.addEventListener('pointermove', this.handlePointer, { passive: true });
		window.addEventListener('pointerdown', this.handlePointer, { passive: true });
		document.addEventListener('visibilitychange', this.handleVisibility);
		this.reducedMotion.addEventListener('change', this.handleMotionPreference);
		this.coarsePointer.addEventListener('change', this.handleResize);
		void this.resources.device.lost.then((info) => {
			if (this.disposed) return;
			console.warn(`ZenFG background WebGPU device was lost: ${info.message || info.reason}`);
			this.dispose();
		});
		this.requestFrame();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		cancelAnimationFrame(this.animationFrame);
		window.removeEventListener('resize', this.handleResize);
		window.removeEventListener('pointermove', this.handlePointer);
		window.removeEventListener('pointerdown', this.handlePointer);
		document.removeEventListener('visibilitychange', this.handleVisibility);
		this.reducedMotion.removeEventListener('change', this.handleMotionPreference);
		this.coarsePointer.removeEventListener('change', this.handleResize);
		document.documentElement.removeAttribute('data-webgpu-background');
		this.resources.graph.destroy();
		this.resources.uniformBuffer.destroy();
		this.resources.device.destroy();
	}

	private readonly handleResize = (): void => {
		this.resizePending = true;
		this.dirty = true;
		this.requestFrame();
	};

	private readonly handlePointer = (event: PointerEvent): void => {
		if (!event.isPrimary || window.innerWidth <= 0 || window.innerHeight <= 0) return;
		const nextX = Math.min(1, Math.max(0, event.clientX / window.innerWidth));
		const nextY = Math.min(1, Math.max(0, event.clientY / window.innerHeight));
		this.velocityX = this.velocityX * 0.35 + (nextX - this.targetPointerX) * 0.65;
		this.velocityY = this.velocityY * 0.35 + (nextY - this.targetPointerY) * 0.65;
		this.targetPointerX = nextX;
		this.targetPointerY = nextY;
		this.lastInteractionTime = performance.now();
		this.dirty = true;
		this.requestFrame();
	};

	private readonly handleVisibility = (): void => {
		if (document.visibilityState === 'visible') {
			this.previousFrameTime = 0;
			this.dirty = true;
			this.requestFrame();
		}
	};

	private readonly handleMotionPreference = (): void => {
		this.previousFrameTime = 0;
		this.dirty = true;
		this.requestFrame();
	};

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
		if (this.reducedMotion.matches && !this.dirty) return;

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
			if (document.documentElement.dataset.webgpuBackground !== 'ready') {
				document.documentElement.dataset.webgpuBackground = 'ready';
			}
		}
		catch (error) {
			console.warn('ZenFG background fell back to CSS after a rendering error.', error);
			this.dispose();
			return;
		}

		if (!this.reducedMotion.matches) this.requestFrame();
	};

	private resizeCanvas(): void {
		const cssWidth = Math.max(1, window.innerWidth);
		const cssHeight = Math.max(1, window.innerHeight);
		const preferredRatio = Math.min(window.devicePixelRatio || 1, this.coarsePointer.matches ? 1 : 1.5);
		const pixelBudget = this.coarsePointer.matches ? mobilePixelBudget : desktopPixelBudget;
		const budgetScale = Math.min(1, Math.sqrt(pixelBudget / (cssWidth * cssHeight * preferredRatio * preferredRatio)));
		const ratio = preferredRatio * budgetScale;
		this.width = Math.max(1, Math.floor(cssWidth * ratio));
		this.height = Math.max(1, Math.floor(cssHeight * ratio));
		this.fieldWidth = Math.max(1, Math.ceil(this.width / fieldDownsample));
		this.fieldHeight = Math.max(1, Math.ceil(this.height / fieldDownsample));
		if (this.canvas.width !== this.width) this.canvas.width = this.width;
		if (this.canvas.height !== this.height) this.canvas.height = this.height;
		this.resizePending = false;
	}

	private updatePointer(deltaSeconds: number): void {
		const response = 1 - Math.exp(-deltaSeconds * pointerFollowRate);
		this.pointerX += (this.targetPointerX - this.pointerX) * response;
		this.pointerY += (this.targetPointerY - this.pointerY) * response;
		const velocityDecay = Math.exp(-deltaSeconds * pointerVelocityDecayRate);
		this.velocityX *= velocityDecay;
		this.velocityY *= velocityDecay;
	}

	private updateUniforms(timeSeconds: number, deltaSeconds: number): void {
		const timeSinceInteraction = performance.now() - this.lastInteractionTime;
		const pointerEnergy = Math.max(0, Math.min(1, 1 - (timeSinceInteraction - 900) / 2100));
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
			pointerEnergy,
			this.frameIndex,
			this.reducedMotion.matches ? 1 : 0,
			this.coarsePointer.matches ? 1 : 0,
			0,
		]);
		this.resources.device.queue.writeBuffer(this.resources.uniformBuffer, 0, this.uniformData);
	}

	private recordAndExecuteFrame(): void {
		const { context, format, graph, pipelines, uniformBuffer } = this.resources;
		const recorder = graph.beginFrame();
		const frameUniforms = recorder.importBuffer(uniformBuffer, { label: 'background-frame-params' });
		const flowField = recorder.createTexture({
			label: 'interactive-flow-field',
			format: 'rgba8unorm',
			size: [this.fieldWidth, this.fieldHeight],
		});
		const sceneColor = recorder.createTexture({
			label: 'lattice-scene-color',
			format: 'rgba8unorm',
			size: [this.width, this.height],
		});
		const backbuffer = recorder.importSwapchainTexture(context.getCurrentTexture(), {
			label: `background-${format}-backbuffer`,
		});

		recorder.withDebugGroup('ZenFG interactive background', () => {
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
				label: '02 · resolve luminous lattice',
				uses: [latticeUniforms, flowSample],
				colorAttachments: [{
					target: sceneColor,
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r: 0.008, g: 0.014, b: 0.022, a: 1 },
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

			const compositeUniforms = recorder.use(frameUniforms, BufferAccess.Uniform);
			const sceneSample = recorder.use(sceneColor, TextureAccess.Sampled);
			recorder.render({
				label: '03 · bloom & present',
				uses: [compositeUniforms, sceneSample],
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
							{ binding: 1, resource: unwrap(sceneSample) },
						],
					}));
					pass.draw(3);
				},
			});
		});

		recorder.markPresent(backbuffer);
		if (!this.reportCaptured) {
			const compiled = recorder.compile({ report: true });
			this.canvas.dataset.frameGraph = compiled.compilationReport.nodes.map((node) => node.label).join(' → ');
			this.canvas.dataset.frameGraphPasses = String(compiled.compilationReport.nodes.length);
			this.reportCaptured = true;
			compiled.execute({ frameIndex: this.frameIndex, gpuDebugGroups: true });
			return;
		}
		recorder.compile().execute({ frameIndex: this.frameIndex });
	}
}

async function createPipelines(device: GPUDevice, format: GPUTextureFormat): Promise<RenderPipelines> {
	const flowModule = device.createShaderModule({ label: 'ZenFG background flow shader', code: flowFieldShader });
	const latticeModule = device.createShaderModule({ label: 'ZenFG background lattice shader', code: latticeShader });
	const compositeModule = device.createShaderModule({ label: 'ZenFG background composite shader', code: compositeShader });
	const [flow, lattice, composite] = await Promise.all([
		device.createComputePipelineAsync({
			label: 'ZenFG background · flow field',
			layout: 'auto',
			compute: { module: flowModule, entryPoint: 'flow_main' },
		}),
		device.createRenderPipelineAsync({
			label: 'ZenFG background · lattice',
			layout: 'auto',
			vertex: { module: latticeModule, entryPoint: 'fullscreen_vertex' },
			fragment: { module: latticeModule, entryPoint: 'lattice_fragment', targets: [{ format: 'rgba8unorm' }] },
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
	return { flow, lattice, composite };
}

export async function startZenBackground(canvas: HTMLCanvasElement): Promise<void> {
	if (!navigator.gpu) return;

	let device: GPUDevice | undefined;
	try {
		const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
		if (!adapter) return;
		device = await adapter.requestDevice();
		const context = canvas.getContext('webgpu');
		if (!context) {
			device.destroy();
			return;
		}
		const format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({ device, format, alphaMode: 'opaque' });
		const pipelines = await createPipelines(device, format);
		const uniformBuffer = device.createBuffer({
			label: 'ZenFG background frame params',
			size: uniformFloatCount * Float32Array.BYTES_PER_ELEMENT,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const background = new ZenBackground(canvas, {
			device,
			context,
			format,
			graph: new FrameGraph(device),
			uniformBuffer,
			pipelines,
		});
		background.start();
	}
	catch (error) {
		device?.destroy();
		console.warn('WebGPU is unavailable for the ZenFG background; using the CSS fallback.', error);
		document.documentElement.removeAttribute('data-webgpu-background');
	}
}
