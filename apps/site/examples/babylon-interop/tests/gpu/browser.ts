import { FrameGraph } from '@zenfg/webgpu';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { createReferenceRenderer, type ReferenceInstance } from '../../../reference-renderer/src/index.ts';
import { Color3, Matrix, MeshBuilder, PBRMaterial, Quaternion, Scene, Vector3 } from '@babylonjs/core';
import { BabylonBridge } from '../../src/bridge.ts';
import { recordCoRendering } from '../../src/graph.ts';
import { createPresenter } from '../../src/present.ts';
import { createAttachmentResolver } from '../../src/resolve.ts';
import { createReferenceInstances } from '../../src/scene.ts';
import { startBabylonInterop, type BabylonInteropController } from '../../src/start.ts';

type Pixels = { width: number; height: number; data: Uint8Array };
type Result = { name: string; ok: boolean; error?: string; validationErrors: string[] };
const results: Result[] = [];
const uncapturedErrors: string[] = [];
const images: Record<string, string> = {};
const snapshots: Record<string, FrameGraphSnapshot> = {};
const comparisons: Record<string, { maxDifference: number; changedChannels: number; changedPixels: number;
    edgePixels: { x: number; y: number; left: number[]; right: number[]; neighborhoodMatch: boolean }[] }> = {};
const pointerMeasurements: { cssHeight: number; steps: number; radians: number; expected: number }[] = [];
const renderCounts = new Map<Scene, number>();
const createdBridges: BabylonBridge[] = [];
const destroyedBridges = new Set<BabylonBridge>();
const observedDevices: GPUDevice[] = [];
let externalDepth = 0;
let externalSubmissions = 0;
let outsideGraphRenders = 0;
let captureCanvas: HTMLCanvasElement | undefined;
let hostPixels: Pixels | undefined;

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
const count = (bridge: BabylonBridge) => renderCounts.get(bridge.scene) ?? 0;

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
        const compile = frame.compile.bind(frame);
        frame.compile = (...options) => {
            const compiled = compile(...options);
            const execute = compiled.execute.bind(compiled);
            compiled.execute = (...executionOptions) => {
                const result = execute(...executionOptions);
                // Read the real host canvas synchronously before WebGPU expires its frame texture.
                if (captureCanvas) hostPixels = readCanvas(captureCanvas);
                return result;
            };
            return compiled;
        };
        return frame;
    };
    const render = Scene.prototype.render;
    Scene.prototype.render = function (...args) {
        renderCounts.set(this, (renderCounts.get(this) ?? 0) + 1);
        if (externalDepth === 0) outsideGraphRenders++;
        return render.apply(this, args);
    };
    const create = BabylonBridge.create;
    BabylonBridge.create = async function (...args) {
        const bridge = await create.apply(this, args);
        createdBridges.push(bridge);
        assert(count(bridge) === 0, 'Bridge initialization must not render');
        return bridge;
    };
    const resize = BabylonBridge.prototype.resize;
    BabylonBridge.prototype.resize = function (...args) {
        const before = count(this);
        resize.apply(this, args);
        equal(count(this), before, 'Bridge resize must not render');
    };
    const destroy = BabylonBridge.prototype.destroy;
    BabylonBridge.prototype.destroy = function () {
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
        Scene.prototype.render = render;
        BabylonBridge.create = create;
        BabylonBridge.prototype.resize = resize;
        BabylonBridge.prototype.destroy = destroy;
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

async function readFrame(bridge: BabylonBridge, graph: FrameGraph, reference?: ReturnType<typeof createReferenceRenderer>): Promise<Pixels> {
    const { width, height } = bridge.getAttachments().color;
    const device = bridge.device;
    const ownedReference = reference ? undefined : createReferenceRenderer(device, { maxInstances: 32 });
    if (ownedReference) ownedReference.setInstances(createReferenceInstances());
    const activeReference = reference ?? ownedReference!;
    const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
        const frame = graph.beginFrame();
        const before = count(bridge);
        const color = recordCoRendering(frame, bridge, activeReference, bridge.updateCamera(), createAttachmentResolver(device)).color;
        const output = frame.importTexture(texture);
        createPresenter(device, 'rgba8unorm')(frame, color, output);
        const destination = frame.importBuffer(buffer);
        frame.copy({ label: 'test.read-pixels', operations: [{ type: 'texture-to-buffer', source: output,
            destination, destinationLayout: { bytesPerRow }, copySize: [width, height] }] });
        frame.markReadback(destination);
        const compiled = frame.compile({ report: true });
        equal(count(bridge), before, 'Recording and compiling must not render');
        compiled.execute();
        equal(count(bridge), before + 1, 'Exactly one Babylon render per co-rendered graph execution');
        await within(buffer.mapAsync(GPUMapMode.READ), 'Pixel readback');
        const mapped = new Uint8Array(buffer.getMappedRange());
        const data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) data.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
        return { width, height, data };
    } finally { buffer.destroy(); texture.destroy(); ownedReference?.destroy(); }
}

async function fixture(bridge: BabylonBridge, swapped: boolean) {
    for (const mesh of [...bridge.scene.meshes]) mesh.dispose();
    bridge.camera.setTarget(Vector3.Zero());
    bridge.camera.setPosition(new Vector3(0, 0, 5));
    const material = new PBRMaterial('fixture.green', bridge.scene);
    material.unlit = true;
    material.albedoColor = new Color3(0.025, 0.8, 0.04);
    const instances: ReferenceInstance[] = [];
    for (const x of [-0.8, 0.8]) {
        const y = x < 0 ? 0.4 : -0.4;
        const mesh = MeshBuilder.CreateBox('fixture.box', { width: 0.9, height: 0.65, depth: 0.3 }, bridge.scene);
        mesh.position.set(x, y, (x < 0 !== swapped) ? 0.6 : -0.6);
        mesh.material = material;
        instances.push({ shape: 'cube', transform: Matrix.Compose(new Vector3(0.9, 0.65, 0.3), Quaternion.Identity(), new Vector3(x, y, 0)).asArray(), color: [0.9, 0.025, 0.015] });
    }
    // A one-sided upper marker detects vertical flips even if two occlusion samples happen to agree.
    const marker = MeshBuilder.CreateBox('fixture.marker', { size: 0.3 }, bridge.scene);
    marker.position.set(0, 1.0, 0);
    marker.material = material;
    await bridge.prepare();
    return { instances };
}
function assertOcclusion(pixels: Pixels, bridge: BabylonBridge, swapped: boolean): void {
    const matrix = bridge.camera.getViewMatrix().multiply(bridge.camera.getProjectionMatrix());
    const sample = (x: number, y: number, green: boolean) => {
        const ndc = Vector3.TransformCoordinates(new Vector3(x, y, 0), matrix);
        const px = Math.floor((ndc.x + 1) * 0.5 * pixels.width);
        const py = Math.floor((1 - ndc.y) * 0.5 * pixels.height);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const at = ((py + dy) * pixels.width + px + dx) * 4;
            const [r, g, b, a] = pixels.data.subarray(at, at + 4);
            assert(a === 255 && (green ? g > 180 && g > r * 2 && g > b * 2 : r > 100 && r > g * 2 && r > b * 2),
                'Occlusion/orientation at ' + [px + dx, py + dy] + ': ' + [r, g, b, a]);
            if (green) {
                const srgb = (v: number) => Math.round(255 * (1.055 * Math.pow(v, 1 / 2.4) - 0.055));
                assert([r, g, b].every((v, i) => Math.abs(v - srgb([0.025, 0.8, 0.04][i])) <= 1), 'Exactly one sRGB encoding of linear Babylon color');
            }
        }
    };
    for (const x of [-0.8, 0.8]) sample(x, x < 0 ? 0.4 : -0.4, x < 0 !== swapped);
    sample(0, 1.0, true);
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
        await within(destination.mapAsync(GPUMapMode.READ), 'Borrowed device after graph.destroy');
        equal(new Uint32Array(destination.getMappedRange())[0], 0x1234abcd, 'Borrowed device still executes work');
    } finally { source.destroy(); destination.destroy(); }
}

async function renderingCase(scene: 'occlusion' | 'swapped' | 'demo'): Promise<void> {
    const byConvention: Pixels[][] = [];
    for (const reverseZ of [false, true]) {
        const bridge = await BabylonBridge.create(128, 96, reverseZ);
        const device = bridge.device;
        const graph = new FrameGraph(device);
        const reference = createReferenceRenderer(device, { maxInstances: 32 });
        try {
            const owned = scene === 'demo' ? undefined : await fixture(bridge, scene === 'swapped');
            reference.setInstances(owned?.instances ?? createReferenceInstances());
            const frames: Pixels[] = [];
            for (const [width, height] of [[128, 96], [192, 112], [96, 144]]) {
                const old = bridge.getAttachments();
                bridge.resize(width, height);
                const attachments = bridge.getAttachments();
                equal([attachments.color.width, attachments.color.height, attachments.depth.width, attachments.depth.height], [width, height, width, height], 'Attachment dimensions');
                if (width !== old.color.width || height !== old.color.height) assert(old.color !== attachments.color && old.depth !== attachments.depth, 'Resize replaces attachments');
                const image = await readFrame(bridge, graph, reference);
                const name = scene + '-' + (reverseZ ? 'reverse' : 'forward') + '-' + width + 'x' + height;
                saveImage(name, image);
                if (owned) assertOcclusion(image, bridge, scene === 'swapped');
                frames.push(image);
                equivalent(image, await readFrame(bridge, graph, reference), name + '-first-vs-repeat');
            }
            byConvention.push(frames);
            reference.destroy(); graph.destroy();
            await borrowedDeviceSurvives(device);
        } finally { reference.destroy(); graph.destroy(); bridge.destroy(); bridge.destroy(); }
        equal((await within(device.lost, 'Owned device disposal')).reason, 'destroyed', 'Bridge owns and destroys device');
    }
    for (let i = 0; i < byConvention[0].length; i++) equivalent(byConvention[0][i], byConvention[1][i], scene + '-forward-vs-reverse-' + i, scene === 'demo');
}

function readCanvas(canvas: HTMLCanvasElement): Pixels {
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    const data = new Uint8Array(context.getImageData(0, 0, copy.width, copy.height).data);
    assert(data.some((value, index) => index % 4 !== 3 && value > 80), 'Actual host canvas contains the rendered scene');
    return { width: copy.width, height: copy.height, data };
}

function newCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:320px;height:200px;display:block;touch-action:pan-y';
    document.body.append(canvas);
    return canvas;
}
function latestBridge(): BabylonBridge {
    const bridge = createdBridges.at(-1);
    assert(bridge, 'Host bridge was observed');
    return bridge;
}
function cameraPose(bridge: BabylonBridge): number[] {
    return [bridge.camera.alpha, bridge.camera.beta, bridge.camera.radius, ...bridge.camera.target.asArray()];
}
function snapshotChecks(snapshot: FrameGraphSnapshot | undefined, name: string): asserts snapshot is FrameGraphSnapshot {
    assert(snapshot, name + ': snapshot is available');
    snapshots[name] = snapshot;
    const nodes = snapshot.graph.nodes;
    equal(nodes.map(node => node.label), ['babylon-interop.babylon-render', 'babylon-interop.resolve', 'Reset', 'Cull', 'Draw', 'babylon-interop.present'], 'Actual co-rendering graph');
    assert(nodes[0].kind === 'external-submission', 'Babylon is an external submission');
    for (const label of ['babylon-interop.native-color', 'babylon-interop.native-depth']) {
        const resources = snapshot.graph.resources.filter(resource => resource.label === label);
        assert(resources.length === 1 && resources[0].origin === 'imported', label + ' imported exactly once');
        const accesses = snapshot.graph.accesses.filter(access => access.resourceId === resources[0].id);
        assert(accesses.some(a => a.nodeId === nodes[0].id) && accesses.some(a => a.nodeId === nodes[1].id), label + ' consumed by resolve');
    }
}

async function hostCase(): Promise<void> {
    const canvas = newCanvas();
    captureCanvas = canvas;
    const errors: string[] = [];
    let readyResolve = () => {};
    const ready = new Promise<void>(resolve => { readyResolve = resolve; });
    const controller = await startBabylonInterop(canvas, { onReady: readyResolve, onError: error => errors.push(error.message) });
    assert(controller, `Host startup: ${errors.join('; ')}`);
    try {
        await within(ready, 'Host first frame');
        equal(controller.getSettings(), { reverseZ: true }, 'Default reverse depth');
        snapshotChecks(await within(controller.captureSnapshot(), 'Initial host snapshot'), 'host-initial');
        const idleCount = count(latestBridge());
        await tick(); await tick();
        assert(count(latestBridge()) > idleCount, 'Idle host continues rendering');
        // Exercise the actual Babylon camera input pipeline.
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
        {
            const initial = hostPixels!;
            saveImage('host-before-switches', initial);
            for (const [index, reverseZ] of [false, true, false, true].entries()) {
                const previous = latestBridge();
                const pending = controller.captureSnapshot();
                await within(controller.setSettings({ reverseZ }), 'Depth switch');
                assert(await within(pending, 'Switch settles pending capture') === undefined, 'Pending capture settles on switch');
                const replacement = latestBridge();
                assert(previous === replacement && !destroyedBridges.has(previous), 'Switch preserves the engine and bridge');
                assert(replacement.device === device, 'Switch preserves host device');
                equal(controller.getSettings(), { reverseZ }, 'Depth setting applied');
                assert(cameraPose(replacement).every((value, i) => Math.abs(value - pose[i]) < 1e-12), 'Orbit angles, radius and target preserved');
                equal([canvas.width, canvas.height], size, 'Viewport preserved on depth switch');
                const first = controller.captureSnapshot();
                assert(first === controller.captureSnapshot(), 'Concurrent snapshot requests coalesce');
                snapshotChecks(await within(first, 'Switched snapshot'), `host-switch-${index}`);
                const image = hostPixels!;
                saveImage(`host-switch-${index}`, image);
                equivalent(initial, image, `host-switch-${index}`);
            }
        }
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
    } finally { captureCanvas = undefined; controller.dispose(); canvas.remove(); }
}

async function lifecycleCase(mode: 'pre-abort' | 'startup-abort' | 'initialized-abort' | 'active-abort' | 'switch-dispose' | 'loss'): Promise<void> {
    const canvas = newCanvas();
    const abort = new AbortController();
    const errors: string[] = [];
    let controller: BabylonInteropController | undefined;
    const deviceCount = observedDevices.length;
    const create = BabylonBridge.create;
    try {
        if (mode === 'initialized-abort') BabylonBridge.create = async function (...args) {
            const bridge = await create.apply(this, args);
            abort.abort();
            return bridge;
        };
        if (mode === 'pre-abort') abort.abort();
        const starting = startBabylonInterop(canvas, { signal: abort.signal, onError: error => errors.push(error.message) });
        if (mode === 'startup-abort') abort.abort();
        controller = await within(starting, 'Lifecycle startup');
        BabylonBridge.create = create;
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
            if (mode === 'pre-abort') equal(observedDevices.length, deviceCount, 'Pre-abort allocates no device');
            for (const device of observedDevices.slice(deviceCount)) equal((await within(device.lost, 'Cancelled initialization cleanup')).reason, 'destroyed', 'Cancelled device disposed');
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
            assert(destroyedBridges.has(latestBridge()), 'Bridge is disposed after the settings call');
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
    } finally { BabylonBridge.create = create; controller?.dispose(); canvas.remove(); }
}

async function pointerCase(): Promise<void> {
    const canvas = newCanvas();
    canvas.style.outline = '2px solid blue';
    canvas.setAttribute('tabindex', '3');
    const errors: string[] = [];
    const controller = await startBabylonInterop(canvas, { onError: error => errors.push(error.message) });
    assert(controller, 'Pointer test host starts');
    try {
        await within(controller.captureSnapshot(), 'Pointer host readiness');
        const bridge = latestBridge();
        equal(canvas.tabIndex, 3, 'An existing canvas tab order is preserved');
        let pointerId = 1;
        for (const height of [200, 400]) {
            canvas.style.height = `${height}px`;
            window.dispatchEvent(new Event('resize'));
            await within(controller.captureSnapshot(), 'Pointer resize');
            for (const steps of [1, 20]) {
                const startAlpha = bridge.camera.alpha;
                const startBeta = bridge.camera.beta;
                const bounds = canvas.getBoundingClientRect();
                const event = (type: string, offset: number, buttons: number) => canvas.dispatchEvent(new PointerEvent(type, {
                    pointerId, pointerType: 'mouse', button: type === 'pointermove' ? -1 : 0, buttons,
                    clientX: bounds.left + 40 + offset, clientY: bounds.top + 40,
                    bubbles: true, cancelable: true,
                }));
                event('pointerdown', 0, 1);
                equal(canvas.style.outline, 'none', 'Pointer focus suppresses the canvas outline');
                for (let step = 1; step <= steps; step++) {
                    event('pointermove', 20 * step / steps, 1);
                    await tick();
                    const expected = 20 * step / steps * 2 * Math.PI / height;
                    assert(Math.abs(Math.abs(bridge.camera.alpha - startAlpha) - expected) < 1e-10,
                        `Pointer delta at height=${height}, steps=${steps}, step=${step}: actual=${bridge.camera.alpha - startAlpha}, expected magnitude=${expected}`);
                }
                event('pointerup', 20, 0);
                await tick();
                pointerMeasurements.push({ cssHeight: height, steps, radians: Math.abs(bridge.camera.alpha - startAlpha), expected: 20 * 2 * Math.PI / height });
                equal(bridge.camera.beta, startBeta, 'Horizontal drag does not change elevation');
                const stopped = cameraPose(bridge), stoppedCount = count(bridge);
                await tick(); await tick();
                equal(cameraPose(bridge), stopped, 'No inertial drift after pointer release');
                assert(count(bridge) > stoppedCount, 'Rendering continues after pointer release');
                canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
                equal(canvas.style.outline, 'blue solid 2px', 'Keyboard input restores the original focus style');
                pointerId++;
            }
        }
        // Multiple events arriving before one frame must also accumulate, including the vertical axis.
        const startBeta = bridge.camera.beta;
        const bounds = canvas.getBoundingClientRect();
        for (const [type, y, buttons] of [['pointerdown', 40, 1], ['pointermove', 42, 1], ['pointermove', 45, 1], ['pointerup', 45, 0]] as const) {
            canvas.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'mouse', button: type === 'pointermove' ? -1 : 0, buttons,
                clientX: bounds.left + 40, clientY: bounds.top + y, bubbles: true, cancelable: true }));
        }
        await tick();
        assert(Math.abs(Math.abs(bridge.camera.beta - startBeta) - 5 * 2 * Math.PI / 400) < 1e-10, 'Batched vertical events accumulate once');
        equal(errors, [], 'Pointer host has no errors');
    } finally { controller.dispose(); }
    equal(canvas.style.outline, 'blue solid 2px', 'Disposal restores original outline');
    equal(canvas.getAttribute('tabindex'), '3', 'Disposal restores original tab order');
    canvas.remove();
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
        await test('pointer: viewport-scaled sensitivity, frame response, focus modality and cleanup', pointerCase);
        for (const mode of ['pre-abort', 'startup-abort', 'initialized-abort', 'active-abort', 'switch-dispose', 'loss'] as const) {
            await test(`host lifecycle: ${mode}`, () => lifecycleCase(mode));
        }
        await test('all Babylon renders belong to graph external submissions; every bridge disposed', async () => {
            assert(externalSubmissions > 0, 'Real graph submissions were observed');
            equal(outsideGraphRenders, 0, 'No graph-external renders, including initialization and resize');
            equal([...renderCounts.values()].reduce((sum, value) => sum + value, 0), externalSubmissions, 'One Babylon render per external submission');
            assert(createdBridges.every(bridge => destroyedBridges.has(bridge)), 'All successfully created bridges were disposed');
        });
        return { ok: results.every(result => result.ok) && uncapturedErrors.length === 0,
            adapter: { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallbackAdapter: info.isFallbackAdapter },
            results, uncapturedErrors, comparisons, pointerMeasurements, devicePixelRatio, instrumentation: { externalSubmissions, outsideGraphRenders,
                bridgesCreated: createdBridges.length, bridgesDestroyed: destroyedBridges.size }, images, snapshots };
    } finally { restore(); }
}

main().then(result => {
    Object.assign(globalThis, { __babylonInteropGpuResult: result });
    document.querySelector('#result')!.textContent = JSON.stringify({ ...result, images: Object.keys(images), snapshots: Object.keys(snapshots) }, null, 2);
}).catch((error: unknown) => {
    Object.assign(globalThis, { __babylonInteropGpuResult: { ok: false, results, uncapturedErrors, images, snapshots,
        error: error instanceof Error ? error.stack : String(error) } });
});
