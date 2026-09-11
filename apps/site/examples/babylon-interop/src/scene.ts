import { Color3, Color4, HemisphericLight, DirectionalLight, Matrix, MeshBuilder, PBRMaterial, Quaternion, Scene, Vector3, type WebGPUEngine } from '@babylonjs/core';
import type { ReferenceInstance } from '../../reference-renderer/src/index.ts';

export const BACKGROUND = [0.012, 0.019, 0.028] as const;
export const CAMERA_TARGET = [0, 1.1, 0] as const;
export const CAMERA_POSITION = [5.8, 4.1, 8.2] as const;

/** Procedural geometry only. Scene colors and the offscreen target are linear RGB. */
export function createBabylonScene(engine: WebGPUEngine): Scene {
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(...BACKGROUND, 1);
    // Keep all image processing for the final native Present node.
    scene.imageProcessingConfiguration.applyByPostProcess = true;
    scene.imageProcessingConfiguration.toneMappingEnabled = false;
    const material = (name: string, color: readonly [number, number, number], roughness: number) => {
        const result = new PBRMaterial(name, scene);
        result.albedoColor = new Color3(...color);
        result.metallic = 0;
        result.roughness = roughness;
        return result;
    };
    const blue = material('babylon-interop.blue', [0.025, 0.46, 0.62], 0.42);
    const teal = material('babylon-interop.teal', [0.025, 0.30, 0.38], 0.55);
    const ring = MeshBuilder.CreateTorus('babylon-interop.ring', { diameter: 2.9, thickness: 0.44, tessellation: 96 }, scene);
    ring.position.set(-0.55, 1.65, 0);
    ring.rotation.set(Math.PI / 2, -0.3, 0);
    ring.material = blue;
    for (const [x, height, z] of [[-2.3, 1.15, -0.65], [2.2, 2.45, -0.5], [0.9, 0.65, 1.1]]) {
        const column = MeshBuilder.CreateCylinder('babylon-interop.column', { diameter: 0.64, height: height!, tessellation: 40 }, scene);
        column.position.set(x!, height! / 2, z!);
        column.material = teal;
    }
    const ambient = new HemisphericLight('babylon-interop.ambient', Vector3.Up(), scene);
    ambient.intensity = 1.8;
    ambient.groundColor = new Color3(0.061, 0.086, 0.122);
    const light = new DirectionalLight('babylon-interop.light', new Vector3(3, -6, -5), scene);
    light.intensity = 2.2;
    return scene;
}

export function createReferenceInstances(): ReferenceInstance[] {
    const instance = (shape: ReferenceInstance['shape'], position: [number, number, number], scale: [number, number, number],
        color: ReferenceInstance['color'], angle = 0): ReferenceInstance => ({
        shape,
        transform: Matrix.Compose(new Vector3(...scale), Quaternion.RotationAxis(Vector3.Up(), angle), new Vector3(...position)).asArray(),
        color,
    });
    return [
        instance('cube', [0, -0.17, 0], [6.2, 0.3, 4.2], [0.075, 0.095, 0.12]),
        instance('cube', [-0.65, 1.1, 0.25], [1.35, 2.2, 1.05], [0.88, 0.25, 0.065], -0.25),
        instance('sphere', [1.15, 1.03, -0.6], [2.06, 2.06, 2.06], [0.95, 0.46, 0.14]),
        instance('cube', [1.85, 0.42, 1.15], [0.84, 0.84, 0.84], [0.7, 0.19, 0.055], 0.3),
        instance('sphere', [-1.9, 0.43, 1.05], [0.86, 0.86, 0.86], [0.95, 0.46, 0.14]),
    ];
}
