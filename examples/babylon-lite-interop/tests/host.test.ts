import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { startBabylonLiteInterop } from '../src/start.ts';
import { BabylonLiteBridge } from '../src/bridge.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';

function stubBridge(device: GPUDevice, width: number, height: number) {
    let destroyed = 0;
    const identity = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const allocate = (w: number, h: number) => ({
        color: device.createTexture({ format: 'rgba16float', size: [w, h], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
        depth: device.createTexture({ format: 'depth32float', size: [w, h], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
    });
    let attachments = allocate(width, height);
    const stub = {
        device,
        attachControls() {},
        updateCamera: () => identity,
        getAttachments: () => attachments,
        resize(w: number, h: number) {
            if (w !== attachments.color.width || h !== attachments.color.height) {
                attachments.color.destroy(); attachments.depth.destroy(); attachments = allocate(w, h);
            }
        },
        render() { device.queue.submit([]); },
        destroy() {
            if (destroyed) return;
            destroyed++;
            attachments.color.destroy(); attachments.depth.destroy(); device.destroy();
        },
    };
    return { bridge: stub as unknown as BabylonLiteBridge, get destroyed() { return destroyed; } };
}

test('host captures on demand, stays idle, and destroys borrowers before the device owner', async t => {
    const host = installHost();
    const stub = stubBridge(host.device, 320, 180);
    const create = t.mock.method(BabylonLiteBridge, 'create', async () => stub.bridge);
    try {
        const errors: Error[] = [];
        const controller = await startBabylonLiteInterop(host.canvas, { onError: error => errors.push(error) });
        assert.ok(controller);
        assert.equal(host.trace.submits, 0);
        const first = controller.captureSnapshot();
        assert.equal(first, controller.captureSnapshot());
        host.flushFrame();
        const snapshot = await first;
        assert.ok(snapshot);
        assert.deepEqual(snapshot.graph.nodes.map(node => node.label), ['babylon-lite-interop.lite-render', 'babylon-lite-interop.linearize', 'Reset', 'Cull', 'Draw', 'babylon-lite-interop.present']);
        assert.equal(host.pendingFrames, 0);

        assert.equal(create.mock.callCount(), 1);
        host.resize(500, 200); host.flushFrame();
        assert.equal(stub.bridge.getAttachments().depth.width, 500);
        assert.equal(host.trace.deviceDestroys, 0);
        const destroy = t.mock.method(stub.bridge, 'destroy', () => {
            assert.ok(host.trace.destroyedBuffers.length > 0, 'Reference and graph buffers released first');
            assert.equal(host.contextTrace.unconfigure, 1);
            host.device.destroy();
        });
        controller.dispose(); controller.dispose();
        assert.equal(destroy.mock.callCount(), 1);
        assert.equal(host.trace.deviceDestroys, 1);
        assert.equal(host.pendingFrames, 0);
        assert.equal(await controller.captureSnapshot(), undefined);
        assert.deepEqual(errors, []);
    } finally { host.restore(); }
});

test('late startup after cancellation releases the bridge without reporting an error', async t => {
    const host = installHost();
    const stub = stubBridge(host.device, 320, 180);
    let finish = (_: BabylonLiteBridge) => {};
    t.mock.method(BabylonLiteBridge, 'create', () => new Promise<BabylonLiteBridge>(resolve => { finish = resolve; }));
    try {
        const abort = new AbortController();
        const errors: Error[] = [];
        const starting = startBabylonLiteInterop(host.canvas, { signal: abort.signal, onError: error => errors.push(error) });
        abort.abort(); finish(stub.bridge);
        assert.equal(await starting, undefined);
        assert.equal(stub.destroyed, 1);
        assert.equal(host.trace.deviceDestroys, 1);
        assert.equal(host.pendingFrames, 0);
        assert.deepEqual(errors, []);
    } finally { host.restore(); }
});

for (const end of ['abort', 'device loss', 'submission error'] as const) {
    test('hidden host settles captures and cleans up on ' + end, async t => {
        const host = installHost();
        const stub = stubBridge(host.device, 320, 180);
        t.mock.method(BabylonLiteBridge, 'create', async () => stub.bridge);
        try {
            const abort = new AbortController(); const errors: Error[] = [];
            const controller = await startBabylonLiteInterop(host.canvas, { signal: abort.signal, onError: error => errors.push(error) });
            assert.ok(controller);
            const pending = controller.captureSnapshot(); host.setVisible(false);
            assert.equal(await pending, undefined); assert.equal(host.pendingFrames, 0);
            assert.equal(await controller.captureSnapshot(), undefined);
            host.setVisible(true); const capture = controller.captureSnapshot();
            if (end === 'abort') abort.abort();
            else if (end === 'device loss') { host.loseDevice({ reason: 'unknown', message: 'test loss' } as GPUDeviceLostInfo); await Promise.resolve(); }
            else if (end === 'submission error') { stub.bridge.render = () => { throw new Error('render failed'); }; host.flushFrame(); }
            assert.equal(await capture, undefined);
            assert.equal(stub.destroyed, 1); assert.equal(host.trace.deviceDestroys, 1);
            assert.equal(host.pendingFrames, 0);
            assert.equal(errors.length, end === 'abort' ? 0 : 1);
            controller.dispose();
        } finally { host.restore(); }
    });
}

test('startup failure is reported once and never schedules a frame', async t => {
    const host = installHost();
    t.mock.method(BabylonLiteBridge, 'create', async () => { throw new Error('preparation failed'); });
    try {
        const errors: Error[] = [];
        assert.equal(await startBabylonLiteInterop(host.canvas, { onError: error => errors.push(error) }), undefined);
        assert.equal(errors.length, 1); assert.equal(host.pendingFrames, 0);
    } finally { host.restore(); }
});
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
