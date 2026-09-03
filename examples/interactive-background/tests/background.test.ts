import assert from 'node:assert/strict';
import test from 'node:test';
import { startZenBackground } from '../src/background.ts';
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
	});

	const wide = resolveCanvasDimensions(7680, 2160, 2, false, 6);
	assert.ok(wide.width * wide.height <= 3_600_000);
	assert.equal(wide.fieldWidth, Math.ceil(wide.width / 6));
	assert.equal(wide.fieldHeight, Math.ceil(wide.height / 6));

	const mobile = resolveCanvasDimensions(390, 844, 3, true, 6);
	assert.deepEqual(mobile, {
		width: 390,
		height: 844,
		fieldWidth: 65,
		fieldHeight: 141,
	});
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
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		},
		document: {
			visibilityState: 'visible',
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		},
		ResizeObserver: MockResizeObserver,
		requestAnimationFrame: () => 1,
		cancelAnimationFrame: () => undefined,
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
	}
	finally {
		restore();
	}
});

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
