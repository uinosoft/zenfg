import type { MonocularFrameSource, MonocularUvTransform } from './types.ts';

export interface MonocularCameraFrame {
    readonly source: MonocularFrameSource;
    readonly uvTransform: MonocularUvTransform;
    readonly swapAxes: boolean;
}

export type CameraFacing = 'user' | 'environment';

interface CameraCallbacks {
    readonly onFrame: (frame: MonocularCameraFrame) => void;
    readonly onError?: (error: unknown) => void;
    readonly onEnded?: () => void;
}

const UPRIGHT = { uvTransform: [1, 0, 0, 1] as const, swapAxes: false };
const IOS_TRANSFORMS: Partial<Record<OrientationType, Omit<MonocularCameraFrame, 'source'>>> = {
    'portrait-primary': { uvTransform: [0, -1, 1, 0], swapAxes: true },
    'portrait-secondary': { uvTransform: [0, 1, -1, 0], swapAxes: true },
    'landscape-primary': { uvTransform: [-1, 0, 0, -1], swapAxes: false },
};

export function cameraFrameTransform(
    isIos: boolean,
    orientation?: OrientationType,
): Omit<MonocularCameraFrame, 'source'> {
    if (!isIos || !orientation) return UPRIGHT;
    return IOS_TRANSFORMS[orientation] ?? UPRIGHT;
}

export class MonocularCameraSession {
    private requestGeneration = 0;
    private activeGeneration = 0;
    private stream?: MediaStream;
    private cancelFrame?: () => void;
    private disposed = false;
    private pendingRequest = 0;
    private currentFacingMode: CameraFacing;

    constructor(
        private readonly video: HTMLVideoElement,
        private readonly callbacks: CameraCallbacks,
        facingMode: CameraFacing = 'environment',
    ) {
        this.currentFacingMode = facingMode;
    }

    get facingMode(): CameraFacing {
        return this.currentFacingMode;
    }

    get active(): boolean {
        return this.pendingRequest !== 0 || this.stream !== undefined;
    }

    async start(facingMode: CameraFacing = this.currentFacingMode): Promise<boolean> {
        if (this.disposed) throw new Error('The camera session has been destroyed.');
        if (this.stream && this.currentFacingMode === facingMode && this.pendingRequest === 0) return true;
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera capture is unavailable in this browser or page context.');
        }
        const generation = ++this.requestGeneration;
        this.pendingRequest = generation;
        let nextStream: MediaStream | undefined;
        const previousStream = this.stream;
        try {
            nextStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: { ideal: facingMode },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 60, max: 60 },
                },
            });
            if (!this.isRequestCurrent(generation)) {
                this.stopTracks(nextStream);
                return false;
            }

            this.cancelFrame?.();
            this.cancelFrame = undefined;
            const candidate = nextStream;
            this.video.srcObject = candidate;
            try {
                await this.video.play();
            } catch (error) {
                if (this.isRequestCurrent(generation)) await this.restorePreviousStream(previousStream);
                throw error;
            }
            if (!this.isRequestCurrent(generation)) {
                if (this.video.srcObject === candidate) await this.restorePreviousStream(previousStream);
                this.stopTracks(candidate);
                return false;
            }

            nextStream = undefined;
            this.stream = candidate;
            this.currentFacingMode = facingMode;
            this.pendingRequest = 0;
            const activeGeneration = ++this.activeGeneration;
            if (previousStream !== candidate) this.stopTracks(previousStream);
            for (const track of candidate.getVideoTracks()) {
                track.addEventListener('ended', () => {
                    if (!this.isRunning(activeGeneration, candidate)) return;
                    this.releaseActive();
                    this.callbacks.onEnded?.();
                }, { once: true });
            }
            this.scheduleFrame(activeGeneration, candidate);
            return true;
        } catch (error) {
            this.stopTracks(nextStream);
            throw error;
        } finally {
            if (this.pendingRequest === generation) this.pendingRequest = 0;
        }
    }

    stop(): void {
        this.requestGeneration += 1;
        this.pendingRequest = 0;
        this.releaseActive();
    }

    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stop();
    }

    private scheduleFrame(generation: number, stream: MediaStream): void {
        if (!this.isRunning(generation, stream) || this.cancelFrame) return;
        const run = (width: number, height: number) => {
            this.cancelFrame = undefined;
            if (!this.isRunning(generation, stream)) return;
            if (width <= 0 || height <= 0) {
                this.scheduleFrame(generation, stream);
                return;
            }
            try {
                const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
                this.callbacks.onFrame({
                    source: this.video,
                    ...cameraFrameTransform(isIos, screen.orientation?.type),
                });
            } catch (error) {
                this.releaseActive();
                this.callbacks.onError?.(error);
                return;
            }
            this.scheduleFrame(generation, stream);
        };
        if (this.video.requestVideoFrameCallback) {
            const id = this.video.requestVideoFrameCallback((_now, metadata) => run(metadata.width, metadata.height));
            this.cancelFrame = () => this.video.cancelVideoFrameCallback(id);
        } else {
            const id = requestAnimationFrame(() => run(this.video.videoWidth, this.video.videoHeight));
            this.cancelFrame = () => cancelAnimationFrame(id);
        }
    }

    private releaseActive(): void {
        this.activeGeneration += 1;
        this.cancelFrame?.();
        this.cancelFrame = undefined;
        const stream = this.stream;
        this.stream = undefined;
        this.video.pause();
        this.video.srcObject = null;
        this.stopTracks(stream);
    }

    private async restorePreviousStream(previousStream?: MediaStream): Promise<void> {
        if (this.stream !== previousStream) return;
        this.video.srcObject = previousStream ?? null;
        if (!previousStream) {
            this.video.pause();
            return;
        }
        try {
            await this.video.play();
        } catch {
            return;
        }
        const activeGeneration = ++this.activeGeneration;
        this.scheduleFrame(activeGeneration, previousStream);
    }

    private stopTracks(stream?: MediaStream): void {
        for (const track of stream?.getTracks() ?? []) track.stop();
    }

    private isRequestCurrent(generation: number): boolean {
        return !this.disposed && generation === this.requestGeneration;
    }

    private isRunning(generation: number, stream: MediaStream): boolean {
        return !this.disposed && generation === this.activeGeneration && this.stream === stream;
    }
}
