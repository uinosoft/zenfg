import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
    resolveCanvasBackingSize,
    startTypeGpuSlimeMold,
} from '../src/index.ts';
import {
    createFakeDevice,
    createFakeTexture,
    createGpuTrace,
    installWebGpuGlobals,
    type FakeGpuTrace,
} from './fakeWebGpu.ts';

interface HostHarness {
    readonly canvas: HTMLCanvasElement;
    readonly contextTrace: { configure: number; unconfigure: number };
    readonly gpuTrace: FakeGpuTrace;
    readonly flushFrame: (time: number) => void;
    readonly restore: () => void;
}

function installHostHarness(): HostHarness {
    const restoreGpu = installWebGpuGlobals();
    const target = globalThis as Record<string, unknown>;
    const keys = [
        'window',
        'document',
        'navigator',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'ResizeObserver',
    ] as const;
    const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(target, key)]));
    const browser = new Window({ url: 'https://zenfg.test/playground/' });
    const canvas = browser.document.createElement('canvas') as unknown as HTMLCanvasElement;
    browser.document.body.appendChild(canvas as unknown as Node);
    let cssWidth = 320;
    let cssHeight = 180;
    Object.defineProperties(canvas, {
        clientWidth: { configurable: true, get: () => cssWidth },
        clientHeight: { configurable: true, get: () => cssHeight },
    });
    canvas.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        right: cssWidth,
        bottom: cssHeight,
        left: 0,
        width: cssWidth,
        height: cssHeight,
        toJSON: () => ({}),
    });

    const gpuTrace = createGpuTrace();
    const device = createFakeDevice(gpuTrace);
    const contextTrace = { configure: 0, unconfigure: 0 };
    const context = {
        configure() { contextTrace.configure += 1; },
        unconfigure() { contextTrace.unconfigure += 1; },
        getCurrentTexture() {
            return createFakeTexture('mock.swapchain', 'rgba8unorm', canvas.width, canvas.height);
        },
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

    let nextRaf = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const id = nextRaf++;
        frames.set(id, callback);
        return id;
    };
    const cancelAnimationFrame = (id: number): void => {
        frames.delete(id);
    };
    class MockResizeObserver {
        constructor(_callback: ResizeObserverCallback) {}
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
    }

    Object.defineProperties(target, {
        window: { configurable: true, value: browser },
        document: { configurable: true, value: browser.document },
        navigator: { configurable: true, value: navigator },
        performance: { configurable: true, value: browser.performance },
        requestAnimationFrame: { configurable: true, value: requestAnimationFrame },
        cancelAnimationFrame: { configurable: true, value: cancelAnimationFrame },
        ResizeObserver: { configurable: true, value: MockResizeObserver },
    });

    return {
        canvas,
        contextTrace,
        gpuTrace,
        flushFrame(time) {
            const pending = [...frames.entries()];
            frames.clear();
            for (const [, callback] of pending) callback(time);
        },
        restore() {
            cssWidth = 1;
            cssHeight = 1;
            browser.close();
            for (const key of keys) {
                const descriptor = previous.get(key);
                if (descriptor) Object.defineProperty(target, key, descriptor);
                else delete target[key];
            }
            restoreGpu();
        },
    };
}

test('host coalesces capture into a real frame and commits before the next frame', async () => {
    const harness = installHostHarness();
    try {
        const errors: Error[] = [];
        let ready = 0;
        const controller = await startTypeGpuSlimeMold(harness.canvas, {
            onReady: () => { ready += 1; },
            onError: (error) => { errors.push(error instanceof Error ? error : new Error(String(error))); },
        });
        assert.ok(controller);
        assert.equal(harness.contextTrace.configure, 1);
        assert.equal(harness.gpuTrace.submits, 0);
        assert.deepEqual(controller.getSettings(), {
            moveSpeed: 50,
            sensorAngle: 0.5,
            sensorDistance: 15,
            turnSpeed: 2,
            evaporationRate: 0.05,
        });
        controller.setSettings({ turnSpeed: 3 });
        assert.equal(controller.getSettings().turnSpeed, 3);

        const capture = controller.captureSnapshot();
        assert.equal(controller.captureSnapshot(), capture);
        harness.flushFrame(16);
        const snapshot = await capture;
        assert.ok(snapshot);
        assert.deepEqual(snapshot.graph.nodes.map((node) => node.label), [
            'slime-mold.reset',
            'slime-mold.diffuse',
            'slime-mold.simulate',
            'slime-mold.render',
        ]);
        assert.equal(harness.gpuTrace.submits, 1);
        assert.equal(harness.gpuTrace.dispatches, 5);
        assert.equal(ready, 1);
        assert.equal(harness.canvas.dataset.frameGraphPasses, '4');
        const firstDeltaWrite = harness.gpuTrace.bufferWrites.findLast((write) => (
            write.bytes.byteLength === Float32Array.BYTES_PER_ELEMENT
        ));
        assert.ok(firstDeltaWrite);
        assert.equal(new Float32Array(
            firstDeltaWrite.bytes.buffer,
            firstDeltaWrite.bytes.byteOffset,
            1,
        )[0], 0);

        harness.flushFrame(32);
        assert.equal(harness.gpuTrace.submits, 2);
        assert.equal(harness.gpuTrace.dispatches, 7);
        assert.equal(ready, 1);
        const secondDeltaWrite = harness.gpuTrace.bufferWrites.findLast((write) => (
            write.bytes.byteLength === Float32Array.BYTES_PER_ELEMENT
        ));
        assert.ok(secondDeltaWrite);
        assert.ok(Math.abs((new Float32Array(
            secondDeltaWrite.bytes.buffer,
            secondDeltaWrite.bytes.byteOffset,
            1,
        )[0] ?? 0) - 0.016) < 0.000_001);
        assert.deepEqual(errors, []);

        controller.dispose();
        controller.dispose();
        assert.equal(harness.contextTrace.unconfigure, 1);
        assert.equal(harness.gpuTrace.deviceDestroys, 1);
        assert.equal(await controller.captureSnapshot(), undefined);
    } finally {
        harness.restore();
    }
});

test('host reports submission failure and device loss with single cleanup', async () => {
    const submitHarness = installHostHarness();
    try {
        const errors: Error[] = [];
        const controller = await startTypeGpuSlimeMold(submitHarness.canvas, {
            onError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
        });
        assert.ok(controller);
        submitHarness.gpuTrace.throwOnSubmit = true;
        submitHarness.flushFrame(16);
        assert.equal(errors.length, 1);
        assert.match(errors[0]?.message ?? '', /submit failure/);
        assert.equal(submitHarness.contextTrace.unconfigure, 1);
        assert.equal(submitHarness.gpuTrace.deviceDestroys, 1);
        controller.dispose();
        assert.equal(submitHarness.gpuTrace.deviceDestroys, 1);
    } finally {
        submitHarness.restore();
    }

    const lossHarness = installHostHarness();
    try {
        const errors: Error[] = [];
        const controller = await startTypeGpuSlimeMold(lossHarness.canvas, {
            onError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
        });
        assert.ok(controller);
        lossHarness.gpuTrace.loseDevice({
            reason: 'unknown',
            message: 'adapter removed',
        } as GPUDeviceLostInfo);
        await Promise.resolve();
        assert.equal(errors.length, 1);
        assert.match(errors[0]?.message ?? '', /adapter removed/);
        assert.equal(lossHarness.contextTrace.unconfigure, 1);
        assert.equal(lossHarness.gpuTrace.deviceDestroys, 1);
        controller.dispose();
        assert.equal(lossHarness.gpuTrace.deviceDestroys, 1);
    } finally {
        lossHarness.restore();
    }
});

test('canvas backing size caps DPR and scales both axes to device limits', () => {
    const canvas = {
        clientWidth: 1_000,
        clientHeight: 500,
        getBoundingClientRect: () => ({ width: 1_000, height: 500 }),
    } as Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight' | 'getBoundingClientRect'>;
    assert.deepEqual(resolveCanvasBackingSize(canvas, 3, 8_192), {
        width: 2_000,
        height: 1_000,
    });
    assert.deepEqual(resolveCanvasBackingSize(canvas, 2, 1_024), {
        width: 1_024,
        height: 512,
    });
});
