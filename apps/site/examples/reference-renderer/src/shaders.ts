import type { PrimitiveBatch } from './primitives.ts';

// Explicit layouts are shared by the small compute and render shaders.
const frameStruct = /* wgsl */ `
struct Frame {
    view_projection: mat4x4f,
    planes: array<vec4f, 6>,
    instance_count: u32,
    visible_stride: u32,
    culling: u32,
    _pad: u32,
};
`;

const instanceStruct = /* wgsl */ `
struct Instance {
    model: mat4x4f,
    normal: mat3x3f,
    color: vec4f,
    center: vec3f,
    shape: u32,
    extent: vec3f,
    orientation: f32,
};
`;

const indirectStruct = /* wgsl */ `
struct DrawArgs {
    index_count: u32,
    instance_count: atomic<u32>,
    first_index: u32,
    base_vertex: i32,
    first_instance: u32,
};
`;

export function createShaderSources(batches: readonly PrimitiveBatch[]): {
    reset: string;
    cull: string;
    draw: string;
} {
    return {
        reset: /* wgsl */ `
${indirectStruct}
@group(0) @binding(0) var<storage, read_write> args: array<DrawArgs, 3>;
@group(0) @binding(1) var<storage, read_write> visible: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < arrayLength(&visible)) { visible[id.x] = 0u; }
    if (id.x < 3u) {
        let counts = array<u32, 3>(${batches.map(batch => `${batch.indexCount}u`).join(', ')});
        let offsets = array<u32, 3>(${batches.map(batch => `${batch.firstIndex}u`).join(', ')});
        args[id.x].index_count = counts[id.x];
        atomicStore(&args[id.x].instance_count, 0u);
        args[id.x].first_index = offsets[id.x];
        args[id.x].base_vertex = 0;
        args[id.x].first_instance = 0u;
    }
}
`,
        cull: /* wgsl */ `
${frameStruct}
${instanceStruct}
${indirectStruct}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var<storage, read_write> args: array<DrawArgs, 3>;
@group(0) @binding(3) var<storage, read_write> visible: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= frame.instance_count) { return; }
    let item = instances[id.x];
    if (frame.culling != 0u) {
        for (var i = 0u; i < 6u; i++) {
            let plane = frame.planes[i];
            let distance = dot(plane.xyz, item.center) + plane.w;
            let radius = dot(abs(plane.xyz), item.extent);
            // A small tolerance retains objects touching a clip plane.
            if (distance + radius < -0.00001) { return; }
        }
    }
    let slot = atomicAdd(&args[item.shape].instance_count, 1u);
    visible[item.shape * frame.visible_stride + slot] = id.x;
}
`,
        draw: /* wgsl */ `
${frameStruct}
${instanceStruct}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
// Each draw binds just its shape's aligned segment; firstInstance stays zero.
@group(0) @binding(2) var<storage, read> visible: array<u32>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) color: vec3f,
};

@vertex
fn vertex_main(
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    let item = instances[visible[instance_index]];
    var result: VertexOutput;
    result.position = frame.view_projection * item.model * vec4f(position, 1.0);
    result.normal = item.normal * normal * item.orientation;
    result.color = item.color.rgb;
    return result;
}

@fragment
fn fragment_main(input: VertexOutput, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    let normal = normalize(input.normal) * select(-1.0, 1.0, front);
    let light = normalize(vec3f(1.0, 2.0, 3.0));
    let brightness = 0.25 + 0.75 * max(dot(normal, light), 0.0);
    return vec4f(input.color * brightness, 1.0);
}
`,
    };
}
