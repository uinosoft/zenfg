import { FrameGraph, TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';

export type ExternalRenderer = (options: {
	readonly device: GPUDevice;
	readonly color: GPUTextureView;
}) => undefined;

export type ExternalSubmissionRecordOptions = {
	readonly recorder: FrameGraphRecording;
	readonly backbufferTexture: GPUTexture;
	readonly presentPipeline: GPURenderPipeline;
	readonly sampler: GPUSampler;
	readonly width: number;
	readonly height: number;
	readonly renderAndSubmit: ExternalRenderer;
};

export type ExternalSubmissionOptions = {
	readonly graph: FrameGraph;
	readonly context: GPUCanvasContext;
	readonly presentPipeline: GPURenderPipeline;
	readonly sampler: GPUSampler;
	readonly width: number;
	readonly height: number;
	readonly frameIndex: number;
	readonly renderAndSubmit: ExternalRenderer;
};

/** Declares an opaque submission boundary followed by presentation. */
export function recordExternalSubmission(options: ExternalSubmissionRecordOptions): void {
	const externalColor = options.recorder.createTexture({
		label: 'external-color',
		format: 'rgba8unorm',
		size: [options.width, options.height],
	});
	const backbuffer = options.recorder.importSwapchainTexture(
		options.backbufferTexture,
		{ label: 'backbuffer' },
	);
	const externalColorWrite = options.recorder.use(
		externalColor,
		TextureAccess.ColorAttachmentWrite,
		{ contents: 'overwrite' },
	);

	options.recorder.externalSubmission({
		label: 'third-party-renderer',
		uses: [externalColorWrite],
		submit({ device, unwrap }) {
			return options.renderAndSubmit({
				device,
				color: unwrap(externalColorWrite),
			});
		},
	});

	const sampledExternalColor = options.recorder.use(externalColor, TextureAccess.Sampled);
	options.recorder.render({
		label: 'present-external-color',
		uses: [sampledExternalColor],
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
					{ binding: 1, resource: unwrap(sampledExternalColor) },
				],
			});
			pass.setPipeline(options.presentPipeline);
			pass.setBindGroup(0, bindGroup);
			pass.draw(3);
		},
	});

	options.recorder.markPresent(backbuffer);
}

/** Orders an opaque, caller-submitted renderer before a native present pass. */
export function renderExternalSubmission(options: ExternalSubmissionOptions): void {
	const recorder = options.graph.beginFrame();
	recordExternalSubmission({
		recorder,
		backbufferTexture: options.context.getCurrentTexture(),
		presentPipeline: options.presentPipeline,
		sampler: options.sampler,
		width: options.width,
		height: options.height,
		renderAndSubmit: options.renderAndSubmit,
	});
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
