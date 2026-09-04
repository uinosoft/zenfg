import type { FrameGraphRecording, TextureHandle } from '@zenfg/webgpu';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';

export interface SlimeMoldSettings {
    readonly moveSpeed: number;
    readonly sensorAngle: number;
    readonly sensorDistance: number;
    readonly turnSpeed: number;
    readonly evaporationRate: number;
}

export interface TypeGpuSlimeMoldOptions {
    readonly device: GPUDevice;
    readonly viewport: {
        readonly width: number;
        readonly height: number;
    };
    readonly outputFormat: GPUTextureFormat;
    readonly agentCount?: number;
    readonly initialSettings?: Partial<SlimeMoldSettings>;
}

export interface TypeGpuSlimeMoldFrameOptions {
    readonly color: TextureHandle;
    readonly deltaTime: number;
}

export interface PendingSlimeMoldFrame {
    commit(): void;
    discard(): void;
}

export interface TypeGpuSlimeMoldController {
    getSettings(): Readonly<SlimeMoldSettings>;
    setSettings(settings: Partial<SlimeMoldSettings>): void;
    captureSnapshot(): Promise<FrameGraphSnapshot | undefined>;
    dispose(): void;
}

export interface StartTypeGpuSlimeMoldOptions {
    readonly onReady?: (message?: string) => void;
    readonly onError?: (error: unknown) => void;
}

export interface TypeGpuSlimeMoldRecorder {
    recordFrameGraph(
        graph: FrameGraphRecording,
        options: TypeGpuSlimeMoldFrameOptions,
    ): PendingSlimeMoldFrame;
}
