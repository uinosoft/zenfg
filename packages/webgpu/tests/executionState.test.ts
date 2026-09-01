import assert from 'node:assert/strict';
import test from 'node:test';

import { BufferAccess, FrameGraph, FrameGraphError, type CompiledFrame } from '../src/index.ts';
import { mockCommandEncoder, mockDevice } from './testUtils.ts';

for (const source of ['node', 'external-submission', 'beforeSubmit', 'afterSubmit'] as const) {
	test(`execute rejects recursive execution from ${source}`, () => {
		const runtime = new FrameGraph(mockDevice());
		const recorder = runtime.beginFrame();
		let compiled!: CompiledFrame;
		let callbackCount = 0;
		const recurse = (): undefined => {
			callbackCount++;
			assert.throws(() => compiled.execute(), (error) => error instanceof FrameGraphError
				&& error.code === 'FG2008'
				&& error.phase === 'execute'
				&& error.context?.operation === 'execute');
			return undefined;
		};
		if (source === 'external-submission') recorder.externalSubmission({ submit: recurse });
		else recorder.command({ sideEffect: true, encode: source === 'node' ? recurse : undefined });
		compiled = recorder.compile();
		compiled.execute({
			beforeSubmit: source === 'beforeSubmit' ? recurse : undefined,
			afterSubmit: source === 'afterSubmit' ? recurse : undefined,
		});
		assert.equal(callbackCount, 1);
	});
}

test('execute guards runtime destruction and pool clearing', () => {
	const runtime = new FrameGraph(mockDevice());
	const recorder = runtime.beginFrame();
	let callbackCount = 0;
	recorder.command({
		sideEffect: true,
		encode() {
			callbackCount++;
			assert.throws(() => runtime.clearResourcePool(), /CompiledFrame\.execute\(\) is running/);
			assert.throws(() => runtime.destroy(), /CompiledFrame\.execute\(\) is running/);
		},
	});
	const compiled = recorder.compile();
	compiled.execute();
	compiled.execute();
	assert.equal(callbackCount, 2);
	assert.doesNotThrow(() => runtime.clearResourcePool());
	assert.doesNotThrow(() => runtime.destroy());
	assert.throws(() => compiled.execute(), (error) => error instanceof FrameGraphError
		&& error.code === 'FG2006'
		&& error.phase === 'execute');
});

test('recording and compiling another frame is allowed during execution', () => {
	const runtime = new FrameGraph(mockDevice());
	const firstRecorder = runtime.beginFrame();
	let secondCompiled: CompiledFrame | undefined;
	firstRecorder.command({
		sideEffect: true,
		encode() {
			const secondRecorder = runtime.beginFrame();
			secondRecorder.command({ sideEffect: true });
			secondCompiled = secondRecorder.compile();
		},
	});
	const firstCompiled = firstRecorder.compile();
	firstCompiled.execute();
	assert.ok(secondCompiled);
	assert.doesNotThrow(() => secondCompiled?.execute());
});

test('compile consumes a recorder on both success and failure', () => {
	const runtime = new FrameGraph(mockDevice());
	const successful = runtime.beginFrame();
	const texture = successful.createTexture({ format: 'rgba8unorm', size: [1, 1] });
	const view = successful.createTextureView(texture);
	const buffer = successful.createBuffer({ size: 4 });
	successful.render({
		colorAttachments: [{ target: view, loadOp: 'clear', storeOp: 'store' }],
	});
	successful.markOutput(texture);
	successful.compile();
	assert.throws(() => successful.command({}), (error) => error instanceof FrameGraphError
		&& error.code === 'FG2007'
		&& error.phase === 'record'
		&& error.context?.operation === 'command');
	assert.throws(() => successful.getTextureDesc(texture), /compile\(\) consumed/);
	assert.throws(() => successful.getTextureViewDesc(view), /compile\(\) consumed/);
	assert.throws(() => successful.getBufferDesc(buffer), /compile\(\) consumed/);
	assert.throws(() => successful.compile(), /compile\(\) consumed/);

	const failed = runtime.beginFrame();
	const output = failed.createBuffer({ size: 4 });
	const read = failed.use(output, BufferAccess.StorageRead);
	failed.command({ sideEffect: true, uses: [read] });
	assert.throws(() => failed.compile(), /read before it is produced/);
	assert.throws(() => failed.createBuffer({ size: 4 }), /compile\(\) consumed/);
	assert.throws(() => failed.compile(), /compile\(\) consumed/);
});

test('execution errors release transients and leave a compiled frame reusable', () => {
	const runtime = new FrameGraph(mockDevice());
	const recorder = runtime.beginFrame();
	const transient = recorder.createBuffer({ label: 'transient', size: 4 });
	const write = recorder.use(transient, BufferAccess.StorageWrite, { contents: 'overwrite' });
	let shouldFail = true;
	recorder.command({
		uses: [write],
		sideEffect: true,
		encode() {
			if (shouldFail) {
				shouldFail = false;
				throw new Error('encode failed');
			}
		},
	});
	const compiled = recorder.compile();
	assert.throws(() => compiled.execute(), /encode failed/);
	assert.equal(runtime.getResourcePoolStats().retainedCount, 1);
	assert.doesNotThrow(() => compiled.execute());
});

test('GPU debug group state does not leak into re-execution after an encode error', () => {
	const calls: string[] = [];
	let encoderIndex = 0;
	const device = {
		...mockDevice(),
		createCommandEncoder() {
			const index = encoderIndex++;
			return mockCommandEncoder({
				pushDebugGroup(label: string) {
					calls.push(`push:${index}:${label}`);
				},
				popDebugGroup() {
					calls.push(`pop:${index}`);
				},
				finish() {
					calls.push(`finish:${index}`);
					return {} as GPUCommandBuffer;
				},
			});
		},
	} as unknown as GPUDevice;
	const recorder = new FrameGraph(device).beginFrame();
	let shouldFail = true;
	recorder.withDebugGroup('Feature', () => {
		recorder.command({
			sideEffect: true,
			encode() {
				calls.push(`encode:${shouldFail ? 'failure' : 'success'}`);
				if (shouldFail) {
					shouldFail = false;
					throw new Error('encode failed');
				}
			},
		});
	});
	const compiled = recorder.compile();

	assert.throws(() => compiled.execute({ gpuDebugGroups: true }), /encode failed/);
	assert.doesNotThrow(() => compiled.execute({ gpuDebugGroups: true }));
	assert.deepEqual(calls, [
		'push:0:Feature',
		'encode:failure',
		'push:1:Feature',
		'encode:success',
		'pop:1',
		'finish:1',
	]);
});
