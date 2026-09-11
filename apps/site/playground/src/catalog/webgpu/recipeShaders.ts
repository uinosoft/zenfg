export const colorShader = /* wgsl */ `
struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	var positions = array(
		vec2f(-1.0, -1.0),
		vec2f(3.0, -1.0),
		vec2f(-1.0, 3.0),
	);
	var output: VertexOutput;
	output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
	output.uv = output.position.xy * vec2f(0.5, -0.5) + 0.5;
	return output;
}

@fragment
fn sceneFragment(input: VertexOutput) -> @location(0) vec4f {
	let glow = 0.22 + 0.78 * (1.0 - distance(input.uv, vec2f(0.68, 0.38)));
	return vec4f(0.05 + input.uv.x * 0.16, 0.16 + glow * 0.34, 0.32 + glow * 0.62, 1.0);
}

@fragment
fn persistentFragment(input: VertexOutput) -> @location(0) vec4f {
	let band = 0.5 + 0.5 * sin((input.uv.x + input.uv.y) * 18.0);
	return vec4f(0.04, 0.18 + band * 0.22, 0.28 + band * 0.38, 1.0);
}

@fragment
fn externalFragment(input: VertexOutput) -> @location(0) vec4f {
	return vec4f(0.82 - input.uv.y * 0.36, 0.24 + input.uv.x * 0.34, 0.08, 1.0);
}
`;

export const presentShader = /* wgsl */ `
struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@group(0) @binding(0) var imageSampler: sampler;
@group(0) @binding(1) var imageTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	var positions = array(
		vec2f(-1.0, -1.0),
		vec2f(3.0, -1.0),
		vec2f(-1.0, 3.0),
	);
	var output: VertexOutput;
	output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
	output.uv = output.position.xy * vec2f(0.5, -0.5) + 0.5;
	return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
	return textureSample(imageTexture, imageSampler, input.uv);
}
`;

export const importedUniformShader = /* wgsl */ `
struct Uniforms {
	color: vec4f,
};

struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	var positions = array(
		vec2f(-1.0, -1.0),
		vec2f(3.0, -1.0),
		vec2f(-1.0, 3.0),
	);
	var output: VertexOutput;
	output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
	output.uv = output.position.xy * vec2f(0.5, -0.5) + 0.5;
	return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
	let vignette = 1.0 - 0.46 * distance(input.uv, vec2f(0.5));
	return vec4f(uniforms.color.rgb * vignette, uniforms.color.a);
}
`;

export const computeOutputShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> output: array<u32>;

@compute @workgroup_size(16)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
	output[id.x] = id.x * 17u;
}
`;

export const computePresentationShader = /* wgsl */ `
struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@group(0) @binding(0) var<storage, read> output: array<u32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	var positions = array(
		vec2f(-1.0, -1.0),
		vec2f(3.0, -1.0),
		vec2f(-1.0, 3.0),
	);
	var vertex: VertexOutput;
	vertex.position = vec4f(positions[vertexIndex], 0.0, 1.0);
	vertex.uv = vertex.position.xy * vec2f(0.5, -0.5) + 0.5;
	return vertex;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
	let computed = vec3f(f32(output[5]), f32(output[10]), f32(output[15])) / 255.0;
	let shade = 0.62 + 0.38 * (1.0 - distance(input.uv, vec2f(0.5)));
	return vec4f(computed * shade, 1.0);
}
`;
