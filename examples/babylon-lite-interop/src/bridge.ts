import { addTask, attachControl, createArcRotateCamera, createEngine, createRenderTarget, createRenderTask,
    createSceneContext, disposeEngine, disposeScene, getViewProjectionMatrix, registerScene, renderFrame,
    setCameraLimits, setEngineSize, type ArcRotateCamera, type EngineContext, type RenderTarget, type SceneContext } from '@babylonjs/lite';
import { CAMERA_POSITION, CAMERA_TARGET, populateScene } from './scene.ts';

export interface SharedAttachments { readonly color: GPUTexture; readonly depth: GPUTexture; }
export interface BabylonLiteLayer {
    readonly device: GPUDevice;
    getAttachments(): SharedAttachments;
    render(): void;
}
/** Version-coupled access is confined to this bridge; Lite's public handles are opaque. */
interface NativeEngine { readonly _device?: GPUDevice; }
interface NativeTarget { readonly _colorTexture?: GPUTexture | null; readonly _depthTexture?: GPUTexture | null; }

export function validateAttachment(texture: GPUTexture | undefined | null, format: GPUTextureFormat, width: number, height: number): GPUTexture {
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    if (!texture || texture.format !== format || texture.width !== width || texture.height !== height
        || texture.depthOrArrayLayers !== 1 || texture.dimension !== '2d' || texture.sampleCount !== 1
        || (texture.usage & usage) !== usage) {
        throw new Error(`Babylon Lite 1.28 must expose a ${width}x${height}, single-sampled ${format} GPUTexture with usage ${usage}.`);
    }
    return texture;
}

/** attachControl without a scene collects input but does not register an inertia callback. */
export function consumeCameraInput(camera: ArcRotateCamera): void {
    camera.alpha += camera.inertialAlphaOffset;
    camera.beta += camera.inertialBetaOffset;
    camera.radius -= camera.inertialRadiusOffset;
    camera.inertialAlphaOffset = camera.inertialBetaOffset = camera.inertialRadiusOffset = 0;
}

/** VP_LH * reflectZ lets the reference geometry stay in canonical right-handed coordinates. */
export function referenceViewProjection(camera: ArcRotateCamera, aspect: number): Float32Array {
    const result = new Float32Array(getViewProjectionMatrix(camera, aspect));
    for (let i = 8; i < 12; i++) result[i] = -result[i]!;
    return result;
}

export class BabylonLiteBridge implements BabylonLiteLayer {
    readonly scene: SceneContext;
    readonly camera: ArcRotateCamera;
    private readonly target: RenderTarget;
    private destroyed = false;
    private detachInput?: () => void;
    private releaseLimits?: () => void;
    private inputCanvas?: HTMLCanvasElement;

    private constructor(readonly engine: EngineContext, private width: number, private height: number) {
        this.scene = createSceneContext(engine, { defaultRenderTask: false });
        const dx = CAMERA_POSITION.x - CAMERA_TARGET.x, dy = CAMERA_POSITION.y - CAMERA_TARGET.y, dz = CAMERA_POSITION.z - CAMERA_TARGET.z;
        const radius = Math.hypot(dx, dy, dz);
        this.camera = createArcRotateCamera(Math.atan2(dz, dx), Math.acos(dy / radius), radius, { ...CAMERA_TARGET });
        this.camera.nearPlane = 0.1; this.camera.farPlane = 100;
        this.camera.inertia = 0; this.camera.panningInertia = 0;
        this.releaseLimits = setCameraLimits(this.camera, { lowerRadiusLimit: 4, upperRadiusLimit: 28,
            lowerBetaLimit: 0.15, upperBetaLimit: Math.PI / 2 - 0.025 });
        this.scene.camera = this.camera;
        this.target = createRenderTarget({ lbl: 'babylon-lite-interop.target', format: 'rgba16float',
            dFormat: 'depth32float', samples: 1, size: engine });
        addTask(this.scene, createRenderTask({ name: 'babylon-lite-interop.scene', rt: this.target }, engine, this.scene));
    }

    static async create(width: number, height: number, signal?: AbortSignal): Promise<BabylonLiteBridge> {
        signal?.throwIfAborted();
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const engine = await createEngine(canvas, { alphaMode: 'opaque', maxDevicePixelRatio: 1, msaaSamples: 1 });
        let bridge: BabylonLiteBridge | undefined;
        try {
            signal?.throwIfAborted();
            bridge = new BabylonLiteBridge(engine, width, height);
            populateScene(engine, bridge.scene);
            bridge.updateCamera();
            // Registration allocates targets and prepares pipelines, without a scene render.
            await bridge.prepare(signal);
            bridge.getAttachments();
            signal?.throwIfAborted();
            return bridge;
        } catch (error) {
            if (bridge) bridge.destroy(); else disposeEngine(engine);
            throw error;
        }
    }

    get device(): GPUDevice {
        const device = (this.engine as unknown as NativeEngine)._device;
        if (!device) throw new Error('Babylon Lite 1.28 did not expose its GPUDevice.');
        return device;
    }

    async prepare(signal?: AbortSignal): Promise<void> {
        this.assertAlive();
        signal?.throwIfAborted();
        const registration = registerScene(this.scene);
        // Lite tracks disposal across async scene builds. Never resurrect late startup results.
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        try {
            await Promise.race([registration, new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Babylon Lite scene preparation timed out.')), 30_000);
                abort = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
                signal?.addEventListener('abort', abort, { once: true });
                void this.device.lost.then(info => reject(new Error(`Babylon Lite device lost during preparation: ${info.message || info.reason}`)));
            })]);
        } finally {
            clearTimeout(timer);
            if (abort) signal?.removeEventListener('abort', abort);
        }
    }

    attachControls(canvas: HTMLCanvasElement): void {
        this.detachInput?.();
        this.inputCanvas = canvas;
        this.updatePointerSensitivity();
        const attach = () => attachControl(this.camera, canvas, undefined, { shouldHandlePointerDown: event => event.button === 0 });
        let detach = attach();
        // Lite 1.28 handles pointerup, but not cancelled gestures or capture lost outside the canvas.
        const cancel = () => {
            detach();
            detach = attach();
        };
        canvas.addEventListener('pointercancel', cancel);
        canvas.addEventListener('lostpointercapture', cancel);
        this.detachInput = () => {
            canvas.removeEventListener('pointercancel', cancel);
            canvas.removeEventListener('lostpointercapture', cancel);
            detach();
        };
    }

    private updatePointerSensitivity(): void {
        if (this.inputCanvas) this.camera.angularSensibility = Math.max(1, this.inputCanvas.clientHeight) / (2 * Math.PI);
    }

    updateCamera(): Float32Array {
        this.assertAlive();
        this.camera.fov = 2 * Math.atan(Math.tan(42 * Math.PI / 360) / Math.min(1, this.width / this.height));
        consumeCameraInput(this.camera);
        return referenceViewProjection(this.camera, this.width / this.height);
    }

    resize(width: number, height: number): void {
        this.assertAlive();
        this.updatePointerSensitivity();
        if (width === this.width && height === this.height) return;
        setEngineSize(this.engine, width, height);
        this.width = width; this.height = height;
        this.getAttachments();
    }

    getAttachments(): SharedAttachments {
        this.assertAlive();
        const target = this.target as NativeTarget;
        return { color: validateAttachment(target._colorTexture, 'rgba16float', this.width, this.height),
            depth: validateAttachment(target._depthTexture, 'depth32float', this.width, this.height) };
    }

    render(): void { this.assertAlive(); renderFrame(this.engine, 0); }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.detachInput?.(); this.releaseLimits?.();
        disposeScene(this.scene);
        disposeEngine(this.engine);
    }

    private assertAlive(): void { if (this.destroyed) throw new Error('Babylon Lite bridge has been disposed.'); }
}
