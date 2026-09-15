import type { ReferenceInstance } from '../../reference-renderer/src/index.ts';
import type { SplatSource } from '../../playcanvas-gsplat-shared/src/bridge.ts';

export const source: SplatSource = {
    name: 'Toy Cat', streaming: false,
    url: 'https://raw.githubusercontent.com/playcanvas/developer-site/074196ac869561d0d0fedba3a88795adbac747c1/static/assets/toy-cat.sog',
    position: [0, -0.7, 0], rotation: [0, 0, 180],
};
export function createInstances(): ReferenceInstance[] {
    const item = (shape: ReferenceInstance['shape'], x: number, y: number, z: number,
        sx: number, sy: number, sz: number, color: ReferenceInstance['color']): ReferenceInstance => ({
        shape, color, transform: new Float32Array([sx,0,0,0, 0,sy,0,0, 0,0,sz,0, x,y,z,1]),
    });
    return [
        item('cube', 0,-0.78,0, 3,0.1,2.4, [0.075,0.095,0.12]),
        item('cube', -0.48,-0.32,0.35, 0.3,0.8,0.3, [0.88,0.25,0.065]),
        item('sphere', 0.48,-0.32,-0.2, 0.55,0.55,0.55, [0.95,0.46,0.14]),
        item('cube', 0.65,-0.55,0.6, 0.25,0.3,0.25, [0.7,0.19,0.055]),
        item('sphere', -0.6,-0.52,-0.6, 0.36,0.36,0.36, [0.95,0.46,0.14]),
    ];
}
