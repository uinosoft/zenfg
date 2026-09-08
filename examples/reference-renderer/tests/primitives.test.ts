import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePrimitives, INSTANCE_BYTES, INSTANCE_FLOATS, packInstances } from '../src/primitives.ts';
import type { ReferenceInstance } from '../src/types.ts';

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const instance = (shape: ReferenceInstance['shape'] = 'cube'): ReferenceInstance => ({ shape, transform: identity(), color: [0.2, 0.4, 0.6] });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('primitive batches cover globally indexed triangles with outward unit normals', () => {
	const { vertices, indices, batches } = generatePrimitives();
	assert.equal(batches.length, 3);
	assert.equal(vertices.length % 6, 0);
	assert.equal(indices.length % 3, 0);
	assert.equal(batches[0].firstIndex, 0);
	for (let batch = 0; batch < batches.length; batch++) {
		assert.ok(batches[batch].indexCount > 0);
		assert.equal(batches[batch].indexCount % 3, 0);
		const end = batches[batch].firstIndex + batches[batch].indexCount;
		assert.equal(end, batches[batch + 1]?.firstIndex ?? indices.length);
	}
	for (let vertex = 0; vertex < vertices.length; vertex += 6) {
		assert.ok(Array.from(vertices.subarray(vertex, vertex + 6)).every(Number.isFinite));
		close(Math.hypot(...vertices.subarray(vertex + 3, vertex + 6)), 1);
	}
	for (let triangle = 0; triangle < indices.length; triangle += 3) {
		const [a, b, c] = Array.from(indices.subarray(triangle, triangle + 3));
		assert.ok([a, b, c].every(index => index < vertices.length / 6));
		const ab = [0, 1, 2].map(axis => vertices[b * 6 + axis] - vertices[a * 6 + axis]);
		const ac = [0, 1, 2].map(axis => vertices[c * 6 + axis] - vertices[a * 6 + axis]);
		const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
		assert.ok(Math.hypot(...normal) > 1e-8, 'triangles must not collapse at sphere poles');
		const alignment = normal.reduce((sum, value, axis) => sum + value * vertices[a * 6 + 3 + axis], 0);
		assert.ok(alignment > 0, 'triangle winding must agree with its shading normal');
	}
});

test('packed layout matches the shader stride, preserves IDs and copies source transforms', () => {
	const instances = [instance('cube'), instance('sphere'), instance('plane')];
	const packed = packInstances(instances, 3);
	assert.equal(INSTANCE_FLOATS, 40);
	assert.equal(INSTANCE_BYTES, 160);
	assert.equal(packed.length, 3 * INSTANCE_FLOATS);
	const words = new Uint32Array(packed.buffer);
	assert.deepEqual(instances.map((_, index) => words[index * INSTANCE_FLOATS + 35]), [0, 1, 2]);
	for (let index = 0; index < 3; index++) {
		const offset = index * INSTANCE_FLOATS;
		assert.deepEqual(packed.subarray(offset, offset + 16), identity());
		[0.2, 0.4, 0.6, 1].forEach((value, axis) => close(packed[offset + 28 + axis], value));
		assert.deepEqual(Array.from(packed.subarray(offset + 36, offset + 39)), index === 2 ? [0.5, 0, 0.5] : [0.5, 0.5, 0.5]);
		assert.equal(packed[offset + 39], 1, 'ordinary transforms preserve triangle orientation');
	}
	(instances[0].transform as Float32Array).fill(42);
	assert.deepEqual(packed.subarray(0, 16), identity());
	assert.equal(packInstances([], 3).length, 0);
});

test('inverse transpose and conservative bounds remain correct for nonuniform scale, shear and reflection', () => {
	const transform = new Float32Array([-2, 0, 0, 0, 1, 3, 0, 0, 0, 0.5, 4, 0, 5, -2, 7, 1]);
	for (const shape of ['cube', 'sphere', 'plane'] as const) {
		const packed = packInstances([{ ...instance(shape), transform }], 1);
		assert.deepEqual(Array.from(packed.subarray(32, 35)), [5, -2, 7]);
		assert.equal(packed[39], -1, 'reflection parity lets two-sided shading follow transformed triangle winding');
		for (let normalColumn = 0; normalColumn < 3; normalColumn++) {
			for (let tangentColumn = 0; tangentColumn < 3; tangentColumn++) {
				const dot = [0, 1, 2].reduce((sum, axis) => sum + packed[16 + normalColumn * 4 + axis] * transform[tangentColumn * 4 + axis], 0);
				close(dot, normalColumn === tangentColumn ? 1 : 0);
			}
		}
		const half = shape === 'plane' ? [0.5, 0, 0.5] : [0.5, 0.5, 0.5];
		for (const x of [-half[0], half[0]]) for (const y of [-half[1], half[1]]) for (const z of [-half[2], half[2]]) {
			for (let axis = 0; axis < 3; axis++) {
				const world = transform[axis] * x + transform[4 + axis] * y + transform[8 + axis] * z + transform[12 + axis];
				assert.ok(Math.abs(world - packed[32 + axis]) <= packed[36 + axis] + 1e-6);
			}
		}
	}
});

test('packing rejects invalid shapes, transforms and colors before GPU upload', () => {
	assert.throws(() => packInstances([instance(), instance()], 1), /capacity/i);
	assert.throws(() => packInstances([{ ...instance(), shape: 'torus' } as unknown as ReferenceInstance], 1), /primitive|shape/i);
	for (const transform of [new Float32Array(15), identity().fill(Number.NaN), identity().fill(Number.POSITIVE_INFINITY)]) {
		assert.throws(() => packInstances([{ ...instance(), transform }], 1), /matrix|transform|finite/i);
	}
	const perspective = identity(); perspective[3] = 1;
	assert.throws(() => packInstances([{ ...instance(), transform: perspective }], 1), /affine/i);
	const singular = identity(); singular[0] = 0;
	assert.throws(() => packInstances([{ ...instance(), transform: singular }], 1), /invertible|scale/i);
	for (const color of [[-0.1, 0, 0], [1.1, 0, 0], [Number.NaN, 0, 0], [0, 0]]) {
		assert.throws(() => packInstances([{ ...instance(), color } as unknown as ReferenceInstance], 1), /color|RGB/i);
	}
});
