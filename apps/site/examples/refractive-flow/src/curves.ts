/** Authored Catmull–Rom paths and parallel-transport frames shared by GPU and fallback. */
export type Vec3 = readonly [number, number, number];
export const curveSegments = 256;
export const curveCount = 4;
export const curveSamples = curveSegments + 1;
export const sampleBytes = 48;
export const sheetLayers = 3;
export const sheetSegments = 16;
export const coverFocus: Vec3 = [.55, -.06, .6];
export const stateBytes = 32;
export const filamentsPerCurve = 24;

// The front loop folds back through depth. A quieter rear loop, a rolling
// right-hand plume and a thin crossing veil share the same focal point.
const paths: readonly (readonly Vec3[])[] = [
	[[.86, .93, -.65], [.16, .69, -.38], [-.41, .44, .15], [-.47, -.06, .90], [-.11, -.28, 1.05], [.31, -.20, .76], [.50, .08, .38], [.35, .51, -.14], [.01, .69, -.50], [-.70, .93, -.75]],
	[[1.50, .95, -1.10], [.64, .78, -.90], [-.10, .56, -.80], [-.60, .18, -.60], [-.32, -.28, -.35], [.32, -.40, -.45], [.71, -.08, -.50], [.67, .44, -.95], [1.04, .98, -1.10]],
	[[.86, 1.40, -.40], [.57, .91, -.20], [.47, .46, .35], [.53, .03, .80], [.72, -.33, .90], [1.15, -.57, .70], [1.70, -.58, .05]],
	[[-1.40, .74, -.85], [-.60, .53, -.70], [.12, .31, -.40], [.49, .04, .25], [.59, -.30, .45], [1.13, -.54, -.25], [1.70, -.80, -.60]],
];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.max(1e-9, Math.hypot(...a)));

/** Localized around the right-hand crossing; the open left loop stays full-width. */
export function waistWeight(point: Vec3): number {
	const side = Math.max(0, Math.min(1, (point[0] - .12) / .30));
	return side * side * (3 - 2 * side) * Math.exp(-(((point[1] + .06) / .22) ** 2));
}

export function curvePoint(curve: number, u: number): Vec3 {
	const points = paths[curve]!;
	const position = Math.max(0, Math.min(1, u)) * (points.length - 1);
	const i = Math.min(points.length - 2, Math.floor(position));
	const t = position - i;
	const a = points[Math.max(0, i - 1)]!, b = points[i]!, c = points[i + 1]!, d = points[Math.min(points.length - 1, i + 2)]!;
	const point = [0, 1, 2].map(k => .5 * ((2 * b[k]!) + (-a[k]! + c[k]!) * t + (2 * a[k]! - 5 * b[k]! + 4 * c[k]! - d[k]!) * t * t + (-a[k]! + 3 * b[k]! - 3 * c[k]! + d[k]!) * t * t * t)) as unknown as Vec3;
	const center: Vec3 = [point[0] * .74 - point[1] * .22 + .21, point[1] * .82 - .10, point[2]];
	const waist = waistWeight(center);
	const axis = .55 - .45 * (center[1] + .06);
	return [center[0] + (axis - center[0]) * waist * .38, center[1], center[2] + (.6 - center[2]) * waist * .18];
}

export function createRestCurves(): Float32Array {
	const result = new Float32Array(curveSamples * curveCount * 12);
	for (let curve = 0; curve < curveCount; curve++) {
		let previousT: Vec3 = unit(sub(curvePoint(curve, .001), curvePoint(curve, 0)));
		let side: Vec3 = unit(cross([0, 0, 1], previousT));
		for (let i = 0; i < curveSamples; i++) {
			const u = i / curveSegments;
			const center = curvePoint(curve, u);
			const tangent = unit(sub(curvePoint(curve, u + .001), curvePoint(curve, u - .001)));
			// Minimal rotation of the previous frame, stable through curve inflections.
			const axis = cross(previousT, tangent);
			const cosine = dot(previousT, tangent);
			if (cosine > -.999) side = add(side, add(cross(axis, side), scale(cross(axis, cross(axis, side)), 1 / (1 + cosine))));
			side = unit(sub(side, scale(tangent, dot(side, tangent))));
			const normal = unit(cross(tangent, side));
			const turn = Math.max(0, Math.min(1, (u - .48) / .20));
			const foldTurn = turn * turn * (3 - 2 * turn);
			const twist = curve === 0 ? -.20 + Math.sin(u * Math.PI * 2 - .4) * 1.1 + Math.sin(u * Math.PI * 4) * .45 + foldTurn * 1.65
				: curve === 1 ? .3 + Math.sin(u * 5) * .5 + u * .4
					: curve === 2 ? -1.1 + 2.9 * (u * u * (3 - 2 * u))
						: -.4 + u * 2.5;
			const turned = add(scale(side, Math.cos(twist)), scale(normal, Math.sin(twist)));
			const turnedNormal = unit(cross(tangent, turned));
			const width = [.16, .12, .185, .08][curve]! * (.15 + .85 * Math.sin(Math.PI * u) ** .65) * (1 - .42 * waistWeight(center));
			result.set([...center, width, ...turned, u, ...turnedNormal, curve], (curve * curveSamples + i) * 12);
			previousT = tangent;
		}
	}
	return result;
}

/** Resting, peeled surface; the GPU evaluates this same profile with animated frames. */
export function restSheetPoint(frames: Float32Array, curve: number, index: number, v: number, layer: number): Vec3 {
	const offset = (curve * curveSamples + index) * 12;
	const center = frames.slice(offset, offset + 3) as unknown as Vec3;
	const side = frames.slice(offset + 4, offset + 7) as unknown as Vec3;
	const normal = frames.slice(offset + 8, offset + 11) as unknown as Vec3;
	const u = frames[offset + 7]!, halfWidth = frames[offset + 3]!;
	const roll = layer * .26 * Math.sin(u * 8 + curve * .9);
	const turned = add(scale(side, Math.cos(roll)), scale(normal, Math.sin(roll)));
	const turnedNormal = sub(scale(normal, Math.cos(roll)), scale(side, Math.sin(roll)));
	const envelope = Math.max(0, Math.sin(u * Math.PI)) ** 1.4;
	const width = halfWidth * (1 - layer * .22);
	const separation = layer * envelope * (.045 + .055 * Math.sin(u * 9 + curve)) * (1 - .45 * waistWeight(center));
	const lateral = (layer > 1.5 ? 1 : -1) * layer * halfWidth * .32 * envelope;
	const pleat = Math.sin(v * 2.8 + u * 5 + curve * 1.3) * width * .09 * (1 - v * v);
	const curl = Math.sin(v * 2.2 + u * 3) * width * .18;
	const flutter = Math.sin(u * 8 + v * 2) * width * .012 * (1 - v * v);
	return add(center, add(scale(turned, v * width + lateral), scale(turnedNormal, separation + pleat + curl + flutter)));
}

/** Projection is mirrored in WGSL so the DOM exploration marker follows the artwork. */
export function projectPoint(point: Vec3, aspect: number, narrow: boolean): readonly [number, number] {
	const zoom = narrow ? .98 : 1.35;
	const depth = 1 - point[2] * .16;
	const x = point[0] * zoom / Math.max(.1, aspect) / depth + (narrow ? -.12 : .12);
	const y = point[1] * zoom / depth + (narrow ? .16 : 0);
	return [x * .5 + .5, .5 - y * .5];
}

export function resolveFlowDimensions(cssWidth: number, cssHeight: number, dpr: number, coarse: boolean) {
	const width = Math.max(1, cssWidth), height = Math.max(1, cssHeight);
	const budget = coarse || width < 600 ? 300_000 : 1_000_000;
	const ratio = Math.min(Math.max(1, dpr || 1), coarse ? 1 : 1.5, Math.sqrt(budget / (width * height)));
	return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}
