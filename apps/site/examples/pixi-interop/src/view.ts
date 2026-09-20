export interface Camera { azimuth: number; polar: number; distance: number; }
export const initialCamera: Camera = { azimuth: 0.6, polar: 1.05, distance: 13.5 };

/** Same zero-to-one, reverse-Z orbit projection as the repository's primitive showcases. */
export function viewProjection(camera: Camera): Float32Array {
    const { azimuth: a, polar: p, distance } = camera;
    const z = [Math.sin(p) * Math.sin(a), Math.cos(p), Math.sin(p) * Math.cos(a)];
    const x = [Math.cos(a), 0, -Math.sin(a)];
    const y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
    const view = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, -distance, 1];
    const near = 0.1, far = 100, f = 1 / Math.tan(Math.PI / 8);
    const projection = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, near / (far - near), -1, 0, 0, far * near / (far - near), 0];
    const result = new Float32Array(16);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
        for (let k = 0; k < 4; k++) result[col * 4 + row] += projection[k * 4 + row] * view[col * 4 + k];
    return result;
}

/** Layout uses CSS pixels; only the backing textures use device pixels. */
export function portalLayout(width: number, height: number) {
    const compact = width < 520 || height < 300;
    const radius = Math.max(24, Math.min(width * 0.30, (height - (compact ? 116 : 146)) / 2));
    const cx = width * 0.5, cy = (height - 12) * 0.5;
    const lensRadius = Math.max(20, radius * 0.39);
    return { width, height, compact, cx, cy, radius, lensRadius,
        lensX: cx + radius * 0.80, lensY: cy + radius * 0.05 };
}

export function backingSize(canvas: HTMLCanvasElement, limit: number) {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
    const resolution = Math.min(Math.max(1, window.devicePixelRatio || 1), 2, limit / width, limit / height);
    return { width, height, resolution };
}