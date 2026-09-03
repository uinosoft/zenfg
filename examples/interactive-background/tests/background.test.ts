import assert from 'node:assert/strict';
import test from 'node:test';
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
