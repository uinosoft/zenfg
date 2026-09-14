/**
 * Source: Original ZenFG package recipe.
 * Demonstrates: Immediate CPU elapsed measurements and independent GPU timestamp readback.
 * Flow: Record a clear pass, compile with reporting and execute with GPU timing enabled.
 * The caller owns the device and native inputs; ZenFG owns graph execution.
 * Read next: README.md for inputs and related recipes. The Examples adapter
 * and recipeHost.ts provide browser setup and snapshot capture.
 */
import {
	FrameGraph,
	type FrameGraphRecording,
	type FrameGraphExecutionTiming,
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

/** Times one render node; CPU is immediate, GPU may report unavailable. */
export function measureClearPass(
	graph: FrameGraph,
	context: GPUCanvasContext,
	frameIndex: number,
): FrameGraphExecutionTiming {
	const recorder = graph.beginFrame();
	recordTimedClearPass(recorder, context.getCurrentTexture());

	return recorder.compile().executeWithTiming({ frameIndex, timing: 'both' });
}
