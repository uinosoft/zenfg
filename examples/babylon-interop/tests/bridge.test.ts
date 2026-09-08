import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';
import { Window } from 'happy-dom';
import { EngineStore, WebGPUEngine } from '@babylonjs/core';
import { BabylonBridge, validateAttachment } from '../src/bridge.ts';
import { createReferenceInstances } from '../src/scene.ts';
import { resolveCanvasBackingSize } from '../src/start.ts';

after(installWebGpuGlobals());

test('native attachment boundary rejects incompatible format, extent, sampling and usage', () => {
    const { device } = createFakeGpu();
    const texture = device.createTexture({ format: 'depth32float', size: [64, 48], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    assert.equal(validateAttachment(texture, 'depth32float', 64, 48), texture);
    for (const patch of [{ format: 'rgba16float' }, { width: 63 }, { height: 47 }, { depthOrArrayLayers: 2 },
        { sampleCount: 4 }, { dimension: '3d' }, { usage: GPUTextureUsage.RENDER_ATTACHMENT }]) {
        assert.throws(() => validateAttachment({ ...texture, ...patch } as GPUTexture, 'depth32float', 64, 48), /Babylon 9.4 must expose/);
    }
    assert.throws(() => validateAttachment(undefined, 'depth32float', 64, 48), /Babylon 9.4 must expose/);
});

test('reference scene contains the base and finite procedural instance transforms', () => {
    const instances = createReferenceInstances();
    assert.equal(instances.length, 5);
    assert.deepEqual(instances.map(instance => instance.shape), ['cube', 'cube', 'sphere', 'cube', 'sphere']);
    for (const instance of instances) {
        assert.equal(instance.transform.length, 16);
        assert.ok(Array.from(instance.transform).every(Number.isFinite));
    }
});

test('backing size respects device limit, DPR cap and collapsed canvas', () => {
    const canvas = (width: number, height: number) => ({ clientWidth: width, clientHeight: height,
        getBoundingClientRect: () => ({ width, height }) as DOMRect });
    assert.deepEqual(resolveCanvasBackingSize(canvas(600, 400), 3, 8192), { width: 1200, height: 800 });
    assert.deepEqual(resolveCanvasBackingSize(canvas(600, 400), 2, 600), { width: 600, height: 400 });
    assert.deepEqual(resolveCanvasBackingSize(canvas(0, 0), 1, 8192), { width: 1, height: 1 });
});

for (const allocated of [false, true]) {
    test('failed engine initialization releases constructor state and preserves the original error (device=' + allocated + ')', async t => {
        const browser = new Window();
        const names = ['window', 'document', 'navigator', 'self'] as const;
        const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
        const values = [browser, browser.document, browser.navigator, browser];
        names.forEach((name, index) => Object.defineProperty(globalThis, name, { configurable: true, value: values[index] }));
        const { device, trace } = createFakeGpu();
        const before = EngineStore.Instances.length;
        const failure = new Error('actual initialization failure');
        t.mock.method(WebGPUEngine.prototype, 'initAsync', async function (this: WebGPUEngine) {
            if (allocated) this._device = device;
            throw failure;
        });
        try {
            await assert.rejects(BabylonBridge.create(64, 48, true), error => error === failure);
            assert.equal(EngineStore.Instances.length, before);
            assert.equal(trace.deviceDestroys, allocated ? 1 : 0);
        } finally {
            browser.close();
            names.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
        }
    });
}
