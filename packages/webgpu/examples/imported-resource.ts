import { BufferAccess, FrameGraph } from '@zenfg/webgpu';

export type ImportedResourceOptions = {
	readonly graph: FrameGraph;
	readonly context: GPUCanvasContext;
	readonly pipeline: GPURenderPipeline;
	readonly uniformBuffer: GPUBuffer;
	readonly uniformSize: number;
	readonly frameIndex: number;
};

/** Uses a caller-owned uniform buffer without transferring its ownership. */
export function renderWithImportedUniform(options: ImportedResourceOptions): void {
	const recorder = options.graph.beginFrame();
	const uniforms = recorder.importBuffer(options.uniformBuffer, {
		label: 'frame-uniforms',
		exposedSize: options.uniformSize,
	});
	const backbuffer = recorder.importSwapchainTexture(
		options.context.getCurrentTexture(),
		{ label: 'backbuffer' },
	);
	const uniformRead = recorder.use(uniforms, BufferAccess.Uniform, {
		range: { offset: 0, size: options.uniformSize },
	});

	recorder.render({
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

	recorder.markPresent(backbuffer);
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
