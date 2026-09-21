import { Container, ExternalSource, Graphics, ImageSource, Sprite, Texture, WebGPURenderer } from 'pixi.js';
import eggUrl from '../assets/eggHead.png?url';
import { advanceMotions, createMotions } from './motion.ts';

/** Pixi owns its scene and MSAA attachments, but borrows the device and target. */
export class SurfacePixi {
    readonly root = new Container();
    readonly target: Texture;
    readonly sprites: Sprite[];
    motions = createMotions();
    private destroyed = false;
    private constructor(readonly renderer: WebGPURenderer, readonly device: GPUDevice,
        shared: GPUTexture, private readonly egg: Texture, private readonly bitmap: ImageBitmap) {
        const source = new ExternalSource({ resource: shared, renderer, label: 'surface.borrowed-target' });
        source.antialias = true;
        this.target = new Texture({ source });
        this.root.addChild(new Graphics().rect(0, 0, 2048, 1024).fill(0x0c141e));
        this.sprites = this.motions.map(() => {
            const sprite = new Sprite(egg);
            sprite.anchor.set(0.5);
            this.root.addChild(sprite);
            return sprite;
        });
        this.update(0);
    }
    static async create(gpu: { adapter: GPUAdapter; device: GPUDevice }, shared: GPUTexture, signal?: AbortSignal) {
        const renderer = new WebGPURenderer();
        let bitmap: ImageBitmap | undefined, egg: Texture | undefined;
        try {
            // A detached canvas satisfies Pixi's renderer setup; only target is rendered.
            await renderer.init({ canvas: document.createElement('canvas'), gpu,
                width: 1, height: 1, resolution: 1, antialias: true, autoDensity: false });
            signal?.throwIfAborted();
            if (renderer.gpu.device !== gpu.device) throw new Error('Pixi must borrow the host GPUDevice.');
            const response = await fetch(eggUrl, { signal });
            if (!response.ok) throw new Error('Could not load eggHead.png.');
            bitmap = await createImageBitmap(await response.blob());
            signal?.throwIfAborted();
            egg = new Texture({ source: new ImageSource({ resource: bitmap, autoGenerateMipmaps: false }) });
            return new SurfacePixi(renderer, gpu.device, shared, egg, bitmap);
        } catch (error) {
            egg?.destroy(true); bitmap?.close(); renderer.destroy(); throw error;
        }
    }
    reset() { this.motions = createMotions(); this.update(0); }
    update(dt: number) {
        advanceMotions(this.motions, dt);
        this.sprites.forEach((sprite, i) => {
            const m = this.motions[i];
            sprite.position.set(m.x, m.y); sprite.scale.set(m.scale);
            sprite.tint = m.tint; sprite.rotation = -m.direction - Math.PI / 2;
        });
    }
    render() { this.renderer.render({ container: this.root, target: this.target, clear: true }); }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.root.destroy({ children: true });
        this.target.destroy(true); // ExternalSource does not destroy the shared GPUTexture.
        this.egg.destroy(true); this.bitmap.close(); this.renderer.destroy();
    }
}
