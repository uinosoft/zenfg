import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDevice, createFakeTexture, createGpuTrace, installWebGpuGlobals } from '../../typegpu-slime-mold/tests/fakeWebGpu.ts';
import { startZenBackground } from '../src/background.ts';
import { resolvePointerPressure } from '../src/backgroundInteraction.ts';
import { resolveCanvasDimensions } from '../src/backgroundLayout.ts';

test('reports a clear initialization error when WebGPU is unavailable', async () => {
	const restore = installGlobals({ navigator: {} });
	try {
		let reported: Error | undefined;
		const controller = await startZenBackground({} as HTMLCanvasElement, {
			onError: (error) => {
				reported = error;
			},
		});
		assert.equal(controller, undefined);
		assert.match(reported?.message ?? '', /WebGPU is not available/);
	}
	finally {
		restore();
	}
});

test('derives backing and flow-field sizes from canvas bounds without exceeding the pixel budget', () => {
	assert.deepEqual(resolveCanvasDimensions(800, 600, 2, false, 6), {
		width: 1200,
		height: 900,
		fieldWidth: 200,
		fieldHeight: 150,
		bloomWidth: 600,
		bloomHeight: 450,
	});

	const wide = resolveCanvasDimensions(7680, 2160, 2, false, 6);
	assert.ok(wide.width * wide.height <= 3_600_000);
	assert.equal(wide.fieldWidth, Math.ceil(wide.width / 6));
	assert.equal(wide.fieldHeight, Math.ceil(wide.height / 6));
	assert.equal(wide.bloomWidth, Math.ceil(wide.width / 2));
	assert.equal(wide.bloomHeight, Math.ceil(wide.height / 2));

	const mobile = resolveCanvasDimensions(390, 844, 3, true, 6);
	assert.deepEqual(mobile, {
		width: 390,
		height: 844,
		fieldWidth: 65,
		fieldHeight: 141,
		bloomWidth: 195,
		bloomHeight: 422,
	});

	assert.deepEqual(resolveCanvasDimensions(1, 1, 1, false, 6), {
		width: 1,
		height: 1,
		fieldWidth: 1,
		fieldHeight: 1,
		bloomWidth: 1,
		bloomHeight: 1,
	});
});

test('makes pressure harder to add and faster to release as it rises', () => {
	assert.equal(resolvePointerPressure(0, 0, 1 / 60, false), 0);

	const lowPressure = 0.2;
	const highPressure = 0.8;
	const lowIdle = resolvePointerPressure(lowPressure, 0, 0.25, false);
	const highIdle = resolvePointerPressure(highPressure, 0, 0.25, false);
	assert.ok(highPressure - highIdle > (lowPressure - lowIdle) * 3);

	const lowCharging = resolvePointerPressure(lowPressure, 0.01, 1 / 60, false);
	const highCharging = resolvePointerPressure(highPressure, 0.01, 1 / 60, false);
	assert.ok(lowCharging > lowPressure);
	assert.ok(highCharging < highPressure);
	assert.ok(lowCharging - lowPressure > highCharging - highPressure);

	const ordinary = simulatePointerPressure(0, 0.48, 2, 60);
	const fast = simulatePointerPressure(0, 1.2, 2, 60);
	assert.ok(ordinary > 0.5 && ordinary < 0.85);
	assert.ok(fast > ordinary);

	let releasing = 1;
	for (let frame = 0; frame < 180; frame += 1) {
		const next = resolvePointerPressure(releasing, 0, 1 / 60, false);
		assert.ok(next <= releasing);
		releasing = next;
	}
	assert.ok(releasing > 0 && releasing < 0.15);
});

test('keeps pressure integration frame-rate stable, bounded, and motion-safe', () => {
	const pressureAt60Fps = simulatePointerPressure(0, 0.48, 2, 60);
	const pressureAt120Fps = simulatePointerPressure(0, 0.48, 2, 120);
	assert.ok(Math.abs(pressureAt60Fps - pressureAt120Fps) < 0.01);
	assert.equal(resolvePointerPressure(0.96, 1, 1 / 60, false), 1);
	assert.equal(resolvePointerPressure(0.7, 0.02, 1 / 60, true), 0);
});

test('coalesces captures and disposes once after a device loss', async () => {
	let resolveLost: (info: GPUDeviceLostInfo) => void = () => undefined;
	const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
		resolveLost = resolve;
	});
	const calls = {
		bufferDestroy: 0,
		deviceDestroy: 0,
		disconnect: 0,
		unconfigure: 0,
	};
	let observedTarget: Element | undefined;
	let pageShowListener: EventListener | undefined;
	let nextAnimationFrame = 0;
	const canceledAnimationFrames: number[] = [];
	class MockResizeObserver {
		constructor(_callback: ResizeObserverCallback) {}
		observe(target: Element): void {
			observedTarget = target;
		}
		disconnect(): void {
			calls.disconnect += 1;
		}
	}

	const pipeline = { getBindGroupLayout: () => ({}) };
	const uniformBuffer = { destroy: () => { calls.bufferDestroy += 1; } };
	const device = {
		features: new Set<GPUFeatureName>(),
		lost,
		createShaderModule: () => ({}),
		createComputePipelineAsync: async () => pipeline,
		createRenderPipelineAsync: async () => pipeline,
		createBuffer: () => uniformBuffer,
		createSampler: () => ({}),
		destroy: () => { calls.deviceDestroy += 1; },
	} as unknown as GPUDevice;
	const context = {
		configure: () => undefined,
		unconfigure: () => { calls.unconfigure += 1; },
	};
	const canvas = {
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		getContext: (kind: string) => kind === 'webgpu' ? context : null,
	} as unknown as HTMLCanvasElement;
	const gpu = {
		requestAdapter: async () => ({
			features: new Set<GPUFeatureName>(),
			requestDevice: async () => device,
		}),
		getPreferredCanvasFormat: () => 'bgra8unorm',
	};
	const mediaQuery = {
		matches: false,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	};
	const restore = installGlobals({
		navigator: { gpu },
		window: {
			devicePixelRatio: 1,
			matchMedia: () => mediaQuery,
			addEventListener: (type: string, listener: EventListener) => {
				if (type === 'pageshow') pageShowListener = listener;
			},
			removeEventListener: (type: string, listener: EventListener) => {
				if (type === 'pageshow' && pageShowListener === listener) pageShowListener = undefined;
			},
		},
		document: {
			visibilityState: 'visible',
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		},
		ResizeObserver: MockResizeObserver,
		requestAnimationFrame: () => ++nextAnimationFrame,
		cancelAnimationFrame: (frame: number) => { canceledAnimationFrames.push(frame); },
		GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8 },
	});

	try {
		let deviceLoss: Error | undefined;
		const controller = await startZenBackground(canvas, {
			onError: (error) => {
				deviceLoss = error;
			},
		});
		assert.ok(controller);
		assert.equal(observedTarget, canvas);
		assert.equal(nextAnimationFrame, 1);
		pageShowListener?.({ persisted: false } as PageTransitionEvent);
		assert.equal(nextAnimationFrame, 1);
		pageShowListener?.({ persisted: true } as PageTransitionEvent);
		assert.equal(nextAnimationFrame, 2);
		assert.deepEqual(canceledAnimationFrames, [1]);

		const firstCapture = controller.captureSnapshot();
		const secondCapture = controller.captureSnapshot();
		assert.equal(firstCapture, secondCapture);

		resolveLost({ message: 'test reset', reason: 'unknown' } as GPUDeviceLostInfo);
		await Promise.resolve();
		await Promise.resolve();
		assert.match(deviceLoss?.message ?? '', /device was lost: test reset/);
		assert.equal(await firstCapture, undefined);

		controller.dispose();
		assert.deepEqual(calls, {
			bufferDestroy: 1,
			deviceDestroy: 1,
			disconnect: 1,
			unconfigure: 1,
		});
		assert.equal(pageShowListener, undefined);
		assert.deepEqual(canceledAnimationFrames, [1, 2]);
	}
	finally {
		restore();
	}
});

function simulatePointerPressure(
	initialPressure: number,
	travelPerSecond: number,
	durationSeconds: number,
	framesPerSecond: number,
): number {
	let pressure = initialPressure;
	const frameCount = durationSeconds * framesPerSecond;
	for (let frame = 0; frame < frameCount; frame += 1) {
		pressure = resolvePointerPressure(
			pressure,
			travelPerSecond / framesPerSecond,
			1 / framesPerSecond,
			false,
		);
	}
	return pressure;
}

function installGlobals(values: Record<string, unknown>): () => void {
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [name, value] of Object.entries(values)) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value,
		});
	}
	return () => {
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	};
}


test('captures five texture resources while native frame uniforms remain bound, updated and released', async () => {
	const restoreGpu = installWebGpuGlobals();
	const trace = createGpuTrace();
	const device = createFakeDevice(trace);
	const pipeline = { getBindGroupLayout: () => ({}) };
	device.createComputePipelineAsync = async () => pipeline as GPUComputePipeline;
	device.createRenderPipelineAsync = async () => pipeline as GPURenderPipeline;
	const bindings: GPUBindGroupDescriptor[] = [];
	device.createBindGroup = (descriptor) => { bindings.push(descriptor); return {} as GPUBindGroup; };
	let frame: FrameRequestCallback = () => {};
	const canvas = {
		width: 64, height: 32, dataset: {},
		getBoundingClientRect: () => ({ width: 64, height: 32 }),
		addEventListener() {}, removeEventListener() {},
		getContext: () => ({ configure() {}, unconfigure() {},
			getCurrentTexture: () => createFakeTexture('surface', 'bgra8unorm', 64, 32),
		}),
	} as unknown as HTMLCanvasElement;
	const restore = installGlobals({
		navigator: { gpu: {
			requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }),
			getPreferredCanvasFormat: () => 'bgra8unorm',
		} },
		window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
			addEventListener() {}, removeEventListener() {} },
		document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
		ResizeObserver: class { observe() {} disconnect() {} },
		requestAnimationFrame: (callback: FrameRequestCallback) => { frame = callback; return 1; },
		cancelAnimationFrame() {},
	});
	try {
		let failure: Error | undefined;
		const controller = await startZenBackground(canvas, { onError: error => { failure = error; } });
		assert.ok(controller);
		const capture = controller.captureSnapshot();
		frame(100);
		assert.equal(failure, undefined);
		const snapshot = await capture;
		assert.ok(snapshot);
		assert.equal(snapshot.graph.nodes.length, 5);
		assert.deepEqual(snapshot.graph.resources.map(resource => resource.label), [
			'interactive-flow-field', 'hdr-lattice-scene-color', 'half-resolution-bloom-seed',
			'half-resolution-soft-bloom', 'background-bgra8unorm-backbuffer',
		]);
		const nodeOrder = new Map(snapshot.graph.nodes.map((node, index) => [node.id, index]));
		assert.deepEqual(snapshot.graph.dependencies.map(edge => [
			nodeOrder.get(edge.fromNodeId), nodeOrder.get(edge.toNodeId), edge.kind,
		]).sort(), [[0, 1, 'value'], [1, 2, 'value'], [1, 4, 'value'], [2, 3, 'value'], [3, 4, 'value']]);
		assert.deepEqual(snapshot.graph.roots.map(root => root.reason), ['present']);
		assert.ok(snapshot.graph.resources.every(resource => resource.initialContents === 'undefined'));
		assert.equal(snapshot.graph.accesses.filter(access => access.mode === 'write').length, 5);
		assert.ok(snapshot.graph.accesses.filter(access => access.mode === 'write')
			.every(access => access.contents === 'overwrite'));
		assert.ok(snapshot.graph.resources.every(resource => resource.kind === 'texture'));
		assert.equal(trace.dispatches, 1);
		assert.equal(trace.draws, 4);
		assert.equal(trace.submits, 1);
		const uniformBindings = bindings.flatMap(group => [...group.entries])
			.filter(entry => 'buffer' in entry.resource);
		assert.equal(uniformBindings.length, 3);
		const uniform = (uniformBindings[0]!.resource as GPUBufferBinding).buffer;
		assert.ok(uniformBindings.every(entry => (entry.resource as GPUBufferBinding).buffer === uniform));
		assert.equal(trace.bufferWrites[0]?.label, uniform.label);
		frame(200);
		assert.equal(trace.bufferWrites.length, 2);
		controller.dispose();
		assert.deepEqual(trace.destroyedBuffers, [uniform.label]);
		assert.equal(trace.destroyedTextures.length, 4);
		assert.equal(trace.deviceDestroys, 1);
	} finally { restore(); restoreGpu(); }
});
