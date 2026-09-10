import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { PerspectiveCamera } from 'three/webgpu';
import { resolveCanvasBackingSize, startThreeInterop } from '../src/start.ts';
import { ThreeBridge } from '../src/bridge.ts';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';

function stubBridge(device: GPUDevice, width: number, height: number, reverseZ: boolean) {
    let destroyed = 0;
    const camera = new PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(5.8, 4.1, 8.2);
    const allocate = (w: number, h: number) => ({
        color: device.createTexture({ format: 'rgba16float', size: [w, h], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
        depth: device.createTexture({ format: 'depth32float', size: [w, h], usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    });
    let attachments = allocate(width, height);
    const bridge = {
        device, reverseZ, camera,
        getAttachments: () => attachments,
        resize(w: number, h: number) {
            if (w !== attachments.color.width || h !== attachments.color.height) {
                attachments.color.destroy(); attachments.depth.destroy();
                attachments = allocate(w, h);
            }
        },
        render() { device.queue.submit([]); },
        destroy() {
            destroyed++;
            attachments.color.destroy(); attachments.depth.destroy();
        },
    } as unknown as ThreeBridge;
    return { bridge, get destroyed() { return destroyed; } };
}

test('host renders continuously, captures real frames, and preserves its device and orbit when switching', async t => {
    const host = installHost();
    const bridges: ReturnType<typeof stubBridge>[] = [];
    t.mock.method(ThreeBridge, 'create', async (...args: Parameters<typeof ThreeBridge.create>) => {
        const stub = stubBridge(...args); bridges.push(stub); return stub.bridge;
    });
    try {
        const errors: Error[] = [];
        const controller = await startThreeInterop(host.canvas, { onError: error => errors.push(error) });
        assert.ok(controller);
        assert.equal(host.trace.submits, 0);
        assert.equal(host.pendingFrames, 1);
        const first = controller.captureSnapshot();
        assert.equal(controller.captureSnapshot(), first);
        host.flushFrame();
        const snapshot = await first;
        assert.ok(snapshot);
        assert.ok(snapshot.graph.nodes.some(node => node.label === 'three-interop.three-render'));
        assert.equal(snapshot.graph.nodes.at(-1)?.label, 'three-interop.present');
        assert.equal(host.pendingFrames, 1);
        const submissions = host.trace.submits;
        for (let frame = 0; frame < 3; frame++) {
            host.flushFrame();
            assert.equal(host.pendingFrames, 1, 'idle rendering keeps exactly one frame scheduled');
        }
        assert.equal(host.trace.submits, submissions + 6, 'frames submit without input or capture requests');
        const initialPose = bridges[0].bridge.camera.position.toArray();
        for (const reverseZ of [false, true, false, true]) {
            const pending = controller.captureSnapshot();
            const change = controller.setSettings({ reverseZ });
            const duringSwitch = controller.captureSnapshot();
            assert.equal(host.pendingFrames, 0);
            assert.equal(await pending, undefined);
            assert.equal(await duringSwitch, undefined);
            await change;
            assert.deepEqual(controller.getSettings(), { reverseZ });
            assert.deepEqual(bridges.at(-1)!.bridge.camera.position.toArray(), initialPose);
            const capture = controller.captureSnapshot();
            host.flushFrame();
            assert.ok(await capture);
        }
        host.resize(500, 200);
        host.flushFrame();
        assert.equal(host.canvas.width, 500);
        assert.equal(bridges.at(-1)!.bridge.getAttachments().depth.width, 500);
        assert.equal(host.contextTrace.configure, 1);
        assert.equal(host.trace.deviceDestroys, 0);
        assert.deepEqual(errors, []);
        assert.ok(host.trace.renderPasses.filter(pass => pass.depthStencilAttachment).every(pass => pass.depthStencilAttachment!.depthLoadOp === 'load'));
        controller.dispose(); controller.dispose();
        assert.ok(bridges.every(stub => stub.destroyed === 1));
        assert.equal(host.trace.deviceDestroys, 1);
        assert.equal(host.contextTrace.unconfigure, 1);
        assert.equal(host.pendingFrames, 0);
        assert.equal(await controller.captureSnapshot(), undefined);
    } finally { host.restore(); }
});

test('late initialization and replacement resources are released after cancellation', async t => {
    for (const duringSwitch of [false, true]) {
        const host = installHost();
        let resolveBridge: (bridge: ThreeBridge) => void = () => undefined;
        const initial = stubBridge(host.device, 320, 180, true);
        const late = stubBridge(host.device, 320, 180, false);
        let calls = 0;
        const mock = t.mock.method(ThreeBridge, 'create', () => {
            if (duringSwitch && calls++ === 0) return Promise.resolve(initial.bridge);
            return new Promise<ThreeBridge>(resolve => { resolveBridge = resolve; });
        });
        try {
            const abort = new AbortController();
            const errors: Error[] = [];
            const startup = startThreeInterop(host.canvas, { signal: abort.signal, onError: error => errors.push(error) });
            let operation: Promise<unknown> = startup;
            if (duringSwitch) {
                const controller = await startup;
                assert.ok(controller);
                operation = controller.setSettings({ reverseZ: false });
                await assert.rejects(controller.setSettings({ reverseZ: false }), /already in progress/);
            } else {
                await Promise.resolve(); await Promise.resolve();
            }
            abort.abort();
            resolveBridge(late.bridge);
            await operation;
            assert.equal(late.destroyed, 1);
            if (duringSwitch) assert.equal(initial.destroyed, 1);
            assert.equal(host.trace.deviceDestroys, 1);
            assert.equal(host.pendingFrames, 0);
            assert.deepEqual(errors, []);
        } finally { mock.mock.restore(); host.restore(); }
    }
});

test('failed initialization or depth replacement reports once and cleans up', async t => {
    for (const duringSwitch of [false, true]) {
        const host = installHost();
        const initial = stubBridge(host.device, 320, 180, true);
        let calls = 0;
        const mock = t.mock.method(ThreeBridge, 'create', async () => {
            if (duringSwitch && calls++ === 0) return initial.bridge;
            throw new Error('bridge initialization failed');
        });
        try {
            const errors: Error[] = [];
            const controller = await startThreeInterop(host.canvas, { onError: error => errors.push(error) });
            if (duringSwitch) {
                assert.ok(controller);
                const capture = controller.captureSnapshot();
                await assert.rejects(controller.setSettings({ reverseZ: false }), /initialization failed/);
                assert.equal(await capture, undefined);
                assert.equal(initial.destroyed, 1);
            } else assert.equal(controller, undefined);
            assert.equal(errors.length, 1);
            assert.equal(host.trace.deviceDestroys, 1);
            assert.equal(host.pendingFrames, 0);
        } finally { mock.mock.restore(); host.restore(); }
    }
});

test('hidden pages suspend captures; cancellation and device loss release the host', async t => {
    for (const end of ['abort', 'device loss', 'submission error']) {
        const host = installHost();
        const mock = t.mock.method(ThreeBridge, 'create', async (...args: Parameters<typeof ThreeBridge.create>) => stubBridge(...args).bridge);
        try {
            const errors: Error[] = [];
            const abort = new AbortController();
            const controller = await startThreeInterop(host.canvas, { signal: abort.signal, onError: error => errors.push(error) });
            assert.ok(controller);
            const pending = controller.captureSnapshot();
            host.setVisible(false);
            assert.equal(await pending, undefined);
            assert.equal(host.pendingFrames, 0);
            host.setVisible(true);
            const finalCapture = controller.captureSnapshot();
            if (end === 'abort') abort.abort();
            else if (end === 'device loss') {
                host.loseDevice({ reason: 'unknown', message: 'device loss' } as GPUDeviceLostInfo);
                await Promise.resolve();
            } else {
                host.device.queue.submit = () => { throw new Error('submission error'); };
                host.flushFrame();
            }
            assert.equal(await finalCapture, undefined);
            assert.equal(errors.length, end === 'abort' ? 0 : 1);
            assert.equal(host.trace.deviceDestroys, 1);
            assert.equal(host.contextTrace.unconfigure, 1);
            assert.equal(host.pendingFrames, 0);
        } finally { mock.mock.restore(); host.restore(); }
    }
});

test('backing size preserves aspect and obeys DPR and texture limits', () => {
    const canvas = { clientWidth: 1000, clientHeight: 500, getBoundingClientRect: () => ({ width: 1000, height: 500 }) } as HTMLCanvasElement;
    assert.deepEqual(resolveCanvasBackingSize(canvas, 3, 8192), { width: 2000, height: 1000 });
    assert.deepEqual(resolveCanvasBackingSize(canvas, 2, 1024), { width: 1024, height: 512 });
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
