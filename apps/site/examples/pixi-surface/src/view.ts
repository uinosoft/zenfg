export interface Camera { azimuth: number; polar: number; distance: number; }
export const initialCamera: Camera = { azimuth: 0.32, polar: 1.32, distance: 12 };

/** Same zero-to-one, reverse-Z orbit projection as the repository's primitive showcases. */
export function viewProjection(camera: Camera, aspect: number): Float32Array {
    const { azimuth: a, polar: p } = camera; const distance = camera.distance * Math.max(1, 1.5 / aspect);
    const z = [Math.sin(p) * Math.sin(a), Math.cos(p), Math.sin(p) * Math.cos(a)];
    const x = [Math.cos(a), 0, -Math.sin(a)];
    const y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
    const view = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, -distance, 1];
    const near = 0.1, far = 100, f = 1 / Math.tan(Math.PI / 8);
    const projection = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, near / (far - near), -1, 0, 0, far * near / (far - near), 0];
    const result = new Float32Array(16);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
        for (let k = 0; k < 4; k++) result[col * 4 + row] += projection[k * 4 + row] * view[col * 4 + k];
    return result;
}

export function renderSize(width: number, height: number, dpr: number, limit: number) {
    const resolution = Math.min(Math.max(1, dpr), 2, limit / width, limit / height);
    const w = Math.max(1, Math.round(width * resolution)), h = Math.max(1, Math.round(height * resolution));
    const scale = Math.min(2, Math.min(4096, limit) / Math.max(w, h));
    return { width: w, height: h, scene: [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))] as const };
}
