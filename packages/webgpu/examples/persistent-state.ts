import { FrameGraph, type FrameGraphRecording } from '@zenfg/webgpu';

export type PersistentStateRecordOptions = {
	readonly recorder: FrameGraphRecording;
	readonly historyTexture: GPUTexture;
	readonly hasPreviousValue: boolean;
	readonly encodeUpdate: (pass: GPURenderPassEncoder) => undefined;
};

export type PersistentStateOptions = {
	readonly graph: FrameGraph;
	readonly historyTexture: GPUTexture;
	readonly hasPreviousValue: boolean;
	readonly frameIndex: number;
	readonly encodeUpdate: (pass: GPURenderPassEncoder) => undefined;
};

/** Declares an update of caller-owned state without compiling it. */
export function recordPersistentStateUpdate(options: PersistentStateRecordOptions): void {
	const history = options.recorder.importTexture(options.historyTexture, {
		label: 'temporal-history',
		initialContents: options.hasPreviousValue ? 'defined' : 'undefined',
	});

	options.recorder.render({
		label: 'update-history',
		colorAttachments: [{
			target: history,
			loadOp: options.hasPreviousValue ? 'load' : 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 0 },
		}],
		encode({ pass }) {
			return options.encodeUpdate(pass);
		},
	});

	options.recorder.markPersistentState(history);
}

/** Updates a caller-owned history texture and retains its final producer. */
export function updatePersistentState(options: PersistentStateOptions): void {
	const recorder = options.graph.beginFrame();
	recordPersistentStateUpdate({
		recorder,
		historyTexture: options.historyTexture,
		hasPreviousValue: options.hasPreviousValue,
		encodeUpdate: options.encodeUpdate,
	});
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
