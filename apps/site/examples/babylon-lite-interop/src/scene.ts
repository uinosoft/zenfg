import { addToScene, createCylinder, createDirectionalLight, createHemisphericLight, createPbrMaterial,
    createTorus, type EngineContext, type SceneContext } from '@babylonjs/lite';
import type { ReferenceInstance } from '../../reference-renderer/src/index.ts';

export const BACKGROUND = [0.012, 0.019, 0.028] as const;
export const CAMERA_TARGET = { x: 0, y: 1.1, z: 0 };
export const CAMERA_POSITION = { x: 5.8, y: 4.1, z: -8.2 };

/** Mirror the canonical right-handed showcase along Z for Lite's left-handed world. */
export function populateScene(engine: EngineContext, scene: SceneContext): void {
    const [r, g, b] = BACKGROUND.map(value => Math.pow(value, 1 / 2.2));
    scene.clearColor = { r: r!, g: g!, b: b!, a: 1 };
    Object.assign(scene.imageProcessing, { exposure: 1, contrast: 1, toneMappingEnabled: false });
    const blue = createPbrMaterial({ baseColorFactor: [0.025, 0.46, 0.62, 1], metallicFactor: 0, roughnessFactor: 0.42 });
    const teal = createPbrMaterial({ baseColorFactor: [0.025, 0.30, 0.38, 1], metallicFactor: 0, roughnessFactor: 0.55 });
    const ring = createTorus(engine, { diameter: 2.9, thickness: 0.44, tessellation: 96 });
    ring.position.x = -0.55; ring.position.y = 1.65;
    // Radians: correct the torus's XZ basis first, then yaw around world Y.
    // Lite's XYZ Euler order differs from Babylon's yaw-pitch-roll; compose qY * qX explicitly.
    const halfPitch = -Math.PI / 4, halfYaw = 0.3 / 2;
    const sx = Math.sin(halfPitch), cx = Math.cos(halfPitch);
    const sy = Math.sin(halfYaw), cy = Math.cos(halfYaw);
    ring.rotationQuaternion.set(sx * cy, cx * sy, -sx * sy, cx * cy);
    ring.material = blue;
    addToScene(scene, ring);
    for (const [x, height, z] of [[-2.3, 1.15, -0.65], [2.2, 2.45, -0.5], [0.9, 0.65, 1.1]] as const) {
        const column = createCylinder(engine, { diameter: 0.64, height, tessellation: 40 });
        column.position.x = x; column.position.y = height / 2; column.position.z = -z;
        column.material = teal;
        addToScene(scene, column);
    }
    const ambient = createHemisphericLight([0, 1, 0], 1.8);
    ambient.groundColor = [0.061, 0.086, 0.122];
    addToScene(scene, ambient);
    addToScene(scene, createDirectionalLight([3, -6, 5], 2.2));
}

/** Column-major right-handed TRS, shared with the other showcases without an engine dependency. */
export function instanceTransform(position: readonly number[], scale: readonly number[], angle = 0): Float32Array {
    const c = Math.cos(angle), s = Math.sin(angle);
    return new Float32Array([
        c * scale[0]!, 0, -s * scale[0]!, 0,
        0, scale[1]!, 0, 0,
        s * scale[2]!, 0, c * scale[2]!, 0,
        position[0]!, position[1]!, position[2]!, 1,
    ]);
}

export function createReferenceInstances(): ReferenceInstance[] {
    const instance = (shape: ReferenceInstance['shape'], position: number[], scale: number[],
        color: ReferenceInstance['color'], angle = 0): ReferenceInstance => ({
        shape, transform: instanceTransform(position, scale, angle), color,
    });
    return [
        instance('cube', [0, -0.17, 0], [6.2, 0.3, 4.2], [0.075, 0.095, 0.12]),
        instance('cube', [-0.65, 1.1, 0.25], [1.35, 2.2, 1.05], [0.88, 0.25, 0.065], -0.25),
        instance('sphere', [1.15, 1.03, -0.6], [2.06, 2.06, 2.06], [0.95, 0.46, 0.14]),
        instance('cube', [1.85, 0.42, 1.15], [0.84, 0.84, 0.84], [0.7, 0.19, 0.055], 0.3),
        instance('sphere', [-1.9, 0.43, 1.05], [0.86, 0.86, 0.86], [0.95, 0.46, 0.14]),
    ];
}
