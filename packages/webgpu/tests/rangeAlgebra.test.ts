import assert from 'node:assert/strict';
import test from 'node:test';

import {
	intersectResolvedTextureRanges,
	type ResolvedTextureRange,
	subtractResolvedTextureRange,
	subtractResolvedTextureRanges,
} from '../src/graphCompiler.ts';

const ASPECT_BITS = [1, 2, 4] as const;
const PROPERTY_SEEDS = [0x5eed1234, 0x00c0ffee, 0x9e3779b9] as const;

type Random = () => number;

function createDeterministicRandom(seed: number): Random {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ value >>> 15, value | 1);
		value ^= value + Math.imul(value ^ value >>> 7, value | 61);
		return ((value ^ value >>> 14) >>> 0) / 0x100000000;
	};
}

function randomInteger(random: Random, minimum: number, maximum: number): number {
	return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function randomRange(random: Random): ResolvedTextureRange {
	const mipBase = randomInteger(random, 0, 3);
	const layerBase = randomInteger(random, 0, 3);
	const depthBase = randomInteger(random, 0, 3);
	return {
		baseMipLevel: mipBase,
		mipLevelCount: randomInteger(random, 1, 4 - mipBase),
		baseArrayLayer: layerBase,
		arrayLayerCount: randomInteger(random, 1, 4 - layerBase),
		baseDepthSlice: depthBase,
		depthSliceCount: randomInteger(random, 1, 4 - depthBase),
		aspectMask: randomInteger(random, 1, 7),
	};
}

function cells(range: ResolvedTextureRange | undefined): Set<string> {
	const result = new Set<string>();
	if (!range) {
		return result;
	}
	for (let mip = range.baseMipLevel; mip < range.baseMipLevel + range.mipLevelCount; mip++) {
		for (let layer = range.baseArrayLayer; layer < range.baseArrayLayer + range.arrayLayerCount; layer++) {
			for (let depth = range.baseDepthSlice; depth < range.baseDepthSlice + range.depthSliceCount; depth++) {
				for (const aspect of ASPECT_BITS) {
					if ((range.aspectMask & aspect) !== 0) {
						result.add(`${mip}:${layer}:${depth}:${aspect}`);
					}
				}
			}
		}
	}
	return result;
}

function cellsForRanges(ranges: readonly ResolvedTextureRange[]): Set<string> {
	const result = new Set<string>();
	for (const range of ranges) {
		for (const cell of cells(range)) {
			result.add(cell);
		}
	}
	return result;
}

function setDifference(source: ReadonlySet<string>, removed: ReadonlySet<string>): Set<string> {
	return new Set([...source].filter((cell) => !removed.has(cell)));
}

function setIntersection(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
	return new Set([...a].filter((cell) => b.has(cell)));
}

function assertSetsEqual(
	actual: ReadonlySet<string>,
	expected: ReadonlySet<string>,
	context: string,
): void {
	assert.deepEqual([...actual].sort(), [...expected].sort(), context);
}

function assertValidSubtraction(
	range: ResolvedTextureRange,
	coveredRange: ResolvedTextureRange,
	context: string,
): void {
	const originalCells = cells(range);
	const coveredCells = cells(coveredRange);
	const expectedIntersection = setIntersection(originalCells, coveredCells);
	const intersection = intersectResolvedTextureRanges(range, coveredRange);
	const fragments = subtractResolvedTextureRange(range, coveredRange);
	const remainingCells = new Set<string>();

	assert.equal(
		intersection === undefined,
		expectedIntersection.size === 0,
		`${context}: intersection presence`,
	);
	if (intersection) {
		assert.ok(intersection.mipLevelCount > 0, `${context}: intersection has an empty mip range`);
		assert.ok(intersection.arrayLayerCount > 0, `${context}: intersection has an empty layer range`);
		assert.ok(intersection.depthSliceCount > 0, `${context}: intersection has an empty depth range`);
		assert.ok(intersection.aspectMask > 0, `${context}: intersection has no aspect`);
	}
	assertSetsEqual(cells(intersection), expectedIntersection, `${context}: intersection`);
	for (const [fragmentIndex, fragment] of fragments.entries()) {
		assert.ok(fragment.mipLevelCount > 0, `${context}: fragment ${fragmentIndex} has an empty mip range`);
		assert.ok(fragment.arrayLayerCount > 0, `${context}: fragment ${fragmentIndex} has an empty layer range`);
		assert.ok(fragment.depthSliceCount > 0, `${context}: fragment ${fragmentIndex} has an empty depth range`);
		assert.ok(fragment.aspectMask > 0, `${context}: fragment ${fragmentIndex} has no aspect`);
		for (const cell of cells(fragment)) {
			assert.ok(originalCells.has(cell), `${context}: fragment ${fragmentIndex} escapes the source range at ${cell}`);
			assert.equal(remainingCells.has(cell), false, `${context}: fragments overlap at ${cell}`);
			remainingCells.add(cell);
		}
	}

	assertSetsEqual(
		remainingCells,
		setDifference(originalCells, coveredCells),
		`${context}: remaining cells`,
	);
	assertSetsEqual(
		new Set([...remainingCells, ...cells(intersection)]),
		originalCells,
		`${context}: reconstruction`,
	);
}

test('texture range subtraction preserves exact disjoint coverage for fixed edge cases', () => {
	const source: ResolvedTextureRange = {
		baseMipLevel: 1,
		mipLevelCount: 3,
		baseArrayLayer: 1,
		arrayLayerCount: 3,
		baseDepthSlice: 1,
		depthSliceCount: 3,
		aspectMask: 7,
	};
	const cases: readonly [string, ResolvedTextureRange][] = [
		['no overlap', {
			baseMipLevel: 0,
			mipLevelCount: 1,
			baseArrayLayer: 0,
			arrayLayerCount: 1,
			baseDepthSlice: 0,
			depthSliceCount: 1,
			aspectMask: 7,
		}],
		['boundary touch', {
			baseMipLevel: 4,
			mipLevelCount: 1,
			baseArrayLayer: 1,
			arrayLayerCount: 3,
			baseDepthSlice: 1,
			depthSliceCount: 3,
			aspectMask: 7,
		}],
		['full coverage', source],
		['interior cut', {
			baseMipLevel: 2,
			mipLevelCount: 1,
			baseArrayLayer: 2,
			arrayLayerCount: 1,
			baseDepthSlice: 2,
			depthSliceCount: 1,
			aspectMask: 7,
		}],
		['partial aspect coverage', {
			baseMipLevel: 1,
			mipLevelCount: 3,
			baseArrayLayer: 1,
			arrayLayerCount: 3,
			baseDepthSlice: 1,
			depthSliceCount: 3,
			aspectMask: 2,
		}],
	];

	for (const [label, coveredRange] of cases) {
		assertValidSubtraction(source, coveredRange, label);
	}
});

test('texture range subtraction matches a fixed-seed cell oracle', () => {
	for (const seed of PROPERTY_SEEDS) {
		const random = createDeterministicRandom(seed);
		for (let iteration = 0; iteration < 500; iteration++) {
			const range = randomRange(random);
			const coveredRange = randomRange(random);
			const context = `seed=${seed} iteration=${iteration} input=${JSON.stringify({ range, coveredRange })}`;
			assertValidSubtraction(range, coveredRange, context);
		}
	}
});

test('multiple texture range subtraction is order- and duplicate-independent', () => {
	for (const seed of PROPERTY_SEEDS) {
		const random = createDeterministicRandom(seed);
		for (let iteration = 0; iteration < 300; iteration++) {
			const range = randomRange(random);
			const coveredRanges = Array.from({ length: 4 }, () => randomRange(random));
			const originalCells = cells(range);
			const coveredCells = cellsForRanges(coveredRanges);
			const expected = setDifference(originalCells, coveredCells);
			const forward = subtractResolvedTextureRanges([range], coveredRanges);
			const reordered = subtractResolvedTextureRanges(
				[range],
				[...coveredRanges].reverse().concat(coveredRanges[0]!),
			);
			const context = `seed=${seed} iteration=${iteration} input=${JSON.stringify({ range, coveredRanges })}`;

			assertSetsEqual(cellsForRanges(forward), expected, `${context}: forward`);
			assertSetsEqual(cellsForRanges(reordered), expected, `${context}: reordered`);
		}
	}
});

test('fragmented texture subtraction stays bounded by remaining atomic cells', () => {
	const layeredRange: ResolvedTextureRange = {
		baseMipLevel: 0,
		mipLevelCount: 1,
		baseArrayLayer: 0,
		arrayLayerCount: 256,
		baseDepthSlice: 0,
		depthSliceCount: 1,
		aspectMask: 1,
	};
	const alternatingLayers = Array.from({ length: 128 }, (_, index): ResolvedTextureRange => ({
		baseMipLevel: 0,
		mipLevelCount: 1,
		baseArrayLayer: index * 2 + 1,
		arrayLayerCount: 1,
		baseDepthSlice: 0,
		depthSliceCount: 1,
		aspectMask: 1,
	}));
	const layeredFragments = subtractResolvedTextureRanges([layeredRange], alternatingLayers);
	const layeredCells = cellsForRanges(layeredFragments);

	assert.equal(layeredCells.size, 128);
	assert.ok(layeredFragments.length <= layeredCells.size);

	const cubeRange: ResolvedTextureRange = {
		baseMipLevel: 0,
		mipLevelCount: 4,
		baseArrayLayer: 0,
		arrayLayerCount: 4,
		baseDepthSlice: 0,
		depthSliceCount: 4,
		aspectMask: 1,
	};
	const checkerboard: ResolvedTextureRange[] = [];
	for (let mip = 0; mip < 4; mip++) {
		for (let layer = 0; layer < 4; layer++) {
			for (let depth = 0; depth < 4; depth++) {
				if ((mip + layer + depth) % 2 === 0) {
					checkerboard.push({
						baseMipLevel: mip,
						mipLevelCount: 1,
						baseArrayLayer: layer,
						arrayLayerCount: 1,
						baseDepthSlice: depth,
						depthSliceCount: 1,
						aspectMask: 1,
					});
				}
			}
		}
	}
	const checkerboardFragments = subtractResolvedTextureRanges([cubeRange], checkerboard);
	const checkerboardCells = cellsForRanges(checkerboardFragments);

	assert.equal(checkerboardCells.size, 32);
	assert.ok(checkerboardFragments.length <= checkerboardCells.size);
});
