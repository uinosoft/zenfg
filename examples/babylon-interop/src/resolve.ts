import { TextureAccess, type FrameGraphRecording, type TextureHandle } from '@zenfg/webgpu';

const shader = /* wgsl */ `
@group(0) @binding(0) var color: texture_2d<f32>;
@group(0) @binding(1) var depth: texture_depth_2d;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let positions = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(positions[index], 0, 1);
}
struct Output { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> Output {
    let xy = vec2i(i32(position.x), i32(textureDimensions(depth).y) - 1 - i32(position.y));
    return Output(textureLoad(color, xy, 0), textureLoad(depth, xy, 0));
}
`;

/** Normalize Babylon RTT orientation for native WebGPU draws, preserving linear color and depth. */
export function createAttachmentResolver(device: GPUDevice) {
    const module = device.createShaderModule({ label: 'babylon-interop.resolve.shader', code: shader });
    const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ] });
    const pipeline = device.createRenderPipeline({
        label: 'babylon-interop.resolve.pipeline', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
    });
    return (frame: FrameGraphRecording, nativeColor: TextureHandle, nativeDepth: TextureHandle, color: TextureHandle, depth: TextureHandle, reverseZ: boolean): void => {
        const colorUse = frame.use(nativeColor, TextureAccess.Sampled);
        const depthUse = frame.use(nativeDepth, TextureAccess.Sampled);
        frame.render({
            label: 'babylon-interop.resolve', uses: [colorUse, depthUse],
            colorAttachments: [{ target: color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
            depthStencilAttachment: { target: depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: reverseZ ? 0 : 1 },
            encode: ({ pass, unwrap }) => {
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, device.createBindGroup({ layout, entries: [
                    { binding: 0, resource: unwrap(colorUse) }, { binding: 1, resource: unwrap(depthUse) },
                ] }));
                pass.draw(3);
            },
        });
    };
}
export type AttachmentResolver = ReturnType<typeof createAttachmentResolver>;
