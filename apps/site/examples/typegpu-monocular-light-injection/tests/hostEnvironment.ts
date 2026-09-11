import { Window } from 'happy-dom';
import { fakeDevice, installWebGpuGlobals, minimalBundle } from './fakeWebGpu.ts';

export function hostEnvironment() {
    const restoreGpu = installWebGpuGlobals();
    const browser = new Window({ url: 'http://localhost/playground/' });
    const canvas = browser.document.createElement('canvas') as unknown as HTMLCanvasElement;
    const controlsHost = browser.document.createElement('aside') as unknown as HTMLElement;
    browser.document.body.append(canvas as never, controlsHost as never);
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    let submits = 0;
    let destroyed = 0;
    let closedFrames = 0;
    let unconfigured = 0;
    let failSubmit = false;
    let modelFailure = false;
    let photoFailure = false;
    const bitmaps: { closeCount: number; close(): void }[] = [];
    const requests: string[] = [];
    const device = fakeDevice();
    const events = new EventTarget();
    Object.assign(device, {
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        lost: new Promise(() => {}),
        destroy() { destroyed++; },
        createCommandEncoder() {
            const pass = { setPipeline() {}, setBindGroup() {}, executeBundles() {}, dispatchWorkgroups() {}, draw() {}, setViewport() {}, setScissorRect() {}, end() {} };
            return { beginComputePass: () => pass, beginRenderPass: () => pass, finish: () => ({}) };
        },
    });
    device.queue.submit = () => { if (failSubmit) { failSubmit = false; throw new Error('Submission failed'); } submits++; };
    canvas.getBoundingClientRect = () => ({ width: 320, height: 180, left: 0, top: 0 }) as DOMRect;
    canvas.getContext = (() => ({
        configure() {}, unconfigure() { unconfigured++; },
        getCurrentTexture: () => device.createTexture({ label: 'swapchain', size: [canvas.width, canvas.height], format: 'bgra8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    })) as typeof canvas.getContext;
    Object.defineProperty(browser.navigator, 'gpu', { value: {
        requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }),
        getPreferredCanvasFormat: () => 'bgra8unorm',
    } });
    Object.defineProperty(browser.document, 'visibilityState', { configurable: true, value: 'visible' });
    const replacements: Record<string, unknown> = {
        window: browser, document: browser.document, navigator: browser.navigator, screen: browser.screen,
        requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
        cancelAnimationFrame: (key: number) => frames.delete(key),
        VideoFrame: class { close() { closedFrames++; } },
        createImageBitmap: async () => {
            const bitmap = { closeCount: 0, close() { this.closeCount++; } }; bitmaps.push(bitmap); return bitmap;
        },
        caches: { open: async () => ({ match: async () => undefined, put: async () => {} }), delete: async () => true },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        fetch: async (url: string) => {
            requests.push(url);
            if (url.endsWith('.depthart')) return new Response(modelFailure ? '' : minimalBundle(), { status: modelFailure ? 503 : 200 });
            return new Response('photo', { status: photoFailure ? 404 : 200 });
        },
    };
    // Tweakpane uses browser constructors and style measurements.
    for (const key of ['HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver']) {
        replacements[key] = (browser as unknown as Record<string, unknown>)[key];
    }
    replacements.getComputedStyle = browser.getComputedStyle.bind(browser);
    const previous = new Map(Object.keys(replacements).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return {
        canvas, controlsHost, browser, device, bitmaps, requests,
        get submits() { return submits; }, get destroyed() { return destroyed; },
        get closedFrames() { return closedFrames; }, get unconfigured() { return unconfigured; },
        failNextSubmit() { failSubmit = true; },
        failModels(value: boolean) { modelFailure = value; }, failPhoto(value: boolean) { photoFailure = value; },
        frame() {
            const entry = frames.entries().next().value;
            if (!entry) throw new Error('No animation frame scheduled');
            frames.delete(entry[0]); entry[1](performance.now());
        },
        restore() {
            for (const [key, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            restoreGpu(); browser.happyDOM.abort();
        },
    };
}

export async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('Expected asynchronous state was not reached');
}

export function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

export async function assertPending(promise: Promise<unknown>): Promise<void> {
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    if (settled) throw new Error('Capture settled before a frame was available');
}
