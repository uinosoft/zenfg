import { TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';
import type { ReferenceRenderer } from '@zenfg-example/reference-renderer';
import type { BabylonLiteLayer } from './bridge.ts';
import type { AttachmentResolver } from './resolve.ts';

export function recordCoRendering(frame: FrameGraphRecording, lite: BabylonLiteLayer, reference: ReferenceRenderer,
    viewProjection: Float32Array, resolve: AttachmentResolver) {
    const attachments = lite.getAttachments();
    const nativeColor = frame.importTexture(attachments.color, { label: 'babylon-lite-interop.native-color' });
    const depth = frame.importTexture(attachments.depth, { label: 'babylon-lite-interop.native-depth' });
    frame.externalSubmission({
        label: 'babylon-lite-interop.lite-render', sideEffect: false,
        uses: [
            frame.use(nativeColor, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' }),
            frame.use(depth, TextureAccess.DepthWrite, { contents: 'overwrite' }),
        ],
        submit({ device }) {
            if (device !== lite.device) throw new Error('Babylon Lite and ZenFG must share the same GPUDevice.');
            lite.render(); // All Lite work is synchronously enqueued on the shared queue before returning.
        },
    });
    const color = frame.createTexture({ label: 'babylon-lite-interop.color', size: [attachments.color.width, attachments.color.height],
        format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    resolve(frame, nativeColor, color);
    reference.record(frame, {
        viewProjection, depthConvention: 'reverse-z',
        color: { target: color, loadOp: 'load', storeOp: 'store' },
        depth: { target: depth, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    return { color, depth };
}
