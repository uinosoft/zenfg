import { glyph, bitmap, msdf, slug } from '@pmndrs/glyph';
import { defineTypeGpuConfig } from '@pmndrs/glyph/typegpu';
import tgpu, { d } from 'typegpu';
import fontUrl from '../assets/inter-latin.font.glb?url';
import shaperUrl from '@pmndrs/glyph/text-shaper.wasm?url';
import { textOptions, type GlyphSettings } from './settings.ts';

let initialization: Promise<void> | undefined;
let nextHandle = 0;
function initialize(): Promise<void> {
    // One shared shaping engine; handles, fonts and GPU resources remain mount-local.
    return initialization ??= fetch(shaperUrl).then(async response => {
        if (!response.ok) throw new Error('Glyph WASM: HTTP ' + response.status);
        await glyph.init({ wasm: await response.arrayBuffer() });
    }).catch(error => { initialization = undefined; throw error; });
}
/** Official Glyph integration; no renderer internals, custom codec or submission. */
export async function createGlyphLayer(device: GPUDevice, settings: GlyphSettings, signal?: AbortSignal) {
    await initialize();
    signal?.throwIfAborted();
    const root = tgpu.initFromDevice({ device });
    const matrix = root.createUniform(d.mat4x4f);
    const camera = tgpu.bindGroupLayout({ matrix: { uniform: d.mat4x4f } });
    const group = root.createBindGroup(camera, { matrix });
    const face = glyph.fontFace(fontUrl, { format: [bitmap({ strikes: [32, 64, 128] }), msdf, slug] });
    const handle = glyph.handle('zenfg:glyph:' + nextHandle++, defineTypeGpuConfig({
        root, format: 'rgba16float',
        depthStencil: { format: 'depth32float', depthCompare: 'less-equal', depthWriteEnabled: false },
        transformPosition: position => {
            'use gpu';
            return camera.$.matrix.mul(d.vec4f(position, 1));
        },
    }));
    let destroyed = false;
    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        signal?.removeEventListener('abort', destroy);
        handle.dispose();
        face.dispose();
        root.destroy();
    };
    signal?.addEventListener('abort', destroy, { once: true });
    try {
        await Promise.all([face.bitmap.load(), face.msdf.load(), face.slug.load()]);
        signal?.throwIfAborted();
        type Selection = typeof face.bitmap | typeof face.msdf | typeof face.slug;
        const text = handle.createText<Selection>({ font: face[settings.mode], ...textOptions(settings, 1) });
        const draw = handle.with(group);
        return {
            update(next: GlyphSettings, pixelRatio: number) {
                // Supply complete style/layout: the upstream update is intentionally shallow.
                text.update({ font: face[next.mode], ...textOptions(next, pixelRatio) });
                glyph.shape();
                return text.measure();
            },
            setMatrix(value: Float32Array) {
                matrix.write(d.mat4x4f(
                    value[0], value[1], value[2], value[3],
                    value[4], value[5], value[6], value[7],
                    value[8], value[9], value[10], value[11],
                    value[12], value[13], value[14], value[15],
                ));
            },
            draw(pass: GPURenderPassEncoder, width: number, height: number) { draw.draw(pass, { width, height }); },
            destroy,
        };
    } catch (error) { destroy(); throw error; }
}
