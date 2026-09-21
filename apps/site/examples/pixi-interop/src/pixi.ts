import { ExternalSource, ImageSource, Point, Texture, WebGPURenderer, type FederatedPointerEvent } from 'pixi.js';
import mapUrl from '../assets/displacement.png?url';
import { createArtwork } from './artwork.ts';
import { initialCamera } from './view.ts';

/** Uses Pixi's public advanced APIs; never takes ownership of the host's device or viewport. */
export class PortalPixi {
    readonly source: ExternalSource;
    readonly texture: Texture;
    readonly art: ReturnType<typeof createArtwork>;
    readonly camera = { ...initialCamera };
    readonly context: GPUCanvasContext;
    orbiting = true;
    lensEnabled = true;
    private destroyed = false;
    private width = 0;
    private height = 0;
    private resolution = 0;
    private drag: { id: number; target: 'lens' | 'camera'; x: number; y: number } | undefined;
    private readonly stopInput: () => void;

    private constructor(readonly renderer: WebGPURenderer, readonly device: GPUDevice,
        private readonly canvas: HTMLCanvasElement, viewport: GPUTexture, private readonly map: Texture, private readonly mapImage: ImageBitmap) {
        this.source = new ExternalSource({ resource: viewport, renderer, label: 'portal.borrowed-3d' });
        this.texture = new Texture({ source: this.source, dynamic: true });
        this.art = createArtwork(this.texture, map, {
            toggleOrbit: () => { this.orbiting = !this.orbiting; },
            toggleLens: () => { this.cancelInteraction(); this.lensEnabled = !this.lensEnabled; },
            reset: () => {
                this.cancelInteraction();
                Object.assign(this.camera, initialCamera);
                this.art.resetLens();
                this.orbiting = this.lensEnabled = true;
            },
        });
        // Initialize the canvas target without rendering. Later getCurrentTexture() and
        // Pixi's render pass use the same image, within the same synchronous frame.
        renderer.renderTarget.getGpuRenderTarget(renderer.view.renderTarget);
        this.context = canvas.getContext('webgpu')!;
        this.stopInput = this.attachInput();
    }

    static async create(canvas: HTMLCanvasElement, gpu: { adapter: GPUAdapter; device: GPUDevice },
        viewport: GPUTexture, signal?: AbortSignal): Promise<PortalPixi> {
        const renderer = new WebGPURenderer();
        let map: Texture | undefined;
        let bitmap: ImageBitmap | undefined;
        try {
            await renderer.init({ canvas, gpu, width: 1, height: 1, resolution: 1, antialias: true,
                background: 0x07131d, backgroundAlpha: 1, autoDensity: false });
            signal?.throwIfAborted();
            if (renderer.gpu.device !== gpu.device) throw new Error('Pixi must borrow the host WebGPU device.');
            const response = await fetch(mapUrl, { signal });
            if (!response.ok) throw new Error('Could not load the local displacement map.');
            bitmap = await createImageBitmap(await response.blob());
            signal?.throwIfAborted();
            map = new Texture({ source: new ImageSource({ resource: bitmap, autoGenerateMipmaps: false }) });
            return new PortalPixi(renderer, gpu.device, canvas, viewport, map, bitmap);
        } catch (error) {
            map?.destroy(true);
            bitmap?.close();
            renderer.destroy();
            throw error;
        }
    }

    resize(width: number, height: number, resolution: number): void {
        if (width === this.width && height === this.height && resolution === this.resolution) return;
        this.cancelInteraction();
        this.width = width; this.height = height; this.resolution = resolution;
        this.renderer.resize(width, height, resolution);
        // Keep detail in the composite before displacement; the pool rounds up to powers of two.
        const filterLimit = 2 ** Math.floor(Math.log2(this.device.limits.maxTextureDimension2D));
        this.art.filter.resolution = Math.min(resolution * 1.5, filterLimit / width, filterLimit / height);
        this.art.resize(width, height);
    }
    setViewport(texture: GPUTexture): void {
        this.source.updateGPUTexture(texture);
        this.art.viewport.width = this.art.viewport.height = this.art.layout.radius * 2;
    }
    update(dt: number): void {
        if (this.orbiting) this.camera.azimuth += dt * 0.22;
        this.art.update(dt, this.orbiting, this.lensEnabled);
    }
    render(): void { this.renderer.render({ container: this.art.root, clear: true }); }

    cancelInteraction(): void {
        const id = this.drag?.id;
        this.drag = undefined;
        if (id !== undefined && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    }
    private attachInput(): () => void {
        const { root, portalHit, lens } = this.art;
        const begin = (target: 'lens' | 'camera', event: FederatedPointerEvent) => {
            if (event.button !== 0 || this.drag) return;
            event.stopPropagation();
            this.drag = { id: event.pointerId, target, x: event.global.x, y: event.global.y };
            if (target === 'camera') this.orbiting = false;
            this.canvas.setPointerCapture(event.pointerId);
        };
        lens.on('pointerdown', event => begin('lens', event));
        portalHit.on('pointerdown', event => begin('camera', event));
        root.on('globalpointermove', (event: FederatedPointerEvent) => {
            const drag = this.drag;
            if (!drag || drag.id !== event.pointerId) return;
            const dx = event.global.x - drag.x, dy = event.global.y - drag.y;
            if (drag.target === 'lens') this.art.moveLens(lens.x + dx, lens.y + dy);
            else {
                this.camera.azimuth -= dx * 0.007;
                this.camera.polar = Math.max(0.2, Math.min(1.5, this.camera.polar - dy * 0.007));
            }
            drag.x = event.global.x; drag.y = event.global.y;
        });
        const end = (event: PointerEvent) => { if (event.pointerId === this.drag?.id) this.cancelInteraction(); };
        const cancel = () => this.cancelInteraction();
        const point = new Point();
        // Pixi's wheel listener is passive. Only prevent page scrolling over the portal.
        const wheel = (event: WheelEvent) => {
            this.renderer.events.mapPositionToPoint(point, event.clientX, event.clientY);
            const { cx, cy, radius } = this.art.layout;
            if ((point.x - cx) ** 2 + (point.y - cy) ** 2 > radius ** 2) return;
            event.preventDefault();
            const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
            this.camera.distance = Math.max(8, Math.min(24, this.camera.distance * Math.exp(Math.max(-1, Math.min(1, pixels * 0.001)))));
        };
        this.canvas.addEventListener('pointerup', end);
        this.canvas.addEventListener('pointercancel', end);
        this.canvas.addEventListener('lostpointercapture', end);
        this.canvas.addEventListener('wheel', wheel, { passive: false });
        window.addEventListener('blur', cancel);
        return () => {
            this.cancelInteraction();
            this.canvas.removeEventListener('pointerup', end);
            this.canvas.removeEventListener('pointercancel', end);
            this.canvas.removeEventListener('lostpointercapture', end);
            this.canvas.removeEventListener('wheel', wheel);
            window.removeEventListener('blur', cancel);
        };
    }
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.stopInput();
        this.art.root.filters = [];
        this.art.content.filters = [];
        this.art.filter.destroy();
        this.art.root.destroy({ children: true });
        this.texture.destroy(true); // ExternalSource deliberately leaves the borrowed GPUTexture alive.
        this.map.destroy(true);
        this.mapImage.close();
        this.renderer.destroy(); // A supplied GPUDevice belongs to the host.
    }
}