import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { typeGpuSlimeMoldExample } from '../src/catalog/typeGpuSlimeMold.ts';
import {
	createFakeDevice,
	createFakeTexture,
	createGpuTrace,
	installWebGpuGlobals,
} from '../../../examples/typegpu-slime-mold/tests/fakeWebGpu.ts';

test('Slime Mold adapter mounts live controls and releases Pane, events, and DOM', async () => {
	const restoreGpu = installWebGpuGlobals();
	const target = globalThis as Record<string, unknown>;
	const globalKeys = [
		'window',
		'document',
		'navigator',
		'performance',
		'requestAnimationFrame',
		'cancelAnimationFrame',
		'ResizeObserver',
		'HTMLElement',
		'Element',
		'Node',
		'Event',
		'CustomEvent',
		'MouseEvent',
		'KeyboardEvent',
		'MutationObserver',
		'getComputedStyle',
	] as const;
	const previous = new Map(globalKeys.map((key) => [
		key,
		Object.getOwnPropertyDescriptor(target, key),
	]));
	const browser = new Window({ url: 'https://zenfg.test/playground/' });
	const canvas = browser.document.createElement('canvas') as unknown as HTMLCanvasElement;
	const controlsHost = browser.document.createElement('aside') as unknown as HTMLElement;
	browser.document.body.append(
		canvas as unknown as Node,
		controlsHost as unknown as Node,
	);
	Object.defineProperties(canvas, {
		clientWidth: { configurable: true, value: 320 },
		clientHeight: { configurable: true, value: 180 },
	});
	canvas.getBoundingClientRect = () => ({
		x: 0,
		y: 0,
		top: 0,
		right: 320,
		bottom: 180,
		left: 0,
		width: 320,
		height: 180,
		toJSON: () => ({}),
	});

	const gpuTrace = createGpuTrace();
	const device = createFakeDevice(gpuTrace);
	let unconfigureCount = 0;
	const context = {
		configure() {},
		unconfigure() { unconfigureCount += 1; },
		getCurrentTexture: () => createFakeTexture(
			'mock.swapchain',
			'rgba8unorm',
			canvas.width,
			canvas.height,
		),
	} as unknown as GPUCanvasContext;
	canvas.getContext = ((kind: string) => (
		kind === 'webgpu' ? context : null
	)) as typeof canvas.getContext;

	const navigator = browser.navigator as Navigator & { gpu?: GPU };
	Object.defineProperty(navigator, 'gpu', {
		configurable: true,
		value: {
			requestAdapter: async () => ({
				features: new Set<GPUFeatureName>(),
				requestDevice: async () => device,
			} as unknown as GPUAdapter),
			getPreferredCanvasFormat: () => 'rgba8unorm',
		} as GPU,
	});
	class MockResizeObserver {
		constructor(_callback: ResizeObserverCallback) {}
		observe(): void {}
		disconnect(): void {}
		unobserve(): void {}
	}
	let nextAnimationFrame = 1;
	const animationFrames = new Map<number, FrameRequestCallback>();
	const requestAnimationFrame = (callback: FrameRequestCallback): number => {
		const id = nextAnimationFrame++;
		animationFrames.set(id, callback);
		return id;
	};
	const cancelAnimationFrame = (id: number): void => {
		animationFrames.delete(id);
	};
	const browserRecord = browser as unknown as Record<string, unknown>;
	Object.defineProperties(target, {
		window: { configurable: true, value: browser },
		document: { configurable: true, value: browser.document },
		navigator: { configurable: true, value: navigator },
		performance: { configurable: true, value: browser.performance },
		requestAnimationFrame: { configurable: true, value: requestAnimationFrame },
		cancelAnimationFrame: { configurable: true, value: cancelAnimationFrame },
		ResizeObserver: { configurable: true, value: MockResizeObserver },
		HTMLElement: { configurable: true, value: browserRecord.HTMLElement },
		Element: { configurable: true, value: browserRecord.Element },
		Node: { configurable: true, value: browserRecord.Node },
		Event: { configurable: true, value: browserRecord.Event },
		CustomEvent: { configurable: true, value: browserRecord.CustomEvent },
		MouseEvent: { configurable: true, value: browserRecord.MouseEvent },
		KeyboardEvent: { configurable: true, value: browserRecord.KeyboardEvent },
		MutationObserver: { configurable: true, value: browserRecord.MutationObserver },
		getComputedStyle: {
			configurable: true,
			value: browser.getComputedStyle.bind(browser),
		},
	});

	try {
		const runtime = await typeGpuSlimeMoldExample.mount({
			canvas,
			controlsHost,
			onReady: () => undefined,
			onError: (error) => { throw error; },
		});
		assert.ok(runtime);
		assert.equal(controlsHost.childElementCount, 1);
		assert.equal(controlsHost.querySelectorAll('input').length, 5);

		const firstInput = controlsHost.querySelector('input');
		assert.ok(firstInput);
		const writesBeforeInput = gpuTrace.writes;
		firstInput.value = '75';
		firstInput.dispatchEvent(new browser.Event('input', { bubbles: true }));
		firstInput.dispatchEvent(new browser.Event('change', { bubbles: true }));
		const pendingFrames = [...animationFrames.values()];
		animationFrames.clear();
		for (const callback of pendingFrames) callback(16);
		assert.ok(gpuTrace.writes > writesBeforeInput);
		const paramsWrite = gpuTrace.bufferWrites.findLast((write) => write.bytes.byteLength >= 20);
		assert.ok(paramsWrite);
		assert.equal(new Float32Array(
			paramsWrite.bytes.buffer,
			paramsWrite.bytes.byteOffset,
			1,
		)[0], 75);

		runtime.dispose();
		assert.equal(controlsHost.childElementCount, 0);
		assert.equal(unconfigureCount, 1);
		assert.equal(gpuTrace.deviceDestroys, 1);
		const writesAfterDispose = gpuTrace.writes;
		firstInput.value = '35';
		firstInput.dispatchEvent(new browser.Event('input', { bubbles: true }));
		firstInput.dispatchEvent(new browser.Event('change', { bubbles: true }));
		assert.equal(gpuTrace.writes, writesAfterDispose);

		runtime.dispose();
		assert.equal(unconfigureCount, 1);
		assert.equal(gpuTrace.deviceDestroys, 1);
	} finally {
		browser.close();
		for (const key of globalKeys) {
			const descriptor = previous.get(key);
			if (descriptor) Object.defineProperty(target, key, descriptor);
			else delete target[key];
		}
		restoreGpu();
	}
});
