import type { ReferenceInstance } from './types.ts';

// Matches Instance in shaders.ts: mat4, padded mat3, color, center/shape, extent/orientation.
export const INSTANCE_FLOATS = 40;
export const INSTANCE_BYTES = INSTANCE_FLOATS * 4;
export const SHAPES = ['cube', 'sphere', 'plane'] as const;

export interface PrimitiveBatch {
    readonly firstIndex: number;
    readonly indexCount: number;
}

/** Unit cube, radius-0.5 sphere and unit XZ plane; positions and normals interleaved. */
export function generatePrimitives(): {
    vertices: Float32Array;
    indices: Uint32Array;
    batches: PrimitiveBatch[];
} {
    const vertices: number[] = [];
    const indices: number[] = [];
    const batches: PrimitiveBatch[] = [];
    const vertex = (p: number[], n: number[]): number => {
        const index = vertices.length / 6;
        vertices.push(...p, ...n);
        return index;
    };
    const quad = (n: number[], u: number[], v: number[], offset: number): void => {
        const base = vertices.length / 6;
        for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
            vertex(n.map((value, i) => value * offset + u[i] * x + v[i] * y), n);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const finish = (): void => {
        const firstIndex = batches.reduce((sum, batch) => sum + batch.indexCount, 0);
        batches.push({ firstIndex, indexCount: indices.length - firstIndex });
    };
    quad([1, 0, 0], [0, 1, 0], [0, 0, 1], 0.5);
    quad([-1, 0, 0], [0, 0, 1], [0, 1, 0], 0.5);
    quad([0, 1, 0], [0, 0, 1], [1, 0, 0], 0.5);
    quad([0, -1, 0], [1, 0, 0], [0, 0, 1], 0.5);
    quad([0, 0, 1], [1, 0, 0], [0, 1, 0], 0.5);
    quad([0, 0, -1], [0, 1, 0], [1, 0, 0], 0.5);
    finish();

    const base = vertices.length / 6;
    const segments = 16;
    const rings = 8;
    for (let y = 0; y <= rings; y++) {
        const latitude = Math.PI * y / rings;
        for (let x = 0; x <= segments; x++) {
            const longitude = 2 * Math.PI * x / segments;
            const n = [Math.sin(latitude) * Math.cos(longitude), Math.cos(latitude), Math.sin(latitude) * Math.sin(longitude)];
            vertex(n.map(value => value * 0.5), n);
        }
    }
    for (let y = 0; y < rings; y++) {
        for (let x = 0; x < segments; x++) {
            const a = base + y * (segments + 1) + x;
            const b = a + segments + 1;
            if (y !== 0) indices.push(a, a + 1, b);
            if (y !== rings - 1) indices.push(a + 1, b + 1, b);
        }
    }
    finish();
    quad([0, 1, 0], [0, 0, 1], [1, 0, 0], 0);
    finish();
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), batches };
}

/** Copies inputs and derives normal matrices and conservative world AABBs once per update. */
export function packInstances(instances: readonly ReferenceInstance[], maxInstances: number): Float32Array {
    if (instances.length > maxInstances) throw new Error(`Instance count exceeds capacity ${maxInstances}.`);
    const data = new Float32Array(instances.length * INSTANCE_FLOATS);
    const words = new Uint32Array(data.buffer);
    for (let i = 0; i < instances.length; i++) {
        const item = instances[i];
        const shape = SHAPES.indexOf(item.shape);
        if (shape < 0) throw new Error(`Unsupported primitive: ${item.shape}.`);
        const m = copyMatrix(item.transform, 'transform');
        if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) {
            throw new Error('Instance transform must be an affine matrix.');
        }
        // Columns of inverse-transpose(A): cross(b,c), cross(c,a), cross(a,b) / det(A).
        const a = [m[0], m[1], m[2]], b = [m[4], m[5], m[6]], c = [m[8], m[9], m[10]];
        const cross = (u: number[], v: number[]): number[] => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const bc = cross(b, c);
        const determinant = a.reduce((sum, value, axis) => sum + value * bc[axis], 0);
        if (!Number.isFinite(determinant) || determinant === 0) throw new Error('Instance transform must be invertible (no zero scale).');
        if (item.color.length !== 3 || item.color.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
            throw new Error('Instance color must contain three linear RGB values in [0, 1].');
        }
        const offset = i * INSTANCE_FLOATS;
        data.set(m, offset);
        for (const [column, normal] of [bc, cross(c, a), cross(a, b)].entries()) {
            data.set(normal.map(value => value / determinant), offset + 16 + column * 4);
        }
        data.set([...item.color, 1], offset + 28);
        data.set([m[12], m[13], m[14]], offset + 32);
        words[offset + 35] = shape;
        // abs(A) * local half extent handles rotation, non-uniform scale and shear.
        const half = shape === 2 ? [0.5, 0, 0.5] : [0.5, 0.5, 0.5];
        for (let axis = 0; axis < 3; axis++) {
            data[offset + 36 + axis] = Math.abs(m[axis]) * half[0] + Math.abs(m[4 + axis]) * half[1] + Math.abs(m[8 + axis]) * half[2];
        }
        // Reflections reverse triangle winding; preserve correct two-sided lighting.
        data[offset + 39] = Math.sign(determinant);
        // Check derived float32 values too: finite inputs can overflow during packing.
        for (let j = 0; j < INSTANCE_FLOATS; j++) {
            if (!Number.isFinite(data[offset + j])) throw new Error('Instance transform exceeds the float32 range.');
        }
    }
    return data;
}

export function copyMatrix(matrix: ArrayLike<number>, label: string): Float32Array {
    if (matrix.length !== 16) throw new Error(`${label} must contain 16 finite matrix values.`);
    const result = Float32Array.from(matrix);
    if (result.some(value => !Number.isFinite(value))) throw new Error(`${label} must contain 16 finite matrix values.`);
    return result;
}
