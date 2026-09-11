import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Matrix4, Mesh, PerspectiveCamera, Quaternion, Vector3, WebGPUCoordinateSystem } from 'three/webgpu';
import { CAMERA_POSITION, CAMERA_TARGET, createReferenceInstances, createThreeScene } from '../src/scene.ts';
import { packInstances } from '../../reference-renderer/src/primitives.ts';

test('reference primitives have finite invertible transforms and rest on the shared ground', () => {
    const instances = createReferenceInstances();
    assert.ok(instances.some(instance => instance.shape === 'cube'));
    assert.ok(instances.some(instance => instance.shape === 'sphere'));
    assert.doesNotThrow(() => packInstances(instances, instances.length));
    const bounds = instances.map(instance => {
        const matrix = new Matrix4().fromArray(Array.from(instance.transform));
        assert.ok(matrix.elements.every(Number.isFinite));
        assert.ok(matrix.determinant() > 0);
        assert.ok(instance.color.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
        return new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)).applyMatrix4(matrix);
    });
    const ground = bounds.find(box => box.getSize(new Vector3()).x > 5 && box.getSize(new Vector3()).y < 0.5);
    assert.ok(ground, 'the scene needs a broad, thin ground slab');
    assert.ok(Math.abs(ground.max.y) < 0.05);
    for (const box of bounds.filter(box => box !== ground)) {
        assert.ok(Math.abs(box.min.y - ground.max.y) < 0.05, 'primitives should sit just above the slab');
        assert.ok(box.min.x >= ground.min.x && box.max.x <= ground.max.x);
        assert.ok(box.min.z >= ground.min.z && box.max.z <= ground.max.z);
    }
    const again = createReferenceInstances();
    assert.deepEqual(again, instances);
    assert.notEqual(again[0].transform, instances[0].transform, 'each scene owns its transform arrays');
});

test('Three columns are grounded, the ring is elevated, and owned assets are disposed once', t => {
    const content = createThreeScene();
    t.after(() => content.scene.clear());
    const meshes = content.scene.children.filter((object): object is Mesh => object instanceof Mesh);
    const columns = meshes.filter(mesh => mesh.geometry.type === 'CylinderGeometry');
    const rings = meshes.filter(mesh => mesh.geometry.type === 'TorusGeometry');
    assert.equal(columns.length, 3);
    assert.equal(rings.length, 1);
    for (const column of columns) {
        const bounds = new Box3().setFromObject(column);
        assert.ok(Math.abs(bounds.min.y) < 1e-6);
        assert.ok(bounds.max.y > 0.5 && bounds.max.y < 3);
    }
    const ringBounds = new Box3().setFromObject(rings[0]);
    assert.ok(ringBounds.max.y > 3);
    assert.ok(ringBounds.min.y > -0.05);
    const geometries = new Set(meshes.map(mesh => mesh.geometry));
    const materials = new Set(meshes.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
    const disposals = [...geometries, ...materials].map(asset => t.mock.method(asset, 'dispose'));
    content.dispose();
    assert.equal(content.scene.children.length, 0);
    assert.ok(disposals.every(dispose => dispose.mock.callCount() === 1));
});

test('the shared camera frames the centers of both renderers procedural objects', () => {
    const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 100);
    camera.coordinateSystem = WebGPUCoordinateSystem;
    camera.position.set(...CAMERA_POSITION);
    camera.lookAt(...CAMERA_TARGET);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const content = createThreeScene();
    try {
        const centers = content.scene.children.filter(object => object instanceof Mesh).map(mesh => mesh.position.clone());
        for (const instance of createReferenceInstances()) {
            const center = new Vector3();
            new Matrix4().fromArray(Array.from(instance.transform)).decompose(center, new Quaternion(), new Vector3());
            centers.push(center);
        }
        for (const center of centers) {
            const clip = center.project(camera);
            assert.ok(Math.abs(clip.x) < 1 && Math.abs(clip.y) < 1 && clip.z > 0 && clip.z < 1,
                'each object center should be inside the shared camera frustum');
        }
    } finally {
        content.dispose();
    }
});
