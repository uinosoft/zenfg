import { BufferAccess, FrameGraph, type FrameGraphRecording } from '@zenfg/webgpu';

export type ComputeOutputRecordOptions = {
	readonly recorder: FrameGraphRecording;
	readonly pipeline: GPUComputePipeline;
	readonly outputBuffer: GPUBuffer;
	readonly outputSize: number;
	readonly workgroupCount: number;
};

export type ComputeOutputOptions = Omit<ComputeOutputRecordOptions, 'recorder'> & {
	readonly graph: FrameGraph;
	readonly frameIndex: number;
};

/**
 * Declares a compute dispatch that fully overwrites the exposed output range.
 * The supplied shader must write every byte in that range.
 */
export function recordComputeOutput(options: ComputeOutputRecordOptions): void {
	const output = options.recorder.importBuffer(options.outputBuffer, {
		label: 'compute-output',
		exposedSize: options.outputSize,
		initialContents: 'undefined',
	});
	const outputWrite = options.recorder.use(output, BufferAccess.StorageWrite, {
		range: { offset: 0, size: options.outputSize },
		contents: 'overwrite',
	});

	options.recorder.compute({
		label: 'write-output',
		uses: [outputWrite],
		encode({ device, pass, unwrap }) {
			const bindGroup = device.createBindGroup({
				layout: options.pipeline.getBindGroupLayout(0),
				entries: [{ binding: 0, resource: { buffer: unwrap(outputWrite) } }],
			});
			pass.setPipeline(options.pipeline);
			pass.setBindGroup(0, bindGroup);
			pass.dispatchWorkgroups(options.workgroupCount);
		},
	});

	options.recorder.markOutput(output);
}

/** Records and executes one compute dispatch into a caller-owned output buffer. */
export function computeOutput(options: ComputeOutputOptions): void {
	const recorder = options.graph.beginFrame();
	recordComputeOutput({
		recorder,
		pipeline: options.pipeline,
		outputBuffer: options.outputBuffer,
		outputSize: options.outputSize,
		workgroupCount: options.workgroupCount,
	});
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
