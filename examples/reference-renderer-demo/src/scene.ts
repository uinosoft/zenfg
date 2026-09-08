import type { ReferenceInstance } from '@zenfg-example/reference-renderer';

/** A deterministic scene; changing the count only uploads a new instance list. */
export function createDemoInstances(count: number): ReferenceInstance[] {
    const side = Math.ceil(Math.cbrt(Math.max(1, count)));
    const colors = [[0.08, 0.35, 0.55], [0.12, 0.58, 0.48], [0.85, 0.32, 0.12]] as const;
    const shapes = ['cube', 'sphere', 'plane'] as const;
    return Array.from({ length: count }, (_, index) => {
        const angle = index * 0.37;
        const c = Math.cos(angle) * 0.65;
        const s = Math.sin(angle) * 0.65;
        const x = index % side;
        const y = Math.floor(index / (side * side));
        const z = Math.floor(index / side) % side;
        return {
            shape: shapes[index % shapes.length],
            color: colors[index % colors.length],
            transform: new Float32Array([
                c, 0, -s, 0, 0, 0.65, 0, 0, s, 0, c, 0,
                (x - (side - 1) / 2) * 2.2,
                (y - (side - 1) / 2) * 2.2,
                (z - (side - 1) / 2) * 2.2, 1,
            ]),
        };
    });
}

