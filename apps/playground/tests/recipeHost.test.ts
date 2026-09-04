import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebGpuRecipeHost } from '../src/catalog/webgpu/recipeHost.ts';
import type { PlaygroundMountContext } from '../src/types.ts';

type Deferred<T> = {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function replaceGlobal(name: string, value: unknown): () => void {
	const original = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	return () => {
		if (original) Object.defineProperty(globalThis, name, original);
		else delete (globalThis as Record<string, unknown>)[name];
	};
}

function mountContext(options: {
	readonly context?: GPUCanvasContext | null;
	readonly errors?: Error[];
} = {}): PlaygroundMountContext {
	const canvas = {
		clientWidth: 640,
		clientHeight: 360,
		width: 640,
		height: 360,
		getContext: () => options.context ?? null,
	} as unknown as HTMLCanvasElement;
	return {
		canvas,
		onReady() {},
		onError(error) { options.errors?.push(error); },
	};
}

function gpuDevice(lost: Promise<GPUDeviceLostInfo>, onDestroy: () => void): GPUDevice {
	return {
		limits: { maxTextureDimension2D: 8192 },
		lost,
		destroy: onDestroy,
	} as unknown as GPUDevice;
}

test('recipe host reports unavailable adapter and context initialization failures', async () => {
	const errors: Error[] = [];
	const restoreTextureUsage = replaceGlobal('GPUTextureUsage', {
		RENDER_ATTACHMENT: 0x10,
		COPY_DST: 0x02,
	});
	const restoreNavigator = replaceGlobal('navigator', {
		gpu: {
			requestAdapter: async () => null,
			getPreferredCanvasFormat: () => 'bgra8unorm',
		},
	});
	try {
		assert.equal(await createWebGpuRecipeHost(mountContext({ errors })), undefined);
		assert.match(errors[0]?.message ?? '', /adapter/u);

		let destroyCount = 0;
		const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
		const device = gpuDevice(neverLost, () => { destroyCount++; });
		(globalThis.navigator as Navigator & { gpu: GPU }).gpu.requestAdapter = async () => ({
			features: new Set(),
			requestDevice: async () => device,
		}) as unknown as GPUAdapter;
		assert.equal(await createWebGpuRecipeHost(mountContext({ errors })), undefined);
		assert.equal(destroyCount, 1);
		assert.match(errors[1]?.message ?? '', /canvas WebGPU context/u);

		const configureError = new Error('configure failed');
		const configureContext = {
			configure() { throw configureError; },
			unconfigure() {},
		} as unknown as GPUCanvasContext;
		assert.equal(await createWebGpuRecipeHost(mountContext({ context: configureContext, errors })), undefined);
		assert.equal(destroyCount, 2);
		assert.equal(errors[2], configureError);
	}
	finally {
		restoreNavigator();
		restoreTextureUsage();
	}
});

test('recipe host reports device loss and disposes owned resources exactly once', async () => {
	const errors: Error[] = [];
	const loss = deferred<GPUDeviceLostInfo>();
	let deviceDestroyCount = 0;
	let unconfigureCount = 0;
	const device = gpuDevice(loss.promise, () => { deviceDestroyCount++; });
	const context = {
		configure() {},
		unconfigure() { unconfigureCount++; },
	} as unknown as GPUCanvasContext;
	const restoreTextureUsage = replaceGlobal('GPUTextureUsage', {
		RENDER_ATTACHMENT: 0x10,
		COPY_DST: 0x02,
	});
	const restoreNavigator = replaceGlobal('navigator', {
		gpu: {
			requestAdapter: async () => ({
				features: new Set(),
				requestDevice: async () => device,
			}),
			getPreferredCanvasFormat: () => 'bgra8unorm',
		},
	});
	try {
		const host = await createWebGpuRecipeHost(mountContext({ context, errors }));
		assert.ok(host);
		let releasedDestroyCount = 0;
		let retainedDestroyCount = 0;
		const released = host.own({ destroy() { releasedDestroyCount++; } });
		host.release(released);
		host.release(released);
		host.own({ destroy() { retainedDestroyCount++; } });

		loss.resolve({ reason: 'unknown', message: 'test loss' } as GPUDeviceLostInfo);
		await loss.promise;
		await Promise.resolve();
		assert.match(errors[0]?.message ?? '', /test loss/u);
		assert.equal(releasedDestroyCount, 1);
		assert.equal(retainedDestroyCount, 1);
		assert.equal(unconfigureCount, 1);
		assert.equal(deviceDestroyCount, 1);

		host.dispose();
		host.dispose();
		assert.equal(unconfigureCount, 1);
		assert.equal(deviceDestroyCount, 1);
	}
	finally {
		restoreNavigator();
		restoreTextureUsage();
	}
});
