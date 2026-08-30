import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAME_GRAPH_COMPILE_BENCHMARK_MODES,
	FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS,
	FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS,
	calculateFrameGraphCompileStatistics,
	measureFrameGraphBenchmarkSamples,
	nearestRank,
	runFrameGraphCompileBenchmarkCase,
	type FrameGraphCompileBenchmarkClock,
	type FrameGraphCompileBenchmarkScenario,
	type FrameGraphCompileBenchmarkStructure,
} from '../benchmarks/FrameGraphCompileBenchmark.ts';
import { parseFrameGraphCompileBenchmarkCliArgs } from '../benchmarks/cli.ts';

test('compile benchmark CLI has stable defaults and supports all filters', () => {
	assert.deepEqual(parseFrameGraphCompileBenchmarkCliArgs([]), {
		profile: 'realistic',
		scenarios: FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS,
		modes: FRAME_GRAPH_COMPILE_BENCHMARK_MODES,
		operations: FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS,
		warmupCount: 20,
		sampleCount: 100,
	});
	assert.deepEqual(parseFrameGraphCompileBenchmarkCliArgs([
		'--profile', 'large',
		'--scenario', 'buffer-ranges',
		'--mode', 'compact',
		'--operation', 'compile-execute',
		'--warmup', '3',
		'--samples', '7',
	]), {
		profile: 'large',
		scenarios: ['buffer-ranges'],
		modes: ['compact'],
		operations: ['compile-execute'],
		warmupCount: 3,
		sampleCount: 7,
	});
	assert.deepEqual(parseFrameGraphCompileBenchmarkCliArgs(['--mode', 'both']).modes, [
		'compact',
		'report',
	]);
	assert.deepEqual(parseFrameGraphCompileBenchmarkCliArgs(['--operation', 'all']).operations, [
		'compile-only',
		'compile-execute',
		'record-compile-execute',
		'execute-repeated',
	]);
});

test('benchmark preparation timing keeps lifecycle boundaries explicit', () => {
	const measure = (preparationTiming: 'before-timer' | 'inside-timer' | 'once'): string[] => {
		const events: string[] = [];
		let timestamp = 0n;
		measureFrameGraphBenchmarkSamples({
			prepare: () => { events.push('prepare'); return {}; },
			run: () => { events.push('run'); },
			preparationTiming,
			warmupCount: 1,
			sampleCount: 1,
			clock: { nowNanoseconds: () => { events.push('clock'); return timestamp += 1_000n; } },
		});
		return events;
	};

	assert.deepEqual(measure('before-timer'), ['prepare', 'run', 'prepare', 'clock', 'run', 'clock']);
	assert.deepEqual(measure('inside-timer'), ['prepare', 'run', 'clock', 'prepare', 'run', 'clock']);
	assert.deepEqual(measure('once'), ['prepare', 'run', 'clock', 'run', 'clock']);
});

test('compile benchmark CLI rejects missing, unknown, and non-positive values', () => {
	for (const args of [
		['--profile'],
		['--profile', 'tiny'],
		['--scenario', 'unknown'],
		['--mode', 'unknown'],
		['--operation', 'unknown'],
		['--warmup', '0'],
		['--warmup', '-1'],
		['--samples', '1.5'],
		['--unknown'],
	]) {
		assert.throws(() => parseFrameGraphCompileBenchmarkCliArgs(args));
	}
});

test('nearest-rank percentiles and compile statistics are deterministic', () => {
	const values = [9, 1, 4, 7, 2, 6, 3, 8, 5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
	assert.equal(nearestRank(values, 0.5), 10);
	assert.equal(nearestRank(values, 0.95), 19);
	assert.deepEqual(calculateFrameGraphCompileStatistics(values), {
		sampleCount: 20,
		minMicros: 1,
		p50Micros: 10,
		p95Micros: 19,
		maxMicros: 20,
	});
	assert.throws(() => nearestRank([], 0.5));
	assert.throws(() => nearestRank([1], 0));
	assert.throws(() => calculateFrameGraphCompileStatistics([Number.NaN]));
});

const expectedStructures: Readonly<Record<FrameGraphCompileBenchmarkScenario, FrameGraphCompileBenchmarkStructure>> = {
	'linear-chain': {
		nodeCount: 5,
		retainedNodeCount: 4,
		culledNodeCount: 1,
		resourceCount: 5,
		accessCount: 8,
		dependencyCount: 3,
		allocationCount: 3,
		executionSegmentCount: 1,
	},
	'buffer-ranges': {
		nodeCount: 4,
		retainedNodeCount: 4,
		culledNodeCount: 0,
		resourceCount: 1,
		accessCount: 7,
		dependencyCount: 3,
		allocationCount: 1,
		executionSegmentCount: 1,
	},
	'texture-subresources': {
		nodeCount: 5,
		retainedNodeCount: 5,
		culledNodeCount: 0,
		resourceCount: 2,
		accessCount: 6,
		dependencyCount: 4,
		allocationCount: 2,
		executionSegmentCount: 1,
	},
	'allocation-aliasing': {
		nodeCount: 4,
		retainedNodeCount: 4,
		culledNodeCount: 0,
		resourceCount: 4,
		accessCount: 4,
		dependencyCount: 0,
		allocationCount: 1,
		executionSegmentCount: 1,
	},
};

function fixedClock(): FrameGraphCompileBenchmarkClock {
	const timestamps = [10_000n, 25_000n];
	let index = 0;
	return {
		nowNanoseconds() {
			return timestamps[index++]!;
		},
	};
}

test('all benchmark scenarios support compile and execute operations with stable structures', () => {
	for (const scenario of FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS) {
		for (const mode of FRAME_GRAPH_COMPILE_BENCHMARK_MODES) {
			for (const operation of FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS) {
				const result = runFrameGraphCompileBenchmarkCase({
					scenario,
					mode,
					operation,
					bodyNodeCount: 4,
					warmupCount: 1,
					sampleCount: 1,
					clock: fixedClock(),
				});
				assert.deepEqual(result.structure, expectedStructures[scenario]);
				assert.equal(result.operation, operation);
				assert.deepEqual(result.statistics, {
					sampleCount: 1,
					minMicros: 15,
					p50Micros: 15,
					p95Micros: 15,
					maxMicros: 15,
				});
			}
		}
	}
});
