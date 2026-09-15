import { TextureAccess, type FrameGraphRecording, type TextureHandle } from '@zenfg/webgpu';

export const compositeShader = /* wgsl */ `
@group(0) @binding(0) var referenceColor: texture_2d<f32>;
@group(0) @binding(1) var splatColor: texture_2d<f32>;
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    let positions = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(positions[vertex], 0, 1);
}
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let linear = clamp(textureLoad(referenceColor, vec2i(position.xy), 0).rgb, vec3f(0), vec3f(1));
    let splat = textureLoad(splatColor, vec2i(position.xy), 0);
    // PlayCanvas 2.21.4 blends premultiplied colors in gamma-2.2 space.
    let mixed = splat.rgb + pow(linear, vec3f(1.0 / 2.2)) * (1.0 - splat.a);
    let result = pow(max(mixed, vec3f(0)), vec3f(2.2));
    let srgb = select(1.055 * pow(result, vec3f(1.0 / 2.4)) - 0.055, 12.92 * result, result <= vec3f(0.0031308));
    return vec4f(srgb, 1);
}
`;

export function createComposite(device: GPUDevice, format: GPUTextureFormat, label: string) {
    const module = device.createShaderModule({ code: compositeShader });
    const pipeline = device.createRenderPipeline({ layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list' } });
    return (frame: FrameGraphRecording, color: TextureHandle, splat: TextureHandle, target: TextureHandle) => {
        const a = frame.use(color, TextureAccess.Sampled), b = frame.use(splat, TextureAccess.Sampled);
        frame.render({ label: label + '.composite-present', uses: [a, b],
            colorAttachments: [{ target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
            encode({ pass, unwrap }) {
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
                    entries: [{ binding: 0, resource: unwrap(a) }, { binding: 1, resource: unwrap(b) }] }));
                pass.draw(3);
            } });
    };
}
