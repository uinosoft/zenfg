import { TextureAccess, type FrameGraphRecording, type TextureHandle } from '@zenfg/webgpu';

const shader = /* wgsl */ `
@group(0) @binding(0) var color: texture_2d<f32>;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let positions = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(positions[index], 0, 1);
}
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let encoded = textureLoad(color, vec2i(position.xy), 0);
    return vec4f(pow(max(encoded.rgb, vec3f(0)), vec3f(2.2)), encoded.a);
}
`;

/** Undo Lite PBR gamma encoding. Its earlier highlight clamp cannot be reversed. No Y flip. */
export function createAttachmentResolver(device: GPUDevice) {
    const module = device.createShaderModule({ label: 'babylon-lite-interop.linearize.shader', code: shader });
    const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    ] });
    const pipeline = device.createRenderPipeline({
        label: 'babylon-lite-interop.linearize.pipeline', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
    });
    return (frame: FrameGraphRecording, nativeColor: TextureHandle, color: TextureHandle): void => {
        const colorUse = frame.use(nativeColor, TextureAccess.Sampled);
        frame.render({
            label: 'babylon-lite-interop.linearize', uses: [colorUse],
            colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
            encode: ({ pass, unwrap }) => {
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, device.createBindGroup({ layout, entries: [{ binding: 0, resource: unwrap(colorUse) }] }));
                pass.draw(3);
            },
        });
    };
}
export type AttachmentResolver = ReturnType<typeof createAttachmentResolver>;
