import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDevice, createFakeTexture, createGpuTrace, installWebGpuGlobals } from '../../typegpu-slime-mold/tests/fakeWebGpu.ts';
import { startRefractiveFlow } from '../src/main.ts';
import { startZenBackground } from '../../interactive-background/src/main.ts';
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



for (const [name, start] of [['refractive flow', startRefractiveFlow], ['interactive background', startZenBackground]] as const) {
 test(name + ' retires old sizes without disrupting steady-state reuse', async () => {
  const restoreGpu = installWebGpuGlobals();
  const trace = createGpuTrace();
  const device = createFakeDevice(trace);
  const pipeline = { getBindGroupLayout: () => ({}) };
  device.createComputePipelineAsync = async () => pipeline as GPUComputePipeline;
  device.createRenderPipelineAsync = async () => pipeline as GPURenderPipeline;
  let width = 320, height = 180;
  let queued: FrameRequestCallback | undefined;
  let resize = () => {};
  const frame = () => { const callback = queued; queued = undefined; callback?.(16); };
  const canvas = {
   width, height, dataset: {},
   getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
   addEventListener() {}, removeEventListener() {},
   getContext: () => ({ configure() {}, unconfigure() {}, getCurrentTexture: () => createFakeTexture('surface', 'bgra8unorm', width, height) }),
  } as unknown as HTMLCanvasElement;
  const restore = installGlobals({
   navigator: { gpu: { requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }), getPreferredCanvasFormat: () => 'bgra8unorm' } },
   window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} },
   document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
   ResizeObserver: class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} },
   requestAnimationFrame: (callback: FrameRequestCallback) => { queued = callback; return 1; }, cancelAnimationFrame() { queued = undefined; },
  });
  let controller: Awaited<ReturnType<typeof start>>;
  try {
   const errors: Error[] = [];
   controller = await start(canvas, { onError: error => errors.push(error) });
   assert.ok(controller);
   frame();
   const count = trace.textureCreates.length;
   assert.ok(count > 0);
   for (const [w, h] of [[480, 180], [480, 240], [320, 180], [640, 360], [320, 180]]) {
    const created = trace.textureCreates.length;
    resize(); frame(); frame();
    assert.equal(trace.textureCreates.length, created, 'same-size notifications reuse textures');
    width = w!; height = h!; resize(); frame();
    assert.equal(trace.destroyedTextures.length, created, 'all previous-size textures are destroyed');
    assert.equal(trace.textureCreates.length - trace.destroyedTextures.length, count, 'only current-size textures remain live');
    assert.equal(trace.deviceDestroys, 0);
   }
   assert.deepEqual(errors, []);
   controller.dispose(); controller.dispose();
   assert.equal(trace.destroyedTextures.length, trace.textureCreates.length);
   assert.equal(trace.deviceDestroys, 1);
  } finally { controller?.dispose(); restore(); restoreGpu(); }
 });
}
