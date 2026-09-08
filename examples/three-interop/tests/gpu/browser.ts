import { FrameGraph } from '@zenfg/webgpu';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { createReferenceRenderer, type ReferenceInstance } from '@zenfg-example/reference-renderer';
import { BoxGeometry, Color, Matrix4, Mesh, MeshBasicMaterial, Vector3, WebGPURenderer } from 'three/webgpu';
import { ThreeBridge, updateCamera } from '../../src/bridge.ts';
import { recordCoRendering } from '../../src/graph.ts';
import { createPresenter } from '../../src/present.ts';
import { createReferenceInstances } from '../../src/scene.ts';
import { startThreeInterop, type ThreeInteropController } from '../../src/start.ts';

type Pixels = { width: number; height: number; data: Uint8Array };
type Result = { name: string; ok: boolean; error?: string; validationErrors: string[] };
const results: Result[] = [];
const uncapturedErrors: string[] = [];
const images: Record<string, string> = {};
const snapshots: Record<string, FrameGraphSnapshot> = {};
const comparisons: Record<string, { maxDifference: number; changedChannels: number; changedPixels: number;
    edgePixels: { x: number; y: number; left: number[]; right: number[]; neighborhoodMatch: boolean }[] }> = {};
const renderCounts = new Map<WebGPURenderer, number>();
const createdBridges: ThreeBridge[] = [];
const destroyedBridges = new Set<ThreeBridge>();
const observedDevices: GPUDevice[] = [];
let externalDepth = 0;
let externalSubmissions = 0;
let outsideGraphRenders = 0;

function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string): void {
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer = 0;
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), 15_000);
        })]);
    } finally { clearTimeout(timer); }
}
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const count = (bridge: ThreeBridge) => renderCounts.get(bridge.renderer) ?? 0;

// Observe the real external submit callback, including frames recorded internally by the host.
// No renderer, device, texture, graph pass, or scheduling callback is faked.
function instrument(adapter: GPUAdapter): () => void {
    const beginFrame = FrameGraph.prototype.beginFrame;
    FrameGraph.prototype.beginFrame = function (...args) {
        const frame = beginFrame.apply(this, args);
        const externalSubmission = frame.externalSubmission.bind(frame);
        frame.externalSubmission = (descriptor) => externalSubmission({
            ...descriptor,
            submit(context) {
                externalDepth++;
                externalSubmissions++;
                try { return descriptor.submit(context); }
                finally { externalDepth--; }
            },
        });
        return frame;
    };
    const render = WebGPURenderer.prototype.render;
    WebGPURenderer.prototype.render = function (...args) {
        renderCounts.set(this, (renderCounts.get(this) ?? 0) + 1);
        if (externalDepth === 0) outsideGraphRenders++;
        return render.apply(this, args);
    };
    const create = ThreeBridge.create;
    ThreeBridge.create = async function (...args) {
        const bridge = await create.apply(this, args);
        createdBridges.push(bridge);
        assert(count(bridge) === 0, 'Bridge initialization must not render');
        return bridge;
    };
    const resize = ThreeBridge.prototype.resize;
    ThreeBridge.prototype.resize = function (...args) {
        const before = count(this);
        resize.apply(this, args);
        equal(count(this), before, 'Bridge resize must not render');
    };
    const destroy = ThreeBridge.prototype.destroy;
    ThreeBridge.prototype.destroy = function () {
        destroyedBridges.add(this);
        destroy.call(this);
    };
    const prototype = Object.getPrototypeOf(adapter) as GPUAdapter;
    const requestDevice = prototype.requestDevice;
    prototype.requestDevice = async function (descriptor) {
        const device = await requestDevice.call(this, descriptor);
        observedDevices.push(device);
        device.addEventListener('uncapturederror', event => uncapturedErrors.push(event.error.message));
        device.pushErrorScope('validation');
        return device;
    };
    return () => {
        FrameGraph.prototype.beginFrame = beginFrame;
        WebGPURenderer.prototype.render = render;
        ThreeBridge.create = create;
        ThreeBridge.prototype.resize = resize;
        ThreeBridge.prototype.destroy = destroy;
        prototype.requestDevice = requestDevice;
    };
}

function saveImage(name: string, pixels: Pixels): void {
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width; canvas.height = pixels.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    images[name] = canvas.toDataURL('image/png');
}
function equivalent(left: Pixels, right: Pixels, name: string, allowIntersectionEdges = false): void {
    equal([left.width, left.height], [right.width, right.height], `${name} dimensions`);
    let maxDifference = 0;
    let changedChannels = 0;
    let changedPixels = 0;
    const edgePixels: typeof comparisons[string]['edgePixels'] = [];
    for (let i = 0; i < left.data.length; i++) {
        const difference = Math.abs(left.data[i] - right.data[i]);
        maxDifference = Math.max(maxDifference, difference);
        if (difference) changedChannels++;
    }
    function nearby(image: Pixels, x: number, y: number, color: Uint8Array): boolean {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (x + dx < 0 || x + dx >= image.width || y + dy < 0 || y + dy >= image.height) continue;
            const at = ((y + dy) * image.width + x + dx) * 4;
            if (color.every((value, channel) => Math.abs(value - image.data[at + channel]) <= 4)) return true;
        }
        return false;
    }
    const diff = new Uint8Array(left.data.length);
    for (let i = 0; i < left.data.length; i += 4) {
        diff[i + 3] = 255;
        const a = left.data.subarray(i, i + 4), b = right.data.subarray(i, i + 4);
        if (a.some((value, channel) => value !== b[channel])) changedPixels++;
        if (!a.some((value, channel) => Math.abs(value - b[channel]) > 1)) continue;
        const x = i / 4 % left.width, y = Math.floor(i / 4 / left.width);
        edgePixels.push({ x, y, left: [...a], right: [...b],
            neighborhoodMatch: nearby(right, x, y, a) && nearby(left, x, y, b) });
        diff[i] = 255; diff[i + 2] = 255;
    }
    comparisons[name] = { maxDifference, changedChannels, changedPixels, edgePixels };
    if (edgePixels.length) saveImage(`${name}-diff`, { width: left.width, height: left.height, data: diff });
    // Forward and reverse floating depth can choose opposite surfaces at an intersection.
    // Only original-demo cross-convention comparisons allow <=0.01% such pixels, each
    // supported by BOTH images' immediate neighbors. Stable interiors still use <=1 byte.
    const edgeLimit = Math.floor(left.width * left.height / 10_000);
    assert(maxDifference <= 1 || (allowIntersectionEdges && edgePixels.length <= edgeLimit && edgePixels.every(pixel => pixel.neighborhoodMatch)),
        `${name}: max difference ${maxDifference}, ${edgePixels.length} edge pixels (limit ${allowIntersectionEdges ? edgeLimit : 0})`);
}

async function readFrame(bridge: ThreeBridge, graph: FrameGraph, reference?: ReturnType<typeof createReferenceRenderer>): Promise<Pixels> {
    const { width, height } = bridge.getAttachments().color;
    const device = bridge.device;
    const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
        const frame = graph.beginFrame();
        const before = count(bridge);
        const color = reference
            ? recordCoRendering(frame, bridge, reference, updateCamera(bridge.camera, width / height, bridge.reverseZ)).color
            : frame.importTexture(bridge.getAttachments().color);
        const output = frame.importTexture(texture);
        createPresenter(device, 'rgba8unorm')(frame, color, output);
        const destination = frame.importBuffer(buffer);
        frame.copy({ label: 'test.read-pixels', operations: [{ type: 'texture-to-buffer', source: output,
            destination, destinationLayout: { bytesPerRow }, copySize: [width, height] }] });
        frame.markReadback(destination);
        const compiled = frame.compile({ report: true });
        equal(count(bridge), before, 'Recording and compiling must not render');
        compiled.execute();
        equal(count(bridge), before + (reference ? 1 : 0), 'Exactly one Three render per co-rendered graph execution');
        await within(buffer.mapAsync(GPUMapMode.READ), 'Pixel readback');
        const mapped = new Uint8Array(buffer.getMappedRange());
        const data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) data.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
        return { width, height, data };
    } finally { buffer.destroy(); texture.destroy(); }
}

function fixture(bridge: ThreeBridge, swapped: boolean) {
    bridge.content.scene.clear();
    bridge.camera.position.set(0, 0, 5);
    bridge.camera.lookAt(0, 0, 0);
    const geometry = new BoxGeometry(0.9, 0.9, 0.3);
    const material = new MeshBasicMaterial({ color: new Color(0.025, 0.8, 0.04) });
    const instances: ReferenceInstance[] = [];
    for (const x of [-0.8, 0.8]) {
        const mesh = new Mesh(geometry, material);
        mesh.position.set(x, 0, (x < 0 !== swapped) ? 0.6 : -0.6);
        bridge.content.scene.add(mesh);
        instances.push({ shape: 'cube', transform: new Matrix4().makeScale(0.9, 0.9, 0.3).setPosition(x, 0, 0).elements,
            color: [0.9, 0.025, 0.015] });
    }
    return { instances, dispose() { geometry.dispose(); material.dispose(); } };
}
function assertOcclusion(pixels: Pixels, bridge: ThreeBridge, swapped: boolean): void {
    for (const x of [-0.8, 0.8]) {
        const ndc = new Vector3(x, 0, 0).project(bridge.camera);
        const px = Math.floor((ndc.x + 1) * 0.5 * pixels.width);
        const py = Math.floor((1 - ndc.y) * 0.5 * pixels.height);
        const green = x < 0 !== swapped;
        // A patch, not a single lucky sample: Three in front must survive the later reference draw;
        // Three behind must be overwritten by that draw in the other patch.
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const at = ((py + dy) * pixels.width + px + dx) * 4;
            const [r, g, b, a] = pixels.data.subarray(at, at + 4);
            assert(a === 255 && (green ? g > 180 && g > r * 2 && g > b * 2 : r > 100 && r > g * 2 && r > b * 2),
                `${green ? 'Three front' : 'Reference front'} at ${px + dx},${py + dy}: ${[r, g, b, a]}`);
        }
    }
    assert(pixels.data[0] < 60 && pixels.data[1] < 60 && pixels.data[2] < 60, 'Background survives shared color load');
}

async function borrowedDeviceSurvives(device: GPUDevice): Promise<void> {
    const source = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const destination = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
        device.queue.writeBuffer(source, 0, new Uint32Array([0x1234abcd]));
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source, 0, destination, 0, 4);
        device.queue.submit([encoder.finish()]);
        await within(destination.mapAsync(GPUMapMode.READ), 'Borrowed device after bridge.destroy');
        equal(new Uint32Array(destination.getMappedRange())[0], 0x1234abcd, 'Borrowed device still executes work');
    } finally { source.destroy(); destination.destroy(); }
}

async function renderingCase(scene: 'occlusion' | 'swapped' | 'demo'): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    assert(adapter, 'Rendering case requires a fresh hardware adapter');
    const device = await adapter.requestDevice();
    const byConvention: Pixels[][] = [];
    try {
        for (const reverseZ of [false, true]) {
            const bridge = await ThreeBridge.create(device, 128, 96, reverseZ);
            const graph = new FrameGraph(device);
            const reference = createReferenceRenderer(device, { maxInstances: 32 });
            const owned = scene === 'demo' ? undefined : fixture(bridge, scene === 'swapped');
            reference.setInstances(owned?.instances ?? createReferenceInstances());
            const frames: Pixels[] = [];
            try {
                for (const [width, height] of [[128, 96], [192, 112], [96, 144]]) {
                    const old = bridge.getAttachments();
                    bridge.resize(width, height);
                    const attachments = bridge.getAttachments();
                    equal([attachments.color.width, attachments.color.height, attachments.depth.width, attachments.depth.height],
                        [width, height, width, height], 'Shared attachment dimensions');
                    if (width !== old.color.width || height !== old.color.height) {
                        assert(old.color !== attachments.color && old.depth !== attachments.depth, 'Resize replaces both native attachments');
                    }
                    const image = await readFrame(bridge, graph, reference);
                    const name = `${scene}-${reverseZ ? 'reverse' : 'forward'}-${width}x${height}`;
                    saveImage(name, image);
                    if (owned) assertOcclusion(image, bridge, scene === 'swapped');
                    frames.push(image);
                    const repeat = await readFrame(bridge, graph, reference);
                    equivalent(image, repeat, `${name}-first-vs-repeat`);
                }
                byConvention.push(frames);
            } finally {
                owned?.dispose(); reference.destroy(); graph.destroy(); bridge.destroy(); bridge.destroy();
            }
            await borrowedDeviceSurvives(device);
        }
        for (let i = 0; i < byConvention[0].length; i++) equivalent(byConvention[0][i], byConvention[1][i], `${scene}-forward-vs-reverse-${i}`, scene === 'demo');
    } finally { device.destroy(); }
}

function newCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:320px;height:200px;display:block;touch-action:pan-y';
    document.body.append(canvas);
    return canvas;
}
function latestBridge(): ThreeBridge {
    const bridge = createdBridges.at(-1);
    assert(bridge, 'Host bridge was observed');
    return bridge;
}
function cameraPose(bridge: ThreeBridge): number[] {
    return [...bridge.camera.position.toArray(), ...bridge.camera.quaternion.toArray(), bridge.camera.zoom];
}
function snapshotChecks(snapshot: FrameGraphSnapshot | undefined, name: string): asserts snapshot is FrameGraphSnapshot {
    assert(snapshot, `${name}: snapshot is available`);
    snapshots[name] = snapshot;
    const nodes = snapshot.graph.nodes;
    equal(nodes.map(node => node.label), ['three-interop.three-render', 'Reset', 'Cull', 'Draw', 'three-interop.present'], 'Actual co-rendering graph snapshot');
    assert(nodes[0].kind === 'external-submission', 'Three pass is an external submission');
    for (const label of ['three-interop.color', 'three-interop.depth']) {
        const resources = snapshot.graph.resources.filter(resource => resource.label === label);
        assert(resources.length === 1 && resources[0].origin === 'imported', `${label} is imported exactly once`);
        const accesses = snapshot.graph.accesses.filter(access => access.resourceId === resources[0].id);
        assert(accesses.some(access => access.nodeId === nodes[0].id) && accesses.some(access => access.nodeId === nodes[3].id),
            `${label} is shared by both renderers`);
    }
}
async function hostCase(): Promise<void> {
    const canvas = newCanvas();
    const errors: string[] = [];
    let readyResolve = () => {};
    const ready = new Promise<void>(resolve => { readyResolve = resolve; });
    const controller = await startThreeInterop(canvas, { onReady: readyResolve, onError: error => errors.push(error.message) });
    assert(controller, `Host startup: ${errors.join('; ')}`);
    try {
        await within(ready, 'Host first frame');
        equal(controller.getSettings(), { reverseZ: true }, 'Default reverse depth');
        snapshotChecks(await within(controller.captureSnapshot(), 'Initial host snapshot'), 'host-initial');
        // Exercise real OrbitControls input, then verify the resulting non-default pose survives rebuilding Three.
        const poseBeforeWheel = cameraPose(latestBridge());
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -180, bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
        await tick();
        assert(JSON.stringify(cameraPose(latestBridge())) !== JSON.stringify(poseBeforeWheel), 'Orbit input changed camera pose');
        canvas.style.width = '420px'; canvas.style.height = '240px';
        window.dispatchEvent(new Event('resize'));
        snapshotChecks(await within(controller.captureSnapshot(), 'Resized host snapshot'), 'host-resized');
        const size = [canvas.width, canvas.height];
        equal(size, [420 * Math.min(2, Math.max(1, devicePixelRatio)), 240 * Math.min(2, Math.max(1, devicePixelRatio))], 'Host backing size');
        const pose = cameraPose(latestBridge());
        const device = latestBridge().device;
        const graph = new FrameGraph(device);
        try {
            const initial = await readFrame(latestBridge(), graph);
            saveImage('host-before-switches', initial);
            for (const [index, reverseZ] of [false, true, false, true].entries()) {
                const previous = latestBridge();
                const pending = controller.captureSnapshot();
                await within(controller.setSettings({ reverseZ }), 'Depth switch');
                assert(await within(pending, 'Switch settles pending capture') === undefined, 'Pending capture settles on switch');
                const replacement = latestBridge();
                assert(previous !== replacement && destroyedBridges.has(previous), 'Switch destroys the old bridge');
                assert(replacement.device === device, 'Switch preserves host device');
                equal(controller.getSettings(), { reverseZ }, 'Depth setting applied');
                assert(cameraPose(replacement).every((value, i) => Math.abs(value - pose[i]) < 1e-12), 'Orbit position, orientation and zoom preserved');
                equal([canvas.width, canvas.height], size, 'Viewport preserved on depth switch');
                const first = controller.captureSnapshot();
                assert(first === controller.captureSnapshot(), 'Concurrent snapshot requests coalesce');
                snapshotChecks(await within(first, 'Switched snapshot'), `host-switch-${index}`);
                const image = await readFrame(replacement, graph);
                saveImage(`host-switch-${index}`, image);
                equivalent(initial, image, `host-switch-${index}`);
            }
        } finally { graph.destroy(); }
        const pending = controller.captureSnapshot();
        const finalBridge = latestBridge();
        const beforeDispose = count(finalBridge);
        controller.dispose(); controller.dispose();
        assert(await within(pending, 'Disposed pending snapshot') === undefined, 'Dispose settles pending capture');
        assert(await controller.captureSnapshot() === undefined, 'Disposed snapshot is unavailable');
        await tick(); await tick();
        equal(count(finalBridge), beforeDispose, 'No renders after dispose');
        equal(canvas.style.touchAction, 'pan-y', 'Disposal restores touch-action');
        let rejected = false;
        try { await controller.setSettings({ reverseZ: false }); } catch { rejected = true; }
        assert(rejected, 'Disposed settings reject');
        equal(errors, [], 'Host callback errors');
    } finally { controller.dispose(); canvas.remove(); }
}

async function lifecycleCase(mode: 'pre-abort' | 'startup-abort' | 'initialized-abort' | 'active-abort' | 'switch-dispose' | 'loss'): Promise<void> {
    const canvas = newCanvas();
    const abort = new AbortController();
    const errors: string[] = [];
    let controller: ThreeInteropController | undefined;
    const deviceCount = observedDevices.length;
    const create = ThreeBridge.create;
    try {
        if (mode === 'initialized-abort') ThreeBridge.create = async function (...args) {
            const bridge = await create.apply(this, args);
            abort.abort();
            return bridge;
        };
        if (mode === 'pre-abort') abort.abort();
        const starting = startThreeInterop(canvas, { signal: abort.signal, onError: error => errors.push(error.message) });
        if (mode === 'startup-abort') abort.abort();
        controller = await within(starting, 'Lifecycle startup');
        ThreeBridge.create = create;
        if (mode === 'initialized-abort') {
            assert(controller === undefined, 'Abort after real GPU initialization returns no controller');
            equal(observedDevices.length, deviceCount + 1, 'Startup reached device allocation');
            const bridge = latestBridge();
            assert(destroyedBridges.has(bridge), 'Aborted startup destroys initialized bridge');
            equal(count(bridge), 0, 'Aborted startup never renders');
            equal((await within(bridge.device.lost, 'Aborted device cleanup')).reason, 'destroyed', 'Aborted startup destroys owned device');
            equal(errors, [], 'Initialized abort is not reported as failure');
            equal(canvas.style.touchAction, 'pan-y', 'Aborted startup preserves canvas');
            return;
        }
        if (mode === 'pre-abort' || mode === 'startup-abort') {
            assert(controller === undefined, 'Aborted startup returns no controller');
            equal(errors, [], 'Abort is not reported as failure');
            equal(observedDevices.length, deviceCount, 'Abort before adapter resolution allocates no device');
            return;
        }
        assert(controller, `Lifecycle host creation: ${errors.join('; ')}`);
        snapshotChecks(await within(controller.captureSnapshot(), 'Lifecycle ready'), `lifecycle-${mode}`);
        const bridge = latestBridge();
        const pending = controller.captureSnapshot();
        if (mode === 'active-abort') abort.abort();
        else if (mode === 'switch-dispose') {
            const switching = controller.setSettings({ reverseZ: false });
            controller.dispose();
            await within(switching, 'Dispose during bridge initialization');
            assert(destroyedBridges.has(latestBridge()), 'In-flight replacement is destroyed');
        } else {
            // A real GPUDevice.destroy() triggers its real lost promise; no synthetic lost event.
            bridge.device.destroy();
            await within(bridge.device.lost, 'Actual GPUDevice loss');
            await tick();
            assert(errors.length === 1 && /device was lost/.test(errors[0]), `Device loss reported once: ${errors.join('; ')}`);
        }
        assert(await within(pending, 'Lifecycle pending capture') === undefined, 'Lifecycle termination settles pending capture');
        assert(await controller.captureSnapshot() === undefined, 'Terminated host has no snapshot');
        assert(destroyedBridges.has(bridge), 'Lifecycle termination disposes bridge');
        const before = count(bridge);
        window.dispatchEvent(new Event('resize'));
        await tick(); await tick();
        equal(count(bridge), before, 'Terminated host never renders again');
        equal(canvas.style.touchAction, 'pan-y', 'Lifecycle cleanup restores canvas');
        if (mode !== 'loss') equal(errors, [], 'Lifecycle errors');
    } finally { ThreeBridge.create = create; controller?.dispose(); canvas.remove(); }
}

async function main() {
    assert(navigator.gpu, 'WebGPU is unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    assert(adapter, 'No WebGPU adapter available');
    const info = adapter.info;
    assert(!info.isFallbackAdapter && !/swiftshader|llvmpipe|software|lavapipe/i.test(`${info.vendor} ${info.architecture} ${info.description}`), 'Hardware adapter required; software fallback is not accepted');
    const restore = instrument(adapter);
    async function test(name: string, action: () => Promise<void>) {
        const start = observedDevices.length;
        const errorsBefore = uncapturedErrors.length;
        const validationErrors: string[] = [];
        let error: unknown;
        try { await action(); } catch (caught) { error = caught; }
        finally {
            for (const device of observedDevices.slice(start)) {
                try {
                    const validation = await within(device.popErrorScope(), 'Validation scope');
                    if (validation) validationErrors.push(validation.message);
                } catch (caught) { validationErrors.push(String(caught)); }
                device.destroy();
            }
        }
        const result: Result = { name, ok: !error && validationErrors.length === 0 && uncapturedErrors.length === errorsBefore,
            ...(error ? { error: error instanceof Error ? error.stack : String(error) } : {}), validationErrors };
        results.push(result);
        console.log(`${result.ok ? 'PASS' : 'FAIL'} ${name}${error ? `: ${String(error)}` : ''}`);
    }
    try {
        for (const scene of ['occlusion', 'swapped', 'demo'] as const) {
            await test(`${scene}: first forward/reverse frames, landscape/portrait resize, image equivalence, borrowed device`, () => renderingCase(scene));
        }
        await test('host: orbit, resize, four depth switches, snapshots, viewport, disposal', hostCase);
        for (const mode of ['pre-abort', 'startup-abort', 'initialized-abort', 'active-abort', 'switch-dispose', 'loss'] as const) {
            await test(`host lifecycle: ${mode}`, () => lifecycleCase(mode));
        }
        await test('all Three renders belong to graph external submissions; every bridge disposed', async () => {
            assert(externalSubmissions > 0, 'Real graph submissions were observed');
            equal(outsideGraphRenders, 0, 'No graph-external renders, including initialization and resize');
            equal([...renderCounts.values()].reduce((sum, value) => sum + value, 0), externalSubmissions, 'One Three render per external submission');
            assert(createdBridges.every(bridge => destroyedBridges.has(bridge)), 'All successfully created bridges were disposed');
        });
        return { ok: results.every(result => result.ok) && uncapturedErrors.length === 0,
            adapter: { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallbackAdapter: info.isFallbackAdapter },
            results, uncapturedErrors, comparisons, instrumentation: { externalSubmissions, outsideGraphRenders,
                bridgesCreated: createdBridges.length, bridgesDestroyed: destroyedBridges.size }, images, snapshots };
    } finally { restore(); }
}

main().then(result => {
    Object.assign(globalThis, { __threeInteropGpuResult: result });
    document.querySelector('#result')!.textContent = JSON.stringify({ ...result, images: Object.keys(images), snapshots: Object.keys(snapshots) }, null, 2);
}).catch((error: unknown) => {
    Object.assign(globalThis, { __threeInteropGpuResult: { ok: false, results, uncapturedErrors, images, snapshots,
        error: error instanceof Error ? error.stack : String(error) } });
});
