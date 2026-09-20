import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../../reference-renderer/src/index.ts';
import { createViewportTexture, recordPortal } from '../../src/graph.ts';
import { PortalPixi } from '../../src/pixi.ts';
import { createCity } from '../../src/scene.ts';
import { initialCamera, viewProjection } from '../../src/view.ts';
import { startPixiInterop } from '../../src/main.ts';

const result: { ok: boolean; cases: string[]; errors: string[]; images: Record<string, string>;
    snapshots: Record<string, unknown>; adapter?: unknown; measurements: Record<string, unknown> } =
    { ok: false, cases: [], errors: [], images: {}, snapshots: {}, measurements: {} };
const globals = globalThis as typeof globalThis & { __pixiInteropGpuResult?: typeof result; __portalTest?: unknown };
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const tracked: GPUDevice[] = [];
const scopeResults: Promise<GPUError | null>[] = [];
const requestDevice = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (descriptor) {
    const device = await requestDevice.call(this, descriptor);
    device.addEventListener('uncapturederror', event => result.errors.push(event.error.message));
    device.pushErrorScope('validation');
    tracked.push(device);
    const destroy = device.destroy.bind(device);
    device.destroy = () => {
        if (tracked.includes(device)) {
            tracked.splice(tracked.indexOf(device), 1);
            scopeResults.push(device.popErrorScope());
        }
        destroy();
    };
    return device;
};

async function readPixels(device: GPUDevice, texture: GPUTexture) {
    const { width, height } = texture;
    const stride = Math.ceil(width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) rgba.set(mapped.subarray(y * stride, y * stride + width * 4), y * width * 4);
    if (texture.format.startsWith('bgra')) for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
    buffer.unmap(); buffer.destroy();
    return rgba;
}
function save(name: string, pixels: Uint8Array, width: number, height: number) {
    const image = document.createElement('canvas'); image.width = width; image.height = height;
    image.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    result.images[name] = image.toDataURL();
}
async function start() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Hardware WebGPU adapter unavailable.');
    result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description };
    const device = await adapter.requestDevice();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:900px;height:540px';
    document.body.append(canvas);
    const graph = new FrameGraph(device);
    const reference = createReferenceRenderer(device, { maxInstances: 64 });
    reference.setInstances(createCity());
    let viewport = createViewportTexture(device, 788);
    const pixi = await PortalPixi.create(canvas, { adapter, device }, viewport);
    pixi.resize(900, 540, 1);
    pixi.orbiting = false;
    function frame() {
        pixi.update(0);
        const recording = graph.beginFrame();
        recording.markPresent(recordPortal(recording, reference, pixi, viewport, pixi.context.getCurrentTexture(), viewProjection(pixi.camera)));
        const compiled = recording.compile({ report: true });
        assert(compiled.compilationReport.nodes.length === 4, 'Only native reset/cull/draw and one opaque Pixi node.');
        compiled.execute();
    }
    async function pixels() { frame(); return readPixels(device, pixi.context.getCurrentTexture()); }
    pixi.lensEnabled = false;
    const plain = await pixels();
    save('plain', plain, canvas.width, canvas.height);
    const { cx, cy, radius, lensRadius } = pixi.art.layout;
    const sampleOffset = (Math.round(cy - radius * 0.8) * canvas.width + Math.round(cx)) * 4;
    const actual = Array.from(plain.subarray(sampleOffset, sampleOffset + 3));
    const expected = [0.009, 0.021, 0.036].map(linear => Math.round(255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055)));
    result.measurements.clearColor = { actual, expected };
    assert(actual.every((channel, i) => Math.abs(channel - expected[i]) <= 2), 'Reference sRGB output must be encoded exactly once.');
    result.cases.push('sRGB attachment -> unorm ExternalSource -> canvas, with correct RGB channel order');

    pixi.lensEnabled = true;
    const bent = await pixels();
    save('portal-lens', bent, canvas.width, canvas.height);
    let inside = 0, outside = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if ((x - pixi.art.lens.x) ** 2 + (y - pixi.art.lens.y) ** 2 > (lensRadius * 0.8) ** 2) continue;
        const i = (y * canvas.width + x) * 4;
        if (Math.max(...[0, 1, 2].map(c => Math.abs(plain[i + c] - bent[i + c]))) < 8) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 < (radius - 4) ** 2) inside++;
        else if ((x - cx) ** 2 + (y - cy) ** 2 > (radius + 4) ** 2) outside++;
    }
    result.measurements.displacedPixels = { inside, outside };
    assert(inside > 100 && outside > 30, 'One built-in filter must change both the live 3D region and surrounding 2D artwork.');
    result.cases.push('built-in displacement simultaneously changes 3D and 2D pixels across the portal edge');

    const old = viewport;
    viewport = createViewportTexture(device, 1024);
    pixi.setViewport(viewport);
    old.destroy();
    pixi.camera.azimuth += 0.65;
    const rotated = await pixels();
    let changed = 0;
    for (let i = 0; i < bent.length; i += 4) if (Math.abs(bent[i] - rotated[i]) > 8) changed++;
    assert(changed > 500, 'Replacing the texture must invalidate cached views/bind groups and show current 3D content.');
    result.cases.push('replacement GPUTexture is sampled on the next frame; live city changes without stale images');

    globals.__portalTest = {
        state: () => ({ lens: { x: pixi.art.lens.x, y: pixi.art.lens.y }, camera: { ...pixi.camera },
            orbiting: pixi.orbiting, lensEnabled: pixi.lensEnabled, layout: pixi.art.layout }),
        frame,
        async finish() {
            try {
                pixi.resize(1280, 720, 1.25);
                canvas.style.width = '1280px'; canvas.style.height = '720px';
                const fractional = await pixels();
                assert(canvas.width === 1600 && canvas.height === 900, 'Fractional DPR must resize MSAA and filter targets.');
                save('wide-dpr125', fractional, canvas.width, canvas.height);
                result.cases.push('wide resize + fractional DPR preserve the MSAA/filter composition');
                pixi.resize(390, 290, 2);
                canvas.style.width = '390px'; canvas.style.height = '290px';
                const retina = await pixels();
                assert(canvas.width === 780 && canvas.height === 580, 'DPR must scale the backing canvas.');
                save('mobile-dpr2', retina, canvas.width, canvas.height);
                result.cases.push('resize + DPR 2 preserve shared texture, mask and filter');
                pixi.destroy(); pixi.destroy();
                // Both borrowed resources must survive destroying the Pixi layer.
                const probe = device.createCommandEncoder();
                const pass = probe.beginRenderPass({ colorAttachments: [{ view: viewport.createView(), loadOp: 'clear',
                    storeOp: 'store', clearValue: [1, 0, 0, 1] }] });
                pass.end(); device.queue.submit([probe.finish()]);
                await device.queue.onSubmittedWorkDone();
                result.cases.push('Pixi disposal preserves the host device and external texture');
                viewport.destroy(); reference.destroy(); graph.destroy(); device.destroy(); canvas.remove();
                await hostTests();
                result.cases.push('trusted pointer input: lens/camera arbitration, wheel, buttons and cancellation');
            } catch (error) { result.errors.push(String(error)); }
            await finish();
        },
    };
}
async function hostTests() {
    for (let attempt = 0; attempt < 2; attempt++) {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:640px;height:400px';
        document.body.append(canvas);
        const abort = new AbortController();
        const errors: string[] = [];
        let frames = 0;
        const controller = await startPixiInterop(canvas, { signal: abort.signal, onFrame: () => frames++,
            onError: error => errors.push(error.message) });
        assert(controller, 'The public host must initialize.');
        const capture = controller!.captureSnapshot();
        assert(capture === controller!.captureSnapshot(), 'Pending captures share a promise.');
        const snapshot = await capture;
        assert(snapshot?.graph.nodes.some(node => node.label === 'portal.pixi-compose'), 'Snapshot contains the real external node.');
        result.snapshots['portal-' + attempt] = snapshot;
        const count = frames;
        await tick(); await tick();
        assert(frames > count, 'The visible host continues rendering.');
        const hiddenCapture = controller!.captureSnapshot();
        window.dispatchEvent(new Event('pagehide'));
        assert(await hiddenCapture === undefined, 'Suspending settles pending captures.');
        assert(await controller!.captureSnapshot() === undefined, 'Suspended hosts do not capture.');
        window.dispatchEvent(new Event('pageshow'));
        assert(await controller!.captureSnapshot(), 'Resuming can capture a new frame.');
        const cancelled = controller!.captureSnapshot();
        abort.abort();
        assert(await cancelled === undefined, 'Aborting settles pending capture.');
        controller!.dispose(); controller!.dispose();
        const stopped = frames;
        await tick(); await tick();
        assert(frames === stopped, 'Disposed hosts stop rendering.');
        assert(errors.length === 0, errors.join('\n'));
        canvas.remove();
    }
    const alreadyAborted = new AbortController(); alreadyAborted.abort();
    assert(await startPixiInterop(document.createElement('canvas'), { signal: alreadyAborted.signal }) === undefined,
        'Pre-aborted initialization must not create a device.');
    result.cases.push('real host captures, visibility, cancellation and repeated mount/dispose');
    const originalFetch = globalThis.fetch;
    const startupAbort = new AbortController();
    let fetchStarted: () => void = () => undefined;
    const fetching = new Promise<void>(resolve => { fetchStarted = resolve; });
    const pendingCanvas = document.createElement('canvas');
    const devicesBefore = tracked.length;
    try {
        globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
            fetchStarted();
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
            });
        }) as typeof fetch;
        const startup = startPixiInterop(pendingCanvas, { signal: startupAbort.signal });
        await fetching;
        startupAbort.abort();
        assert(await startup === undefined, 'Cancellation during asset preparation must settle startup.');
        assert(tracked.length === devicesBefore, 'Cancelled startup releases its partially initialized device.');
    } finally { globalThis.fetch = originalFetch; }
    result.cases.push('cancellation during async startup releases partial renderer and device');

    const canvas = document.createElement('canvas'); document.body.append(canvas);
    let lost = false;
    const controller = await startPixiInterop(canvas, { onError: () => { lost = true; } });
    assert(controller, 'Device loss fixture initializes.');
    await controller!.captureSnapshot();
    tracked.at(-1)!.destroy();
    await tick(); await tick();
    assert(lost && await controller!.captureSnapshot() === undefined, 'Device loss reports failure and settles captures.');
    controller!.dispose(); canvas.remove();
    result.cases.push('device loss stops the host and releases owned resources');
}
async function finish() {
    for (const device of [...tracked]) device.destroy();
    for (const error of await Promise.all(scopeResults)) if (error) result.errors.push(error.message);
    GPUAdapter.prototype.requestDevice = requestDevice;
    result.ok = result.errors.length === 0;
    globals.__pixiInteropGpuResult = result;
    document.querySelector('#result')!.textContent = JSON.stringify({ ...result, images: Object.keys(result.images) }, null, 2);
}
void start().catch(async error => { result.errors.push(error.stack ?? String(error)); await finish(); });