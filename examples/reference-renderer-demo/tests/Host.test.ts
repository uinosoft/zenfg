import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { resolveCanvasBackingSize, startReferenceRenderer } from '../src/start.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';

function installHost() {
    const restoreGpu = installWebGpuGlobals();
    const browser = new Window({ url: 'https://zenfg.test/playground/' });
    const { device, trace } = createFakeGpu();
    const target = globalThis as Record<string, unknown>;
    const names = ['window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver'];
    const previous = names.map(name => Object.getOwnPropertyDescriptor(target, name));
    let width = 320;
    let height = 180;
    let visible = true;
    let nextRaf = 1;
    const frames = new Map<number, FrameRequestCallback>();
    let loseDevice: (info: GPUDeviceLostInfo) => void = () => undefined;
    Object.defineProperty(device, 'lost', { value: new Promise<GPUDeviceLostInfo>(resolve => { loseDevice = resolve; }) });
    Object.defineProperty(browser.document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
    const canvas = browser.document.createElement('canvas') as unknown as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ width, height }) as DOMRect;
    Object.defineProperties(canvas, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
    const contextTrace = { configure: 0, unconfigure: 0 };
    const context = {
        configure() { contextTrace.configure += 1; },
        unconfigure() { contextTrace.unconfigure += 1; },
        getCurrentTexture: () => device.createTexture({ format: 'rgba8unorm', size: [canvas.width, canvas.height], usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    } as unknown as GPUCanvasContext;
    canvas.getContext = (() => context) as typeof canvas.getContext;
    const adapter = { features: new Set(), requestDevice: async () => device };
    const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'rgba8unorm' };
    Object.defineProperties(target, {
        window: { configurable: true, value: browser },
        document: { configurable: true, value: browser.document },
        navigator: { configurable: true, value: { gpu } },
        requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => { const id = nextRaf++; frames.set(id, callback); return id; } },
        cancelAnimationFrame: { configurable: true, value: (id: number) => { frames.delete(id); } },
        ResizeObserver: { configurable: true, value: undefined },
    });
    return {
        browser, canvas, device, trace, contextTrace, adapter, loseDevice,
        get pendingFrames() { return frames.size; },
        flushFrame() {
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback(16));
        },
        resize(nextWidth: number, nextHeight: number) {
            width = nextWidth;
            height = nextHeight;
            browser.dispatchEvent(new browser.Event('resize'));
        },
        setVisible(next: boolean) {
            visible = next;
            browser.document.dispatchEvent(new browser.Event('visibilitychange'));
        },
        restore() {
            browser.close();
            names.forEach((name, index) => {
                const descriptor = previous[index];
                if (descriptor) Object.defineProperty(target, name, descriptor);
                else delete target[name];
            });
            restoreGpu();
        },
    };
}

test('host renders continuously, captures real frames, resizes, and switches depth conventions', async () => {
    const host = installHost();
    try {
        const errors: Error[] = [];
        let ready = 0;
        const controller = await startReferenceRenderer(host.canvas, { onError: error => errors.push(error), onReady: () => { ready += 1; } });
        assert.ok(controller);
        assert.equal(host.trace.submits, 0);
        assert.deepEqual(controller.getSettings(), { instanceCount: 1_000, culling: true, depthConvention: 'reverse-z' });
        const capture = controller.captureSnapshot();
        assert.equal(controller.captureSnapshot(), capture);
        host.flushFrame();
        const snapshot = await capture;
        assert.ok(snapshot);
        assert.equal(snapshot.graph.nodes.at(-1)?.label, 'reference.present');
        assert.equal(host.trace.submits, 1);
        assert.equal(host.pendingFrames, 1);
        const submissions = host.trace.submits;
        for (let frame = 0; frame < 3; frame++) {
            host.flushFrame();
            assert.equal(host.pendingFrames, 1, 'idle rendering keeps exactly one frame scheduled');
        }
        assert.equal(host.trace.submits, submissions + 3, 'frames submit without input or capture requests');
        assert.equal(ready, 1);
        assert.equal(host.trace.renderPasses.find(pass => pass.depthStencilAttachment)?.depthStencilAttachment?.depthClearValue, 0);
        controller.setSettings({ instanceCount: 10, culling: false, depthConvention: 'forward-z' });
        host.resize(500, 200);
        const nextCapture = controller.captureSnapshot();
        host.flushFrame();
        assert.ok(await nextCapture);
        assert.equal(host.canvas.width, 500);
        assert.equal(host.canvas.height, 200);
        assert.equal(host.trace.renderPasses.findLast(pass => pass.depthStencilAttachment)?.depthStencilAttachment?.depthClearValue, 1);
        assert.equal(host.trace.submits, 5);
        assert.equal(ready, 1);
        assert.deepEqual(errors, []);
        assert.throws(() => controller.setSettings({ instanceCount: 10_001 }), /instanceCount/);
        controller.dispose();
        controller.dispose();
        assert.equal(host.contextTrace.unconfigure, 1);
        assert.equal(host.trace.deviceDestroys, 1);
        assert.equal(await controller.captureSnapshot(), undefined);
    } finally { host.restore(); }
});

test('host settles captures on suspension and runtime cancellation', async () => {
    const host = installHost();
    try {
        const abort = new AbortController();
        const controller = await startReferenceRenderer(host.canvas, { signal: abort.signal });
        assert.ok(controller);
        const suspendedCapture = controller.captureSnapshot();
        host.setVisible(false);
        assert.equal(await suspendedCapture, undefined);
        assert.equal(host.pendingFrames, 0);
        assert.equal(await controller.captureSnapshot(), undefined);
        host.setVisible(true);
        const resumedCapture = controller.captureSnapshot();
        host.flushFrame();
        assert.ok(await resumedCapture);
        const cancelledCapture = controller.captureSnapshot();
        abort.abort();
        assert.equal(await cancelledCapture, undefined);
        assert.equal(host.pendingFrames, 0);
        assert.equal(host.trace.deviceDestroys, 1);
    } finally { host.restore(); }
});

test('host reports submission failure and device loss once and releases resources', async () => {
    for (const failure of ['submission', 'device loss'] as const) {
        const host = installHost();
        try {
            const errors: Error[] = [];
            const controller = await startReferenceRenderer(host.canvas, { onError: error => errors.push(error) });
            assert.ok(controller);
            const capture = controller.captureSnapshot();
            if (failure === 'submission') {
                host.device.queue.submit = () => { throw new Error('submission failed'); };
                host.flushFrame();
            } else {
                host.loseDevice({ reason: 'unknown', message: 'device loss' } as GPUDeviceLostInfo);
                await Promise.resolve();
            }
            assert.equal(await capture, undefined);
            assert.equal(errors.length, 1);
            assert.match(errors[0].message, new RegExp(failure));
            controller.dispose();
            assert.equal(host.trace.deviceDestroys, 1);
        } finally { host.restore(); }
    }
});

test('initialization cancelled while requesting a device destroys the late device', async () => {
    const host = installHost();
    try {
        let resolveDevice: (device: GPUDevice) => void = () => undefined;
        host.adapter.requestDevice = () => new Promise<GPUDevice>(resolve => { resolveDevice = resolve; });
        const abort = new AbortController();
        const errors: Error[] = [];
        const pending = startReferenceRenderer(host.canvas, { signal: abort.signal, onError: error => errors.push(error) });
        await Promise.resolve();
        abort.abort();
        resolveDevice(host.device);
        assert.equal(await pending, undefined);
        assert.equal(host.trace.deviceDestroys, 1);
        assert.equal(host.contextTrace.configure, 0);
        assert.deepEqual(errors, []);
    } finally { host.restore(); }
});

test('canvas sizing preserves aspect while respecting DPR and device limits', () => {
    const canvas = { clientWidth: 1000, clientHeight: 500, getBoundingClientRect: () => ({ width: 1000, height: 500 }) } as HTMLCanvasElement;
    assert.deepEqual(resolveCanvasBackingSize(canvas, 3, 8192), { width: 2000, height: 1000 });
    assert.deepEqual(resolveCanvasBackingSize(canvas, 2, 1024), { width: 1024, height: 512 });
});
