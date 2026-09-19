import type { ReferenceInstance } from '../../reference-renderer/src/index.ts';
import type { GlyphSettings } from './settings.ts';

export const initialCamera = { azimuth: 0.12, polar: 1.47, distance: 7.0 };
export function createScene(): ReferenceInstance[] {
    return [
        { shape: 'cube', color: [0.9, 0.24, 0.08],
            transform: new Float32Array([0.8, 0, 0, 0, 0, 1.1, 0, 0, 0, 0, 0.8, 0, -1.65, -0.25, 0.7, 1]) },
        { shape: 'sphere', color: [0.035, 0.44, 0.48],
            transform: new Float32Array([1.9, 0, 0, 0, 0, 1.9, 0, 0, 0, 0, 1.9, 0, 1.45, 0.15, -1.1, 1]) },
    ];
}

/** Glyph pixels (top-left, y-down) -> centered world plane -> shared clip space. */
export function textMatrix(viewProjection: Float32Array, settings: GlyphSettings, height: number): Float32Array {
    const unit = 0.01 * settings.scale;
    const angle = settings.tilt * Math.PI / 180;
    const c = Math.cos(angle) * unit, s = Math.sin(angle) * unit;
    const model = new Float32Array([
        c, 0, -s, 0, 0, -unit, 0, 0, s, 0, c, 0,
        -settings.width * c / 2, height * unit / 2, settings.width * s / 2, 1,
    ]);
    const result = new Float32Array(16);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
        for (let k = 0; k < 4; k++) result[col * 4 + row] += viewProjection[k * 4 + row] * model[col * 4 + k];
    return result;
}
