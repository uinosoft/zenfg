import { FrameGraph, type FrameGraphRecording } from '@zenfg/webgpu';

/** Declares one clear-only presentation frame without compiling it. */
export function recordMinimalFrame(
	recorder: FrameGraphRecording,
	backbufferTexture: GPUTexture,
): void {
	const backbuffer = recorder.importSwapchainTexture(
		backbufferTexture,
		{ label: 'backbuffer' },
	);

	recorder.render({
		label: 'clear-backbuffer',
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0.04, g: 0.06, b: 0.1, a: 1 },
		}],
	});

	recorder.markPresent(backbuffer);
}

/** Records, executes, and presents one clear-only frame. */
export function renderMinimalFrame(
	graph: FrameGraph,
	context: GPUCanvasContext,
	frameIndex: number,
): void {
	const recorder = graph.beginFrame();
	recordMinimalFrame(recorder, context.getCurrentTexture());
	recorder.compile().execute({ frameIndex });
}
