import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../../reference-renderer/src/index.ts';
import { glyph } from '@pmndrs/glyph';
import { createGlyphLayer } from '../../src/glyph.ts';
import { defaults } from '../../src/settings.ts';
import { textMatrix } from '../../src/scene.ts';
import { createPresenter } from '../../src/present.ts';
import { startGlyphInterop } from '../../src/main.ts';

const result: { ok: boolean; cases: string[]; errors: string[]; images: Record<string, string>; snapshots: Record<string, unknown>; adapter?: unknown } =
    { ok: false, cases: [], errors: [], images: {}, snapshots: {} };
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function test() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Hardware WebGPU adapter unavailable.');
    result.adapter = { ...adapter.info.toJSON?.(), vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description };
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', event => result.errors.push(event.error.message));
    device.pushErrorScope('validation');
    const graph = new FrameGraph(device);
    const meshes = createReferenceRenderer(device, { maxInstances: 1 });
    const settings = { ...defaults, text: 'O', fontSize: 160, width: 160 };
    const text = await createGlyphLayer(device, settings);
    const present = createPresenter(device, 'rgba8unorm');
    const output = device.createTexture({ size: [128, 128], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 128 * 128 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const projection = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.2, 0, 0, 0, 0.5, 1]);
    async function render(mode: 'bitmap' | 'msdf' | 'slug', meshZ: number, drawText: boolean) {
        const next = { ...settings, mode };
        const metrics = text.update(next, 1);
        assert(metrics.missingGlyphCount === 0, 'ASCII O must be available.');
        text.setMatrix(textMatrix(projection, next, metrics.height));
        meshes.setInstances([{ shape: 'cube', color: [0.02, 0.4, 0.2],
            transform: new Float32Array([5, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0.1, 0, 0, 0, meshZ, 1]) }]);
        const frame = graph.beginFrame();
        const color = frame.createTexture({ format: 'rgba16float', size: [128, 128] });
        const depth = frame.createTexture({ format: 'depth32float', size: [128, 128] });
        meshes.record(frame, { viewProjection: projection, depthConvention: 'forward-z',
            color: { target: color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
            depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
        if (drawText) frame.render({ label: 'glyph.text',
            colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
            depthStencilAttachment: { target: depth, depthReadOnly: true },
            encode: ({ pass }) => { text.draw(pass, 128, 128); } });
        const target = frame.importTexture(output);
        present(frame, color, target); frame.markOutput(target); frame.compile().execute();
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: 512 }, [128, 128]);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const pixels = new Uint8Array(readback.getMappedRange()).slice();
        readback.unmap();
        return pixels;
    }
    function save(name: string, pixels: Uint8Array) {
        const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
        canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), 128, 128), 0, 0);
        result.images[name] = canvas.toDataURL();
    }
    try {
        for (const mode of ['bitmap', 'msdf', 'slug'] as const) {
            const rear = await render(mode, -1, false);
            const visible = await render(mode, -1, true);
            const front = await render(mode, 1, false);
            const occluded = await render(mode, 1, true);
            let changed = 0, hiddenDifference = 0;
            for (let i = 0; i < rear.length; i += 4) {
                if (Math.abs(visible[i] - rear[i]) > 5) changed++;
                if (Math.abs(occluded[i] - front[i]) > 1) hiddenDifference++;
            }
            assert(changed > 100, mode + ' must rasterize visible glyphs.');
            assert(hiddenDifference === 0, mode + ' must be hidden by a front mesh.');
            // Find the glyph ink bounds; O's interior and a corner of that rectangle must preserve the rear mesh.
            const ink: [number, number][] = [];
            for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++)
                if (visible[(y * 128 + x) * 4] - rear[(y * 128 + x) * 4] > 30) ink.push([x, y]);
            const minX = Math.min(...ink.map(p => p[0])), maxX = Math.max(...ink.map(p => p[0]));
            const minY = Math.min(...ink.map(p => p[1])), maxY = Math.max(...ink.map(p => p[1]));
            const center = (Math.floor((minY + maxY) / 2) * 128 + Math.floor((minX + maxX) / 2)) * 4;
            assert(Math.abs(visible[center] - rear[center]) <= 1, mode + ' O hole must preserve the rear mesh.');
            save(mode, visible);
            result.cases.push(mode + ': visible ink, front occlusion and rear mesh through O hole');
        }
        const error = await device.popErrorScope(); if (error) throw error;
    } finally {
        text.destroy(); meshes.destroy(); graph.destroy(); readback.destroy(); output.destroy();
        // Disposing Glyph must leave its borrowed device usable.
        const probe = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(probe, 0, new Uint32Array([42]));
        await device.queue.onSubmittedWorkDone(); probe.destroy(); device.destroy();
    }

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:640px;height:480px;display:block'; document.body.append(canvas);
    let frames = 0, statistics = { glyphs: 0, lines: 0 }, warning: string | undefined;
    let shapeCalls = 0;
    const shape = glyph.shape.bind(glyph);
    glyph.shape = () => { shapeCalls++; shape(); };
    const controller = await startGlyphInterop(canvas, {
        onError: error => result.errors.push(error.message),
        onFrame: () => frames++, onWarning: value => { warning = value; },
        onStatistics: value => { statistics = value; },
    });
    assert(controller, 'Host must initialize.');
    try {
        for (let i = 0; i < 120 && !frames && !result.errors.length; i++) await tick();
        assert(frames > 0, 'Host must submit a frame.');
        const snapshot = await controller!.captureSnapshot();
        assert(snapshot, 'Host must capture the real graph.');
        result.snapshots.initial = snapshot;
        const labels = canvas.dataset.frameGraph!;
        assert(labels.includes('glyph.text') && labels.includes('glyph-interop.present'), 'Graph must include text and presentation.');
        for (const mode of ['bitmap', 'slug', 'msdf', 'bitmap', 'msdf'] as const) {
            controller!.setSettings({ mode }); await tick(); await tick();
            assert(controller!.getSettings().mode === mode, 'Raster switch must persist.');
        }
        const before = shapeCalls;
        controller!.setSettings({ scale: 1.5, tilt: 45 }); await tick(); await tick();
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, cancelable: true }));
        await tick(); await tick();
        assert(shapeCalls === before, 'Spatial controls must not reshape text.');
        controller!.setSettings({ outline: 0.03, shadow: true, text: 'Glyph\nDepth' }); await tick(); await tick();
        assert(statistics.lines >= 2, 'Newlines must update layout metrics.');
        controller!.setSettings({ mode: 'slug' }); await tick(); await tick();
        controller!.setSettings({ mode: 'msdf' }); await tick(); await tick();
        assert(controller!.getSettings().shadow, 'MSDF effects must survive mode switches.');
        controller!.setSettings({ text: '中文' }); await tick(); await tick();
        assert(warning, 'Missing glyph warning must be visible.');
        controller!.setSettings({ text: '' }); await tick(); await tick();
        assert(statistics.glyphs === 0 && !warning, 'Empty text must clear glyphs and warning.');
        canvas.style.width = '320px'; canvas.style.height = '480px'; await tick(); await tick();
        assert(canvas.width === 320 && canvas.height === 480, 'Portrait resize must update attachments.');
        const capture = controller!.captureSnapshot(); controller!.dispose();
        assert(await capture === undefined, 'Pending capture must settle on disposal.');
        const stopped = frames; await tick(); await tick(); assert(frames === stopped, 'Disposed host must stop submitting.');
        result.cases.push('host: raster/effects, layout, empty/missing text, uniform-only transforms, resize, snapshot and disposal');
    } finally { controller?.dispose(); glyph.shape = shape; canvas.remove(); }
    const abort = new AbortController(); abort.abort();
    assert(await startGlyphInterop(document.createElement('canvas'), { signal: abort.signal }) === undefined, 'Pre-aborted initialization must settle.');
    result.cases.push('pre-aborted initialization');
    const startupAbort = new AbortController();
    let startupError = false;
    const cancelled = await startGlyphInterop(document.createElement('canvas'), {
        signal: startupAbort.signal,
        onLoading: message => { if (message.startsWith('Loading Glyph')) startupAbort.abort(); },
        onError: () => { startupError = true; },
    });
    assert(cancelled === undefined && !startupError, 'Cancellation after device creation must release resources quietly.');
    result.cases.push('initialization cancelled after WebGPU setup');
    const remountCanvas = document.createElement('canvas');
    remountCanvas.style.cssText = 'width:320px;height:240px'; document.body.append(remountCanvas);
    const remount = await startGlyphInterop(remountCanvas, { onError: error => result.errors.push(error.message) });
    assert(await remount?.captureSnapshot(), 'A fresh mount must work after prior teardown.');
    remount?.dispose(); remount?.dispose(); remountCanvas.remove();
    result.cases.push('remount and idempotent disposal');

    result.ok = result.errors.length === 0;
}
test().catch(error => result.errors.push(error.stack ?? String(error))).finally(() => {
    (globalThis as unknown as { __glyphResult: typeof result }).__glyphResult = result;
});
