import { BufferAccess, FrameGraph } from '../src/index.ts';
import { createFrameGraphSnapshot } from '../src/snapshot.ts';
import { buffer, bufferUsage, mockDevice } from './testUtils.ts';

/** A compiler-produced, dense branching capture for repeatable Frame Flow visual QA. */
export function createFrameFlowVisualFixture() {
	const frame = new FrameGraph(mockDevice()).beginFrame();
	frame.pushDebugGroup('Declarations');
	const settings = frame.importBuffer(buffer('Shared settings', bufferUsage.STORAGE), { exposedSize: 64 });
	const history = frame.importBuffer(buffer('Temporal history', bufferUsage.STORAGE), { exposedSize: 32 });
	frame.popDebugGroup();
	const outputs = [];
	frame.pushDebugGroup('Frame');
	for (const branch of ['Lighting', 'Reflections', 'Bloom', 'Exposure']) {
		frame.pushDebugGroup(branch);
		let previous;
		for (let stage = 0; stage < 6; stage++) {
			const target = frame.createBuffer({ label: `${branch}.stage${stage}`, size: 64 });
			frame.command({ label: `${branch}.stage${stage}`, sideEffect: false, uses: [
				frame.use(settings, BufferAccess.StorageRead),
				...(previous ? [frame.use(previous, BufferAccess.StorageRead)] : []),
				frame.use(target, BufferAccess.StorageWrite, { contents: 'overwrite' }),
			] });
			previous = target;
		}
		outputs.push(previous!);
		frame.popDebugGroup();
	}
	const output = frame.createBuffer({ label: 'Combined output', size: 64 });
	frame.command({ label: 'Combine branches', sideEffect: false, uses: [
		...outputs.map((value) => frame.use(value, BufferAccess.StorageRead)),
		frame.use(output, BufferAccess.StorageWrite, { contents: 'overwrite' }),
	] });
	frame.popDebugGroup();
	for (const offset of [0, 8]) frame.command({ label: `Update history ${offset}`, sideEffect: false, uses: [
		frame.use(output, BufferAccess.StorageRead),
		frame.use(history, BufferAccess.StorageWrite, { range: { offset, size: 8 }, contents: 'overwrite' }),
	] });
	frame.markOutput(output);
	frame.markPersistentState(history);
	frame.markDebugCapture(history, { offset: 16, size: 16 });
	frame.markDebugCapture(settings);
	return createFrameGraphSnapshot({
		compilation: frame.compile({ report: true }).compilationReport,
		gpuTiming: { status: 'unavailable', frameIndex: 0, reason: 'unsupported' },
		resourcePool: { acquireCount: 0, reuseCount: 0, createdCount: 0, retainedCount: 0, estimatedRetainedBytes: 0 },
	});
}
