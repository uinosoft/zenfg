import { TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';
import type { ReferenceRenderer } from '../../reference-renderer/src/index.ts';

export interface SplatLayer {
    readonly device: GPUDevice;
    getAttachments(): { color: GPUTexture; depth: GPUTexture };
    render(delta: number): void;
}

/** A single imported depth connects native drawing to the external consumer. */
export function recordCoRendering(frame: FrameGraphRecording, layer: SplatLayer,
    reference: ReferenceRenderer, viewProjection: Float32Array, delta: number, label: string) {
    const attachments = layer.getAttachments();
    const splatColor = frame.importTexture(attachments.color, { label: label + '.splat-color' });
    const depth = frame.importTexture(attachments.depth, { label: label + '.shared-depth' });
    const color = frame.createTexture({ label: label + '.reference-color',
        size: [attachments.color.width, attachments.color.height], format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    reference.record(frame, {
        viewProjection, depthConvention: 'forward-z',
        color: { target: color, loadOp: 'clear', storeOp: 'store', clearValue: [0.012, 0.019, 0.028, 1] },
        depth: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
    });
    frame.externalSubmission({
        label: label + '.playcanvas', sideEffect: false,
        uses: [frame.use(depth, TextureAccess.DepthRead),
            frame.use(splatColor, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' })],
        submit({ device }) {
            if (device !== layer.device) throw new Error('PlayCanvas and ZenFG must share one GPUDevice.');
            layer.render(delta);
        },
    });
    return { color, splatColor, depth };
}
