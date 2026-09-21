import { TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';
import type { ReferenceRenderer } from '../../reference-renderer/src/index.ts';
import type { createScreen } from './screen.ts';
import type { createPresenter } from './present.ts';

export function createSharedTexture(device: GPUDevice) {
    return device.createTexture({ label: 'surface.pixi-color', size: [2048, 1024],
        format: 'bgra8unorm', viewFormats: ['bgra8unorm-srgb'],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
}

/** All cross-renderer dependencies are here. Pixi's internal MSAA passes stay inside Pixi. */
export function recordSurface(frame: FrameGraphRecording, reference: ReferenceRenderer,
    pixi: { device: GPUDevice; render(): void }, shared: GPUTexture, backbuffer: GPUTexture,
    size: readonly [number, number], matrix: Float32Array,
    screen: Pick<ReturnType<typeof createScreen>, 'draw'>, present: ReturnType<typeof createPresenter>) {
    const animation = frame.importTexture(shared, { label: 'surface.pixi-color', viewFormats: ['bgra8unorm-srgb'] });
    const srgb = frame.createTextureView(animation, { format: 'bgra8unorm-srgb' });
    const color = frame.createTexture({ label: 'surface.scene-color', format: 'rgba16float', size });
    const depth = frame.createTexture({ label: 'surface.scene-depth', format: 'depth32float', size });
    const canvas = frame.importSwapchainTexture(backbuffer, { label: 'surface.canvas' });
    frame.externalSubmission({
        label: 'surface.pixi-animation', sideEffect: false,
        uses: [frame.use(animation, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' })],
        submit({ device }) {
            if (device !== pixi.device) throw new Error('Pixi and ZenFG must share the same GPUDevice.');
            pixi.render();
        },
    });
    reference.record(frame, {
        viewProjection: matrix, depthConvention: 'reverse-z',
        color: { target: color, loadOp: 'clear', storeOp: 'store', clearValue: [0.012, 0.019, 0.028, 1] },
        depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
    });
    const image = frame.use(srgb, TextureAccess.Sampled);
    frame.render({
        label: 'surface.draw-screen', uses: [image],
        colorAttachments: [{ target: color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { target: depth, depthReadOnly: true },
        encode: ({ pass, unwrap }) => { screen.draw(pass, unwrap(image)); },
    });
    const scene = frame.use(color, TextureAccess.Sampled);
    frame.render({
        label: 'surface.present', uses: [scene],
        colorAttachments: [{ target: canvas, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,1] }],
        encode: ({ pass, unwrap }) => { present.draw(pass, unwrap(scene)); },
    });
    return canvas;
}
