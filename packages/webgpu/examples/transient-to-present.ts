import { FrameGraph, TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';

export type TransientToPresentRecordOptions = {
	readonly recorder: FrameGraphRecording;
	readonly backbufferTexture: GPUTexture;
	readonly scenePipeline: GPURenderPipeline;
	readonly presentPipeline: GPURenderPipeline;
	readonly sampler: GPUSampler;
	readonly width: number;
	readonly height: number;
};

export type TransientToPresentOptions = {
	readonly graph: FrameGraph;
	readonly context: GPUCanvasContext;
	readonly scenePipeline: GPURenderPipeline;
	readonly presentPipeline: GPURenderPipeline;
	readonly sampler: GPUSampler;
	readonly width: number;
	readonly height: number;
	readonly frameIndex: number;
};

/** Declares transient rendering followed by presentation without compiling it. */
export function recordTransientToPresent(options: TransientToPresentRecordOptions): void {
	const sceneColor = options.recorder.createTexture({
		label: 'scene-color',
		format: 'rgba16float',
		size: [options.width, options.height],
	});
	const backbuffer = options.recorder.importSwapchainTexture(
		options.backbufferTexture,
		{ label: 'backbuffer' },
	);

	options.recorder.render({
		label: 'scene',
		colorAttachments: [{
			target: sceneColor,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
		encode({ pass }) {
			pass.setPipeline(options.scenePipeline);
			pass.draw(3);
		},
	});

	const sampledSceneColor = options.recorder.use(sceneColor, TextureAccess.Sampled);
	options.recorder.render({
		label: 'present',
		uses: [sampledSceneColor],
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
		encode({ device, pass, unwrap }) {
			const bindGroup = device.createBindGroup({
				layout: options.presentPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: options.sampler },
					{ binding: 1, resource: unwrap(sampledSceneColor) },
				],
			});
			pass.setPipeline(options.presentPipeline);
			pass.setBindGroup(0, bindGroup);
			pass.draw(3);
		},
	});

	options.recorder.markPresent(backbuffer);
}

/** Renders into a transient texture and samples it into the current surface. */
export function renderTransientToPresent(options: TransientToPresentOptions): void {
	const recorder = options.graph.beginFrame();
	recordTransientToPresent({
		recorder,
		backbufferTexture: options.context.getCurrentTexture(),
		scenePipeline: options.scenePipeline,
		presentPipeline: options.presentPipeline,
		sampler: options.sampler,
		width: options.width,
		height: options.height,
	});
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
