import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	FRAME_GRAPH_COMPILE_BENCHMARK_MODES,
	FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS,
	FRAME_GRAPH_COMPILE_BENCHMARK_PROFILES,
	FRAME_GRAPH_COMPILE_BENCHMARK_PROTOCOL,
	FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS,
	FRAME_GRAPH_COMPILE_PROFILE_NODE_COUNTS,
	runFrameGraphCompileBenchmarkCase,
	type FrameGraphCompileBenchmarkMode,
	type FrameGraphCompileBenchmarkOperation,
	type FrameGraphCompileBenchmarkProfile,
	type FrameGraphCompileBenchmarkResult,
	type FrameGraphCompileBenchmarkScenario,
} from './FrameGraphCompileBenchmark.ts';

export interface FrameGraphCompileBenchmarkCliOptions {
	readonly profile: FrameGraphCompileBenchmarkProfile;
	readonly scenarios: readonly FrameGraphCompileBenchmarkScenario[];
	readonly modes: readonly FrameGraphCompileBenchmarkMode[];
	readonly operations: readonly FrameGraphCompileBenchmarkOperation[];
	readonly warmupCount: number;
	readonly sampleCount: number;
}

export interface FrameGraphCompileBenchmarkCliReport {
	readonly environment: {
		readonly commit: string;
		readonly node: string;
		readonly platform: NodeJS.Platform;
		readonly architecture: string;
	};
	readonly protocol: {
		readonly id: typeof FRAME_GRAPH_COMPILE_BENCHMARK_PROTOCOL;
		readonly execution: 'cpu-only';
		readonly timer: 'process.hrtime.bigint';
		readonly unit: 'microseconds';
		readonly percentile: 'nearest-rank';
		readonly measuredOperations: readonly FrameGraphCompileBenchmarkOperation[];
	};
	readonly configuration: {
		readonly profile: FrameGraphCompileBenchmarkProfile;
		readonly bodyNodeCount: number;
		readonly scenarios: readonly FrameGraphCompileBenchmarkScenario[];
		readonly modes: readonly FrameGraphCompileBenchmarkMode[];
		readonly operations: readonly FrameGraphCompileBenchmarkOperation[];
		readonly warmupCount: number;
		readonly sampleCount: number;
	};
	readonly results: readonly FrameGraphCompileBenchmarkResult[];
}

export interface FrameGraphCompileBenchmarkCliIo {
	readonly stdout: (text: string) => void;
}

function enumValue<T extends string>(
	value: string | undefined,
	values: readonly T[],
	name: string,
): T {
	if (!value || !values.includes(value as T)) {
		throw new Error(`Unknown FrameGraph compile benchmark ${name}: ${value ?? '<missing>'}.`);
	}
	return value as T;
}

function positiveIntegerArgument(value: string | undefined, name: string): number {
	if (!value || !/^\d+$/.test(value)) {
		throw new Error(`${name} must be a positive integer.`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive safe integer.`);
	}
	return parsed;
}

export function parseFrameGraphCompileBenchmarkCliArgs(
	args: readonly string[],
): FrameGraphCompileBenchmarkCliOptions {
	let profile: FrameGraphCompileBenchmarkProfile = 'realistic';
	let scenarios: readonly FrameGraphCompileBenchmarkScenario[] = FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS;
	let modes: readonly FrameGraphCompileBenchmarkMode[] = FRAME_GRAPH_COMPILE_BENCHMARK_MODES;
	let operations: readonly FrameGraphCompileBenchmarkOperation[] = FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS;
	let warmupCount = 20;
	let sampleCount = 100;

	for (let index = 0; index < args.length; index++) {
		const argument = args[index]!;
		switch (argument) {
			case '--profile':
				profile = enumValue(args[++index], FRAME_GRAPH_COMPILE_BENCHMARK_PROFILES, 'profile');
				break;
			case '--scenario':
				scenarios = [enumValue(args[++index], FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS, 'scenario')];
				break;
			case '--mode': {
				const mode = args[++index];
				modes = mode === 'both'
					? FRAME_GRAPH_COMPILE_BENCHMARK_MODES
					: [enumValue(mode, FRAME_GRAPH_COMPILE_BENCHMARK_MODES, 'mode')];
				break;
			}
			case '--operation': {
				const operation = args[++index];
				operations = operation === 'all'
					? FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS
					: [enumValue(operation, FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS, 'operation')];
				break;
			}
			case '--warmup':
				warmupCount = positiveIntegerArgument(args[++index], '--warmup');
				break;
			case '--samples':
				sampleCount = positiveIntegerArgument(args[++index], '--samples');
				break;
			default:
				throw new Error(
					`Unknown FrameGraph compile benchmark argument: ${argument}. `
					+ 'Supported arguments are --profile, --scenario, --mode, --operation, --warmup, and --samples.',
				);
		}
	}
	return Object.freeze({ profile, scenarios, modes, operations, warmupCount, sampleCount });
}

function resolveCommit(rootDir: string): string {
	const explicit = process.env.FRAME_GRAPH_COMPILE_BENCHMARK_COMMIT;
	if (explicit) {
		return explicit;
	}
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: rootDir,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return 'unknown';
	}
}
export function runFrameGraphCompileBenchmarkCli(
	args: readonly string[],
	io: FrameGraphCompileBenchmarkCliIo = { stdout: (text) => process.stdout.write(text) },
): FrameGraphCompileBenchmarkCliReport {
	const options = parseFrameGraphCompileBenchmarkCliArgs(args);
	const rootDir = process.env.FRAME_GRAPH_COMPILE_BENCHMARK_ROOT ?? process.cwd();
	const bodyNodeCount = FRAME_GRAPH_COMPILE_PROFILE_NODE_COUNTS[options.profile];
	const results = options.scenarios.flatMap((scenario) => options.modes.flatMap((mode) => (
		options.operations.map((operation) => runFrameGraphCompileBenchmarkCase({
			scenario,
			mode,
			operation,
			bodyNodeCount,
			warmupCount: options.warmupCount,
			sampleCount: options.sampleCount,
		}))
	)));
	const report: FrameGraphCompileBenchmarkCliReport = {
		environment: {
			commit: resolveCommit(rootDir),
			node: process.version,
			platform: process.platform,
			architecture: process.arch,
		},
		protocol: {
			id: FRAME_GRAPH_COMPILE_BENCHMARK_PROTOCOL,
			execution: 'cpu-only',
			timer: 'process.hrtime.bigint',
			unit: 'microseconds',
			percentile: 'nearest-rank',
			measuredOperations: options.operations,
		},
		configuration: {
			profile: options.profile,
			bodyNodeCount,
			scenarios: options.scenarios,
			modes: options.modes,
			operations: options.operations,
			warmupCount: options.warmupCount,
			sampleCount: options.sampleCount,
		},
		results,
	};
	io.stdout(`${JSON.stringify(report, null, 2)}\n`);
	return report;
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
	try {
		runFrameGraphCompileBenchmarkCli(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
