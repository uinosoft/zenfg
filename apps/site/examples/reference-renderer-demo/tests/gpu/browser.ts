import { FrameGraph, type BufferDesc, type BufferHandle, type FrameGraphRecording } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../../reference-renderer/src/index.ts';
import { startReferenceRenderer } from '../../src/index.ts';

type Renderer = ReturnType<typeof createReferenceRenderer>;
type Instance = Parameters<Renderer['setInstances']>[0][number];
type Convention = 'forward-z' | 'reverse-z';
type Result = { name: string; ok: boolean; error?: string };
const results: Result[] = [];
const uncapturedErrors: string[] = [];

function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

function transform(x = 0, y = 0, z = 0.5, sx = 0.3, sy = sx, sz = sx, rotation = 0): number[] {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    return [c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, sz, 0, x, y, z, 1];
}

function projection(convention: Convention): number[] {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, convention === 'reverse-z' ? -1 : 1, 0,
        0, 0, convention === 'reverse-z' ? 1 : 0, 1];
}

function primitive(shape: Instance['shape'], matrix = transform(), color: [number, number, number] = [0.4, 0.2, 0.1]): Instance {
    return { shape, transform: matrix, color };
}

function observeIndirect(frame: FrameGraphRecording): { recording: FrameGraphRecording; handles: BufferHandle[] } {
    const handles: BufferHandle[] = [];
    return {
        handles,
        recording: new Proxy(frame, {
            get(target, key, receiver) {
                if (key === 'createBuffer') return (descriptor: BufferDesc) => {
                    const handle = target.createBuffer(descriptor);
                    if (descriptor.label === 'reference.indirect-args') handles.push(handle);
                    return handle;
                };
                const value = Reflect.get(target, key, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }),
    };
}

type RenderOptions = {
    instances?: Instance[];
    renderer?: Renderer;
    convention?: Convention;
    culling?: boolean;
    colorFormat?: GPUTextureFormat;
    depthFormat?: GPUTextureFormat;
    logicalView?: boolean;
    readOnlyDepth?: boolean;
    initialDepth?: number;
    layers?: Instance[][];
    size?: number;
};

async function render(device: GPUDevice, options: RenderOptions = {}) {
    const size = options.size ?? 64;
    const colorFormat = options.colorFormat ?? 'rgba8unorm';
    const depthFormat = options.depthFormat ?? 'depth32float';
    const convention = options.convention ?? 'forward-z';
    const reverse = convention === 'reverse-z';
    const runtime = new FrameGraph(device);
    const renderer = options.renderer ?? createReferenceRenderer(device, { maxInstances: 10_000 });
    const extraRenderers: Renderer[] = [];
    const colorTexture = device.createTexture({
        label: 'test.shared-color',
        size: options.logicalView ? [size * 2, size * 2, 2] : [size, size],
        mipLevelCount: options.logicalView ? 2 : 1,
        format: options.logicalView ? 'rgba8unorm' : colorFormat,
        viewFormats: options.logicalView ? ['rgba8unorm-srgb'] : [],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const depthTexture = device.createTexture({
        label: 'test.shared-depth',
        size: options.logicalView ? [size * 2, size * 2, 2] : [size, size],
        mipLevelCount: options.logicalView ? 2 : 1,
        format: depthFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | (depthFormat === 'depth32float' ? GPUTextureUsage.COPY_SRC : 0),
    });
    const bytesPerPixel = colorFormat === 'rgba16float' ? 8 : 4;
    const bytesPerRow = Math.ceil(size * bytesPerPixel / 256) * 256;
    const pixels = device.createBuffer({ size: bytesPerRow * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const depthReadback = options.readOnlyDepth ? device.createBuffer({ size: 256 * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : undefined;
    const counterBuffers: GPUBuffer[] = [];
    try {
        renderer.setInstances(options.instances ?? [primitive('cube')]);
        const frame = runtime.beginFrame();
        const colorHandle = frame.importTexture(colorTexture, options.logicalView ? { viewFormats: ['rgba8unorm-srgb'] } : {});
        const color = options.logicalView ? frame.createTextureView(colorHandle, {
            format: 'rgba8unorm-srgb', dimension: '2d', baseMipLevel: 1, mipLevelCount: 1,
            baseArrayLayer: 1, arrayLayerCount: 1,
        }) : colorHandle;
        const depthHandle = frame.importTexture(depthTexture);
        const depth = options.logicalView ? frame.createTextureView(depthHandle, {
            dimension: '2d', baseMipLevel: 1, mipLevelCount: 1, baseArrayLayer: 1, arrayLayerCount: 1,
        }) : depthHandle;
        const initialized = options.readOnlyDepth || options.initialDepth !== undefined;
        if (initialized) frame.render({
            label: 'test.initialize-shared-attachments',
            colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store', clearValue: [0.1, 0.2, 0.3, 1] }],
            depthStencilAttachment: {
                target: depth, depthLoadOp: 'clear', depthStoreOp: 'store',
                depthClearValue: options.initialDepth ?? (reverse ? 0 : 1),
            },
        });
        const observed = observeIndirect(frame);
        const layers = options.layers ?? [];
        for (let layer = 0; layer <= layers.length; layer++) {
            const current = layer === 0 ? renderer : createReferenceRenderer(device, { maxInstances: 10 });
            if (layer > 0) {
                extraRenderers.push(current);
                current.setInstances(layers[layer - 1]);
            }
            current.record(observed.recording, {
                viewProjection: projection(convention), depthConvention: convention, culling: options.culling ?? true,
                color: {
                    target: color, loadOp: initialized || layer > 0 ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1],
                },
                depth: options.readOnlyDepth ? { target: depth, depthReadOnly: true } : initialized || layer > 0
                    ? { target: depth, depthLoadOp: 'load', depthStoreOp: 'store' }
                    : { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: reverse ? 0 : 1 },
            });
        }
        assert(observed.handles.length === layers.length + 1, 'Test must observe one indirect buffer per renderer');
        for (const [index, handle] of observed.handles.entries()) {
            const buffer = device.createBuffer({ size: 60, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            counterBuffers.push(buffer);
            const destination = frame.importBuffer(buffer);
            frame.copy({ label: `test.read-indirect-${index}`, operations: [{ type: 'buffer-to-buffer', source: handle, destination, size: 60 }] });
            frame.markReadback(destination);
        }
        const pixelHandle = frame.importBuffer(pixels);
        frame.copy({ label: 'test.read-pixels', operations: [{
            type: 'texture-to-buffer', source: colorHandle, destination: pixelHandle,
            sourceMipLevel: options.logicalView ? 1 : 0,
            sourceOrigin: options.logicalView ? [0, 0, 1] : [0, 0, 0],
            destinationLayout: { bytesPerRow }, copySize: [size, size],
        }] });
        frame.markReadback(pixelHandle);
        if (depthReadback) {
            const destination = frame.importBuffer(depthReadback);
            frame.copy({ label: 'test.read-depth', operations: [{
                type: 'texture-to-buffer', source: depthHandle, destination, sourceAspect: 'depth-only',
                sourceMipLevel: options.logicalView ? 1 : 0,
                sourceOrigin: options.logicalView ? [0, 0, 1] : [0, 0, 0],
                destinationLayout: { bytesPerRow: 256 }, copySize: [size, size],
            }] });
            frame.markReadback(destination);
        }
        const compiled = frame.compile({ report: true });
        compiled.execute();
        await Promise.all([pixels, ...counterBuffers, ...(depthReadback ? [depthReadback] : [])].map((buffer) => buffer.mapAsync(GPUMapMode.READ)));
        const counts = counterBuffers.map((buffer) => {
            const args = new Uint32Array(buffer.getMappedRange());
            equal([args[4], args[9], args[14]], [0, 0, 0], 'firstInstance stays zero');
            return [args[1], args[6], args[11]];
        });
        const data = new Uint8Array(pixels.getMappedRange()).slice();
        const depthValues = depthReadback ? new Float32Array(depthReadback.getMappedRange()).slice() : undefined;
        return { data, counts, depthValues, size, bytesPerRow, bytesPerPixel, report: compiled.compilationReport };
    }
    finally {
        pixels.destroy();
        depthReadback?.destroy();
        for (const buffer of counterBuffers) buffer.destroy();
        for (const extra of extraRenderers) extra.destroy();
        if (!options.renderer) renderer.destroy();
        runtime.destroy();
        colorTexture.destroy();
        depthTexture.destroy();
    }
}

function assertSameImage(left: Uint8Array, right: Uint8Array, message: string): void {
    assert(left.length === right.length, `${message}: unequal dimensions`);
    const difference = left.findIndex((value, index) => value !== right[index]);
    assert(difference === -1, `${message}: byte ${difference}: ${left[difference]} != ${right[difference]}`);
}

function coloredPixels(image: Awaited<ReturnType<typeof render>>): number {
    let count = 0;
    for (let y = 0; y < image.size; y++) for (let x = 0; x < image.size; x++) {
        const at = y * image.bytesPerRow + x * image.bytesPerPixel;
        if (image.data[at] + image.data[at + 1] + image.data[at + 2] > 0) count++;
    }
    return count;
}

async function within<T>(promise: Promise<T>, name: string): Promise<T> {
    let timer = 0;
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new Error(`${name} timed out`)), 15_000);
        })]);
    }
    finally { clearTimeout(timer); }
}

async function main() {
    assert(navigator.gpu, 'WebGPU is unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    assert(adapter, 'No WebGPU adapter available');
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (event) => uncapturedErrors.push(event.error.message));
    async function test(name: string, action: () => Promise<void>) {
        device.pushErrorScope('validation');
        let error: unknown;
        try { await action(); }
        catch (caught) { error = caught; }
        const validation = await device.popErrorScope();
        if (validation) error = new Error(`${error ? `${String(error)}; ` : ''}WebGPU: ${validation.message}`);
        const result = { name, ok: !error, ...(error ? { error: error instanceof Error ? error.stack : String(error) } : {}) };
        results.push(result);
        console.log(`${result.ok ? 'PASS' : 'FAIL'} ${name}${error ? `: ${String(error)}` : ''}`);
    }
    try {
        await test('three shapes, compacted indirect counts, culling image equivalence', async () => {
            const plane = [0.32, 0, 0, 0, 0, 0, 0.32, 0, 0, -0.32, 0, 0, 0.6, 0, 0.5, 1];
            const instances = [primitive('cube', transform(-0.6)), primitive('sphere'), primitive('plane', plane), primitive('sphere', transform(3))];
            const culled = await render(device, { instances });
            const unculled = await render(device, { instances, culling: false });
            equal(culled.counts, [[1, 1, 1]], 'Visible instances by shape');
            equal(unculled.counts, [[1, 2, 1]], 'Unculled instances by shape');
            assertSameImage(culled.data, unculled.data, 'Culling preserves visible pixels');
            assert(coloredPixels(culled) > 100, 'Primitives must produce colored pixels');
        });
        await test('clip boundaries, behind camera, nonuniform scales and rotation', async () => {
            const instances = [
                primitive('cube', transform(1.02, 0, 0.5, 0.35, 0.25, 0.2, Math.PI / 4)),
                primitive('sphere', transform(-1.02, 0, 0.5, 0.35, 0.2, 0.2)),
                primitive('cube', transform(2)), primitive('cube', transform(0, 0, -1)), primitive('cube', transform(0, 0, 2)),
            ];
            const culled = await render(device, { instances });
            equal(culled.counts, [[1, 1, 0]], 'Boundary intersections retained; outside bounds rejected');
            const unculled = await render(device, { instances, culling: false });
            assertSameImage(culled.data, unculled.data, 'Boundary culling preserves pixels');
        });
        await test('negative scale preserves lighting on symmetric geometry', async () => {
            const positive = await render(device, { instances: [primitive('cube', transform(0, 0, 0.5, 0.4, 0.3, 0.2))] });
            const reflected = await render(device, { instances: [primitive('cube', transform(0, 0, 0.5, -0.4, 0.3, 0.2))] });
            assertSameImage(positive.data, reflected.data, 'Reflected cube uses the same surface lighting');
            equal(reflected.counts, [[1, 0, 0]], 'Reflected cube remains visible');
        });
        await test('reset clears stale indirect counts across frames and empty input', async () => {
            const renderer = createReferenceRenderer(device, { maxInstances: 10_000 });
            try {
                const full = await render(device, { renderer, instances: Array.from({ length: 10_000 }, (_, i) => primitive(['cube', 'sphere', 'plane'][i % 3] as Instance['shape'])) });
                equal(full.counts, [[3334, 3333, 3333]], 'Capacity boundary atomics');
                const outside = await render(device, { renderer, instances: [primitive('cube', transform(10))] });
                equal(outside.counts, [[0, 0, 0]], 'All invisible frame resets counts');
                assert(coloredPixels(outside) === 0, 'All invisible frame remains clear');
                const empty = await render(device, { renderer, instances: [] });
                equal(empty.counts, [[0, 0, 0]], 'Empty frame resets counts');
                assert(coloredPixels(empty) === 0, 'Empty frame remains clear');
            }
            finally { renderer.destroy(); }
        });
        await test('forward and reverse depth, all supported depth formats', async () => {
            for (const depthFormat of ['depth16unorm', 'depth24plus', 'depth32float'] as const) {
                const front = primitive('cube', transform(0, 0, 0.3, 0.3), [0.6, 0, 0]);
                const back = primitive('cube', transform(0, 0, 0.7, 0.3), [0, 0.6, 0]);
                const forward = await render(device, { depthFormat, instances: [front, back] });
                const reverse = await render(device, { depthFormat, convention: 'reverse-z', instances: [front, back] });
                assertSameImage(forward.data, reverse.data, `${depthFormat} depth conventions`);
                const center = 32 * forward.bytesPerRow + 32 * 4;
                assert(forward.data[center] > 0 && forward.data[center + 1] === 0, 'Nearest red object wins depth');
            }
        });
        await test('shared color/depth works in either renderer recording order', async () => {
            for (const convention of ['forward-z', 'reverse-z'] as const) {
                const front = primitive('cube', transform(0, 0, 0.3), [0.6, 0, 0]);
                const back = primitive('sphere', transform(0, 0, 0.7), [0, 0.6, 0]);
                const first = await render(device, { convention, instances: [front], layers: [[back]] });
                const second = await render(device, { convention, instances: [back], layers: [[front]] });
                assertSameImage(first.data, second.data, `Shared attachments with ${convention}`);
                equal(first.counts, [[1, 0, 0], [0, 1, 0]], 'Independent renderer buffers');
            }
        });
        await test('load preserves existing attachments and read-only depth stays unchanged', async () => {
            for (const convention of ['forward-z', 'reverse-z'] as const) {
                const initialDepth = convention === 'forward-z' ? 0 : 1;
                const hidden = await render(device, { convention, initialDepth });
                const baseline = await render(device, { convention, initialDepth, instances: [] });
                assertSameImage(hidden.data, baseline.data, 'Existing depth occludes renderer');
                const readonly = await render(device, { convention, readOnlyDepth: true });
                assert(readonly.depthValues?.every((value) => value === (convention === 'forward-z' ? 1 : 0)), 'Read-only depth must retain its clear value');
                assert(readonly.data[0] >= 25 && readonly.data[1] >= 50 && readonly.data[2] >= 76, 'Load preserves background color');
            }
        });
        await test('linear, sRGB, BGRA and HDR output formats', async () => {
            const linear = await render(device);
            for (const colorFormat of ['rgba8unorm-srgb', 'bgra8unorm', 'bgra8unorm-srgb', 'rgba16float'] as const) {
                const image = await render(device, { colorFormat });
                assert(image.counts[0][0] === 1 && coloredPixels(image) > 20, `${colorFormat} draws`);
                if (colorFormat === 'rgba16float') continue;
                for (let i = 0; i < linear.data.length; i += 4) for (let channel = 0; channel < 3; channel++) {
                    const linearValue = linear.data[i + channel] / 255;
                    const expected = colorFormat.endsWith('-srgb')
                        ? Math.round((linearValue <= 0.0031308 ? linearValue * 12.92 : 1.055 * linearValue ** (1 / 2.4) - 0.055) * 255)
                        : linear.data[i + channel];
                    const actualChannel = colorFormat.startsWith('bgra') ? 2 - channel : channel;
                    assert(Math.abs(image.data[i + actualChannel] - expected) <= 2, `${colorFormat} encoding at byte ${i + channel}`);
                }
            }
        });
        await test('imported color/depth views use their format, mip and array layer', async () => {
            const view = await render(device, { logicalView: true, colorFormat: 'rgba8unorm-srgb' });
            const direct = await render(device, { colorFormat: 'rgba8unorm-srgb' });
            assertSameImage(view.data, direct.data, 'Logical sRGB mip/layer view');
        });
        await test('attachment resize reuses renderer with no resize method', async () => {
            const renderer = createReferenceRenderer(device);
            try {
                for (const size of [32, 96, 64]) {
                    const image = await render(device, { renderer, size });
                    assert(coloredPixels(image) > 10, `${size}px attachment renders`);
                }
            }
            finally { renderer.destroy(); renderer.destroy(); }
        });
        await test('different devices fail explicitly before using borrowed GPU resources', async () => {
            const otherAdapter = await navigator.gpu.requestAdapter();
            assert(otherAdapter, 'Second device adapter is available');
            const other = await otherAdapter.requestDevice();
            const renderer = createReferenceRenderer(device);
            other.pushErrorScope('validation');
            try {
                let failure: unknown;
                try { await render(other, { renderer }); }
                catch (error) { failure = error; }
                assert(/same GPUDevice/.test(String(failure)), `Expected an explicit device identity error, received ${String(failure)}`);
                const validation = await other.popErrorScope();
                assert(!validation, `Cross-device guard must run before invalid GPU commands: ${validation?.message}`);
            }
            finally { renderer.destroy(); other.destroy(); }
        });
        await test('real demo captures the next rendered frame, resizes, switches settings and releases resources', async () => {
            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'width:320px;height:200px;display:block';
            document.body.append(canvas);
            const errors: string[] = [];
            let readyResolve = () => {};
            const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
            const controller = await startReferenceRenderer(canvas, { onReady: readyResolve, onError: (error) => errors.push(error.message) });
            assert(controller, `Host creation failed: ${errors.join('; ')}`);
            try {
                await within(ready, 'Host ready');
                const first = await within(controller.captureSnapshot(), 'Initial snapshot');
                assert(first, 'Expected real first snapshot');
                equal(first.graph.nodes.map((node) => node.label), ['Reset', 'Cull', 'Draw', 'reference.present'], 'Snapshot contains actual renderer and present passes');
                equal(controller.getSettings(), { instanceCount: 1000, culling: true, depthConvention: 'reverse-z' }, 'Initial host settings');
                controller.setSettings({ instanceCount: 0, culling: false, depthConvention: 'forward-z' });
                canvas.style.width = '480px';
                window.dispatchEvent(new Event('resize'));
                const second = await within(controller.captureSnapshot(), 'Updated snapshot');
                assert(second && second.capture !== first.capture, 'Capture reflects a new rendered frame');
                assert(canvas.width === 480 * Math.min(2, Math.max(1, devicePixelRatio)), 'Backing size follows resized canvas');
                controller.setSettings({ instanceCount: 10000, culling: true, depthConvention: 'reverse-z' });
                assert(await within(controller.captureSnapshot(), 'Capacity snapshot'), 'Host supports capacity boundary');
                controller.dispose();
                controller.dispose();
                assert(await controller.captureSnapshot() === undefined, 'Disposed capture settles with no snapshot');
                equal(errors, [], 'Demo has no validation or lifecycle errors');
            }
            finally { controller.dispose(); canvas.remove(); }
        });
        await test('real device loss settles pending demo capture and reports the failure', async () => {
            const prototype = Object.getPrototypeOf(adapter) as GPUAdapter;
            const original = prototype.requestDevice;
            let hostDevice: GPUDevice | undefined;
            prototype.requestDevice = async function (descriptor?: GPUDeviceDescriptor) {
                hostDevice = await original.call(this, descriptor);
                return hostDevice;
            };
            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'width:160px;height:120px;display:block';
            document.body.append(canvas);
            let reportFailure = (_error: Error) => {};
            const failure = new Promise<Error>((resolve) => { reportFailure = resolve; });
            let controller: Awaited<ReturnType<typeof startReferenceRenderer>>;
            try {
                controller = await startReferenceRenderer(canvas, { onError: reportFailure });
                prototype.requestDevice = original;
                assert(controller && hostDevice, 'Host device was captured for loss simulation');
                const pending = controller.captureSnapshot();
                hostDevice.destroy();
                const error = await within(failure, 'Device-loss error');
                assert(/device was lost/.test(error.message), `Explicit device loss report: ${error.message}`);
                assert(await within(pending, 'Lost-device capture') === undefined, 'Pending capture settles when device is lost');
                assert(await controller.captureSnapshot() === undefined, 'Lost-device host is disposed');
            }
            finally {
                prototype.requestDevice = original;
                controller?.dispose();
                canvas.remove();
            }
        });
        await device.queue.onSubmittedWorkDone();
        return { ok: results.every((result) => result.ok) && uncapturedErrors.length === 0,
            adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description },
            results, uncapturedErrors };
    }
    finally { device.destroy(); }
}

main().then((result) => {
    Object.assign(globalThis, { __referenceRendererGpuResult: result });
    document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2);
}).catch((error: unknown) => {
    const result = { ok: false, results, uncapturedErrors, error: error instanceof Error ? error.stack : String(error) };
    Object.assign(globalThis, { __referenceRendererGpuResult: result });
    document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2);
});
