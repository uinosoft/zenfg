import { Window } from 'happy-dom';
import { FrameGraph } from '@zenfg/webgpu';
import { createParticles4AllHost, type StartParticles4AllOptions } from '../src/startParticles4All.ts';
import { createPresetSettings } from '../src/settings.ts';
import { fakeDevice, installWebGpuGlobals } from '../../typegpu-monocular-light-injection/tests/fakeWebGpu.ts';

export function browserEnvironment() {
    const restoreGpu = installWebGpuGlobals();
    const browser = new Window({ url: 'http://localhost/playground/' });
    const canvas = browser.document.createElement('canvas') as unknown as HTMLCanvasElement;
    browser.document.body.append(canvas as never);
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    let submits = 0;
    let destroyed = 0;
    let unconfigured = 0;
    let rejectSubmission = false;
    const device = fakeDevice();
    Object.assign(device.limits, { maxStorageBuffersPerShaderStage: 8, maxComputeInvocationsPerWorkgroup: 256, maxComputeWorkgroupSizeX: 256 });
    const events = new EventTarget();
    Object.assign(device, {
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        lost: new Promise(() => {}), destroy() { destroyed++; },
        createCommandEncoder() {
            const pass = { end() {}, setViewport() {}, setScissorRect() {} };
            return { beginRenderPass: () => pass, finish: () => ({}) };
        },
    });
    device.queue.submit = () => { if (rejectSubmission) throw new Error('Submission failed'); submits++; };
    const context = {
        configure() {}, unconfigure() { unconfigured++; },
        getCurrentTexture: () => device.createTexture({ size: [canvas.width, canvas.height], format: 'bgra8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    } as GPUCanvasContext;
    canvas.getBoundingClientRect = () => ({ width: 320, height: 180, left: 0, top: 0 }) as DOMRect;
    canvas.width = 320; canvas.height = 180;
    canvas.getContext = (() => context) as typeof canvas.getContext;
    const adapter = { features: device.features, limits: device.limits, requestDevice: async () => device };
    Object.defineProperty(browser.navigator, 'gpu', { value: {
        requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm',
    } });
    Object.defineProperty(browser.document, 'visibilityState', { value: 'visible', configurable: true });
    const replacements: Record<string, unknown> = {
        window: browser, document: browser.document, navigator: browser.navigator,
        HTMLElement: browser.HTMLElement,
        requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: (id: number) => frames.delete(id),
    };
    const previous = new Map(Object.keys(replacements).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    const state = { commits: 0, discards: 0, disposed: 0, resets: 0, clearEnvironment: 0, endDrag: 0,
        failRecording: false, invalidGraph: false, deltaTimes: [] as number[], resizes: [] as number[][], resourceRevision: 0 };
    let settings = createPresetSettings('small');
    const workload: Parameters<typeof createParticles4AllHost>[4] = {
        recordFrameGraph(recording, { color, deltaTime }) {
            state.deltaTimes.push(deltaTime);
            if (state.failRecording) throw new Error('Recording failed');
            recording.render({ label: 'test-fluid-render', colorAttachments: [{ target: color,
                loadOp: state.invalidGraph ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
            return { transientResourceKey: `${settings.displayMode}/${state.resourceRevision}`,
                commit() { state.commits++; }, discard() { state.discards++; } };
        },
        dispose() { state.disposed++; }, resize(width, height) { state.resizes.push([width, height]); },
        getSettings: () => ({ ...settings, transmission: [...settings.transmission] }),
        setSettings(patch) { settings = { ...(patch.preset ? createPresetSettings(patch.preset) : settings), ...patch }; },
        getPresetSettings: createPresetSettings,
        applyPreset(preset) { settings = createPresetSettings(preset); },
        applyImportedSettings(value) { settings = value; },
        reset() { state.resets++; }, resetCamera() {}, togglePour() {}, stopPour() {},
        getStats: () => ({ preset: settings.preset, displayMode: settings.displayMode, particleCount: 0, fluidParticleCount: 0,
            rigidParticleCount: 0, boundaryParticleCount: 0, bodyCount: 0, lastSubsteps: 0, averageDensity: 0, maximumDensity: 0,
            maximumSpeed: 0, kineticEnergy: 0, meshTriangles: 0, pourRemaining: 0 }),
        loadEnvironment: async () => {}, clearEnvironment() { state.clearEnvironment++; },
        beginBodyDrag: () => false, updateBodyDrag() {}, endBodyDrag() { state.endDrag++; }, applyPointerImpulse() {}, orbit() {}, pan() {}, zoom() {},
    };
    const graph = new FrameGraph(device);
    return {
        browser, canvas, device, adapter, graph, workload, state,
        start: (options: StartParticles4AllOptions = {}) => createParticles4AllHost(canvas, device, context, graph, workload, { loadDefaultEnvironment: false, ...options }),
        get submits() { return submits; }, get destroyed() { return destroyed; }, get unconfigured() { return unconfigured; },
        get frames() { return frames.size; },
        failSubmit() { rejectSubmission = true; },
        frame(now = 1000) {
            const frame = frames.entries().next().value;
            if (!frame) throw new Error('No animation frame scheduled');
            frames.delete(frame[0]); frame[1](now);
        },
        hidden(value: boolean) {
            Object.defineProperty(browser.document, 'visibilityState', { value: value ? 'hidden' : 'visible', configurable: true });
            browser.document.dispatchEvent(new browser.Event('visibilitychange'));
        },
        restore() {
            for (const [key, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
            }
            restoreGpu(); browser.happyDOM.abort();
        },
    };
}

export function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
