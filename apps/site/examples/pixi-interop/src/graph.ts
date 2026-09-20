import { TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';
import type { ReferenceRenderer } from '../../reference-renderer/src/index.ts';

/** Pixi borrows the device and viewport; the host owns their lifetime. */
export interface PixiSubmission {
    readonly device: GPUDevice;
    render(): void;
}

/** One imported image: Reference writes an sRGB view, Pixi samples the unorm view. */
export function recordPortal(frame: FrameGraphRecording, reference: ReferenceRenderer, pixi: PixiSubmission,
    viewport: GPUTexture, backbuffer: GPUTexture, viewProjection: Float32Array) {
    const color = frame.importTexture(viewport, { label: 'portal.3d-color', viewFormats: ['bgra8unorm-srgb'] });
    const srgb = frame.createTextureView(color, { format: 'bgra8unorm-srgb' });
    const depth = frame.createTexture({ label: 'portal.3d-depth', format: 'depth32float',
        size: [viewport.width, viewport.height] });
    const canvas = frame.importSwapchainTexture(backbuffer, { label: 'portal.canvas' });

    reference.record(frame, {
        viewProjection, depthConvention: 'reverse-z',
        color: { target: srgb, loadOp: 'clear', storeOp: 'store', clearValue: [0.009, 0.021, 0.036, 1] },
        depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 0 },
    });
    frame.externalSubmission({
        label: 'portal.pixi-compose', sideEffect: false,
        uses: [
            frame.use(color, TextureAccess.Sampled),
            frame.use(canvas, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' }),
        ],
        submit({ device }) {
            if (device !== pixi.device) throw new Error('Pixi and ZenFG must share the same GPUDevice.');
            // Includes Pixi's mask and built-in filter passes; enqueues before returning.
            pixi.render();
        },
    });
    return canvas;
}

export function createViewportTexture(device: GPUDevice, size: number): GPUTexture {
    return device.createTexture({
        label: 'portal.3d-color', size: [size, size], format: 'bgra8unorm',
        viewFormats: ['bgra8unorm-srgb'],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
}