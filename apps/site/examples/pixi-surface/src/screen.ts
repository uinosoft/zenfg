import { screenVertices } from './scene.ts';
const shader = /* wgsl */ `
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var<uniform> matrix: mat4x4f;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var imageSampler: sampler;
@vertex fn vertexMain(@location(0) position: vec3f, @location(1) uv: vec2f) -> Vertex {
    var out: Vertex; out.position = matrix * vec4f(position, 1); out.uv = uv; return out;
}
@fragment fn fragmentMain(in: Vertex) -> @location(0) vec4f {
    return vec4f(textureSample(image, imageSampler, in.uv).rgb, 1);
}`;
export function createScreen(device: GPUDevice) {
    const module = device.createShaderModule({ label: 'surface.screen.shader', code: shader });
    const pipeline = device.createRenderPipeline({
        label: 'surface.screen', layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain', buffers: [{ arrayStride: 20,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' }] }] },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
    });
    const data = screenVertices();
    const vertices = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const matrix = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertices, 0, data);
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    return {
        update(value: Float32Array) { device.queue.writeBuffer(matrix, 0, value as Float32Array<ArrayBuffer>); },
        draw(pass: GPURenderPassEncoder, view: GPUTextureView) {
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: { buffer: matrix } }, { binding: 1, resource: view }, { binding: 2, resource: sampler },
            ] }));
            pass.setVertexBuffer(0, vertices); pass.draw(data.length / 5);
        },
        destroy() { vertices.destroy(); matrix.destroy(); },
    };
}
