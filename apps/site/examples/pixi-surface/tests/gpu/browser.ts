import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../../reference-renderer/src/index.ts';
import { createSharedTexture, recordSurface } from '../../src/graph.ts';
import { SurfacePixi } from '../../src/pixi.ts';
import { createScreen } from '../../src/screen.ts';
import { createPresenter } from '../../src/present.ts';
import { createScene } from '../../src/scene.ts';
import { createControls } from '../../src/controls.ts';
import { initialCamera, renderSize, viewProjection } from '../../src/view.ts';
import { startPixiSurface } from '../../src/main.ts';
const result: { ok: boolean; cases: string[]; errors: string[]; images: Record<string, string>;
    snapshots: Record<string, unknown>; adapter?: unknown; measurements: Record<string, unknown> } =
    { ok: false, cases: [], errors: [], images: {}, snapshots: {}, measurements: {} };
const globals = globalThis as typeof globalThis & { __pixiSurfaceGpuResult?: typeof result; __surfaceTest?: unknown };
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
    result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
    const device = await adapter.requestDevice();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:900px;height:540px';
    document.body.append(canvas);
    canvas.width = 900; canvas.height = 540;
    const context = canvas.getContext('webgpu')!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const graph = new FrameGraph(device);
    const reference = createReferenceRenderer(device, { maxInstances: 3 });
    const shared = createSharedTexture(device);
    const pixi = await SurfacePixi.create({ adapter, device }, shared);
    const screen = createScreen(device), present = createPresenter(device, format);
    const controls = createControls(canvas, () => pixi.reset());
    let scene = createScene(0);
    function frame() {
        const matrix = viewProjection(controls.camera, canvas.width/canvas.height);
        screen.update(matrix); reference.setInstances(scene);
        const recording = graph.beginFrame();
        recording.markPresent(recordSurface(recording, reference, pixi, shared, context.getCurrentTexture(),
            [canvas.width*2,canvas.height*2], matrix, screen,present));
        const compiled = recording.compile({ report: true });
        assert(compiled.compilationReport.nodes.length === 6, 'Six explicit graph nodes.');
        compiled.execute();
    }
    async function pixels() { frame(); return readPixels(device, context.getCurrentTexture()); }
    const first = await pixels(); save('tinted-screen',first,900,540);
    pixi.update(0.5);
    const next = await pixels();
    let changed = 0;
    for(let i=0;i<first.length;i+=4) if(Math.abs(first[i]-next[i])>8) changed++;
    assert(changed>500,'Pixi writes current animation pixels, not a stale texture.');
    result.cases.push('consecutive Pixi external submissions update the sampled screen');
    controls.camera.azimuth=0; controls.camera.polar=Math.PI/2;
    pixi.sprites.forEach(s => s.visible=false);
    const background = await pixels();
    const center = (270*900+450)*4;
    const expected=[12,20,30], actual=Array.from(background.slice(center,center+3));
    result.measurements.screenColor={actual,expected};
    assert(actual.every((c,i)=>Math.abs(c-expected[i])<=2),'sRGB decode and final encoding preserve Pixi RGB.');
    result.cases.push('Pixi unorm -> sRGB sampling -> linear scene -> one final encode');
    const sphere = createScene(0)[2];
    const transform = Array.from(sphere.transform);
    transform[12]=0; transform[13]=0; transform[14]=2;
    scene=[{...sphere,transform}];
    const front = await pixels(); save('sphere-front',front,900,540);
    assert(Math.abs(front[center]-background[center])>30,'Front sphere remains in front of the screen.');
    transform[14]=-2; scene=[{...sphere,transform}];
    const behind=await pixels(); save('sphere-behind',behind,900,540);
    assert(expected.every((c,i)=>Math.abs(behind[center+i]-c)<=2),'Screen occludes the sphere behind it.');
    result.cases.push('shared reverse-Z depth: sphere in front and behind the screen');
    scene=createScene(0); Object.assign(controls.camera,initialCamera);
    pixi.sprites.forEach(s=>s.visible=true); pixi.reset();
    globals.__surfaceTest={
        state:()=>({camera:{...controls.camera},paused:controls.state.paused,time:controls.state.time}),
        frame,
        async finish() {
            try {
                for(const dpr of [1,1.25,2]) {
                    const size=renderSize(390,290,dpr,device.limits.maxTextureDimension2D);
                    canvas.width=size.width;canvas.height=size.height;
                    canvas.style.width='390px';canvas.style.height='290px';
                    const image=await pixels(); save('narrow-dpr'+dpr,image,canvas.width,canvas.height);
                    assert(shared.width===2048 && shared.height===1024,'Resize preserves persistent texture.');
                }
                result.cases.push('DPR 1 / 1.25 / 2 and narrow framing with a fixed shared texture');
                controls.destroy(); pixi.destroy(); pixi.destroy();
                const encoder=device.createCommandEncoder();
                const pass=encoder.beginRenderPass({colorAttachments:[{view:shared.createView(),loadOp:'clear',storeOp:'store'}]});
                pass.end();device.queue.submit([encoder.finish()]);
                await device.queue.onSubmittedWorkDone();
                result.cases.push('Pixi disposal preserves the borrowed device and texture');
                screen.destroy();reference.destroy();shared.destroy();graph.destroy();context.unconfigure();device.destroy();canvas.remove();
                await hostTests();
            } catch(error) {result.errors.push(String(error));}
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
        const controller = await startPixiSurface(canvas, { signal: abort.signal, onFrame: () => frames++,
            onError: error => errors.push(error.message) });
        assert(controller, 'The public host must initialize.');
        const capture = controller!.captureSnapshot();
        assert(capture === controller!.captureSnapshot(), 'Pending captures share a promise.');
        const snapshot = await capture;
        assert(snapshot?.graph.nodes.some(node => node.label === 'surface.pixi-animation'), 'Snapshot contains the real external node.');
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
    assert(await startPixiSurface(document.createElement('canvas'), { signal: alreadyAborted.signal }) === undefined,
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
        const startup = startPixiSurface(pendingCanvas, { signal: startupAbort.signal });
        await fetching;
        startupAbort.abort();
        assert(await startup === undefined, 'Cancellation during asset preparation must settle startup.');
        assert(tracked.length === devicesBefore, 'Cancelled startup releases its partially initialized device.');
    } finally { globalThis.fetch = originalFetch; }
    result.cases.push('cancellation during async startup releases partial renderer and device');

    const canvas = document.createElement('canvas'); document.body.append(canvas);
    let lost = false;
    const controller = await startPixiSurface(canvas, { onError: () => { lost = true; } });
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
    globals.__pixiSurfaceGpuResult = result;
    document.querySelector('#result')!.textContent = JSON.stringify({ ...result, images: Object.keys(result.images) }, null, 2);
}
void start().catch(async error => { result.errors.push(error.stack ?? String(error)); await finish(); });