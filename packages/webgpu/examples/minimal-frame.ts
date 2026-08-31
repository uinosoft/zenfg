import { FrameGraph } from '@zenfg/webgpu';

/** Records, executes, and presents one clear-only frame. */
export function renderMinimalFrame(
	graph: FrameGraph,
	context: GPUCanvasContext,
	frameIndex: number,
): void {
	const recorder = graph.beginFrame();
	const backbuffer = recorder.importSwapchainTexture(
		context.getCurrentTexture(),
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
	recorder.compile().execute({ frameIndex });
}
