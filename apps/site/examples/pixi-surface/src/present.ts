const shader = /* wgsl */ `
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Vertex {
    let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3))[index];
    var out: Vertex; out.position = vec4f(p,0,1); out.uv = p * vec2f(0.5,-0.5) + 0.5; return out;
}
@fragment fn fragmentMain(in: Vertex) -> @location(0) vec4f {
    let linear = max(textureSample(scene, sceneSampler, in.uv).rgb, vec3f(0));
    let srgb = select(1.055 * pow(linear, vec3f(1.0 / 2.4)) - 0.055, 12.92 * linear, linear <= vec3f(0.0031308));
    return vec4f(srgb, 1);
}`;
export function createPresenter(device: GPUDevice, format: GPUTextureFormat) {
    const module = device.createShaderModule({ label: 'surface.present.shader', code: shader });
    const pipeline = device.createRenderPipeline({ label: 'surface.present', layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] } });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    return {
        draw(pass: GPURenderPassEncoder, view: GPUTextureView) {
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: view }, { binding: 1, resource: sampler }] }));
            pass.draw(3);
        },
    };
}
