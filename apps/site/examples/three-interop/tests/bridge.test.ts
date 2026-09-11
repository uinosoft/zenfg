import assert from 'node:assert/strict';
import test, { after, type TestContext } from 'node:test';
import { Matrix4, PerspectiveCamera, RenderTarget, Vector3, WebGPUCoordinateSystem, WebGPURenderer } from 'three/webgpu';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';
import { ThreeBridge, updateCamera, validateAttachment } from '../src/bridge.ts';

after(installWebGpuGlobals());

// Keep Three's real constructors, RenderTarget, scene and math. Only replace
// methods that initialize GPU state or issue rendering commands.
function mockRenderer(t: TestContext, options: { wrongDevice?: boolean; fallback?: boolean; invalidColor?: boolean } = {}) {
    const { device, trace } = createFakeGpu();
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { createElement: () => ({ width: 1, height: 1, style: {} }) },
    });
    t.after(() => {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else Reflect.deleteProperty(globalThis, 'document');
    });
    const init = t.mock.method(WebGPURenderer.prototype, 'init', async function (this: WebGPURenderer) {
        Object.assign(this.backend, {
            device: options.wrongDevice ? createFakeGpu().device : device,
            isWebGPUBackend: !options.fallback,
        });
    });
    const allocate = t.mock.method(WebGPURenderer.prototype, 'initRenderTarget', function (this: WebGPURenderer, target: RenderTarget) {
        const backend = this.backend as unknown as { get(texture: object): { texture?: GPUTexture } };
        backend.get(target.texture).texture = device.createTexture({
            format: options.invalidColor ? 'rgba8unorm' : 'rgba16float', size: [target.width, target.height],
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        backend.get(target.depthTexture!).texture = device.createTexture({
            format: 'depth32float', size: [target.width, target.height], usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    });
    const render = t.mock.method(WebGPURenderer.prototype, 'render', () => {});
    const renderAsync = t.mock.method(WebGPURenderer.prototype, 'renderAsync', async () => {});
    const dispose = t.mock.method(WebGPURenderer.prototype, 'dispose', () => {});
    return { device, trace, init, allocate, render, renderAsync, dispose };
}

for (const reverseZ of [false, true]) {
    test(`bridge initialization and resize allocate without rendering (${reverseZ ? 'reverse' : 'forward'} Z)`, async t => {
        const mocks = mockRenderer(t);
        const bridge = await ThreeBridge.create(mocks.device, 64, 48, reverseZ);
        t.after(() => bridge.destroy());
        assert.ok(bridge.renderer instanceof WebGPURenderer);
        assert.ok(bridge.target instanceof RenderTarget);
        assert.equal(bridge.device, mocks.device);
        assert.equal(bridge.renderer.reversedDepthBuffer, reverseZ);
        assert.equal(mocks.init.mock.callCount(), 1);
        assert.equal(mocks.allocate.mock.callCount(), 1);
        const before = bridge.getAttachments();
        assert.equal(before.color.format, 'rgba16float');
        assert.equal(before.depth.format, 'depth32float');
        bridge.resize(64, 48);
        assert.equal(mocks.allocate.mock.callCount(), 1, 'unchanged dimensions reuse attachments');
        assert.equal(bridge.getAttachments().color, before.color);
        bridge.resize(96, 72);
        const resized = bridge.getAttachments();
        assert.equal(mocks.allocate.mock.callCount(), 2);
        for (const texture of [resized.color, resized.depth]) {
            assert.equal(texture.width, 96);
            assert.equal(texture.height, 72);
        }
        assert.notEqual(resized.color, before.color);
        assert.notEqual(resized.depth, before.depth);
        assert.equal(mocks.render.mock.callCount(), 0);
        assert.equal(mocks.renderAsync.mock.callCount(), 0);
        assert.equal(mocks.trace.submits, 0);
        const targetDispose = t.mock.method(bridge.target, 'dispose');
        bridge.destroy(); bridge.destroy();
        assert.equal(targetDispose.mock.callCount(), 1);
        assert.equal(mocks.dispose.mock.callCount(), 1);
        assert.equal(mocks.trace.deviceDestroys, 0);
        assert.throws(() => bridge.getAttachments(), /destroyed/);
        assert.throws(() => bridge.resize(32, 32), /destroyed/);
        assert.throws(() => bridge.render(), /destroyed/);
    });
}

test('bridge renders synchronously into its target and restores the target even on failure', async t => {
    const mocks = mockRenderer(t);
    const bridge = await ThreeBridge.create(mocks.device, 32, 32, false);
    t.after(() => bridge.destroy());
    const targets = t.mock.method(bridge.renderer, 'setRenderTarget');
    bridge.render();
    assert.deepEqual(targets.mock.calls.map(call => call.arguments[0]), [bridge.target, null]);
    assert.deepEqual(mocks.render.mock.calls[0].arguments, [bridge.content.scene, bridge.camera]);
    mocks.render.mock.mockImplementation(() => { throw new Error('render failed'); });
    assert.throws(() => bridge.render(), /render failed/);
    assert.equal(targets.mock.calls.at(-1)!.arguments[0], null);
    assert.equal(mocks.renderAsync.mock.callCount(), 0);
});

for (const options of [{ wrongDevice: true }, { fallback: true }, { invalidColor: true }]) {
    test(`bridge rejects incompatible native backend or attachment: ${Object.keys(options)[0]}`, async t => {
        const mocks = mockRenderer(t, options);
        await assert.rejects(ThreeBridge.create(mocks.device, 32, 32, false), /host WebGPU device|rgba16float/);
        assert.equal(mocks.dispose.mock.callCount(), 1);
        assert.equal(mocks.render.mock.callCount(), 0);
        assert.equal(mocks.trace.deviceDestroys, 0);
    });
}

test('native attachment validation checks every shared texture requirement and accepts extra usage', () => {
    const { device } = createFakeGpu();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const texture = device.createTexture({ format: 'rgba16float', size: [64, 48], usage: usage | GPUTextureUsage.COPY_SRC });
    assert.equal(validateAttachment(texture, 'rgba16float', 64, 48, usage), texture);
    assert.throws(() => validateAttachment(undefined, 'rgba16float', 64, 48, usage), /GPUTexture/);
    for (const mutation of [
        { format: 'rgba8unorm' }, { width: 63 }, { height: 47 },
        { depthOrArrayLayers: 2 }, { dimension: '3d' }, { sampleCount: 4 },
        { usage: GPUTextureUsage.RENDER_ATTACHMENT }, { usage: GPUTextureUsage.TEXTURE_BINDING },
    ]) {
        assert.throws(() => validateAttachment({ ...texture, ...mutation } as GPUTexture, 'rgba16float', 64, 48, usage), /GPUTexture/);
    }
    const depth = device.createTexture({ format: 'depth32float', size: [64, 48], usage: GPUTextureUsage.RENDER_ATTACHMENT });
    assert.equal(validateAttachment(depth, 'depth32float', 64, 48, GPUTextureUsage.RENDER_ATTACHMENT), depth);
    assert.throws(() => validateAttachment(texture, 'depth32float', 64, 48, GPUTextureUsage.RENDER_ATTACHMENT), /depth32float/);
});

function close(actual: number, expected: number, tolerance = 1e-6) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

for (const reverseZ of [false, true]) {
    test(`first camera update projects WebGPU near/far correctly before rendering (${reverseZ ? 'reverse' : 'forward'} Z)`, () => {
        const camera = new PerspectiveCamera(42, 1, 0.1, 100);
        camera.zoom = 1.4;
        camera.position.set(5.8, 4.1, 8.2);
        camera.lookAt(0, 1.1, 0);
        const result = updateCamera(camera, 16 / 9, reverseZ);
        assert.equal(camera.coordinateSystem, WebGPUCoordinateSystem);
        assert.equal(camera.aspect, 16 / 9);
        assert.ok(result instanceof Float32Array);
        assert.ok(result.every(Number.isFinite));
        close(new Vector3(0, 0, -camera.near).applyMatrix4(camera.projectionMatrix).z, reverseZ ? 1 : 0);
        close(new Vector3(0, 0, -camera.far).applyMatrix4(camera.projectionMatrix).z, reverseZ ? 0 : 1);
        const top = camera.near * Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
        const corner = new Vector3(top * camera.aspect, top, -camera.near).applyMatrix4(camera.projectionMatrix);
        close(corner.x, 1); close(corner.y, 1);
        const inverseProduct = camera.projectionMatrix.clone().multiply(camera.projectionMatrixInverse);
        inverseProduct.elements.forEach((value, i) => close(value, new Matrix4().elements[i]));
        const worldPoint = new Vector3(0.2, 0.4, -3).applyMatrix4(camera.matrixWorld);
        const clip = worldPoint.applyMatrix4(new Matrix4().fromArray(result));
        const expected = new Vector3(0.2, 0.4, -3).applyMatrix4(camera.projectionMatrix);
        close(clip.x, expected.x); close(clip.y, expected.y); close(clip.z, expected.z);
        const next = updateCamera(camera, 0.75, !reverseZ);
        assert.notDeepEqual(next, result);
        close(new Vector3(0, 0, -camera.near).applyMatrix4(camera.projectionMatrix).z, reverseZ ? 0 : 1);
    });
}
