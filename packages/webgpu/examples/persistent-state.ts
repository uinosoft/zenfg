import { FrameGraph } from '@zenfg/webgpu';

export type PersistentStateOptions = {
	readonly graph: FrameGraph;
	readonly historyTexture: GPUTexture;
	readonly hasPreviousValue: boolean;
	readonly frameIndex: number;
	readonly encodeUpdate: (pass: GPURenderPassEncoder) => void;
};

/** Updates a caller-owned history texture and retains its final producer. */
export function updatePersistentState(options: PersistentStateOptions): void {
	const recorder = options.graph.beginFrame();
	const history = recorder.importTexture(options.historyTexture, {
		label: 'temporal-history',
		initialContents: options.hasPreviousValue ? 'defined' : 'undefined',
	});

	recorder.render({
		label: 'update-history',
		colorAttachments: [{
			target: history,
			loadOp: options.hasPreviousValue ? 'load' : 'clear',
			storeOp: 'store',
			clearValue: { r: 0, g: 0, b: 0, a: 0 },
		}],
		encode({ pass }) {
			options.encodeUpdate(pass);
		},
	});

	recorder.markPersistentState(history);
	recorder.compile().execute({ frameIndex: options.frameIndex });
}
