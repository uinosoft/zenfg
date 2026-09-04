import { BufferAccess, FrameGraph, type FrameGraphRecording } from '@zenfg/webgpu';

export type ImportedUniformRecordOptions = {
	readonly recorder: FrameGraphRecording;
	readonly backbufferTexture: GPUTexture;
	readonly pipeline: GPURenderPipeline;
	readonly uniformBuffer: GPUBuffer;
	readonly uniformSize: number;
};

export type ImportedResourceOptions = {
	readonly graph: FrameGraph;
	readonly context: GPUCanvasContext;
	readonly pipeline: GPURenderPipeline;
	readonly uniformBuffer: GPUBuffer;
	readonly uniformSize: number;
	readonly frameIndex: number;
};

/** Declares a draw that reads a caller-owned uniform buffer. */
export function recordImportedUniformFrame(options: ImportedUniformRecordOptions): void {
	const uniforms = options.recorder.importBuffer(options.uniformBuffer, {
		label: 'frame-uniforms',
		exposedSize: options.uniformSize,
	});
	const backbuffer = options.recorder.importSwapchainTexture(
		options.backbufferTexture,
		{ label: 'backbuffer' },
	);
	const uniformRead = options.recorder.use(uniforms, BufferAccess.Uniform, {
		range: { offset: 0, size: options.uniformSize },
	});

	options.recorder.render({
		label: 'draw-with-imported-uniforms',
		uses: [uniformRead],
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0.02, g: 0.02, b: 0.02, a: 1 },
		}],
		encode({ device, pass, unwrap }) {
			const bindGroup = device.createBindGroup({
				layout: options.pipeline.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: {
						buffer: unwrap(uniformRead),
						offset: 0,
						size: options.uniformSize,
					},
				}],
			});
			pass.setPipeline(options.pipeline);
			pass.setBindGroup(0, bindGroup);
			pass.draw(3);
		},
	});

	options.recorder.markPresent(backbuffer);
}

/** Uses a caller-owned uniform buffer without transferring its ownership. */
export function renderWithImportedUniform(options: ImportedResourceOptions): void {
	const recorder = options.graph.beginFrame();
	recordImportedUniformFrame({
		recorder,
		backbufferTexture: options.context.getCurrentTexture(),
		pipeline: options.pipeline,
		uniformBuffer: options.uniformBuffer,
		uniformSize: options.uniformSize,
	});
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
