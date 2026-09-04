import { FrameGraph, type FrameGraphRecording } from '@zenfg/webgpu';
import { createFrameGraphSnapshot } from '@zenfg/webgpu/snapshot';

export type SnapshotExportOptions = {
	readonly graph: FrameGraph;
	readonly context: GPUCanvasContext;
	readonly frameIndex: number;
	readonly producerVersion: string;
};

/** Declares the frame used by the Snapshot export workflow. */
export function recordSnapshotFrame(
	recorder: FrameGraphRecording,
	backbufferTexture: GPUTexture,
): void {
	const backbuffer = recorder.importSwapchainTexture(
		backbufferTexture,
		{ label: 'backbuffer' },
	);
	recorder.render({
		label: 'captured-clear',
		colorAttachments: [{
			target: backbuffer,
			loadOp: 'clear',
			storeOp: 'store',
			clearValue: { r: 0.03, g: 0.04, b: 0.07, a: 1 },
		}],
	});
	recorder.markPresent(backbuffer);
}

/** Captures matching compilation, timing, and pool reports as Snapshot 1.0 JSON. */
export async function captureSnapshotJson(options: SnapshotExportOptions): Promise<string> {
	const recorder = options.graph.beginFrame();
	recordSnapshotFrame(recorder, options.context.getCurrentTexture());

	const compiled = recorder.compile({ report: true });
	const timingPromise = compiled.execute({
		frameIndex: options.frameIndex,
		gpuTiming: true,
	});
	const resourcePool = options.graph.getResourcePoolStats();
	const gpuTiming = await timingPromise;
	const snapshot = createFrameGraphSnapshot({
		compilation: compiled.compilationReport,
		gpuTiming,
		resourcePool,
		producerVersion: options.producerVersion,
	});

	return `${JSON.stringify(snapshot, null, 2)}\n`;
}
