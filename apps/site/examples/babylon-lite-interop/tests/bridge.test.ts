import { createArcRotateCamera, getViewProjectionMatrix, setCameraLimits } from '@babylonjs/lite';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';
import { consumeCameraInput, referenceViewProjection, validateAttachment } from '../src/bridge.ts';
import { createReferenceInstances } from '../src/scene.ts';
import { resolveCanvasBackingSize } from '../src/start.ts';

after(installWebGpuGlobals());

test('native attachment boundary rejects incompatible format, extent, sampling and usage', () => {
    const { device } = createFakeGpu();
    const texture = device.createTexture({ format: 'depth32float', size: [64, 48], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    assert.equal(validateAttachment(texture, 'depth32float', 64, 48), texture);
    for (const patch of [{ format: 'rgba16float' }, { width: 63 }, { height: 47 }, { depthOrArrayLayers: 2 },
        { sampleCount: 4 }, { dimension: '3d' }, { usage: GPUTextureUsage.RENDER_ATTACHMENT }]) {
        assert.throws(() => validateAttachment({ ...texture, ...patch } as GPUTexture, 'depth32float', 64, 48), /Babylon Lite 1.28 must expose/);
    }
    assert.throws(() => validateAttachment(undefined, 'depth32float', 64, 48), /Babylon Lite 1.28 must expose/);
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

test('input is consumed exactly once and limits use native setters', () => {
    const camera = createArcRotateCamera(0, 1, 10, { x: 0, y: 1, z: 0 });
    const cleanup = setCameraLimits(camera, { lowerRadiusLimit: 4, upperRadiusLimit: 28, lowerBetaLimit: 0.15, upperBetaLimit: 1.54 });
    camera.inertialAlphaOffset = 0.2; camera.inertialBetaOffset = 2; camera.inertialRadiusOffset = 20;
    consumeCameraInput(camera);
    assert.equal(camera.alpha, 0.2); assert.equal(camera.beta, 1.54); assert.equal(camera.radius, 4);
    consumeCameraInput(camera);
    assert.equal(camera.alpha, 0.2); assert.equal(camera.beta, 1.54); assert.equal(camera.radius, 4);
    cleanup();
});

test('reference projection reflects canonical Z and refreshes when FOV changes', () => {
    const camera = createArcRotateCamera(-1, 1, 10, { x: 0, y: 1, z: 0 });
    const native = getViewProjectionMatrix(camera, 1.5);
    const reference = referenceViewProjection(camera, 1.5);
    for (let i = 0; i < 16; i++) assert.equal(reference[i], i >= 8 && i < 12 ? -native[i] : native[i]);
    camera.fov += 0.2;
    assert.notDeepEqual(referenceViewProjection(camera, 1.5), reference);
});
