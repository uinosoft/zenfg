import { FrameGraph, TextureAccess } from '@zenfg/webgpu';

export type ExternalRenderer = (options: {
	readonly device: GPUDevice;
	readonly color: GPUTextureView;
}) => void;

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

/** Orders an opaque, caller-submitted renderer before a native present pass. */
export function renderExternalSubmission(options: ExternalSubmissionOptions): void {
	const recorder = options.graph.beginFrame();
	const externalColor = recorder.createTexture({
		label: 'external-color',
		format: 'rgba8unorm',
		size: [options.width, options.height],
	});
	const backbuffer = recorder.importSwapchainTexture(
		options.context.getCurrentTexture(),
		{ label: 'backbuffer' },
	);
	const externalColorWrite = recorder.use(
		externalColor,
		TextureAccess.ColorAttachmentWrite,
		{ contents: 'overwrite' },
	);

	recorder.externalSubmission({
		label: 'third-party-renderer',
		uses: [externalColorWrite],
		submit({ device, unwrap }) {
			options.renderAndSubmit({
				device,
				color: unwrap(externalColorWrite),
			});
		},
	});

	const sampledExternalColor = recorder.use(externalColor, TextureAccess.Sampled);
	recorder.render({
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

	recorder.markPresent(backbuffer);
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
