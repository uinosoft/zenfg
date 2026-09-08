import assert from 'node:assert/strict';
import test from 'node:test';
import type { EngineContext } from '@babylonjs/lite';
import { createFakeGpu, installWebGpuGlobals } from '../../reference-renderer/tests/fakeWebGpu.ts';

test('native ring yaw and cylinder axes match the canonical right-handed composition', async () => {
    // Lite captures WebGPU constants when its mesh upload module is first loaded.
    const restore = installWebGpuGlobals();
    try {
        const { createSceneContext } = await import('@babylonjs/lite');
        const { populateScene } = await import('../src/scene.ts');
        const { device } = createFakeGpu();
        const engine = { _device: device } as unknown as EngineContext;
        Object.assign(engine, { engine });
        const scene = createSceneContext(engine, { defaultRenderTask: false });
        populateScene(engine, scene);
        const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6,
            `expected ${expected}, received ${actual}`);
        const ring = scene.meshes[0]!.worldMatrix;
        // Torus starts in XZ. Reflect its transformed local Y normal back into canonical space.
        near(ring[4]!, Math.sin(-0.3));
        near(ring[5]!, 0);
        near(-ring[6]!, Math.cos(-0.3));
        near(ring[12]!, -0.55);
        near(ring[13]!, 1.65);
        near(ring[14]!, 0);
        const positions = [[-2.3, 1.15 / 2, -0.65], [2.2, 2.45 / 2, -0.5], [0.9, 0.65 / 2, 1.1]];
        for (const [index, position] of positions.entries()) {
            const matrix = scene.meshes[index + 1]!.worldMatrix;
            near(matrix[4]!, 0); near(matrix[5]!, 1); near(matrix[6]!, 0);
            near(matrix[12]!, position[0]!);
            near(matrix[13]!, position[1]!);
            near(-matrix[14]!, position[2]!);
        }
    } finally {
        restore();
    }
});
