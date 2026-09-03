const frameParams = /* wgsl */ `
struct FrameParams {
	resolution: vec2f,
	field_resolution: vec2f,
	pointer: vec2f,
	pointer_velocity: vec2f,
	time: f32,
	delta_time: f32,
	aspect: f32,
	pointer_energy: f32,
	frame: f32,
	reduced_motion: f32,
	mobile: f32,
	_padding: f32,
};
`;

export const flowFieldShader = /* wgsl */ `
${frameParams}

@group(0) @binding(0) var<uniform> params: FrameParams;
@group(0) @binding(1) var flow_output: texture_storage_2d<rgba8unorm, write>;

fn hash21(p: vec2f) -> f32 {
	let q = fract(p * vec2f(123.34, 345.45));
	return fract((q.x + q.y) * (q.x + q.y + 34.345));
}

fn noise21(p: vec2f) -> f32 {
	let cell = floor(p);
	let local = fract(p);
	let curve = local * local * (3.0 - 2.0 * local);
	let a = hash21(cell);
	let b = hash21(cell + vec2f(1.0, 0.0));
	let c = hash21(cell + vec2f(0.0, 1.0));
	let d = hash21(cell + vec2f(1.0, 1.0));
	return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
}

fn fbm(p0: vec2f) -> f32 {
	var p = p0;
	var value = 0.0;
	var amplitude = 0.5;
	for (var octave = 0; octave < 4; octave += 1) {
		value += noise21(p) * amplitude;
		p = mat2x2f(1.62, 1.18, -1.18, 1.62) * p + vec2f(7.1, 3.7);
		amplitude *= 0.5;
	}
	return value;
}

@compute @workgroup_size(8, 8)
fn flow_main(@builtin(global_invocation_id) invocation: vec3u) {
	let size = textureDimensions(flow_output);
	if (any(invocation.xy >= size)) {
		return;
	}

	let uv = (vec2f(invocation.xy) + 0.5) / vec2f(size);
	var p = uv * 2.0 - 1.0;
	p.x *= params.aspect;
	let motion_time = params.time * mix(0.12, 0.0, params.reduced_motion);
	let domain = p * 1.35 + vec2f(motion_time, -motion_time * 0.62);
	let epsilon = 0.025;
	let dx = fbm(domain + vec2f(epsilon, 0.0)) - fbm(domain - vec2f(epsilon, 0.0));
	let dy = fbm(domain + vec2f(0.0, epsilon)) - fbm(domain - vec2f(0.0, epsilon));
	var flow = normalize(vec2f(dy, -dx) + vec2f(0.001, 0.0));

	var pointer_position = params.pointer * 2.0 - 1.0;
	pointer_position.x *= params.aspect;
	let to_pointer = pointer_position - p;
	let pointer_distance = length(to_pointer);
	let pointer_influence = exp(-pointer_distance * 3.7) * params.pointer_energy;
	let tangent = normalize(vec2f(-to_pointer.y, to_pointer.x) + vec2f(0.001, 0.0));
	let pointer_motion = vec2f(params.pointer_velocity.x * params.aspect, params.pointer_velocity.y);
	flow = normalize(flow + tangent * pointer_influence * 1.4 + pointer_motion * pointer_influence * 4.0);

	let turbulence = abs(dx) + abs(dy);
	let pulse = 0.5 + 0.5 * sin((p.x - p.y) * 3.2 + params.time * 0.42);
	let energy = clamp(turbulence * 3.6 + pulse * 0.2 + pointer_influence * 0.8, 0.0, 1.0);
	textureStore(flow_output, vec2i(invocation.xy), vec4f(flow * 0.5 + 0.5, energy, pointer_influence));
}
`;

const fullscreenVertex = /* wgsl */ `
struct VertexOutput {
	@builtin(position) position: vec4f,
};

@vertex
fn fullscreen_vertex(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
	let positions = array<vec2f, 3>(
		vec2f(-1.0, -1.0),
		vec2f(3.0, -1.0),
		vec2f(-1.0, 3.0),
	);
	var output: VertexOutput;
	output.position = vec4f(positions[vertex_index], 0.0, 1.0);
	return output;
}
`;

export const latticeShader = /* wgsl */ `
${fullscreenVertex}
${frameParams}

@group(0) @binding(0) var<uniform> params: FrameParams;
@group(0) @binding(1) var flow_texture: texture_2d<f32>;

fn field_at(uv: vec2f) -> vec4f {
	let size = vec2i(textureDimensions(flow_texture));
	let coordinate = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - vec2i(1));
	return textureLoad(flow_texture, coordinate, 0);
}

fn grid_line(point: vec2f, scale: f32, width: f32) -> f32 {
	let cell = abs(fract(point * scale) - 0.5);
	let distance_to_line = min(cell.x, cell.y);
	let antialias = max(fwidth(distance_to_line), 0.0005);
	return 1.0 - smoothstep(width, width + antialias * 1.4, distance_to_line);
}

fn node_field(point: vec2f, scale: f32) -> f32 {
	let cell = fract(point * scale) - 0.5;
	let distance_to_node = length(cell);
	let antialias = max(fwidth(distance_to_node), 0.001);
	return 1.0 - smoothstep(0.055, 0.055 + antialias * 2.0, distance_to_node);
}

fn hash12(point: vec2f) -> f32 {
	let q = fract(point * vec2f(123.34, 456.21));
	return fract((q.x + q.y) * (q.x + q.y + 45.32));
}

@fragment
fn lattice_fragment(input: VertexOutput) -> @location(0) vec4f {
	let uv = input.position.xy / params.resolution;
	let field = field_at(uv);
	let flow = field.xy * 2.0 - 1.0;
	let field_energy = field.z;
	let pointer_field = field.w;
	let motion_time = params.time * mix(1.0, 0.0, params.reduced_motion);

	var aspect_uv = uv - 0.5;
	aspect_uv.x *= params.aspect;
	let drift = flow * (0.018 + field_energy * 0.015);
	let warped = aspect_uv + drift + vec2f(motion_time * 0.006, -motion_time * 0.003);
	let counter_warped = aspect_uv - drift * 0.72 + vec2f(-motion_time * 0.003, motion_time * 0.002);

	let fine_grid = grid_line(warped + vec2f(sin(warped.y * 4.0) * 0.012, 0.0), 24.0, 0.022);
	let deep_grid = grid_line(counter_warped, 11.0, 0.012);
	let nodes = node_field(warped, 24.0);
	let node_seed = hash12(floor(warped * 24.0));
	let node_pulse = 0.42 + 0.58 * sin(node_seed * 6.283 + motion_time * 1.15) * 0.5 + 0.29;

	let diagonal_a = abs(warped.y + sin(warped.x * 3.2 + motion_time * 0.22) * 0.16);
	let diagonal_b = abs(counter_warped.y - 0.2 + sin(counter_warped.x * 4.8 - motion_time * 0.17) * 0.11);
	let ribbon_a = exp(-diagonal_a * 11.0) * (0.42 + field_energy * 0.72);
	let ribbon_b = exp(-diagonal_b * 18.0) * 0.55;

	// Anchor the composition in height-relative stage space so ultrawide
	// viewports reveal darker margins instead of stretching the focal area.
	let horizontal_fade = smoothstep(-0.67, 0.37, aspect_uv.x);
	let edge_fade = smoothstep(0.0, 0.11, uv.x) * smoothstep(1.0, 0.88, uv.x);
	let vertical_fade = smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.84, uv.y);
	let stage_fade = 1.0 - smoothstep(0.78, 1.18, abs(aspect_uv.x - 0.12));
	let content_guard = mix(0.20, 1.0, smoothstep(-0.08, 0.42, aspect_uv.x));
	let mobile_guard = mix(1.0, 0.72, params.mobile);
	let visibility = edge_fade * vertical_fade * stage_fade * mobile_guard;

	let cyan = vec3f(0.12, 0.69, 0.91);
	let azure = vec3f(0.12, 0.31, 0.66);
	let mint = vec3f(0.18, 0.84, 0.70);
	let amber = vec3f(0.96, 0.55, 0.22);
	var color = vec3f(0.012, 0.024, 0.037);
	color += azure * ribbon_a * 0.105 * horizontal_fade;
	color += mint * ribbon_b * 0.035 * horizontal_fade;
	color += cyan * fine_grid * (0.032 + field_energy * 0.060) * content_guard;
	color += azure * deep_grid * 0.042 * content_guard;
	color += mix(cyan, amber, step(0.88, node_seed)) * nodes * node_pulse * 0.28 * content_guard;

	var pointer_position = params.pointer - 0.5;
	pointer_position.x *= params.aspect;
	let pointer_distance = length(aspect_uv - pointer_position);
	let wave_phase = fract(motion_time * 0.16);
	let ripple_radius = 0.06 + wave_phase * 0.34;
	let ripple = exp(-abs(pointer_distance - ripple_radius) * 75.0) * (1.0 - wave_phase);
	let pointer_halo = exp(-pointer_distance * 8.0) * pointer_field;
	color += cyan * (ripple * 0.16 + pointer_halo * 0.11) * params.pointer_energy;

	let horizon = exp(-abs(uv.y - 0.68 - flow.x * 0.025) * 26.0);
	color += mix(azure, cyan, uv.x) * horizon * 0.025 * horizontal_fade;
	let right_boost = 1.0 + smoothstep(0.02, 0.52, aspect_uv.x) * 0.22;
	color = vec3f(0.012, 0.024, 0.037) + (color - vec3f(0.012, 0.024, 0.037)) * right_boost;
	color *= visibility;
	color += vec3f(0.002, 0.004, 0.006) * (1.0 - visibility);
	return vec4f(color, 1.0);
}
`;

export const compositeShader = /* wgsl */ `
${fullscreenVertex}
${frameParams}

@group(0) @binding(0) var<uniform> params: FrameParams;
@group(0) @binding(1) var scene_texture: texture_2d<f32>;

fn scene_at(pixel: vec2i) -> vec3f {
	let size = vec2i(textureDimensions(scene_texture));
	return textureLoad(scene_texture, clamp(pixel, vec2i(0), size - vec2i(1)), 0).rgb;
}

fn hash11(value: f32) -> f32 {
	return fract(sin(value * 91.3458) * 47453.5453);
}

@fragment
fn composite_fragment(input: VertexOutput) -> @location(0) vec4f {
	let pixel = vec2i(input.position.xy);
	let uv = input.position.xy / params.resolution;
	let center = scene_at(pixel);
	let bloom_near = (
		scene_at(pixel + vec2i(3, 0)) +
		scene_at(pixel - vec2i(3, 0)) +
		scene_at(pixel + vec2i(0, 3)) +
		scene_at(pixel - vec2i(0, 3))
	) * 0.25;
	let bloom_far = (
		scene_at(pixel + vec2i(9, 6)) +
		scene_at(pixel + vec2i(-9, 6)) +
		scene_at(pixel + vec2i(9, -6)) +
		scene_at(pixel + vec2i(-9, -6))
	) * 0.25;
	let bloom = max(bloom_near * 0.68 + bloom_far * 0.32 - vec3f(0.025), vec3f(0.0));

	let aberration_strength = params.pointer_energy * exp(-distance(uv, params.pointer) * 5.0);
	let aberration_offset = vec2i(2, 0);
	let shifted_a = scene_at(pixel + aberration_offset);
	let shifted_b = scene_at(pixel - aberration_offset);
	var color = center + bloom * 0.52;
	color.r = mix(color.r, shifted_a.r, aberration_strength * 0.16);
	color.b = mix(color.b, shifted_b.b, aberration_strength * 0.19);

	let centered = uv * 2.0 - 1.0;
	let vignette = 1.0 - smoothstep(0.48, 1.28, dot(centered, centered));
	color *= 0.72 + vignette * 0.28;
	let grain = hash11(input.position.x + input.position.y * 173.0 + floor(params.frame * 0.5)) - 0.5;
	color += grain * 0.006 * mix(1.0, 0.2, params.reduced_motion);
	color = pow(max(color, vec3f(0.0)), vec3f(0.94));
	return vec4f(color, 1.0);
}
`;
