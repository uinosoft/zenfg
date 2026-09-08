import { TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';
import type { ReferenceRenderer } from '@zenfg-example/reference-renderer';
import type { BabylonLayer } from './bridge.ts';
import type { AttachmentResolver } from './resolve.ts';

export function recordCoRendering(frame: FrameGraphRecording, babylon: BabylonLayer, reference: ReferenceRenderer,
    viewProjection: Float32Array, resolve: AttachmentResolver) {
    const attachments = babylon.getAttachments();
    const nativeColor = frame.importTexture(attachments.color, { label: 'babylon-interop.native-color' });
    const nativeDepth = frame.importTexture(attachments.depth, { label: 'babylon-interop.native-depth' });
    frame.externalSubmission({
        label: 'babylon-interop.babylon-render', sideEffect: false,
        uses: [
            frame.use(nativeColor, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' }),
            frame.use(nativeDepth, TextureAccess.DepthWrite, { contents: 'overwrite' }),
        ],
        submit({ device }) {
            if (device !== babylon.device) throw new Error('Babylon and ZenFG must share the same GPUDevice.');
            babylon.render(); // Synchronously enqueues work before returning, without waiting for GPU completion.
        },
    });
    const size = [attachments.color.width, attachments.color.height] as const;
    const color = frame.createTexture({ label: 'babylon-interop.color', size, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const depth = frame.createTexture({ label: 'babylon-interop.depth', size, format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    resolve(frame, nativeColor, nativeDepth, color, depth, babylon.reverseZ);
    reference.record(frame, {
        viewProjection, depthConvention: babylon.reverseZ ? 'reverse-z' : 'forward-z',
        color: { target: color, loadOp: 'load', storeOp: 'store' },
        depth: { target: depth, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    return { color, depth };
}
