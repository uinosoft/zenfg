/**
 * Source: Original ZenFG package recipe.
 * Demonstrates: Capturing compilation, GPU timing and resource-pool reports.
 * Flow: Record a real frame, compile with reporting, execute and serialize its snapshot.
 * The caller owns the device and native inputs; ZenFG owns graph execution.
 * Read next: README.md for inputs and related recipes. The Examples adapter
 * and recipeHost.ts provide browser setup and snapshot capture.
 */
import { FrameGraph, type FrameGraphTimingMode, type FrameGraphRecording } from '@zenfg/webgpu';
import { createFrameGraphSnapshot } from '@zenfg/webgpu/snapshot';

export type SnapshotExportOptions = {
	readonly graph: FrameGraph;
	readonly context: GPUCanvasContext;
	readonly frameIndex: number;
	readonly producerVersion: string;
	readonly timing?: FrameGraphTimingMode;
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

/** Captures matching compilation, timing, and pool reports as Snapshot 1.1 JSON. */
export async function captureSnapshotJson(options: SnapshotExportOptions): Promise<string> {
	const recorder = options.graph.beginFrame();
	recordSnapshotFrame(recorder, options.context.getCurrentTexture());

	const compiled = recorder.compile({ report: true });
	const executionTiming = compiled.executeWithTiming({
		frameIndex: options.frameIndex,
		timing: options.timing ?? 'both',
	});
	const resourcePool = options.graph.getResourcePoolStats();
	const gpuTiming = await executionTiming.gpu;
	const snapshot = createFrameGraphSnapshot({ frameIndex: executionTiming.frameIndex, cpuTiming: executionTiming.cpu,
		compilation: compiled.compilationReport,
		gpuTiming,
		resourcePool,
		producerVersion: options.producerVersion,
	});

	return `${JSON.stringify(snapshot, null, 2)}\n`;
}
