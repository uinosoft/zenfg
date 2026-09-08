import { AbstractEngine, ArcRotateCamera, Constants, RenderTargetTexture, Vector3, WebGPUEngine, type Scene } from '@babylonjs/core';
import { _CommonDispose } from '@babylonjs/core/Engines/engine.common.js';
import { CAMERA_POSITION, CAMERA_TARGET, createBabylonScene } from './scene.ts';

export interface SharedAttachments { readonly color: GPUTexture; readonly depth: GPUTexture; }
export interface BabylonLayer {
    readonly device: GPUDevice;
    readonly reverseZ: boolean;
    getAttachments(): SharedAttachments;
    render(): void;
}

/** Babylon 9.4 native storage access stays inside this example bridge. */
interface NativeTexture { readonly _hardwareTexture?: { readonly underlyingResource?: GPUTexture | null } | null; }

export function validateAttachment(texture: GPUTexture | undefined | null, format: GPUTextureFormat, width: number, height: number): GPUTexture {
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    if (!texture || texture.format !== format || texture.width !== width || texture.height !== height
        || texture.depthOrArrayLayers !== 1 || texture.dimension !== '2d' || texture.sampleCount !== 1
        || (texture.usage & usage) !== usage) {
        throw new Error(`Babylon 9.4 must expose a ${width}x${height}, single-sampled ${format} GPUTexture with usage ${usage}.`);
    }
    return texture;
}

/** Owns the engine/device and native targets. The host and graph borrow the device. */
export class BabylonBridge implements BabylonLayer {
    readonly scene: Scene;
    readonly camera: ArcRotateCamera;
    private target: RenderTargetTexture;
    private destroyed = false;
    private width: number;
    private height: number;
    private inputCanvas?: HTMLCanvasElement;

    private constructor(readonly engine: WebGPUEngine, width: number, height: number) {
        this.width = width; this.height = height;
        this.scene = createBabylonScene(engine);
        this.camera = new ArcRotateCamera('babylon-interop.camera', 0, 0, 1, new Vector3(...CAMERA_TARGET), this.scene);
        this.camera.setPosition(new Vector3(...CAMERA_POSITION));
        this.camera.minZ = 0.1;
        this.camera.maxZ = 100;
        this.camera.inertia = 0;
        this.camera.panningInertia = 0;
        this.camera.panningSensibility = 0;
        this.camera.lowerRadiusLimit = 4;
        this.camera.upperRadiusLimit = 28;
        this.camera.lowerBetaLimit = 0.15;
        this.camera.upperBetaLimit = Math.PI / 2 - 0.025;
        this.scene.activeCamera = this.camera;
        this.target = this.createTarget();
        this.camera.outputRenderTarget = this.target;
    }

    static async create(width: number, height: number, reverseZ: boolean, signal?: AbortSignal): Promise<BabylonBridge> {
        signal?.throwIfAborted();
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const engine = new WebGPUEngine(canvas, {
            antialias: false, adaptToDeviceRatio: false, doNotHandleContextLost: true,
            enableAllFeatures: false, setMaximumLimits: false,
            // Babylon filters optional features against its actual adapter before requestDevice.
            deviceDescriptor: { requiredFeatures: ['timestamp-query'] },
        });
        let bridge: BabylonBridge | undefined;
        try {
            await engine.initAsync();
            signal?.throwIfAborted();
            engine.useReverseDepthBuffer = reverseZ;
            bridge = new BabylonBridge(engine, width, height);
            bridge.updateCamera();
            bridge.getAttachments();
            await bridge.prepare(signal);
            signal?.throwIfAborted();
            return bridge;
        } catch (error) {
            if (bridge) bridge.destroy();
            else disposeFailedEngine(engine);
            throw error;
        }
    }

    get device(): GPUDevice { return this.engine._device; }
    get reverseZ(): boolean { return this.engine.useReverseDepthBuffer; }

    /** Compile materials without drawing a frame. Cancellation must also end readiness waits. */
    async prepare(signal?: AbortSignal): Promise<void> {
        this.assertAlive();
        signal?.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => finish(new Error('Babylon scene preparation timed out.')), 30_000);
            const abort = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
            const ready = () => finish();
            const finish = (error?: unknown) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                this.scene.onReadyObservable.removeCallback(ready);
                if (error) reject(error); else resolve();
            };
            signal?.addEventListener('abort', abort, { once: true });
            void this.device.lost.then(info => finish(new Error(`Babylon device lost during preparation: ${info.message || info.reason}`)));
            try { this.scene.executeWhenReady(ready); }
            catch (error) { finish(error); }
        });
    }

    attachControls(canvas: HTMLCanvasElement): void {
        this.scene.detachControl();
        this.inputCanvas = canvas;
        this.updatePointerSensitivity();
        this.engine.inputElement = canvas;
        this.engine.canvasTabIndex = 0;
        this.scene.attachControl();
        this.camera.attachControl(false);
    }

    private updatePointerSensitivity(): void {
        if (!this.inputCanvas) return;
        // With inertia disabled Babylon's default 1000 px/radian is much slower
        // than OrbitControls. Use its 2π radians per CSS viewport height on both axes.
        const pixelsPerRadian = Math.max(1, this.inputCanvas.clientHeight) / (2 * Math.PI);
        this.camera.angularSensibilityX = pixelsPerRadian;
        this.camera.angularSensibilityY = pixelsPerRadian;
    }

    updateCamera(): Float32Array {
        this.assertAlive();
        this.camera.fov = 2 * Math.atan(Math.tan(42 * Math.PI / 360) / Math.min(1, this.width / this.height));
        this.camera.update();
        const projection = this.camera.getProjectionMatrix(true);
        return new Float32Array(this.camera.getViewMatrix().multiply(projection).asArray());
    }

    setReverseZ(reverseZ: boolean): void {
        this.assertAlive();
        this.engine.useReverseDepthBuffer = reverseZ;
        this.camera.getProjectionMatrix(true);
    }

    resize(width: number, height: number): void {
        this.assertAlive();
        this.updatePointerSensitivity();
        if (width === this.width && height === this.height) return;
        this.width = width; this.height = height;
        this.engine.setSize(width, height, true);
        this.camera.outputRenderTarget = null;
        this.target.dispose();
        this.target = this.createTarget();
        this.camera.outputRenderTarget = this.target;
        this.getAttachments();
    }

    getAttachments(): SharedAttachments {
        this.assertAlive();
        return {
            color: validateAttachment((this.target.getInternalTexture() as NativeTexture | null)?._hardwareTexture?.underlyingResource, 'rgba16float', this.width, this.height),
            depth: validateAttachment((this.target.depthStencilTexture as NativeTexture | null)?._hardwareTexture?.underlyingResource, 'depth32float', this.width, this.height),
        };
    }

    render(): void {
        this.assertAlive();
        if (this.camera.outputRenderTarget !== this.target) throw new Error('Babylon camera output target was replaced.');
        this.engine.wipeCaches(true);
        this.engine.beginFrame();
        try { this.scene.render(false, false); }
        finally { this.engine.endFrame(); }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.camera.detachControl();
        this.inputCanvas = undefined;
        this.camera.outputRenderTarget = null;
        this.target.dispose();
        this.scene.dispose();
        this.engine.dispose(); // Babylon owns and destroys the shared device.
    }

    private createTarget(): RenderTargetTexture {
        const target = new RenderTargetTexture('babylon-interop.target', { width: this.width, height: this.height }, this.scene, {
            generateMipMaps: false, doNotChangeAspectRatio: true, type: Constants.TEXTURETYPE_HALF_FLOAT,
            samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE, generateDepthBuffer: false, generateStencilBuffer: false,
            format: Constants.TEXTUREFORMAT_RGBA, samples: 1, useSRGBBuffer: false, gammaSpace: false,
        });
        target.clearColor = this.scene.clearColor;
        target.disableImageProcessing = true;
        target.createDepthStencilTexture(0, false, false, 1, Constants.TEXTUREFORMAT_DEPTH32_FLOAT, 'babylon-interop.depth');
        return target;
    }

    private assertAlive(): void { if (this.destroyed) throw new Error('Babylon bridge has been destroyed.'); }
}

/** 9.4's dispose() assumes initAsync finished and dereferences unallocated GPU helpers otherwise. */
function disposeFailedEngine(engine: WebGPUEngine): void {
    try { engine.dispose(); }
    catch {
        // On failed initialization no host borrows this device. Release any partial allocation,
        // constructor DOM listeners and EngineStore entry while preserving the startup error.
        engine._device?.destroy();
        _CommonDispose(engine, engine.getRenderingCanvas());
        AbstractEngine.prototype.dispose.call(engine);
    }
}
