import { TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';
import type { ReferenceRenderer } from '../../reference-renderer/src/index.ts';
import type { ThreeLayer } from './bridge.ts';

/** The host imports each physical attachment once and shares its handle with both renderers. */
export function recordCoRendering(frame: FrameGraphRecording, three: ThreeLayer, reference: ReferenceRenderer, viewProjection: Float32Array) {
    const attachments = three.getAttachments();
    const color = frame.importTexture(attachments.color, { label: 'three-interop.color' });
    const depth = frame.importTexture(attachments.depth, { label: 'three-interop.depth' });
    frame.externalSubmission({
        label: 'three-interop.three-render',
        sideEffect: false,
        uses: [
            frame.use(color, TextureAccess.ColorAttachmentWrite, { contents: 'overwrite' }),
            frame.use(depth, TextureAccess.DepthWrite, { contents: 'overwrite' }),
        ],
        submit({ device }) {
            if (device !== three.device) throw new Error('Three.js and ZenFG must share the same GPUDevice.');
            // render() must enqueue all work before returning. Do not use renderAsync().
            three.render();
        },
    });
    reference.record(frame, {
        viewProjection,
        depthConvention: three.reverseZ ? 'reverse-z' : 'forward-z',
        color: { target: color, loadOp: 'load', storeOp: 'store' },
        depth: { target: depth, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    return { color, depth };
}
