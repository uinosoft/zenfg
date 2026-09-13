import assert from 'node:assert/strict';
import test from 'node:test';
import { createRestCurves, curveCount, curveSamples, resolveFlowDimensions, projectPoint, coverFocus, restSheetPoint, sheetLayers } from '../src/curves.ts';
import { surfaceFallbackSvg } from '../src/fallback.ts';

test('transported ribbon frames stay finite, orthogonal and continuous through inflections', () => {
	const data = createRestCurves();
	assert.equal(data.length, curveCount * curveSamples * 12);
	for (let curve = 0; curve < curveCount; curve++) {
		for (let i = 0; i < curveSamples; i++) {
			const offset = (curve * curveSamples + i) * 12;
			const sample = data.slice(offset, offset + 12);
			assert.ok(sample.every(Number.isFinite));
			assert.ok(sample[3]! > 0);
			const side = sample.slice(4, 7), normal = sample.slice(8, 11);
			assert.ok(Math.abs(Math.hypot(...side) - 1) < 1e-6);
			assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6);
			assert.ok(Math.abs(side.reduce((sum, v, k) => sum + v * normal[k]!, 0)) < 1e-6);
			if (i) assert.ok(side.reduce((sum, v, k) => sum + v * data[offset - 12 + 4 + k]!, 0) > .90, 'frame does not flip between adjacent samples');
		}
	}
});

test('render pixel budgets are independent of screen density and page length', () => {
	for (const [width, height, coarse, budget] of [[1080, 680, false, 1_000_000], [390, 550, true, 300_000], [390, 550, false, 300_000], [4000, 2000, false, 1_000_000], [1024, 680, true, 300_000]] as const) {
		for (const dpr of [1, 2, 3, 4]) {
			const size = resolveFlowDimensions(width, height, dpr, coarse);
			assert.ok(size.width * size.height <= budget);
			assert.ok(Math.abs(size.width / size.height - width / height) < .01);
		}
	}
});

test('fallback uses the same finite projection at desktop and touch aspect ratios', () => {
	for (const [width, height] of [[1080, 680], [390, 550]] as const) {
		const anchor = projectPoint(coverFocus, width / height, width < 600);
		assert.ok(anchor.every(v => v > 0 && v < 1));
		const svg = surfaceFallbackSvg(width, height);
		assert.ok(svg.includes(`viewBox="0 0 ${width} ${height}"`));
		assert.doesNotMatch(svg, /NaN|Infinity/);
		assert.ok(svg.includes('var(--flow-glass)'), 'fallback follows the shared theme');
	}
});

test('peeled films stay finite and distinct through the foreground fold and rear loop', () => {
	const frames = createRestCurves();
	let nearest = -Infinity, farthest = Infinity;
	for (let curve = 0; curve < curveCount; curve++) {
		for (let i = 0; i < curveSamples; i++) {
			for (let layer = 0; layer < sheetLayers; layer++) {
				for (const v of [-1, 0, 1]) {
					const point = restSheetPoint(frames, curve, i, v, layer);
					assert.ok(point.every(Number.isFinite));
					nearest = Math.max(nearest, point[2]); farthest = Math.min(farthest, point[2]);
					assert.ok(point[2] < 6, 'all films stay in front of the projection singularity');
					if (i === 128 && v === 0 && layer > 0) {
						const base = restSheetPoint(frames, curve, i, v, 0);
						assert.ok(Math.hypot(...point.map((x, k) => x - base[k]!)) > .015, 'layers separate in space');
					}
				}
			}
		}
	}
	assert.ok(nearest - farthest > 1.8, 'foreground and background occupy different focal depths');
});
