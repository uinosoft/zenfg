import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDevice, createFakeTexture, createGpuTrace, installWebGpuGlobals } from '../../typegpu-slime-mold/tests/fakeWebGpu.ts';
import { startRefractiveFlow } from '../src/main.ts';
import type { CoverReadingRegions } from '../src/host.ts';
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


test('captures the optical graph and preserves one renderer across theme, input and visibility changes', async () => {
	const restoreGpu = installWebGpuGlobals();
	const trace = createGpuTrace();
	const device = createFakeDevice(trace);
	const pipeline = { getBindGroupLayout: () => ({}) };
	device.createComputePipelineAsync = async () => pipeline as GPUComputePipeline;
	device.createRenderPipelineAsync = async () => pipeline as GPURenderPipeline;
	const bindings: GPUBindGroupDescriptor[] = [];
	device.createBindGroup = (descriptor) => { bindings.push(descriptor); return {} as GPUBindGroup; };
	let queued: FrameRequestCallback | undefined;
	const frame = (time: number) => { const callback = queued; queued = undefined; callback?.(time); };
	const listeners = new Map<string, EventListener>();
	const reducedMotion = { matches: false, addEventListener(_type: string, callback: EventListener) { listeners.set('motion', callback); }, removeEventListener() { } };
	const canvas = {
		width: 64, height: 32, dataset: {},
		getBoundingClientRect: () => ({ width: 64, height: 32, left: 100, top: 50, right: 164, bottom: 82 }),
		addEventListener(type: string, callback: EventListener) { listeners.set(type, callback); }, removeEventListener(type: string) { listeners.delete(type); },
		getContext: () => ({
			configure() { }, unconfigure() { },
			getCurrentTexture: () => createFakeTexture('surface', 'bgra8unorm', 64, 32),
		}),
	} as unknown as HTMLCanvasElement;
	const restore = installGlobals({
		navigator: {
			gpu: {
				requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }),
				getPreferredCanvasFormat: () => 'bgra8unorm',
			}
		},
		window: {
			devicePixelRatio: 1, matchMedia: (query: string) => query.includes('reduced-motion') ? reducedMotion : { matches: false, addEventListener() { }, removeEventListener() { } },
			addEventListener() { }, removeEventListener() { }
		},
		document: { visibilityState: 'visible', addEventListener(type: string, callback: EventListener) { listeners.set(type, callback); }, removeEventListener(type: string) { listeners.delete(type); } },
		ResizeObserver: class { observe() { } disconnect() { } },
		requestAnimationFrame: (callback: FrameRequestCallback) => { queued = callback; return 1; },
		cancelAnimationFrame() { queued = undefined; },
	});
	try {
		let failure: Error | undefined;
		let readingChanged: (() => void) | undefined;
		let regions: CoverReadingRegions = [[0, .1, .5, .3], [0, .4, .7, .5], [0, .6, .4, .7]];
		const parallaxListeners = new Map<string, EventListener>();
		const parallaxTarget = {
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
			addEventListener(type: string, listener: EventListener) { parallaxListeners.set(type, listener); },
			removeEventListener(type: string) { parallaxListeners.delete(type); },
		} as unknown as HTMLElement;
		const controller = await startRefractiveFlow(canvas, {
			parallaxTarget,
			onError: error => { failure = error; },
			readingRegions: { get: () => regions, subscribe(listener) { readingChanged = listener; return () => { readingChanged = undefined; }; } },
		});
		assert.ok(controller);
		const capture = controller.captureSnapshot();
		frame(100);
		assert.equal(failure, undefined);
		const snapshot = await capture;
		assert.ok(snapshot);
		assert.equal(snapshot.graph.nodes.length, 8);
		assert.deepEqual(snapshot.graph.resources.map(resource => resource.label), [
			'authored curve frames', 'persistent ribbon springs', 'deformed curve frames',
			'weighted optical color', 'optical transmittance', 'HDR optical highlights',
			'bloom · 1/2', 'bloom · 1/4', 'bloom · 1/8',
			'bloom reconstruction · 1/4', 'bloom reconstruction · 1/2', 'refractive cover backbuffer',
		]);
		assert.equal(snapshot.graph.resources.filter(resource => resource.kind === 'buffer').length, 3);
		assert.ok(snapshot.graph.roots.some(root => root.reason === 'present'));
		assert.ok(snapshot.graph.resources.slice(0, 2).every(resource => resource.initialContents === 'defined'));
		assert.ok(snapshot.graph.accesses.filter(access => access.mode === 'write').every(access => access.contents === 'overwrite'));
		// Both the optical layer and reconstructed bloom must feed presentation.
		const finalNode = snapshot.graph.nodes.at(-1)!;
		const incoming = snapshot.graph.dependencies.filter(edge => edge.toNodeId === finalNode.id);
		assert.ok(incoming.some(edge => edge.fromNodeId === snapshot.graph.nodes[1]!.id));
		assert.ok(incoming.some(edge => edge.fromNodeId === snapshot.graph.nodes[6]!.id));
		assert.equal(trace.dispatches, 1);
		assert.equal(trace.draws, 8);
		assert.equal(trace.submits, 1);
		const uniformBindings = bindings.flatMap(group => [...group.entries])
			.filter(entry => 'buffer' in entry.resource && entry.resource.buffer.label === 'refractive frame params');
		assert.equal(uniformBindings.length, 4);
		const uniform = (uniformBindings[0]!.resource as GPUBufferBinding).buffer;
		assert.ok(uniformBindings.every(entry => (entry.resource as GPUBufferBinding).buffer === uniform));
		assert.equal(trace.bufferWrites[0]?.label, uniform.label);
		frame(200);
		assert.equal(trace.bufferWrites.length, 2);
		controller.setTheme('light');
		frame(300);
		assert.equal(trace.bufferWrites.length, 3);
		const uniformValues = () => { const bytes = trace.bufferWrites.at(-1)!.bytes; return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4); };
		assert.equal(uniformValues()[20], 1, 'light theme is written to the same uniform');
		assert.ok(Math.abs(uniformValues()[16]! - 245 / 255) < 1e-6, 'background matches the shared light palette');
		const move = (x: number, y: number) => listeners.get('pointermove')?.({ isPrimary: true, clientX: x, clientY: y, type: 'pointermove' } as PointerEvent);
		move(110, 60); move(130, 66); frame(320);
		assert.ok(uniformValues()[11]! > 0, 'travel inside the canvas charges the ribbons');
		assert.ok(uniformValues()[4]! < 1 && uniformValues()[4]! > 0, 'pointer is normalized against local bounds');
		assert.equal(Math.abs(uniformValues()[2]!), 0, 'viewpoint starts centered');
		const aim = (pointerType: string) => parallaxListeners.get('pointermove')?.({ isPrimary: true, pointerType, clientX: 200, clientY: 100 } as PointerEvent);
		aim('touch'); frame(325); assert.equal(Math.abs(uniformValues()[2]!), 0, 'touch does not move the viewpoint');
		aim('mouse'); frame(330);
		const parallax = uniformValues()[2]!;
		assert.ok(parallax < 0 && parallax > -36 / 64, 'mouse position eases toward a bounded offset');
		assert.ok(uniformValues()[3]! > 0, 'moving the viewpoint down shifts the artwork up');
		frame(335); assert.ok(uniformValues()[2]! < parallax, 'a stationary cursor continues to ease, independently of travel');
		parallaxListeners.get('pointerleave')?.({} as Event);
		const beforeLeave = uniformValues()[2]!;
		const pressure = uniformValues()[11]!;
		listeners.get('pointerleave')?.({} as Event); move(160, 80); frame(340);
		assert.ok(uniformValues()[11]! < pressure, 're-entry starts a fresh travel sample');
		assert.ok(uniformValues()[2]! > beforeLeave, 'leaving the hero eases back to the centered view');
		const beforeCancel = uniformValues()[11]!;
		listeners.get('pointercancel')?.({} as Event); move(110, 60); frame(350);
		assert.ok(uniformValues()[11]! < beforeCancel, 'a canceled touch gesture resets the travel sample');
		reducedMotion.matches = true; listeners.get('motion')?.({} as Event); frame(360);
		assert.equal(uniformValues()[13], 1); assert.equal(uniformValues()[8], 0); assert.equal(uniformValues()[11], 0);
		assert.equal(Math.abs(uniformValues()[2]!), 0); assert.equal(Math.abs(uniformValues()[3]!), 0);
		assert.equal(queued, undefined, 'reduced motion stops the continuous loop');
		controller.setTheme('dark'); frame(380);
		assert.equal(uniformValues()[20], 0); assert.equal(queued, undefined);
		regions = [[0, .1, .8, .3], [0, .4, .9, .5], [0, .6, .5, .7]];
		readingChanged?.(); frame(390);
		assert.ok(Math.abs(uniformValues()[26]! - .8) < 1e-6, 'changed text bounds reach the GPU in reduced motion');
		assert.ok(Math.abs(uniformValues()[30]! - .9) < 1e-6);
		assert.equal(queued, undefined, 'layout changes draw once without restarting the loop');
		reducedMotion.matches = false; listeners.get('motion')?.({} as Event);
		const pending = controller.captureSnapshot();
		controller.setActive(false);
		assert.equal(await pending, undefined);
		assert.equal(await controller.captureSnapshot(), undefined);
		assert.equal(queued, undefined, 'inactive renderer has no animation request');
		controller.setTheme('dark');
		controller.setActive(true);
		const resumedCapture = controller.captureSnapshot();
		frame(400);
		assert.ok(await resumedCapture);
		const hiddenCapture = controller.captureSnapshot();
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		listeners.get('visibilitychange')?.({} as Event);
		assert.equal(await hiddenCapture, undefined); assert.equal(queued, undefined);
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		listeners.get('visibilitychange')?.({} as Event); assert.ok(queued);
		controller.dispose();
		assert.equal(readingChanged, undefined, 'layout subscriptions are released');
		assert.equal(parallaxListeners.size, 0, 'viewpoint listeners are released');
		assert.equal(trace.destroyedBuffers.length, 4, 'three native buffers and the transient curve buffer are released');
		assert.equal(new Set(trace.destroyedBuffers).size, 4, 'each buffer is destroyed once');
		assert.ok(trace.destroyedBuffers.includes(uniform.label));
		assert.equal(trace.destroyedTextures.length, trace.textureCreates.length, 'all allocated textures are released');
		assert.equal(trace.deviceDestroys, 1);
	} finally { restore(); restoreGpu(); }
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
		constructor(_callback: ResizeObserverCallback) { }
		observe(target: Element): void {
			observedTarget = target;
		}
		disconnect(): void {
			calls.disconnect += 1;
		}
	}

	const pipeline = { getBindGroupLayout: () => ({}) };

	const device = {
		features: new Set<GPUFeatureName>(),
		lost,
		createShaderModule: () => ({}),
		createComputePipelineAsync: async () => pipeline,
		createRenderPipelineAsync: async () => pipeline,
		createBuffer: (descriptor: GPUBufferDescriptor) => ({ getMappedRange: () => new ArrayBuffer(descriptor.size), unmap() { }, destroy: () => { calls.bufferDestroy += 1; } }),
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
		GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 },
	});

	try {
		let deviceLoss: Error | undefined;
		const controller = await startRefractiveFlow(canvas, {
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
			bufferDestroy: 3,
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

test('initialization failures release the configured context and device without scheduling a loop', async () => {
	const restoreGpu = installWebGpuGlobals();
	try {
		for (const stage of ['adapter', 'context', 'pipeline'] as const) {
			const trace = createGpuTrace();
			const device = createFakeDevice(trace);
			device.createComputePipelineAsync = async () => { throw Error('pipeline rejected'); };
			device.createRenderPipelineAsync = async () => ({}) as GPURenderPipeline;
			let unconfigured = 0, errors = 0, frames = 0;
			const canvas = {
				getContext: () => stage === 'context' ? null : {
					configure() { }, unconfigure() { unconfigured++; },
				}
			} as unknown as HTMLCanvasElement;
			const restore = installGlobals({
				navigator: {
					gpu: {
						requestAdapter: async () => stage === 'adapter' ? null : { features: new Set(), requestDevice: async () => device },
						getPreferredCanvasFormat: () => 'bgra8unorm',
					}
				},
				requestAnimationFrame: () => { frames++; return 1; },
			});
			try {
				const renderer = await startRefractiveFlow(canvas, { onError() { errors++; } });
				assert.equal(renderer, undefined);
				assert.equal(errors, 1);
				assert.equal(frames, 0);
				assert.equal(trace.deviceDestroys, stage === 'adapter' ? 0 : 1);
				assert.equal(unconfigured, stage === 'pipeline' ? 1 : 0);
			} finally { restore(); }
		}
	} finally { restoreGpu(); }
});
