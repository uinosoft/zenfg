import type { ReferenceInstance } from '../../reference-renderer/src/index.ts';
export function createScene(time: number): ReferenceInstance[] {
    const object = (shape: ReferenceInstance['shape'], x: number, y: number, z: number,
        sx: number, sy: number, sz: number, color: ReferenceInstance['color']): ReferenceInstance =>
        ({ shape, color, transform: new Float32Array([sx,0,0,0, 0,sy,0,0, 0,0,sz,0, x,y,z,1]) });
    return [
        object('cube', 0,-2.0,-0.2, 7.2,0.25,2.8, [0.06,0.13,0.18]),
        object('cube', 0,-2.2,-0.2, 6.4,0.15,2.3, [0.025,0.055,0.08]),
        object('sphere', Math.cos(time * 0.65) * 4.3, 0.15, Math.sin(time * 0.65) * 2.3,
            0.6,0.6,0.6, [1,0.48,0.12]),
    ];
}

/** Six vertices per strip keep the static cylindrical mesh easy to inspect. */
export function screenVertices(): Float32Array {
    const vertices: number[] = [];
    const point = (u: number, v: number) => {
        const angle = (u - 0.5) * 1.1, radius = 6 / 1.1;
        vertices.push(Math.sin(angle) * radius, (0.5 - v) * 3,
            (1 - Math.cos(angle)) * radius, u, v);
    };
    for (let i = 0; i < 48; i++) {
        const a = i / 48, b = (i + 1) / 48;
        point(a,0); point(a,1); point(b,0);
        point(b,0); point(a,1); point(b,1);
    }
    return new Float32Array(vertices);
}
