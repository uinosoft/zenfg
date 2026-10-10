/**
 * Source: Original ZenFG package recipe.
 * Demonstrates: Caller-owned resources, explicit access, and native render-pass extras.
 * Flow: Import initialized native resources, record their consumers and submit the frame.
 * The caller owns the device and native inputs; ZenFG owns graph execution.
 * Read next: README.md for inputs and related recipes. The Examples adapter
 * and recipeHost.ts provide browser setup and snapshot capture.
 */
import {
	BufferAccess,
	FrameGraph,
	type FrameGraphRecording,
	type WebGpuRenderPassDescriptorExtras,
} from '@zenfg/webgpu';

export type ImportedUniformRecordOptions = {
	readonly recorder: FrameGraphRecording;
	readonly backbufferTexture: GPUTexture;
	readonly pipeline: GPURenderPipeline;
	readonly uniformBuffer: GPUBuffer;
	readonly uniformSize: number;
	/** Optional caller-owned 4x MSAA target matching the backbuffer format and size. */
	readonly multisampleTexture?: GPUTexture;
	/** Optional native fields; the caller owns referenced objects and feature support. */
	readonly webgpuDescriptor?: WebGpuRenderPassDescriptorExtras;
};

export type ImportedResourceOptions = {
	readonly graph: FrameGraph;
	readonly context: GPUCanvasContext;
	readonly pipeline: GPURenderPipeline;
	readonly uniformBuffer: GPUBuffer;
	readonly uniformSize: number;
	readonly multisampleTexture?: GPUTexture;
	readonly webgpuDescriptor?: WebGpuRenderPassDescriptorExtras;
	readonly frameIndex: number;
};

/**
 * Declares a draw that reads a caller-owned uniform buffer.
 * This teaching example intentionally exposes the uniform to demonstrate
 * imports, access tokens, and input-range validation. Private uniforms in
 * complex workloads can instead remain internally bound when appropriate.
 * The pipeline must match the attachment format and sample count. When supplied,
 * the multisample target is resolved and discarded because this recipe never
 * reads its contents again; attachments needed later must instead use `store`.
 */
export function recordImportedUniformFrame(options: ImportedUniformRecordOptions): void {
	const uniforms = options.recorder.importBuffer(options.uniformBuffer, {
		label: 'frame-uniforms',
		exposedSize: options.uniformSize,
	});
	const backbuffer = options.recorder.importSwapchainTexture(
		options.backbufferTexture,
		{ label: 'backbuffer' },
	);
	const multisample = options.multisampleTexture === undefined
		? undefined
		: options.recorder.importTexture(options.multisampleTexture, {
			label: 'multisample-color',
			initialContents: 'undefined',
		});
	const uniformRead = options.recorder.use(uniforms, BufferAccess.Uniform, {
		range: { offset: 0, size: options.uniformSize },
	});

	options.recorder.render({
		label: 'draw-with-imported-uniforms',
		webgpuDescriptor: options.webgpuDescriptor,
		uses: [uniformRead],
		colorAttachments: [{
			target: multisample ?? backbuffer,
			resolveTarget: multisample === undefined ? undefined : backbuffer,
			loadOp: 'clear',
			storeOp: multisample === undefined ? 'store' : 'discard',
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

/** Uses caller-owned resources without transferring their ownership. */
export function renderWithImportedUniform(options: ImportedResourceOptions): void {
	const recorder = options.graph.beginFrame();
	recordImportedUniformFrame({
		recorder,
		backbufferTexture: options.context.getCurrentTexture(),
		pipeline: options.pipeline,
		uniformBuffer: options.uniformBuffer,
		uniformSize: options.uniformSize,
		multisampleTexture: options.multisampleTexture,
		webgpuDescriptor: options.webgpuDescriptor,
	});
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
