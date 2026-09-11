import {
    Color, DepthFormat, DepthTexture, FloatType, HalfFloatType, LinearSRGBColorSpace,
    Matrix4, NoToneMapping, PerspectiveCamera, RenderTarget, RGBAFormat,
    WebGPUCoordinateSystem, WebGPURenderer,
} from 'three/webgpu';
import { BACKGROUND, CAMERA_POSITION, CAMERA_TARGET, createThreeScene } from './scene.ts';

/** This is the only dependency on Three r184 backend texture storage. */
interface NativeBackend {
    readonly isWebGPUBackend?: boolean;
    readonly device?: GPUDevice;
    get(texture: unknown): { readonly texture?: GPUTexture };
}

export interface SharedAttachments {
    readonly color: GPUTexture;
    readonly depth: GPUTexture;
}

export interface ThreeLayer {
    readonly device: GPUDevice;
    readonly reverseZ: boolean;
    getAttachments(): SharedAttachments;
    render(): void;
}

export function validateAttachment(texture: GPUTexture | undefined, format: GPUTextureFormat, width: number, height: number,
    usage: GPUTextureUsageFlags): GPUTexture {
    if (!texture || texture.format !== format || texture.width !== width || texture.height !== height
        || texture.depthOrArrayLayers !== 1 || texture.dimension !== '2d' || texture.sampleCount !== 1
        || (texture.usage & usage) !== usage) {
        throw new Error(`Three.js r184 must expose a ${width}x${height}, single-sampled ${format} GPUTexture with usage ${usage}.`);
    }
    return texture;
}

/** Set the public matrices explicitly, including before Three's first reverse-Z render. */
export function updateCamera(camera: PerspectiveCamera, aspect: number, reverseZ: boolean): Float32Array {
    camera.aspect = aspect;
    camera.coordinateSystem = WebGPUCoordinateSystem;
    const top = camera.near * Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
    const right = top * aspect;
    camera.projectionMatrix.makePerspective(-right, right, top, -top, camera.near, camera.far, WebGPUCoordinateSystem, reverseZ);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld(true);
    return new Float32Array(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements);
}

/** Owns Three resources, but borrows the host's device. Never renders during allocation. */
export class ThreeBridge implements ThreeLayer {
    readonly camera = new PerspectiveCamera(42, 1, 0.1, 100);
    readonly renderer: WebGPURenderer;
    readonly content = createThreeScene();
    readonly target: RenderTarget;
    private width: number;
    private height: number;
    private destroyed = false;

    private constructor(readonly device: GPUDevice, width: number, height: number, readonly reverseZ: boolean) {
        this.width = width; this.height = height;
        this.camera.position.set(...CAMERA_POSITION);
        this.camera.lookAt(...CAMERA_TARGET);
        this.renderer = new WebGPURenderer({
            canvas: document.createElement('canvas'), device, antialias: false, alpha: false,
            reversedDepthBuffer: reverseZ,
        });
        this.renderer.outputColorSpace = LinearSRGBColorSpace;
        this.renderer.toneMapping = NoToneMapping;
        this.renderer.setClearColor(new Color(...BACKGROUND), 1);
        // Public clear depth is converted to 0 by Three's reverse-Z backend.
        this.renderer.setClearDepth(1);
        this.renderer.setSize(width, height, false);
        this.target = new RenderTarget(width, height, {
            format: RGBAFormat, type: HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 0,
        });
        this.target.texture.name = 'three-interop.color';
        this.target.texture.colorSpace = LinearSRGBColorSpace;
        this.target.depthTexture = new DepthTexture(width, height, FloatType);
        this.target.depthTexture.format = DepthFormat;
        this.target.depthTexture.name = 'three-interop.depth';
    }

    static async create(device: GPUDevice, width: number, height: number, reverseZ: boolean): Promise<ThreeBridge> {
        const bridge = new ThreeBridge(device, width, height, reverseZ);
        try {
            await bridge.renderer.init();
            const backend = bridge.renderer.backend as unknown as NativeBackend;
            if (backend.isWebGPUBackend !== true || backend.device !== device) {
                throw new Error('Three.js must use the host WebGPU device; WebGL fallback cannot co-render.');
            }
            bridge.renderer.initRenderTarget(bridge.target);
            bridge.getAttachments();
            return bridge;
        } catch (error) {
            bridge.destroy();
            throw error;
        }
    }

    resize(width: number, height: number): void {
        this.assertAlive();
        if (width === this.width && height === this.height) return;
        this.width = width; this.height = height;
        this.renderer.setSize(width, height, false);
        this.target.setSize(width, height);
        this.renderer.initRenderTarget(this.target);
        this.getAttachments();
    }

    getAttachments(): SharedAttachments {
        this.assertAlive();
        const backend = this.renderer.backend as unknown as NativeBackend;
        return {
            color: validateAttachment(backend.get(this.target.texture).texture, 'rgba16float', this.width, this.height,
                GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING),
            depth: validateAttachment(backend.get(this.target.depthTexture).texture, 'depth32float', this.width, this.height,
                GPUTextureUsage.RENDER_ATTACHMENT),
        };
    }

    render(): void {
        this.assertAlive();
        this.renderer.setRenderTarget(this.target);
        try { this.renderer.render(this.content.scene, this.camera); }
        finally { this.renderer.setRenderTarget(null); }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.content.dispose();
        this.target.dispose();
        // r184 does not destroy a device supplied in the constructor.
        this.renderer.dispose();
    }

    private assertAlive(): void {
        if (this.destroyed) throw new Error('Three.js bridge has been destroyed.');
    }
}
