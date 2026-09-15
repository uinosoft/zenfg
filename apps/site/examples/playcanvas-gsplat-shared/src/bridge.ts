import * as pc from 'playcanvas';
import { prepare } from './loading.ts';
import type { SplatLayer } from './graph.ts';

export interface SplatSource {
    readonly url: string;
    readonly name: string;
    readonly streaming: boolean;
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number];
}

/** Version-coupled access is isolated here; no engine internals enter ZenFG APIs. */
export function validateAttachments(color: GPUTexture, depth: GPUTexture, width: number, height: number): void {
    for (const [texture, format] of [[color, 'rgba8unorm'], [depth, 'depth32float']] as const) {
        if (!texture || texture.format !== format || texture.width !== width || texture.height !== height
            || texture.dimension !== '2d' || texture.depthOrArrayLayers !== 1 || texture.sampleCount !== 1
            || !(texture.usage & GPUTextureUsage.RENDER_ATTACHMENT)
            || (format === 'rgba8unorm' && !(texture.usage & GPUTextureUsage.TEXTURE_BINDING))) {
            throw new Error('PlayCanvas exposed incompatible shared attachments.');
        }
    }
}

export class PlayCanvasSplatBridge implements SplatLayer {
    readonly device: GPUDevice;
    readonly app: pc.AppBase;
    private readonly camera: pc.Entity;
    private readonly projection = new pc.Mat4();
    private color!: pc.Texture;
    private depth!: pc.Texture;
    private target!: pc.RenderTarget;
    private asset?: pc.Asset;
    private entity?: pc.Entity;
    private destroyed = false;
    private width = 0;
    private height = 0;
    renderedSplats = 0;
    loadingCount = 0;

    private constructor(private readonly graphics: pc.GraphicsDevice,
        source: SplatSource, private readonly warning: (message: string) => void) {
        this.device = (graphics as unknown as { wgpu: GPUDevice }).wgpu;
        if (!this.device) { throw new Error('PlayCanvas WebGPU is required.'); }
        this.app = new pc.AppBase(document.createElement('canvas'));
        const options = new pc.AppOptions();
        options.graphicsDevice = graphics;
        options.componentSystems = [pc.CameraComponentSystem, pc.GSplatComponentSystem];
        options.resourceHandlers = [pc.TextureHandler, pc.GSplatHandler];
        this.app.init(options);
        this.app.autoRender = false;
        this.app.scene.exposure = 1;
        this.camera = new pc.Entity('Shared camera', this.app);
        this.camera.addComponent('camera', { fov: source.streaming ? 75 : 50, nearClip: 0.1, farClip: source.streaming ? 1000 : 100,
            clearColor: new pc.Color(0, 0, 0, 0), clearColorBuffer: true,
            clearDepthBuffer: false, clearStencilBuffer: false });
        this.camera.camera!.shaderParams.gammaCorrection = pc.GAMMA_SRGB;
        this.camera.camera!.shaderParams.toneMapping = pc.TONEMAP_LINEAR;
        this.camera.camera!.calculateProjection = output => output.copy(this.projection);
        this.app.root.addChild(this.camera);
        this.app.scene.gsplat.renderer = pc.GSPLAT_RENDERER_RASTER_GPU_SORT;
        this.app.scene.gsplat.alphaClipForward = 1 / 255;
        if (source.streaming) {
            Object.assign(this.app.scene.gsplat, { splatBudget: 4_000_000, lodUpdateDistance: 0.5,
                lodUnderfillLimit: 5, lodUpdateAngle: 90, lodBehindPenalty: 3, radialSorting: true });
        }
        this.app.systems.gsplat!.on('frame:ready', (_camera: unknown, _layer: unknown, _ready: boolean, loading: number) => {
            this.loadingCount = loading;
        });
        this.app.assets.on('error', (error: string) => {
            try { this.warning('A splat resource failed to load: ' + error); } catch { /* Status observers cannot stop rendering. */ }
        });
    }

    static async create(source: SplatSource, width: number, height: number,
        signal?: AbortSignal, warning: (message: string) => void = () => undefined): Promise<PlayCanvasSplatBridge> {
        const hidden = document.createElement('canvas');
        hidden.width = hidden.height = 1;
        const graphics = await prepare(pc.createGraphicsDevice(hidden, {
            deviceTypes: ['webgpu'], antialias: false, depth: true,
        }), signal, device => device.destroy());
        let bridge: PlayCanvasSplatBridge;
        try { bridge = new PlayCanvasSplatBridge(graphics, source, warning); }
        catch (error) { graphics.destroy(); throw error; }
        try {
            bridge.resize(width, height);
            const asset = new pc.Asset(source.name, 'gsplat', { url: source.url });
            bridge.asset = asset;
            const loaded = new Promise<pc.Asset>((resolve, reject) => {
                asset.once('load', () => resolve(asset));
                asset.once('error', (error: string) => reject(new Error(error)));
                bridge.app.assets.add(asset);
                bridge.app.assets.load(asset);
            });
            const lost = new AbortController();
            let preparing = true;
            void bridge.device.lost.then(info => { if (preparing) lost.abort(new Error('PlayCanvas device lost during preparation: ' + info.message)); });
            try {
                await prepare(loaded, signal ? AbortSignal.any([signal, lost.signal]) : lost.signal, value => value.unload(), 60_000);
            } finally { preparing = false; }
            signal?.throwIfAborted();
            const entity = new pc.Entity(source.name, bridge.app);
            entity.addComponent('gsplat', { asset });
            entity.setLocalPosition(...source.position);
            entity.setLocalEulerAngles(...source.rotation);
            if (source.streaming) {
                Object.assign(entity.gsplat!, { lodRangeMin: 1, lodRangeMax: 5, lodBaseDistance: 5, lodMultiplier: 4 });
            }
            bridge.entity = entity;
            bridge.app.root.addChild(entity);
            return bridge;
        } catch (error) { bridge.destroy(); throw error; }
    }

    setBudget(value: number): void {
        if (!Number.isFinite(value) || value < 500_000 || value > 4_000_000) throw new Error('Splat budget must be between 500,000 and 4,000,000.');
        this.app.scene.gsplat.splatBudget = Math.round(value);
    }

    syncCamera(world: pc.Mat4, projection: pc.Mat4, aspect: number): void {
        const position = world.getTranslation(new pc.Vec3());
        this.camera.setPosition(position);
        this.camera.setRotation(new pc.Quat().setFromMat4(world));
        this.projection.copy(projection);
        this.camera.camera!.aspectRatio = aspect;
    }

    resize(width: number, height: number): void {
        if (width === this.width && height === this.height) return;
        this.target?.destroy(); this.color?.destroy(); this.depth?.destroy();
        this.width = width; this.height = height;
        this.color = new pc.Texture(this.graphics, { name: 'GSplat color', width, height, format: pc.PIXELFORMAT_RGBA8, mipmaps: false });
        this.depth = new pc.Texture(this.graphics, { name: 'Shared forward depth', width, height, format: pc.PIXELFORMAT_DEPTH, mipmaps: false });
        this.target = new pc.RenderTarget({ colorBuffer: this.color, depthBuffer: this.depth, samples: 1 });
        this.camera.camera!.renderTarget = this.target;
        this.getAttachments();
    }

    getAttachments(): { color: GPUTexture; depth: GPUTexture } {
        const native = (texture: pc.Texture) => (texture as unknown as { impl: { gpuTexture: GPUTexture } }).impl.gpuTexture;
        const color = native(this.color), depth = native(this.depth);
        validateAttachments(color, depth, this.width, this.height);
        return { color, depth };
    }

    render(delta: number): void {
        if (this.destroyed) throw new Error('PlayCanvas bridge is disposed.');
        this.app.update(delta);
        this.app.fire('framerender');
        this.graphics.frameStart();
        this.app.fire('prerender');
        this.app.root.syncHierarchy();
        this.app.renderComposition(this.app.scene.layers);
        this.app.fire('postrender');
        this.graphics.frameEnd();
        this.app.fire('frameend');
        this.renderedSplats = (this.app.renderer as unknown as { _gsplatCount: number })._gsplatCount;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.entity?.destroy();
        if (this.asset) { this.app.assets.remove(this.asset); this.asset.unload(); }
        this.target?.destroy(); this.color?.destroy(); this.depth?.destroy();
        this.app.destroy();
    }
}
