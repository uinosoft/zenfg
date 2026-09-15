import type { ReferenceInstance } from '../../reference-renderer/src/index.ts';
import type { SplatSource } from '../../playcanvas-gsplat-shared/src/bridge.ts';

export const source: SplatSource = {
    name: 'Roman Parish', streaming: true,
    url: 'https://code.playcanvas.com/examples_data/example_roman_parish_02/lod-meta.json',
    position: [0,0,0], rotation: [270,0,0],
};
/** A small deterministic route through the capture, not a GPU mesh stress test. */
export function createInstances(): ReferenceInstance[] {
    return Array.from({ length: 32 }, (_, i) => {
        const x = 7.5 + (i % 4) * 2.5, z = -9 + Math.floor(i / 4) * 3;
        const height = 0.45 + (i % 3) * 0.3;
        return {
            shape: i % 3 === 0 ? 'sphere' : 'cube',
            color: i % 2 ? [0.88,0.25,0.065] : [0.95,0.46,0.14],
            transform: new Float32Array([0.5,0,0,0, 0,height,0,0, 0,0,0.5,0, x,height/2,z,1]),
        };
    });
}
