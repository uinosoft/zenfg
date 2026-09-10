import { FrameGraph } from '@zenfg/webgpu';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { createReferenceRenderer, type ReferenceInstance } from '@zenfg-example/reference-renderer';
import { addToScene, createBox, createPbrMaterial, removeFromScene, setPbrUnlit, unregisterScene, type SceneContext } from '@babylonjs/lite';
import { BabylonLiteBridge } from '../../src/bridge.ts';
import { recordCoRendering } from '../../src/graph.ts';
import { createPresenter } from '../../src/present.ts';
import { createAttachmentResolver } from '../../src/resolve.ts';
import { createReferenceInstances, instanceTransform, BACKGROUND } from '../../src/scene.ts';
import { startBabylonLiteInterop, type BabylonLiteInteropController } from '../../src/start.ts';

type Pixels = { width: number; height: number; data: Uint8Array };
type Result = { name: string; ok: boolean; error?: string; validationErrors: string[] };
const results: Result[] = [];
const uncapturedErrors: string[] = [];
const images: Record<string, string> = {};
const snapshots: Record<string, FrameGraphSnapshot> = {};
const comparisons: Record<string, { maxDifference: number; changedChannels: number; changedPixels: number }> = {};
const pointerMeasurements: { cssHeight: number; steps: number; radians: number; expected: number }[] = [];
const renderCounts = new Map<SceneContext, number>();
const createdBridges: BabylonLiteBridge[] = [];
const destroyedBridges = new Set<BabylonLiteBridge>();
const observedDevices: GPUDevice[] = [];
let externalDepth = 0;
let externalSubmissions = 0;
let outsideGraphRenders = 0;
let nativeFrames = 0;
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
const count = (bridge: BabylonLiteBridge) => renderCounts.get(bridge.scene) ?? 0;

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
    const render = BabylonLiteBridge.prototype.render;
    BabylonLiteBridge.prototype.render = function (...args) {
        renderCounts.set(this.scene, (renderCounts.get(this.scene) ?? 0) + 1);
        if (externalDepth === 0) outsideGraphRenders++;
        return render.apply(this, args);
    };
    const create = BabylonLiteBridge.create;
    BabylonLiteBridge.create = async function (...args) {
        const bridge = await create.apply(this, args);
        createdBridges.push(bridge);
        assert(count(bridge) === 0, 'Bridge initialization must not render');
        return bridge;
    };
    const resize = BabylonLiteBridge.prototype.resize;
    BabylonLiteBridge.prototype.resize = function (...args) {
        const before = count(this);
        resize.apply(this, args);
        equal(count(this), before, 'Bridge resize must not render');
    };
    const destroy = BabylonLiteBridge.prototype.destroy;
    BabylonLiteBridge.prototype.destroy = function () {
        destroyedBridges.add(this);
        destroy.call(this);
    };
    const prototype = Object.getPrototypeOf(adapter) as GPUAdapter;
    const requestDevice = prototype.requestDevice;
    prototype.requestDevice = async function (descriptor) {
        const device = await requestDevice.call(this, descriptor);
        observedDevices.push(device);
        const createEncoder = device.createCommandEncoder.bind(device);
        device.createCommandEncoder = descriptor => {
            if (descriptor?.label === 'frame') { nativeFrames++; if (!externalDepth) outsideGraphRenders++; }
            return createEncoder(descriptor);
        };
        device.addEventListener('uncapturederror', event => uncapturedErrors.push(event.error.message));
        device.pushErrorScope('validation');
        return device;
    };
    return () => {
        FrameGraph.prototype.beginFrame = beginFrame;
        BabylonLiteBridge.prototype.render = render;
        BabylonLiteBridge.create = create;
        BabylonLiteBridge.prototype.resize = resize;
        BabylonLiteBridge.prototype.destroy = destroy;
        prototype.requestDevice = requestDevice;
    };
}

function saveImage(name: string, pixels: Pixels): void {
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width; canvas.height = pixels.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    images[name] = canvas.toDataURL('image/png');
}
function equivalent(left: Pixels, right: Pixels, name: string): void {
    equal([left.width, left.height], [right.width, right.height], name + ' dimensions');
    let maxDifference = 0, changedChannels = 0, changedPixels = 0;
    for (let i = 0; i < left.data.length; i += 4) {
        let changed = false;
        for (let channel = 0; channel < 4; channel++) {
            const difference = Math.abs(left.data[i + channel] - right.data[i + channel]);
            maxDifference = Math.max(maxDifference, difference);
            if (difference) { changedChannels++; changed = true; }
        }
        if (changed) changedPixels++;
    }
    comparisons[name] = { maxDifference, changedChannels, changedPixels };
    assert(maxDifference <= 1, name + ': max difference ' + maxDifference + ', changed pixels ' + changedPixels);
}

async function readFrame(bridge: BabylonLiteBridge, graph: FrameGraph, reference?: ReturnType<typeof createReferenceRenderer>): Promise<Pixels> {
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
        equal(count(bridge), before + 1, 'Exactly one Lite render per co-rendered graph execution');
        await within(buffer.mapAsync(GPUMapMode.READ), 'Pixel readback');
        const mapped = new Uint8Array(buffer.getMappedRange());
        const data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) data.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
        return { width, height, data };
    } finally { buffer.destroy(); texture.destroy(); ownedReference?.destroy(); }
}

async function fixture(bridge: BabylonLiteBridge, swapped: boolean) {
    unregisterScene(bridge.scene);
    for (const mesh of [...bridge.scene.meshes]) removeFromScene(bridge.scene, mesh);
    bridge.camera.target.x = 0; bridge.camera.target.y = 0; bridge.camera.target.z = 0;
    bridge.camera.alpha = -Math.PI / 2; bridge.camera.beta = Math.PI / 2 - 0.025; bridge.camera.radius = 5;
    const material = createPbrMaterial({ baseColorFactor: [0.025, 0.8, 0.04, 1] });
    setPbrUnlit(material);
    const instances: ReferenceInstance[] = [];
    for (const x of [-0.8, 0.8]) {
        const y = x < 0 ? 0.4 : -0.4;
        const mesh = createBox(bridge.engine, { width: 0.9, height: 0.65, depth: 0.3 });
        mesh.position.x = x; mesh.position.y = y; mesh.position.z = (x < 0 !== swapped) ? -0.6 : 0.6;
        mesh.material = material;
        addToScene(bridge.scene, mesh);
        instances.push({ shape: 'cube', transform: instanceTransform([x, y, 0], [0.9, 0.65, 0.3]), color: [0.9, 0.025, 0.015] });
    }
    const marker = createBox(bridge.engine, { size: 0.3 });
    marker.position.y = 1;
    marker.material = material;
    addToScene(bridge.scene, marker);
    await bridge.prepare();
    return { instances };
}
function assertOcclusion(pixels: Pixels, bridge: BabylonLiteBridge, swapped: boolean): void {
    const matrix = bridge.updateCamera();
    const srgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    const sample = (x: number, y: number, green: boolean) => {
        const w = matrix[3] * x + matrix[7] * y + matrix[15];
        const nx = (matrix[0] * x + matrix[4] * y + matrix[12]) / w;
        const ny = (matrix[1] * x + matrix[5] * y + matrix[13]) / w;
        const px = Math.floor((nx + 1) * 0.5 * pixels.width), py = Math.floor((1 - ny) * 0.5 * pixels.height);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const at = ((py + dy) * pixels.width + px + dx) * 4;
            const [r, g, b, a] = pixels.data.subarray(at, at + 4);
            assert(a === 255 && (green ? g > 180 && g > r * 2 && g > b * 2 : r > 100 && r > g * 2 && r > b * 2),
                'Occlusion/orientation at ' + [px + dx, py + dy] + ': ' + [r, g, b, a]);
            if (green) assert([r, g, b].every((v, i) => Math.abs(v - srgb([0.025, 0.8, 0.04][i])) <= 1),
                'Gamma decode and exactly one final sRGB encoding: ' + [r, g, b]);
        }
    };
    for (const x of [-0.8, 0.8]) sample(x, x < 0 ? 0.4 : -0.4, x < 0 !== swapped);
    sample(0, 1, true);
    assert(BACKGROUND.every((v, i) => Math.abs(pixels.data[i] - srgb(v)) <= 1), 'Background round-trips gamma decode and final sRGB');
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
    const bridge = await BabylonLiteBridge.create(128, 96);
    const device = bridge.device, graph = new FrameGraph(device), reference = createReferenceRenderer(device, { maxInstances: 32 });
    try {
        const owned = scene === 'demo' ? undefined : await fixture(bridge, scene === 'swapped');
        reference.setInstances(owned?.instances ?? createReferenceInstances());
        for (const [width, height] of [[128, 96], [192, 112], [96, 144]]) {
            const old = bridge.getAttachments();
            bridge.resize(width, height);
            const attachments = bridge.getAttachments();
            equal([attachments.color.width, attachments.color.height, attachments.depth.width, attachments.depth.height],
                [width, height, width, height], 'Attachment dimensions');
            if (width !== old.color.width || height !== old.color.height) {
                assert(old.color !== attachments.color && old.depth !== attachments.depth, 'Resize replaces attachments');
            }
            const image = await readFrame(bridge, graph, reference), name = scene + '-' + width + 'x' + height;
            saveImage(name, image);
            if (owned) assertOcclusion(image, bridge, scene === 'swapped');
            equivalent(image, await readFrame(bridge, graph, reference), name + '-first-vs-repeat');
        }
        reference.destroy(); graph.destroy();
        await borrowedDeviceSurvives(device);
    } finally { reference.destroy(); graph.destroy(); bridge.destroy(); bridge.destroy(); }
    equal((await within(device.lost, 'Owned device disposal')).reason, 'destroyed', 'Bridge owns device');
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
function latestBridge(): BabylonLiteBridge {
    const bridge = createdBridges.at(-1);
    assert(bridge, 'Host bridge was observed');
    return bridge;
}
function cameraPose(bridge: BabylonLiteBridge): number[] {
    return [bridge.camera.alpha, bridge.camera.beta, bridge.camera.radius, bridge.camera.target.x, bridge.camera.target.y, bridge.camera.target.z];
}
function snapshotChecks(snapshot: FrameGraphSnapshot | undefined, name: string): asserts snapshot is FrameGraphSnapshot {
    assert(snapshot, name + ': snapshot is available');
    snapshots[name] = snapshot;
    const nodes = snapshot.graph.nodes;
    equal(nodes.map(node => node.label), ['babylon-lite-interop.lite-render', 'babylon-lite-interop.linearize', 'Reset', 'Cull', 'Draw', 'babylon-lite-interop.present'], 'Actual co-rendering graph');
    assert(nodes[0].kind === 'external-submission', 'Lite is an external submission');
    for (const label of ['babylon-lite-interop.native-color', 'babylon-lite-interop.native-depth']) {
        const resources = snapshot.graph.resources.filter(resource => resource.label === label);
        assert(resources.length === 1 && resources[0].origin === 'imported', label + ' imported exactly once');
        const accesses = snapshot.graph.accesses.filter(access => access.resourceId === resources[0].id);
        const consumer = label.endsWith('native-depth') ? nodes.find(node => node.label === 'Draw')! : nodes[1];
        assert(accesses.some(a => a.nodeId === nodes[0].id) && accesses.some(a => a.nodeId === consumer.id), label + ' producer and consumer');
    }
}

async function hostCase(): Promise<void> {
    const canvas = newCanvas();
    captureCanvas = canvas;
    const errors: string[] = [];
    let readyResolve = () => {};
    const ready = new Promise<void>(resolve => { readyResolve = resolve; });
    const controller = await startBabylonLiteInterop(canvas, { onReady: readyResolve, onError: error => errors.push(error.message) });
    assert(controller, `Host startup: ${errors.join('; ')}`);
    try {
        await within(ready, 'Host first frame');
        snapshotChecks(await within(controller.captureSnapshot(), 'Initial host snapshot'), 'host-initial');
        const idleCount = count(latestBridge());
        await tick(); await tick();
        assert(count(latestBridge()) > idleCount, 'Idle host continues rendering');
        // Exercise the actual Lite camera input pipeline.
        const poseBeforeWheel = cameraPose(latestBridge());
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -180, bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
        await tick();
        assert(JSON.stringify(cameraPose(latestBridge())) !== JSON.stringify(poseBeforeWheel), 'Orbit input changed camera pose');
        canvas.style.width = '420px'; canvas.style.height = '240px';
        window.dispatchEvent(new Event('resize'));
        snapshotChecks(await within(controller.captureSnapshot(), 'Resized host snapshot'), 'host-resized');
        const size = [canvas.width, canvas.height];
        equal(size, [420 * Math.min(2, Math.max(1, devicePixelRatio)), 240 * Math.min(2, Math.max(1, devicePixelRatio))], 'Host backing size');
        const first = controller.captureSnapshot();
        assert(first === controller.captureSnapshot(), 'Concurrent captures coalesce');
        snapshotChecks(await within(first, 'Repeated capture'), 'host-repeated');
        saveImage('host-resized', hostPixels!);
        const pending = controller.captureSnapshot();
        const finalBridge = latestBridge();
        const beforeDispose = count(finalBridge);
        controller.dispose(); controller.dispose();
        assert(await within(pending, 'Disposed pending snapshot') === undefined, 'Dispose settles pending capture');
        assert(await controller.captureSnapshot() === undefined, 'Disposed snapshot is unavailable');
        await tick(); await tick();
        equal(count(finalBridge), beforeDispose, 'No renders after dispose');
        equal(canvas.style.touchAction, 'pan-y', 'Disposal restores touch-action');
        equal(errors, [], 'Host callback errors');
    } finally { captureCanvas = undefined; controller.dispose(); canvas.remove(); }
}

async function lifecycleCase(mode: 'pre-abort' | 'preparation-abort' | 'startup-abort' | 'initialized-abort' | 'active-abort' | 'dispose' | 'loss'): Promise<void> {
    const canvas = newCanvas();
    const abort = new AbortController();
    const errors: string[] = [];
    let controller: BabylonLiteInteropController | undefined;
    const deviceCount = observedDevices.length;
    const create = BabylonLiteBridge.create;
    const prepare = BabylonLiteBridge.prototype.prepare;
    try {
        if (mode === 'preparation-abort') BabylonLiteBridge.prototype.prepare = async function (...args) {
            const pending = prepare.apply(this, args);
            abort.abort();
            return pending;
        };
        if (mode === 'initialized-abort') BabylonLiteBridge.create = async function (...args) {
            const bridge = await create.apply(this, args);
            abort.abort();
            return bridge;
        };
        if (mode === 'pre-abort') abort.abort();
        const starting = startBabylonLiteInterop(canvas, { signal: abort.signal, onError: error => errors.push(error.message) });
        if (mode === 'startup-abort') abort.abort();
        controller = await within(starting, 'Lifecycle startup');
        BabylonLiteBridge.create = create;
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
        if (mode === 'pre-abort' || mode === 'startup-abort' || mode === 'preparation-abort') {
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
        else if (mode === 'dispose') {
            controller.dispose();
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
    } finally { BabylonLiteBridge.create = create; BabylonLiteBridge.prototype.prepare = prepare; controller?.dispose(); canvas.remove(); }
}

async function pointerCase(): Promise<void> {
    const canvas = newCanvas();
    canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {};
    canvas.style.outline = '2px solid blue';
    canvas.setAttribute('tabindex', '3');
    const errors: string[] = [];
    const controller = await startBabylonLiteInterop(canvas, { onError: error => errors.push(error.message) });
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
        // Cancellation resets native dragging, but must not discard motion queued before the next frame.
        for (const end of ['pointercancel', 'lostpointercapture']) {
            const before = bridge.camera.alpha;
            canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId, button: 0, buttons: 1, clientX: 40, clientY: 40 }));
            canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId, buttons: 1, clientX: 50, clientY: 40 }));
            canvas.dispatchEvent(new PointerEvent(end, { pointerId }));
            canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId, buttons: 1, clientX: 80, clientY: 40 }));
            await within(controller.captureSnapshot(), 'Cancelled pointer capture');
            assert(Math.abs(bridge.camera.alpha - before + 10 * 2 * Math.PI / 400) < 1e-10, end + ' preserves only pre-cancellation motion');
        }
        const beforePan = cameraPose(bridge);
        for (const [type, x, buttons] of [['pointerdown', 40, 2], ['pointermove', 80, 2], ['pointerup', 80, 0]] as const) {
            canvas.dispatchEvent(new PointerEvent(type, { pointerId, button: 2, buttons, clientX: x, clientY: 40 }));
        }
        await within(controller.captureSnapshot(), 'Right button input');
        equal(cameraPose(bridge), beforePan, 'Right button does not pan or orbit');
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
            await test(`${scene}: first/repeated frames, landscape/portrait resize, image equivalence, borrowed device`, () => renderingCase(scene));
        }
        await test('host: orbit, resize, snapshots, viewport, disposal', hostCase);
        await test('pointer: viewport-scaled sensitivity, frame response, focus modality and cleanup', pointerCase);
        for (const mode of ['pre-abort', 'preparation-abort', 'startup-abort', 'initialized-abort', 'active-abort', 'dispose', 'loss'] as const) {
            await test(`host lifecycle: ${mode}`, () => lifecycleCase(mode));
        }
        await test('all Lite renders belong to graph external submissions; every bridge disposed', async () => {
            assert(externalSubmissions > 0, 'Real graph submissions were observed');
            equal(nativeFrames, externalSubmissions, 'Actual Lite native frames match external submissions');
            equal(outsideGraphRenders, 0, 'No graph-external renders, including initialization and resize');
            equal([...renderCounts.values()].reduce((sum, value) => sum + value, 0), externalSubmissions, 'One Lite render per external submission');
            assert(createdBridges.every(bridge => destroyedBridges.has(bridge)), 'All successfully created bridges were disposed');
        });
        return { ok: results.every(result => result.ok) && uncapturedErrors.length === 0,
            adapter: { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallbackAdapter: info.isFallbackAdapter },
            results, uncapturedErrors, comparisons, pointerMeasurements, devicePixelRatio, instrumentation: { nativeFrames, externalSubmissions, outsideGraphRenders,
                bridgesCreated: createdBridges.length, bridgesDestroyed: destroyedBridges.size }, images, snapshots };
    } finally { restore(); }
}

main().then(result => {
    Object.assign(globalThis, { __babylonLiteInteropGpuResult: result });
    document.querySelector('#result')!.textContent = JSON.stringify({ ...result, images: Object.keys(images), snapshots: Object.keys(snapshots) }, null, 2);
}).catch((error: unknown) => {
    Object.assign(globalThis, { __babylonLiteInteropGpuResult: { ok: false, results, uncapturedErrors, images, snapshots,
        error: error instanceof Error ? error.stack : String(error) } });
});
