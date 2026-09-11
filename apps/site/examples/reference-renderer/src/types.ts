import type {
    FrameGraphRecording,
    RenderColorAttachmentDesc,
    RenderDepthStencilAttachmentDesc,
} from '@zenfg/webgpu';

/** A unit primitive, transformed by a column-major, invertible affine matrix. */
export interface ReferenceInstance {
    readonly shape: 'cube' | 'sphere' | 'plane';
    readonly transform: ArrayLike<number>;
    /** Linear RGB in [0, 1]. Every instance is opaque. */
    readonly color: readonly [number, number, number];
}

export interface ReferenceRendererOptions {
    /** Fixed capacity; defaults to 10,000. Overflow throws instead of reallocating. */
    readonly maxInstances?: number;
}

export interface ReferenceFrameOptions {
    /** Column-major matrix using WebGPU clip depth [0, w], matching depthConvention. */
    readonly viewProjection: ArrayLike<number>;
    /** Defaults to reverse-z (greater, clear 0); forward-z uses less, clear 1. */
    readonly depthConvention?: 'reverse-z' | 'forward-z';
    /** Defaults to true. Disabling still builds the instance lists on the GPU. */
    readonly culling?: boolean;
    /** Borrowed single-sampled 2D color attachment or logical view. */
    readonly color: RenderColorAttachmentDesc;
    /** Borrowed pure depth attachment, optionally read-only. */
    readonly depth: RenderDepthStencilAttachmentDesc;
}

/** A teaching module: the caller owns the device, graph, attachments and submission. */
export interface ReferenceRenderer {
    /** Copies and uploads a complete replacement. Call before recording the next frame. */
    setInstances(instances: readonly ReferenceInstance[]): void;
    /**
     * Records Reset -> Cull -> Draw once per recording. Execute before updating
     * inputs or recording another frame; an overwritten recording cannot be replayed.
     */
    record(frame: FrameGraphRecording, options: ReferenceFrameOptions): void;
    /** Idempotently releases only resources created by this renderer. */
    destroy(): void;
}
