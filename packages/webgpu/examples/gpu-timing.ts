import {
	FrameGraph,
	type FrameGraphRecording,
	type FrameGraphGpuTimingReport,
} from '@zenfg/webgpu';

/** Declares the clear pass measured by the GPU timing workflow. */
export function recordTimedClearPass(
	recorder: FrameGraphRecording,
	backbufferTexture: GPUTexture,
): void {
	const backbuffer = recorder.importSwapchainTexture(
		backbufferTexture,
		{ label: 'backbuffer' },
	);
	recorder.render({
		label: 'timed-clear',
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
		}],
	});
	recorder.markPresent(backbuffer);
}

/** Times one retained render node; unsupported devices return an unavailable report. */
export async function measureClearPass(
	graph: FrameGraph,
	context: GPUCanvasContext,
	frameIndex: number,
): Promise<FrameGraphGpuTimingReport> {
	const recorder = graph.beginFrame();
	recordTimedClearPass(recorder, context.getCurrentTexture());

	return recorder.compile().execute({ frameIndex, gpuTiming: true });
}
