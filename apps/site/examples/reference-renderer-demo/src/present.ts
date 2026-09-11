import { TextureAccess, type FrameGraphRecording, type TextureHandle } from '@zenfg/webgpu';

const presentShader = /* wgsl */ `
@group(0) @binding(0) var scene: texture_2d<f32>;

@vertex fn vertexMain(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    let positions = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(positions[vertex], 0, 1);
}

@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let linear = max(textureLoad(scene, vec2i(position.xy), 0).rgb, vec3f(0));
    let srgb = select(1.055 * pow(linear, vec3f(1.0 / 2.4)) - 0.055, 12.92 * linear, linear <= vec3f(0.0031308));
    return vec4f(srgb, 1);
}
`;

/** The host converts linear scene color to the canvas encoding exactly once. */
export function createPresenter(device: GPUDevice, format: GPUTextureFormat) {
    const module = device.createShaderModule({ label: 'reference.present.shader', code: presentShader });
    const pipeline = device.createRenderPipeline({
        label: 'reference.present.pipeline',
        layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
    });
    return (frame: FrameGraphRecording, scene: TextureHandle, backbuffer: TextureHandle): void => {
        const sample = frame.use(scene, TextureAccess.Sampled);
        frame.render({
            label: 'reference.present',
            uses: [sample],
            colorAttachments: [{ target: backbuffer, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
            encode: ({ pass, unwrap }) => {
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, device.createBindGroup({
                    layout: pipeline.getBindGroupLayout(0),
                    entries: [{ binding: 0, resource: unwrap(sample) }],
                }));
                pass.draw(3);
            },
        });
    };
}
