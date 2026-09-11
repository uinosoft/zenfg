import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoInstances } from '../src/scene.ts';
import { createViewProjection } from '../src/camera.ts';

function project(matrix: Float32Array, point: readonly number[]): number[] {
    const clip = Array.from({ length: 4 }, (_, row) => (
        matrix[row] * point[0] + matrix[4 + row] * point[1] + matrix[8 + row] * point[2] + matrix[12 + row]
    ));
    return clip.slice(0, 3).map(value => value / clip[3]);
}

test('demo camera maps the same near/far planes to both WebGPU depth conventions', () => {
    const camera = { azimuth: 0, polar: Math.PI / 2, distance: 46 };
    for (const reverse of [false, true]) {
        const matrix = createViewProjection(camera, 16 / 9, reverse);
        const near = project(matrix, [0, 0, 45.9]);
        const far = project(matrix, [0, 0, -954]);
        assert.ok(Math.abs(near[2] - (reverse ? 1 : 0)) < 0.0001);
        assert.ok(Math.abs(far[2] - (reverse ? 0 : 1)) < 0.0001);
        const above = project(matrix, [0, 1, 0]);
        const right = project(matrix, [1, 0, 0]);
        assert.ok(above[1] > 0);
        assert.ok(right[0] > 0);
    }
});

test('demo camera orbit preserves centered framing and changes no projected depth convention', () => {
    const camera = { azimuth: 1.4, polar: 0.2, distance: 46 };
    const forward = project(createViewProjection(camera, 1, false), [0, 0, 0]);
    const reverse = project(createViewProjection(camera, 1, true), [0, 0, 0]);
    assert.ok(Math.abs(forward[0]) < 0.000001 && Math.abs(forward[1]) < 0.000001);
    assert.ok(Math.abs(forward[2] + reverse[2] - 1) < 0.000001);
});

test('demo instances are deterministic, use all three shapes, and accept an empty scene', () => {
    assert.deepEqual(createDemoInstances(0), []);
    const instances = createDemoInstances(10);
    assert.deepEqual(instances, createDemoInstances(10));
    assert.equal(instances.length, 10);
    assert.deepEqual(new Set(instances.map(instance => instance.shape)), new Set(['cube', 'sphere', 'plane']));
    assert.ok(instances.every(instance => Array.from(instance.transform).every(Number.isFinite)));
});
