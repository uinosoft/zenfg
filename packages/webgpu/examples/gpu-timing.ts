/**
 * Source: Original ZenFG package recipe.
 * Demonstrates: Optional GPU timestamp measurements and unavailable results.
 * Flow: Record a clear pass, compile with reporting and execute with GPU timing enabled.
 * The caller owns the device and native inputs; ZenFG owns graph execution.
 * Read next: README.md for inputs and related recipes. The Playground adapter
 * and recipeHost.ts provide browser setup and snapshot capture.
 */
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
