import type { TextureHandle } from '@zenfg/webgpu';

export type Particles4AllPreset = 'small' | 'medium' | 'large';
export type Particles4AllDisplayMode = 'particles' | 'surface-mesh' | 'ray-march' | 'ssfr';

export interface Particles4AllSettings {
    preset: Particles4AllPreset;
    displayMode: Particles4AllDisplayMode;
    paused: boolean;
    timeScale: number;
    particleRadius: number;
    speedMax: number;
    boxScaleX: number;
    substeps: number;
    iterations: number;
    cfm: number;
    omega: number;
    sorAverage: boolean;
    xsph: number;
    scorr: number;
    scorrDq: number;
    tension: number;
    gravity: number;
    forceEnabled: boolean;
    forceRadius: number;
    forceStrength: number;
    forceLimit: number;
    cameraSpeed: number;
    rigidBodiesEnabled: boolean;
    grabEnabled: boolean;
    grabStrength: number;
    pourSpeed: number;
    pourWidth: number;
    pourHeight: number;
    pourTilt: number;
    meshResolution: number;
    meshIso: number;
    fieldSmooth: number;
    normalSmooth: number;
    anisotropyRatio: number;
    anisotropyLambda: number;
    anisotropyNeighbours: number;
    anisotropyLonely: number;
    anisotropyRadius: number;
    anisotropyStretch: number;
    anisotropyKs: number;
    raySurface: 'mesh' | 'field';
    rayDebug: number;
    rayThicknessSteps: number;
    ior: number;
    absorption: number;
    transmission: [number, number, number];
    roughness: number;
    exposure: number;
    sunIntensity: number;
    sunElevation: number;
    sunAzimuth: number;
    groundReflection: number;
    ssfrScale: number;
    ssfrDebug: number;
    ssfrRadius: number;
    ssfrFilter: 0 | 1 | 2;
    ssfrIterations: number;
    ssfrSigma: number;
    ssfrDelta: number;
    ssfrMu: number;
    ssfrBilateralRange: number;
    ssfrCleanupPass: boolean;
    ssfrThicknessRadius: number;
    ssfrThicknessScale: number;
    ssfrThicknessBlur: number;
    ssfrDepthCull: number;
    environmentIntensity: number;
    environmentYawDegrees: number;
    floorPlane: boolean;
}

export interface Particles4AllSceneOverrides {
    targetParticleCount?: number;
    spacing?: number;
    box?: [number, number, number];
    bodies?: string[];
    bodySize?: number;
    camera?: [number, number, number] | [number, number, number, number, number, number];
}

export interface Particles4AllFrame {
    /** Delta time in seconds. */
    readonly deltaTime: number;
}

export interface Particles4AllFrameGraphOptions extends Particles4AllFrame {
    readonly color: TextureHandle;
}

/** Device and pipeline format are supplied by the caller; this workload never submits. */
export interface Particles4AllOptions {
    readonly device: GPUDevice;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly outputFormat: GPUTextureFormat;
    readonly initialSettings?: Partial<Particles4AllSettings>;
}

/** Settle immediately after successful submission, or discard an abandoned recording. */
export interface PendingParticles4AllFrame {
    /** Actual transient specifications for this recording; compare before compiling to retire obsolete pool entries. */
    readonly transientResourceKey: string;
    commit(): void;
    discard(): void;
}

export interface Particles4AllStats {
    readonly preset: Particles4AllPreset;
    readonly displayMode: Particles4AllDisplayMode;
    readonly particleCount: number;
    readonly fluidParticleCount: number;
    readonly rigidParticleCount: number;
    readonly boundaryParticleCount: number;
    readonly bodyCount: number;
    readonly lastSubsteps: number;
    readonly averageDensity: number;
    readonly maximumDensity: number;
    readonly maximumSpeed: number;
    readonly kineticEnergy: number;
    readonly meshTriangles: number;
    readonly pourRemaining: number;
}
