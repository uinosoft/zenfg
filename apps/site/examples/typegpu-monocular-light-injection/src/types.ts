import type { TextureHandle } from '@zenfg/webgpu';

export const MONOCULAR_LIGHT_INJECTION_MODES = ['relit', 'camera', 'depth', 'normals'] as const;
export type MonocularLightInjectionMode = typeof MONOCULAR_LIGHT_INJECTION_MODES[number];

export type MonocularFrameSource = HTMLVideoElement | VideoFrame;
export type MonocularUvTransform = readonly [number, number, number, number];

export interface MonocularLightInjectionSettings {
    readonly lightPosition: readonly [number, number];
    readonly lightZ: number;
    readonly mirror: boolean;
    readonly lightColor: readonly [number, number, number];
    readonly exposure: number;
    readonly intensity: number;
    readonly relief: number;
    readonly specular: number;
    readonly shadow: number;
    readonly occlusion: number;
    readonly mode: MonocularLightInjectionMode;
}

export interface CreateMonocularLightInjectionOptions {
    readonly device: GPUDevice;
    readonly outputFormat: GPUTextureFormat;
    readonly initialSettings?: Partial<MonocularLightInjectionSettings>;
}

export interface MonocularFrameOptions {
    readonly color: TextureHandle;
    readonly source: MonocularFrameSource;
    readonly uvTransform: MonocularUvTransform;
    readonly swapAxes: boolean;
    readonly updateDepth: boolean;
}

export interface MonocularLightInjectionModelMetadata {
    readonly model: string;
    readonly outputSize: readonly [width: number, height: number];
    readonly dispatchCount: number;
    readonly usesShaderF16: boolean;
}

export interface MonocularLightInjectionRuntimeStats {
    readonly ready: boolean;
    readonly model?: string;
    readonly outputSize?: readonly [width: number, height: number];
    readonly dispatchCount: number;
    readonly usesShaderF16: boolean;
    readonly submittedDepthUpdates: number;
}

export interface PendingMonocularFrame {
    commit(): void;
    discard(): void;
}
