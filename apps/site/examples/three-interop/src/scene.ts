import {
    Color, CylinderGeometry, DirectionalLight, HemisphereLight, Matrix4,
    Mesh, MeshStandardMaterial, Quaternion, Scene, TorusGeometry, Vector3,
} from 'three/webgpu';
import type { ReferenceInstance } from '../../reference-renderer/src/index.ts';

export const BACKGROUND = [0.012, 0.019, 0.028] as const;
export const CAMERA_TARGET = [0, 1.1, 0] as const;
export const CAMERA_POSITION = [5.8, 4.1, 8.2] as const;

/** All assets are procedural and owned by this scene. Colors are linear RGB. */
export function createThreeScene() {
    const scene = new Scene();
    const torus = new TorusGeometry(1.45, 0.22, 24, 96);
    const cylinder = new CylinderGeometry(0.32, 0.32, 1, 40);
    const blue = new MeshStandardMaterial({ color: new Color(0.025, 0.46, 0.62), roughness: 0.42, metalness: 0 });
    const teal = new MeshStandardMaterial({ color: new Color(0.025, 0.30, 0.38), roughness: 0.55, metalness: 0 });
    const ring = new Mesh(torus, blue);
    ring.position.set(-0.55, 1.65, 0);
    ring.rotation.y = -0.3;
    scene.add(ring);
    for (const [x, height, z] of [[-2.3, 1.15, -0.65], [2.2, 2.45, -0.5], [0.9, 0.65, 1.1]]) {
        const column = new Mesh(cylinder, teal);
        column.position.set(x!, height! / 2, z!);
        column.scale.y = height!;
        scene.add(column);
    }
    scene.add(new HemisphereLight(0xffffff, 0x465362, 1.8));
    const light = new DirectionalLight(0xffffff, 2.2);
    light.position.set(-3, 6, 5);
    scene.add(light);
    return {
        scene,
        dispose() {
            torus.dispose(); cylinder.dispose(); blue.dispose(); teal.dispose();
            scene.clear();
        },
    };
}

export function createReferenceInstances(): ReferenceInstance[] {
    const instance = (shape: ReferenceInstance['shape'], position: [number, number, number], scale: [number, number, number],
        color: ReferenceInstance['color'], angle = 0): ReferenceInstance => ({
        shape,
        transform: new Matrix4().compose(new Vector3(...position), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle), new Vector3(...scale)).elements,
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
