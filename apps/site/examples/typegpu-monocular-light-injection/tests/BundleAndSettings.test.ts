import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonocularLightInjection } from '../src/index.ts';
import { fakeDevice, installWebGpuGlobals } from './fakeWebGpu.ts';
import { parseDepthBundle } from '../src/inference/bundle.ts';

const HEADER_BYTES = 48;
const ALIGNMENT = 256;

function bundleBytes(patch: Record<string, unknown> = {}, payloadBytes = 0): ArrayBuffer {
    const manifest = {
        model: 'depthart-relative-s-448',
        precision: 'f32-reference',
        input: {
            kind: 'srgb-image', tensorId: 'input', colorSpace: 'rgb', resize: 'cubic-warp',
            mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
        },
        output: { kind: 'relative-disparity', tensorId: 'output', resize: 'bilinear-align-corners' },
        tensors: [
            { id: 'input', shape: [1, 4, 2, 2], dtype: 'f32', layout: 'hwc4', byteLength: 64, storage: { kind: 'input' } },
            { id: 'output', shape: [1, 4, 2, 2], dtype: 'f32', layout: 'hwc4', byteLength: 64, storage: { kind: 'output' } },
        ],
        slots: [],
        dispatches: [],
        weightSections: [],
        ...patch,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const payloadOffset = Math.ceil((HEADER_BYTES + manifestBytes.length) / ALIGNMENT) * ALIGNMENT;
    const buffer = new ArrayBuffer(payloadOffset + payloadBytes);
    const bytes = new Uint8Array(buffer);
    bytes.set(new TextEncoder().encode('DARTBND\0'));
    const view = new DataView(buffer);
    view.setUint32(8, 1, true);
    view.setUint32(24, manifestBytes.length, true);
    bytes.set(manifestBytes, HEADER_BYTES);
    return buffer;
}

test('parseDepthBundle validates boundaries and builds zero-copy lookup tables', () => {
    const buffer = bundleBytes({
        weightSections: [{ id: 'weights', byteOffset: 0, byteLength: 4 }],
    }, 4);
    new Uint8Array(buffer).set([1, 2, 3, 4], buffer.byteLength - 4);
    const bundle = parseDepthBundle(buffer);
    assert.equal(bundle.output.polarity, 'direct');
    assert.equal(bundle.tensorById.get('output')?.byteLength, 64);
    assert.deepEqual([...bundle.weightSectionById.get('weights')!.bytes], [1, 2, 3, 4]);

    assert.throws(() => parseDepthBundle(new ArrayBuffer(20)), /DepthART v1/);
    assert.throws(() => parseDepthBundle(bundleBytes({
        weightSections: [{ id: 'weights', byteOffset: 4, byteLength: 8 }],
    }, 4)), /payload boundary/);
    assert.throws(() => parseDepthBundle(bundleBytes({
        tensors: [
            { id: 'same', shape: [1], dtype: 'f32', layout: 'raw', byteLength: 4, storage: { kind: 'input' } },
            { id: 'same', shape: [1], dtype: 'f32', layout: 'raw', byteLength: 4, storage: { kind: 'output' } },
        ],
    })), /identifiers must be non-empty and unique/);
});

test('settings are copied and validated without exposing TypeGPU values', async () => {
    const restore = installWebGpuGlobals();
    try {
    const feature = await createMonocularLightInjection({ device: fakeDevice(), outputFormat: 'bgra8unorm' });
    const settings = feature.getSettings();
    assert.equal(settings.mode, 'relit');
    assert.deepEqual(settings.lightPosition, [0.34, 0.34]);
    feature.setSettings({ mode: 'normals', lightPosition: [0.2, 0.8], specular: 0.7 });
    assert.deepEqual(feature.getSettings(), { ...settings, mode: 'normals', lightPosition: [0.2, 0.8], specular: 0.7 });
    assert.throws(() => feature.setSettings({ intensity: Number.NaN }), /intensity/);
    assert.throws(() => feature.setSettings({ lightColor: [2, 0, 0] }), /lightColor/);
    feature.dispose();
    } finally { restore(); }
});

export { bundleBytes as createMinimalDepthBundleForTest };
