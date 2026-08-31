import {
	FrameGraph,
	type FrameGraphGpuTimingReport,
} from '@zenfg/webgpu';

/** Times one retained render node; unsupported devices return an unavailable report. */
export async function measureClearPass(
	graph: FrameGraph,
	context: GPUCanvasContext,
	frameIndex: number,
): Promise<FrameGraphGpuTimingReport> {
	const recorder = graph.beginFrame();
	const backbuffer = recorder.importSwapchainTexture(
		context.getCurrentTexture(),
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

	return recorder.compile().execute({ frameIndex, gpuTiming: true });
}
