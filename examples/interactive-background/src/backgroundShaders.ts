// Kept as TypeScript strings so the showcase remains a self-contained browser module.
const frameParams = /* wgsl */ `
struct FrameParams {
	resolution: vec2f,
	field_resolution: vec2f,
	pointer: vec2f,
	pointer_velocity: vec2f,
	time: f32,
	delta_time: f32,
	aspect: f32,
	pointer_pressure: f32,
	frame: f32,
	reduced_motion: f32,
	pointer_expansion: f32,
	coarse_pointer: f32,
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
	let pointer_influence = exp(-pointer_distance * 3.7) * params.pointer_pressure;
	let tangent = normalize(vec2f(-to_pointer.y, to_pointer.x) + vec2f(0.001, 0.0));
	let pointer_motion = vec2f(params.pointer_velocity.x * params.aspect, params.pointer_velocity.y);
	flow = normalize(flow + tangent * pointer_influence * 1.4 + pointer_motion * pointer_influence * 4.0);

	let turbulence = abs(dx) + abs(dy);
	let pulse = 0.5 + 0.5 * sin((p.x - p.y) * 3.2 + params.time * 0.42 * (1.0 - params.reduced_motion));
	let energy = clamp(turbulence * 3.6 + pulse * 0.2 + pointer_influence * 0.8, 0.0, 1.0);
	textureStore(flow_output, vec2i(invocation.xy), vec4f(flow * 0.5 + 0.5, energy, pointer_influence));
}
`;

const fullscreenVertex = /* wgsl */ `
struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@vertex
fn fullscreen_vertex(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
	let positions = array<vec2f, 3>(
		vec2f(-1.0, -1.0),
		vec2f(3.0, -1.0),
		vec2f(-1.0, 3.0),
	);
	let uvs = array<vec2f, 3>(
		vec2f(0.0, 1.0),
		vec2f(2.0, 1.0),
		vec2f(0.0, -1.0),
	);
	var output: VertexOutput;
	output.position = vec4f(positions[vertex_index], 0.0, 1.0);
	output.uv = uvs[vertex_index];
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
	let uv = input.uv;
	let field = field_at(uv);
	let flow = field.xy * 2.0 - 1.0;
	let field_energy = field.z;
	let pointer_field = field.w;
	let motion_time = params.time * (1.0 - params.reduced_motion);

	var aspect_uv = uv - 0.5;
	aspect_uv.x *= params.aspect;
	var pointer_position = params.pointer - 0.5;
	pointer_position.x *= params.aspect;
	let pointer_delta = aspect_uv - pointer_position;
	let pointer_distance = length(pointer_delta);
	let pointer_direction = normalize(pointer_delta + vec2f(0.0001, 0.0));
	let pointer_tangent = vec2f(-pointer_direction.y, pointer_direction.x);
	let pointer_motion = vec2f(params.pointer_velocity.x * params.aspect, params.pointer_velocity.y);
	let pressure_contraction = params.pointer_pressure * params.pointer_pressure
		* (3.0 - 2.0 * params.pointer_pressure);
	let lens_radius = mix(0.245, 0.081, pressure_contraction);
	let lens_distance = pointer_distance / max(lens_radius, 0.0001);
	let lens_envelope = max(
		exp(-lens_distance * lens_distance * 1.8) * params.pointer_pressure,
		pointer_field * 0.52,
	);
	let lens_profile = lens_distance * exp(0.5 - lens_distance * lens_distance * 1.8) * params.pointer_pressure;
	let lens_angle = atan2(pointer_direction.y, pointer_direction.x);
	let edge_irregularity = sin(lens_angle * 5.0 + motion_time * 0.52) * 0.055
		+ sin(lens_angle * 9.0 - motion_time * 0.31 + field_energy * 2.4) * 0.025;
	let edge_band = exp(-pow(lens_distance + edge_irregularity - 0.90, 2.0) * 92.0)
		* params.pointer_pressure;
	let edge_asymmetry = 0.34 + 0.66
		* pow(0.5 + 0.5 * sin(lens_angle * 3.0 - motion_time * 0.37 + field_energy * 5.0), 2.0);
	let pointer_warp = pointer_direction * lens_profile * 0.064
		+ pointer_tangent * lens_envelope * 0.021
		+ pointer_motion * lens_envelope * 0.22
		+ (pointer_direction * 0.024 + pointer_tangent * 0.012) * edge_band * edge_asymmetry;
	let drift = flow * (0.018 + field_energy * 0.015);
	let warped = aspect_uv + drift + pointer_warp + vec2f(motion_time * 0.006, -motion_time * 0.003);
	let counter_warped = aspect_uv - drift * 0.72 - pointer_warp * 0.62 + vec2f(-motion_time * 0.003, motion_time * 0.002);

	let fine_grid = grid_line(warped + vec2f(sin(warped.y * 4.0) * 0.012, 0.0), 24.0, 0.022);
	let deep_grid = grid_line(counter_warped, 11.0, 0.012);
	let nodes = node_field(warped, 24.0);
	let node_cell = floor(warped * 24.0);
	let node_seed = hash12(node_cell);
	let node_phase = 0.5 + 0.5 * sin(node_seed * 6.283185 + motion_time * 0.72);
	let node_pulse = 0.42 + node_phase * 0.58;

	let diagonal_a = abs(warped.y + sin(warped.x * 3.2 + motion_time * 0.22) * 0.16);
	let diagonal_b = abs(counter_warped.y - 0.2 + sin(counter_warped.x * 4.8 - motion_time * 0.17) * 0.11);
	let ribbon_a = exp(-diagonal_a * 11.0) * (0.42 + field_energy * 0.72);
	let ribbon_b = exp(-diagonal_b * 18.0) * 0.55;

	let caustic_wave_a = sin(warped.x * 18.0 + warped.y * 9.0 + field_energy * 4.8 - motion_time * 0.72);
	let caustic_wave_b = sin(warped.y * 21.0 - warped.x * 7.0 - field_energy * 3.4 + motion_time * 0.49);
	let caustic_interference = abs(caustic_wave_a + caustic_wave_b) * 0.5;
	let caustic_ridge = pow(smoothstep(0.90, 0.995, caustic_interference), 4.0);
	let caustic_breakup = smoothstep(0.52, 0.86, field_energy + sin(warped.x * 6.0 - motion_time * 0.21) * 0.14);
	let caustic = caustic_ridge * caustic_breakup * (0.28 + fine_grid * 0.72);

	let glint_selector = step(0.935, node_seed);
	let glint_wave = max(0.0, sin(node_seed * 18.849556 + dot(node_cell, vec2f(0.19, 0.31)) + motion_time * 0.86));
	let glint_pulse = pow(glint_wave, 10.0);
	let amber_selector = step(0.92, hash12(node_cell + vec2f(31.7, 17.3)));
	let warm_node_selector = step(0.935, hash12(node_cell + vec2f(8.2, 4.7)));
	let flow_flash_phase = dot(warped + flow * 0.045, vec2f(12.0, -8.0)) + field_energy * 6.0 - motion_time * 0.62;
	let flow_flash = pow(max(0.0, sin(flow_flash_phase)), 8.0)
		* smoothstep(0.46, 0.82, field_energy) * (0.22 + fine_grid * 0.78);

	let content_guard = mix(0.30, 1.0, smoothstep(0.40, 0.72, uv.x));
	let edge_guard = smoothstep(0.02, 0.10, uv.x) * smoothstep(0.98, 0.90, uv.x)
		* smoothstep(0.02, 0.10, uv.y) * smoothstep(0.98, 0.90, uv.y);
	let mobile_guard = mix(1.0, 0.75, params.coarse_pointer);
	let highlight_guard = content_guard * edge_guard * mobile_guard;

	let cyan = vec3f(0.025, 0.42, 0.82);
	let azure = vec3f(0.018, 0.09, 0.32);
	let electric_blue = vec3f(0.025, 0.24, 0.62);
	let ice = vec3f(0.18, 0.72, 1.35);
	let amber = vec3f(1.45, 0.38, 0.055);
	let compression_heat = vec3f(1.62, 0.68, 0.060);
	let base = vec3f(0.0025, 0.0045, 0.0075);
	var color = base;
	color += azure * ribbon_a * 0.055;
	color += electric_blue * ribbon_b * 0.025;
	color += cyan * fine_grid * (0.008 + field_energy * 0.025);
	color += azure * deep_grid * 0.022;
	color += mix(cyan, amber, warm_node_selector) * nodes * node_pulse * 0.070;
	color += ice * caustic * (0.22 + field_energy * 0.42) * highlight_guard;
	color += electric_blue * flow_flash * 0.18 * highlight_guard;
	color += mix(ice, amber, amber_selector) * nodes * glint_selector * glint_pulse * 1.15 * highlight_guard;

	let pointer_visibility = params.pointer_pressure * params.pointer_pressure;
	let outer_halo = exp(-pow(lens_distance - 0.82, 2.0) * 92.0) * pointer_visibility;
	color += mix(electric_blue, cyan, 0.55) * outer_halo
		* (0.024 + fine_grid * 0.016) * mobile_guard;

	let charge_radius = lens_radius * 0.70;
	let charge_distance = pointer_distance / max(charge_radius, 0.0001);
	let charge_mask = exp(-charge_distance * charge_distance * 1.45)
		* (1.0 - smoothstep(0.85, 1.35, charge_distance)) * pointer_visibility;
	let charged_detail = fine_grid * 0.050
		+ deep_grid * 0.030
		+ nodes * node_pulse * 0.085
		+ caustic * 0.070
		+ flow_flash * 0.035
		+ (ribbon_a + ribbon_b) * 0.012;
	color += mix(electric_blue, ice, 0.42) * charged_detail * charge_mask * mobile_guard;

	let focus_radius = lens_radius * mix(0.59, 0.63, params.pointer_expansion);
	let refracted_edge_distance = abs(pointer_distance - focus_radius * (1.0 - edge_irregularity * 0.32));
	let refracted_edge = exp(-refracted_edge_distance * 96.0)
		* pointer_visibility * edge_asymmetry * (0.16 + fine_grid * 0.84);
	let pointer_core = exp(-pow(pointer_distance / max(lens_radius * 0.24, 0.0001), 2.0))
		* pointer_visibility * (0.42 + fine_grid * 0.38 + nodes * 0.20);
	let heat_amount = smoothstep(0.68, 0.94, pressure_contraction);
	let pointer_core_color = mix(mix(cyan, ice, 0.32), compression_heat, heat_amount * 0.54);
	color += pointer_core_color
		* (refracted_edge * 0.045 + pointer_core * 0.030) * mobile_guard;
	let heat_core_radius = lens_radius * mix(0.28, 0.21, heat_amount);
	let heat_shape = 0.88 + 0.12
		* sin(lens_angle * 5.0 + field_energy * 4.2 - motion_time * 0.34);
	let heat_core = exp(-pow(pointer_distance / max(heat_core_radius * heat_shape, 0.0001), 1.65))
		* pointer_visibility * heat_amount;
	color += compression_heat * heat_core
		* (0.016 + fine_grid * 0.040 + deep_grid * 0.018 + caustic * 0.025 + nodes * 0.025)
		* mobile_guard;
	let heat_tint = min(
		0.58,
		heat_core * (0.20 + fine_grid * 0.24 + deep_grid * 0.14 + caustic * 0.22 + nodes * 0.12),
	);
	let heated_core = color * vec3f(1.04, 0.58, 0.20)
		+ compression_heat * (0.055 + fine_grid * 0.030 + caustic * 0.025);
	color = mix(color, heated_core, heat_tint);

	let horizon = exp(-abs(uv.y - 0.68 - flow.x * 0.025) * 26.0);
	color += mix(azure, cyan, uv.x) * horizon * 0.020;
	return vec4f(color, 1.0);
}
`;

export const bloomExtractShader = /* wgsl */ `
${fullscreenVertex}

@group(0) @binding(0) var hdr_texture: texture_2d<f32>;

fn hdr_at(pixel: vec2i) -> vec3f {
	let size = vec2i(textureDimensions(hdr_texture));
	return textureLoad(hdr_texture, clamp(pixel, vec2i(0), size - vec2i(1)), 0).rgb;
}

fn prefilter(color: vec3f) -> vec3f {
	let brightness = dot(color, vec3f(0.2126, 0.7152, 0.0722));
	let threshold = 0.68;
	let knee = 0.22;
	let soft_value = clamp((brightness - threshold + knee) / (2.0 * knee), 0.0, 1.0);
	let soft_curve = soft_value * soft_value * (3.0 - 2.0 * soft_value) * knee;
	let contribution = max(brightness - threshold, soft_curve);
	return color * (contribution / max(brightness, 0.0001));
}

@fragment
fn bloom_extract_fragment(input: VertexOutput) -> @location(0) vec4f {
	let source_pixel = vec2i(input.position.xy) * 2;
	let color = (
		hdr_at(source_pixel) +
		hdr_at(source_pixel + vec2i(1, 0)) +
		hdr_at(source_pixel + vec2i(0, 1)) +
		hdr_at(source_pixel + vec2i(1, 1))
	) * 0.25;
	return vec4f(prefilter(color), 1.0);
}
`;

export const bloomBlurShader = /* wgsl */ `
${fullscreenVertex}

@group(0) @binding(0) var bloom_sampler: sampler;
@group(0) @binding(1) var bloom_texture: texture_2d<f32>;

@fragment
fn bloom_blur_fragment(input: VertexOutput) -> @location(0) vec4f {
	let size = vec2f(textureDimensions(bloom_texture));
	let texel = 1.0 / size;
	let uv = input.uv;
	let axial = texel * 1.75;
	let diagonal = texel * 1.25;
	var color = textureSampleLevel(bloom_texture, bloom_sampler, uv, 0.0).rgb * 0.20;
	color += textureSampleLevel(bloom_texture, bloom_sampler, uv + vec2f(axial.x, 0.0), 0.0).rgb * 0.10;
	color += textureSampleLevel(bloom_texture, bloom_sampler, uv - vec2f(axial.x, 0.0), 0.0).rgb * 0.10;
	color += textureSampleLevel(bloom_texture, bloom_sampler, uv + vec2f(0.0, axial.y), 0.0).rgb * 0.10;
	color += textureSampleLevel(bloom_texture, bloom_sampler, uv - vec2f(0.0, axial.y), 0.0).rgb * 0.10;
	color += textureSampleLevel(bloom_texture, bloom_sampler, uv + diagonal, 0.0).rgb * 0.10;
	color += textureSampleLevel(bloom_texture, bloom_sampler, uv - diagonal, 0.0).rgb * 0.10;
	color += textureSampleLevel(bloom_texture, bloom_sampler, uv + vec2f(diagonal.x, -diagonal.y), 0.0).rgb * 0.10;
	color += textureSampleLevel(bloom_texture, bloom_sampler, uv + vec2f(-diagonal.x, diagonal.y), 0.0).rgb * 0.10;
	return vec4f(color, 1.0);
}
`;

export const compositeShader = /* wgsl */ `
${fullscreenVertex}
${frameParams}

@group(0) @binding(0) var<uniform> params: FrameParams;
@group(0) @binding(1) var hdr_texture: texture_2d<f32>;
@group(0) @binding(2) var bloom_texture: texture_2d<f32>;
@group(0) @binding(3) var bloom_sampler: sampler;

fn hdr_at(pixel: vec2i) -> vec3f {
	let size = vec2i(textureDimensions(hdr_texture));
	return textureLoad(hdr_texture, clamp(pixel, vec2i(0), size - vec2i(1)), 0).rgb;
}

fn aces_fitted(color: vec3f) -> vec3f {
	let a = 2.51;
	let b = 0.03;
	let c = 2.43;
	let d = 0.59;
	let e = 0.14;
	return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3f(0.0), vec3f(1.0));
}

fn linear_to_srgb(linear: vec3f) -> vec3f {
	let low = linear * 12.92;
	let high = 1.055 * pow(linear, vec3f(1.0 / 2.4)) - 0.055;
	return select(high, low, linear <= vec3f(0.0031308));
}

fn hash11(value: f32) -> f32 {
	return fract(sin(value * 91.3458) * 47453.5453);
}

@fragment
fn composite_fragment(input: VertexOutput) -> @location(0) vec4f {
	let pixel = vec2i(input.position.xy);
	let center = hdr_at(pixel);
	let bloom = textureSampleLevel(bloom_texture, bloom_sampler, input.uv, 0.0).rgb;
	let bloom_gain = mix(0.22, 0.165, params.coarse_pointer);
	var hdr_color = center + bloom * bloom_gain;

	let aberration_strength = params.pointer_pressure * exp(-distance(input.uv, params.pointer) * 5.0);
	let shifted_a = hdr_at(pixel + vec2i(2, 0));
	let shifted_b = hdr_at(pixel - vec2i(2, 0));
	hdr_color.r = mix(hdr_color.r, shifted_a.r, aberration_strength * 0.08);
	hdr_color.b = mix(hdr_color.b, shifted_b.b, aberration_strength * 0.10);

	let mapped = max(aces_fitted(hdr_color * 1.05) - vec3f(0.00035), vec3f(0.0));
	var color = linear_to_srgb(mapped);
	let grain = hash11(input.position.x + input.position.y * 173.0 + floor(params.frame * 0.5)) - 0.5;
	color += grain * 0.0025 * mix(1.0, 0.0, params.reduced_motion);
	return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
