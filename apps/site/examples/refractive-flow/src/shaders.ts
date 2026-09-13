import { curveSamples, curveCount, filamentsPerCurve, sheetLayers, sheetSegments } from './curves.ts';

const params = /* wgsl */ `
struct FrameParams {
  resolution: vec2f, parallax: vec2f,
  pointer: vec2f, pointer_velocity: vec2f,
  time: f32, delta_time: f32, aspect: f32, pointer_pressure: f32,
  frame: f32, reduced_motion: f32, pointer_expansion: f32, coarse_pointer: f32,
  background: vec4f, appearance: vec4f,
  heading_region: vec4f, body_region: vec4f, value_region: vec4f,
};
@group(0) @binding(0) var<uniform> p: FrameParams;
struct CurveSample { center: vec4f, side: vec4f, normal: vec4f };
const SAMPLE_COUNT = ${curveSamples}u;
const CURVE_COUNT = ${curveCount}u;
fn waist_weight(point: vec3f) -> f32 {
  let y=(point.y+.06)/.22;
  return smoothstep(.12,.42,point.x)*exp(-y*y);
}
fn project(point: vec3f) -> vec4f {
  let zoom = mix(1.35, 0.98, p.appearance.z);
  let depth = 1.0 - point.z * 0.16;
  let shift = vec2f(mix(0.12, -0.12, p.appearance.z), mix(0.0, 0.16, p.appearance.z));
  let depth_parallax=p.parallax*mix(.55,1.25,smoothstep(-.85,.85,point.z));
  return vec4f(point.xy * vec2f(zoom / p.aspect, zoom) / depth + shift + depth_parallax, clamp(0.5-point.z*0.18,0.01,0.99), 1.0);
}
`;

export const updateShader = /* wgsl */ `
${params}
struct Motion { offset: vec4f, velocity: vec4f };
@group(0) @binding(1) var<storage, read> rest: array<CurveSample>;
@group(0) @binding(2) var<storage, read_write> motion: array<Motion>;
@group(0) @binding(3) var<storage, read_write> curves: array<CurveSample>;
// Analytic gradient of a small spectral-noise potential; its curl is divergence-free.
fn noise_gradient(q: vec3f) -> vec3f {
  let a = vec3f(1.31, 1.73, -0.91); let b = vec3f(-1.83, 0.77, 1.57); let c = vec3f(0.63, -2.11, 1.19);
  return a*cos(dot(q,a)+0.7)*0.45 + b*cos(dot(q,b)+2.3)*0.31 + c*cos(dot(q,c)+4.1)*0.24;
}
fn curl_noise(q: vec3f) -> vec3f {
  let x = noise_gradient(q); let y = noise_gradient(q+vec3f(7.3,11.1,3.7)); let z = noise_gradient(q+vec3f(17.1,2.8,9.4));
  return vec3f(z.y-y.z, x.z-z.x, y.x-x.y);
}
@compute @workgroup_size(64)
fn update_curves(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= SAMPLE_COUNT * CURVE_COUNT) { return; }
  let sample = rest[id.x];
  let uv = project(sample.center.xyz).xy * vec2f(0.5,-0.5) + 0.5;
  let delta = (uv - p.pointer) * vec2f(p.aspect, 1.0);
  let influence = exp(-dot(delta,delta)*22.0) * p.pointer_pressure;
  let u = sample.side.w;
  let envelope = sin(u*3.14159265);
  let flow = curl_noise(sample.center.xyz*1.1+vec3f(p.time*0.10,0.0,p.time*0.075)) * 0.013;
  let radial = vec3f(delta.x,-delta.y,0.10);
  let pointer_flow = radial*0.32 + vec3f(clamp(p.pointer_velocity,vec2f(-.12),vec2f(.12))*vec2f(1.0,-1.0),0.0)*0.8;
  let desired_offset = (flow + pointer_flow*influence) * envelope;
  var state = motion[id.x];
  let dt = min(p.delta_time, 0.05) / 4.0;
  for (var i=0; i<4; i++) {
    state.velocity = vec4f(state.velocity.xyz + ((desired_offset-state.offset.xyz)*38.0-state.velocity.xyz*10.0)*dt, 0.0);
    state.offset = vec4f(state.offset.xyz+state.velocity.xyz*dt,0.0);
  }
  if (p.reduced_motion > 0.5) { state.offset = vec4f(0.0); state.velocity = vec4f(0.0); }
  motion[id.x] = state;
  let angle = sin(u*9.0 + p.time*0.23 + sample.normal.w)*0.11*(1.0-p.reduced_motion);
  let side = sample.side.xyz*cos(angle)+sample.normal.xyz*sin(angle);
  let normal = sample.normal.xyz*cos(angle)-sample.side.xyz*sin(angle);
  curves[id.x] = CurveSample(vec4f(sample.center.xyz+state.offset.xyz,sample.center.w), vec4f(side,u), vec4f(normal,influence));
}
`;

export const ribbonShader = /* wgsl */ `
${params}
@group(0) @binding(1) var<storage, read> curves: array<CurveSample>;
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) world: vec3f,
  @location(3) charge: f32,
  @location(4) @interpolate(flat) strand: f32,
  @location(5) @interpolate(flat) film: vec2f,
};
const corners = array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
fn curve_at(curve: u32, index: u32) -> CurveSample { return curves[curve*SAMPLE_COUNT+min(index,SAMPLE_COUNT-1u)]; }
// Each thin layer peels locally away from the transported frame. Cross-width
// corrugation makes a genuinely folded surface, rather than a rounded tube.
fn sheet_point(curve: u32, index: u32, v: f32, layer: f32) -> vec3f {
  let sample = curve_at(curve,index); let u=sample.side.w;
  let roll=layer*.26*sin(u*8.0+f32(curve)*.9);
  let side=sample.side.xyz*cos(roll)+sample.normal.xyz*sin(roll);
  let normal=sample.normal.xyz*cos(roll)-sample.side.xyz*sin(roll);
  let envelope=pow(max(0.0,sin(u*3.14159265)),1.4);
  let width=sample.center.w*(1.0-layer*.22);
  let separation=layer*envelope*(.045+.055*sin(u*9.0+f32(curve)))*(1.0-.45*waist_weight(sample.center.xyz));
  let lateral=select(-1.0,1.0,layer>1.5)*layer*sample.center.w*.32*envelope;
  let phase=u*5.0+f32(curve)*1.3+p.time*.19;
  let pleat=sin(v*2.8+phase)*width*.09*(1.0-v*v);
  let curl=sin(v*2.2+u*3.0)*width*.18;
  let flutter=sin(u*8.0+v*2.0-p.time*.27)*width*.012*(1.0-v*v);
  return sample.center.xyz+side*(v*width+lateral)+normal*(separation+pleat+curl+flutter);
}
@vertex
fn ribbon_vertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Vertex {
  let curve=instance / ${sheetLayers}u; let layer=f32(instance % ${sheetLayers}u);
  let cell=vertex/6u; let corner=corners[vertex%6u];
  let index=cell/${sheetSegments}u+u32(corner.x);
  let v=(f32(cell % ${sheetSegments}u)+corner.y)/${sheetSegments}.0*2.0-1.0;
  let sample=curve_at(curve,index);
  let point=sheet_point(curve,index,v,layer);
  let before=sheet_point(curve,select(index-1u,0u,index==0u),v,layer);
  let after=sheet_point(curve,min(index+1u,SAMPLE_COUNT-1u),v,layer);
  let across=sheet_point(curve,index,v+.015,layer)-sheet_point(curve,index,v-.015,layer);
  var out: Vertex;
  out.position=project(point); out.uv=vec2f(sample.side.w,v);
  out.normal=normalize(cross(after-before,across)); out.world=point;
  out.charge=sample.normal.w; out.strand=-1.0; out.film=vec2f(f32(curve),layer);
  return out;
}
@vertex
fn filament_vertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Vertex {
  let corner=corners[vertex%6u]; let index=vertex/6u+u32(corner.x);
  let curve=instance/${filamentsPerCurve}u; let strand=f32(instance%${filamentsPerCurve}u);
  let sample=curve_at(curve,index); let u=sample.side.w;
  let spread=strand/${filamentsPerCurve - 1}.0*2.0-1.0;
  let fan=sin(u*3.14159265)*(.3+.7*sin(u*4.0+strand*.17));
  let point=sample.center.xyz+sample.side.xyz*spread*sample.center.w*2.3
    +sample.normal.xyz*(spread*spread*.12+fan*.10*sin(strand*1.7))*(1.0-.45*waist_weight(sample.center.xyz));
  var clip=project(point);
  let next=project(curve_at(curve,min(index+1u,SAMPLE_COUNT-1u)).center.xyz);
  let previous=project(curve_at(curve,select(index-1u,0u,index==0u)).center.xyz);
  let tangent=normalize((next.xy-previous.xy)*p.resolution+vec2f(.00001,0));
  let focus=smoothstep(-.9,.8,point.z);
  clip=vec4f(clip.xy+vec2f(-tangent.y,tangent.x)*(corner.y*2.0-1.0)*mix(2.2,1.5,focus)/p.resolution,clip.zw);
  var out: Vertex;
  out.position=clip; out.uv=vec2f(u,corner.y*2.0-1.0); out.normal=sample.normal.xyz;
  out.world=point; out.charge=sample.normal.w; out.strand=strand; out.film=vec2f(f32(curve),0.0);
  return out;
}
struct MaterialOutput { @location(0) accumulation: vec4f, @location(1) revealage: vec4f, @location(2) emission: vec4f };
fn light_environment(direction: vec3f, roughness: f32) -> vec3f {
  let silver=dot(direction,normalize(vec3f(.28,1.0,.32)))-.31;
  let blue=direction.x*.82-direction.z*.57+.14;
  let rim=direction.y*.66+direction.z*.75-.29;
  let warm=direction.x*.45+direction.y*.81-.64;
  let sharp=mix(1200.0,150.0,roughness);
  return vec3f(.60,.82,1.0)*exp(-silver*silver*sharp)*mix(9.0,2.0,roughness)
    +vec3f(.025,.14,.85)*exp(-blue*blue*70.0)*1.8
    +vec3f(.05,.25,1.0)*exp(-rim*rim*sharp*.65)*5.0
    +vec3f(1.0,.48,.13)*exp(-warm*warm*1100.0)*.15;
}
@fragment
fn material_fragment(in: Vertex) -> MaterialOutput {
  let light=p.appearance.x; let u=in.uv.x; let v=in.uv.y;
  let edge_width=max(.045,min(.10,fwidth(v)*1.1));
  let ends=smoothstep(0.0,.04,u)*(1.0-smoothstep(.94,1.0,u));
  let focus=smoothstep(-.85,.85,in.world.z);
  let depth_light=mix(.20,1.15,focus);
  let knot=exp(-dot(in.world.xy-vec2f(.55,-.06),in.world.xy-vec2f(.55,-.06))*360.0);
  var alpha:f32; var pigment:vec3f; var glow:vec3f;
  if (in.strand<0.0) {
    var n=normalize(in.normal);
    let view=normalize(vec3f(0.0,0.0,6.25)-in.world);
    if (dot(n,view)<0.0) { n=-n; }
    let facing=clamp(dot(n,view),0.0,1.0);
    let fresnel=.04+.96*pow(1.0-facing,4.0);
    let roughness=mix(.56,.035,focus);
    let reflected=light_environment(reflect(-view,n),roughness);
    let transmitted=vec3f(
      light_environment(refract(-view,n,1.0/1.30),roughness).r,
      light_environment(refract(-view,n,1.0/1.34),roughness).g,
      light_environment(refract(-view,n,1.0/1.39),roughness).b);
    let feather=1.0-smoothstep(mix(.65,.93,focus),1.0,abs(v));
    let phase=(1.0-facing)*4.0+in.world.z*1.3+sin(u*8.0+v*2.0)*.7;
    let iridescence=.5+.5*cos(vec3f(0.0,2.1,4.2)+phase*2.8);
    var tint=mix(vec3f(.025,.15,.72),vec3f(.20,.075,.68),iridescence.r*.42);
    tint=mix(tint,vec3f(.025,.58,.68),iridescence.g*.48);
    // Narrow, interrupted folds catch light across the film, leaving clear gaps.
    let crease=pow(.5+.5*sin(v*26.0+u*17.0+sin(u*9.0)*1.5),24.0);
    let streak=pow(.5+.5*sin(v*73.0+u*8.0),36.0);
    let layer_weight=1.0-in.film.y*.24;
    // A narrow edge catches grazing light without drawing a uniform neon outline.
    let edge_distance=(abs(v)-.92)/edge_width;
    let rim=exp(-edge_distance*edge_distance);
    let grazing=pow(1.0-facing,1.5);
    let edge_color=mix(tint*2.0,vec3f(.70,.90,1.0),fresnel);
    alpha=(.027+fresnel*.15+crease*.018+rim*.025*light)*ends*feather*layer_weight*mix(1.0,2.3,light)*mix(.45,1.0,focus);
    pigment=tint*(1.0-rim*(.12+.30*grazing)*light);
    glow=(reflected*(.07+fresnel*1.15)+transmitted*tint*.36+tint*(.07+crease*.08+streak*.025)
      +edge_color*rim*(.14+grazing*.90))
      *ends*feather*layer_weight*depth_light*(1.0+in.charge*1.5);
    let spark_layer=select(0.0,1.0,in.film.y<.5 && (in.film.x<.5 || in.film.x>2.5));
    let flare=pow(.5+.5*sin(u*19.0+in.film.x*5.0),64.0)*pow(.5+.5*sin(v*6.0+u*7.0),20.0)*spark_layer;
    glow+=vec3f(5.0,2.0,.30)*(knot*(.07+crease*.4)+flare*.20)*ends*feather*layer_weight;
  } else {
    let line=exp(-v*v*mix(2.0,3.5,focus))*(1.0-smoothstep(.72,1.0,abs(v)));
    let selected=select(.13,.40,in.strand%9.0<1.0);
    let pulse=pow(max(0.0,sin(u*15.0-p.time*.5+in.strand*2.7)),18.0);
    let warm=select(0.0,1.0,in.strand<1.0 && in.film.x%2.0<.5);
    pigment=vec3f(.08,.31,.75);
    alpha=line*ends*.025*depth_light;
    glow=pigment*line*ends*(.11+pulse*.49)*selected*depth_light*(1.0+in.charge);
    glow+=vec3f(5.5,2.1,.35)*(knot*.4+pulse*warm*.3)*line*ends*selected;
  }
  // Weighted blended transparency: bounded memory, smooth intersections, approximate transmission.
  alpha = clamp(alpha,0.0,.94);
  let weight = clamp(.3+pow(1.0-in.position.z,3.0)*6.0,.3,6.0);
  var out: MaterialOutput;
  out.accumulation = vec4f(pigment*alpha*weight,alpha*weight);
  out.revealage = vec4f(alpha);
  out.emission = vec4f(glow,0.0);
  return out;
}
`;

const fullscreen = /* wgsl */ `
struct FullscreenVertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn fullscreen_vertex(@builtin(vertex_index) id: u32) -> FullscreenVertex {
  let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  let uvs=array<vec2f,3>(vec2f(0,1),vec2f(2,1),vec2f(0,-1));
  var out: FullscreenVertex; out.position=vec4f(positions[id],0,1); out.uv=uvs[id]; return out;
}
`;
export const bloomShader = /* wgsl */ `
${fullscreen}
@group(0) @binding(0) var linear_sampler: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var high_level: texture_2d<f32>;
fn tent(uv: vec2f, radius: f32) -> vec3f {
  let d=vec2f(radius)/vec2f(textureDimensions(source));
  var color=textureSampleLevel(source,linear_sampler,uv,0.0).rgb*4.0;
  color += (textureSampleLevel(source,linear_sampler,uv+vec2f(d.x,0),0.0).rgb+textureSampleLevel(source,linear_sampler,uv-vec2f(d.x,0),0.0).rgb
    +textureSampleLevel(source,linear_sampler,uv+vec2f(0,d.y),0.0).rgb+textureSampleLevel(source,linear_sampler,uv-vec2f(0,d.y),0.0).rgb)*2.0;
  color += textureSampleLevel(source,linear_sampler,uv+d,0.0).rgb+textureSampleLevel(source,linear_sampler,uv-d,0.0).rgb
    +textureSampleLevel(source,linear_sampler,uv+vec2f(d.x,-d.y),0.0).rgb+textureSampleLevel(source,linear_sampler,uv+vec2f(-d.x,d.y),0.0).rgb;
  return color/16.0;
}
@fragment fn bloom_extract(in: FullscreenVertex) -> @location(0) vec4f {
  let color=tent(in.uv,1.0);
  let brightness=max(max(color.r,color.g),color.b);
  let knee=clamp(brightness-.65+.30,0.0,.60);
  let contribution=max(brightness-.65,knee*knee/1.20)/max(brightness,.00001);
  return vec4f(color*contribution,1.0);
}
@fragment fn bloom_down(in: FullscreenVertex) -> @location(0) vec4f { return vec4f(tent(in.uv,1.5),1.0); }
@fragment fn bloom_up(in: FullscreenVertex) -> @location(0) vec4f {
  return vec4f(tent(in.uv,2.0)*.65+textureSampleLevel(high_level,linear_sampler,in.uv,0.0).rgb,1.0);
}
`;

export const compositeShader = /* wgsl */ `
${fullscreen}
${params}
@group(0) @binding(1) var accumulation: texture_2d<f32>;
@group(0) @binding(2) var revealage: texture_2d<f32>;
@group(0) @binding(3) var emission: texture_2d<f32>;
@group(0) @binding(4) var bloom: texture_2d<f32>;
@group(0) @binding(5) var linear_sampler: sampler;
fn to_linear(s: vec3f) -> vec3f { return select(pow((s+.055)/1.055,vec3f(2.4)),s/12.92,s<=vec3f(.04045)); }
fn to_srgb(s: vec3f) -> vec3f { return select(1.055*pow(max(s,vec3f(0)),vec3f(1.0/2.4))-.055,s*12.92,s<=vec3f(.0031308)); }
fn reading_region(uv: vec2f, rect: vec4f) -> f32 {
  if (rect.z<=rect.x || rect.w<=rect.y) { return 0.0; }
  let feather=vec2f(36.0,36.0)/p.resolution;
  return (1.0-smoothstep(rect.z,rect.z+feather.x*1.5,uv.x))
    *smoothstep(rect.y-feather.y,rect.y,uv.y)*(1.0-smoothstep(rect.w,rect.w+feather.y,uv.y));
}
@fragment fn composite_fragment(in: FullscreenVertex) -> @location(0) vec4f {
  let pixel=vec2i(in.position.xy); let accum=textureLoad(accumulation,pixel,0);
  let coverage=clamp(1.0-textureLoad(revealage,pixel,0).r,0.0,1.0);
  let pigment=accum.rgb/max(accum.a,.00001);
  let radiance=textureLoad(emission,pixel,0).rgb;
  let glow=textureSampleLevel(bloom,linear_sampler,in.uv,0.0).rgb;
  let background=to_linear(p.background.rgb);
  let dark_base=mix(background,pigment*.045,coverage);
  let absorption=(vec3f(1.0)-clamp(pigment,vec3f(0.0),vec3f(.98)))*3.4;
  let glass_base=background*exp(-absorption*coverage);
  let base=mix(dark_base,glass_base,p.appearance.x);
  // Give HDR peaks more exposure while keeping low-energy transmission quiet.
  let peak=max(max(radiance.r,radiance.g),radiance.b);
  let highlight_exposure=1.0+smoothstep(.4,3.0,peak)*mix(.65,.30,p.appearance.x);
  let energy=radiance*mix(.85,.24,p.appearance.x)*highlight_exposure+glow*mix(.70,.12,p.appearance.x);
  let energy_peak=max(max(energy.r,energy.g),energy.b);
  let chromatic_shoulder=energy/max(energy_peak,.00001)*(1.0-exp(-energy_peak));
  // Preserve some dispersion color in the brightest shoulder instead of whitening every channel.
  let mapped=mix(vec3f(1.0)-exp(-energy),chromatic_shoulder,smoothstep(.7,3.0,peak)*.25);
  let lit=base+(vec3f(1.0)-base)*mapped;
  // Fade the effect itself into the exact page color, including its bloom halo.
  let edge=smoothstep(0.0,.07,in.uv.x)*(1.0-smoothstep(.76,.99,in.uv.y));
  let quiet=max(max(reading_region(in.uv,p.heading_region),reading_region(in.uv,p.body_region)),reading_region(in.uv,p.value_region));
  // Compress luminance behind copy while retaining the film's hue and folds.
  // Dimming the whole surface to zero would visibly cut through the silhouette.
  let luminance=dot(lit,vec3f(.2126,.7152,.0722));
  let dark_readable=lit*min(1.0,.035/max(luminance,.00001));
  let light_readable=mix(lit,vec3f(1.0),clamp((.76-luminance)/max(.00001,1.0-luminance),0.0,1.0));
  let readable=mix(dark_readable,light_readable,p.appearance.x);
  let color=mix(lit,readable,quiet*p.appearance.y);
  return vec4f(mix(p.background.rgb,to_srgb(color),edge),1.0);
}
`;
