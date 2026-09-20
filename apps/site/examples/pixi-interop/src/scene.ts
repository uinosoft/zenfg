import type { ReferenceInstance } from '../../reference-renderer/src/index.ts';

/** A tiny city built from existing primitives. No assets or engine. */
export function createCity(): ReferenceInstance[] {
    const instances: ReferenceInstance[] = [];
    function add(shape: ReferenceInstance['shape'], position: number[], size: number[], color: ReferenceInstance['color']) {
        const [x, y, z] = position, [sx, sy, sz] = size;
        instances.push({ shape, color, transform: new Float32Array([
            sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1,
        ]) });
    }
    add('cube', [0, -1.3, 0], [6.4, 0.4, 5.4], [0.10, 0.22, 0.25]);
    add('cube', [0, -1.6, 0], [4.9, 0.25, 4.0], [0.03, 0.09, 0.12]);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
        const height = 0.9 + ((row * 7 + col * 3) % 5) * 0.42;
        const x = (col - 1.5) * 1.3, z = (row - 1) * 1.5;
        const warm = (row + col) % 3 === 0;
        add('cube', [x, height / 2 - 1.1, z], [0.76, height, 0.82],
            warm ? [0.9, 0.36, 0.10] : [0.08, 0.43, 0.44]);
        add('cube', [x, height - 1.04, z], [0.83, 0.12, 0.89],
            warm ? [1, 0.70, 0.32] : [0.40, 0.88, 0.78]);
    }
    add('sphere', [-2.7, 2.7, -2.1], [1.05, 1.05, 1.05], [0.98, 0.64, 0.30]);
    add('sphere', [2.5, 1.5, 1.7], [0.38, 0.38, 0.38], [0.38, 0.88, 0.84]);
    return instances;
}