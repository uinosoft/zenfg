import {
	BufferAccess,
	type CompiledFrame,
	FrameGraph,
	TextureAccess,
	type FrameGraphCompilationReport,
	type FrameGraphRecorder,
} from '../src/index.ts';

export const FRAME_GRAPH_COMPILE_BENCHMARK_PROTOCOL = 'frame-graph-compile/v3' as const;

export const FRAME_GRAPH_COMPILE_BENCHMARK_PROFILES = ['realistic', 'small', 'medium', 'large'] as const;
export type FrameGraphCompileBenchmarkProfile = typeof FRAME_GRAPH_COMPILE_BENCHMARK_PROFILES[number];

export const FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS = [
	'linear-chain',
	'buffer-ranges',
	'texture-subresources',
	'allocation-aliasing',
] as const;
export type FrameGraphCompileBenchmarkScenario = typeof FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS[number];

export const FRAME_GRAPH_COMPILE_BENCHMARK_MODES = ['compact', 'report'] as const;
export type FrameGraphCompileBenchmarkMode = typeof FRAME_GRAPH_COMPILE_BENCHMARK_MODES[number];

export const FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS = [
	'compile-only',
	'compile-execute',
	'record-compile-execute',
	'execute-repeated',
] as const;
export type FrameGraphCompileBenchmarkOperation = typeof FRAME_GRAPH_COMPILE_BENCHMARK_OPERATIONS[number];

export const FRAME_GRAPH_COMPILE_PROFILE_NODE_COUNTS: Readonly<Record<FrameGraphCompileBenchmarkProfile, number>> = {
	realistic: 12,
	small: 64,
	medium: 256,
	large: 1024,
};

export interface FrameGraphCompileBenchmarkStructure {
	readonly nodeCount: number;
	readonly retainedNodeCount: number;
	readonly culledNodeCount: number;
	readonly resourceCount: number;
	readonly accessCount: number;
	readonly dependencyCount: number;
	readonly allocationCount: number;
	readonly executionSegmentCount: number;
}

export interface FrameGraphCompileBenchmarkStatistics {
	readonly sampleCount: number;
	readonly minMicros: number;
	readonly p50Micros: number;
	readonly p95Micros: number;
	readonly maxMicros: number;
}

export interface FrameGraphCompileBenchmarkResult {
	readonly scenario: FrameGraphCompileBenchmarkScenario;
	readonly mode: FrameGraphCompileBenchmarkMode;
	readonly operation: FrameGraphCompileBenchmarkOperation;
	readonly bodyNodeCount: number;
	readonly warmupCount: number;
	readonly statistics: FrameGraphCompileBenchmarkStatistics;
	readonly structure: FrameGraphCompileBenchmarkStructure;
}

export interface FrameGraphCompileBenchmarkClock {
	nowNanoseconds(): bigint;
}

export type FrameGraphBenchmarkPreparationTiming = 'before-timer' | 'inside-timer' | 'once';

const textureUsage = {
	COPY_SRC: 0x01,
	COPY_DST: 0x02,
	TEXTURE_BINDING: 0x04,
	STORAGE_BINDING: 0x08,
	RENDER_ATTACHMENT: 0x10,
};

const bufferUsage = {
	MAP_READ: 0x0001,
	COPY_SRC: 0x0004,
	COPY_DST: 0x0008,
	INDEX: 0x0010,
	VERTEX: 0x0020,
	UNIFORM: 0x0040,
	STORAGE: 0x0080,
	INDIRECT: 0x0100,
	QUERY_RESOLVE: 0x0200,
};

function installCompileOnlyWebGpuConstants(): void {
	if (typeof globalThis.GPUTextureUsage === 'undefined') {
		(globalThis as { GPUTextureUsage?: typeof textureUsage }).GPUTextureUsage = textureUsage;
	}
	if (typeof globalThis.GPUBufferUsage === 'undefined') {
		(globalThis as { GPUBufferUsage?: typeof bufferUsage }).GPUBufferUsage = bufferUsage;
	}
}

function createBenchmarkDevice(): GPUDevice {
	const queue = { submit() {} };
	return {
		queue,
		createTexture(descriptor: GPUTextureDescriptor) {
			return {
				...descriptor,
				width: Number((descriptor.size as GPUExtent3DDict).width ?? 1),
				height: Number((descriptor.size as GPUExtent3DDict).height ?? 1),
				depthOrArrayLayers: Number((descriptor.size as GPUExtent3DDict).depthOrArrayLayers ?? 1),
				createView: () => ({} as GPUTextureView),
				destroy() {},
			} as unknown as GPUTexture;
		},
		createBuffer(descriptor: GPUBufferDescriptor) {
			return { ...descriptor, destroy() {} } as GPUBuffer;
		},
		createCommandEncoder() {
			return { finish: () => ({} as GPUCommandBuffer) } as GPUCommandEncoder;
		},
	} as unknown as GPUDevice;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive safe integer.`);
	}
	return value;
}

export function measureFrameGraphBenchmarkSamples<TPrepared>(options: {
	readonly prepare: () => TPrepared;
	readonly run: (prepared: TPrepared) => void;
	readonly preparationTiming: FrameGraphBenchmarkPreparationTiming;
	readonly warmupCount: number;
	readonly sampleCount: number;
	readonly clock: FrameGraphCompileBenchmarkClock;
}): number[] {
	const warmupCount = positiveInteger(options.warmupCount, 'warmupCount');
	const sampleCount = positiveInteger(options.sampleCount, 'sampleCount');
	const reusable = options.preparationTiming === 'once' ? options.prepare() : undefined;
	const prepareAndRun = (): void => options.run(options.prepare());

	for (let index = 0; index < warmupCount; index++) {
		if (options.preparationTiming === 'once') options.run(reusable as TPrepared);
		else prepareAndRun();
	}

	const durationsMicros: number[] = [];
	for (let index = 0; index < sampleCount; index++) {
		const prepared = options.preparationTiming === 'before-timer' ? options.prepare() : undefined;
		const start = options.clock.nowNanoseconds();
		if (options.preparationTiming === 'inside-timer') prepareAndRun();
		else options.run(options.preparationTiming === 'once' ? reusable as TPrepared : prepared as TPrepared);
		const end = options.clock.nowNanoseconds();
		const duration = Number(end - start) / 1_000;
		if (!Number.isFinite(duration) || duration < 0) {
			throw new Error('Benchmark clock must produce finite, monotonic timestamps.');
		}
		durationsMicros.push(duration);
	}
	return durationsMicros;
}

export function createFrameGraphCompileBenchmarkRecorder(
	runtime: FrameGraph,
	scenario: FrameGraphCompileBenchmarkScenario,
	bodyNodeCount: number,
): FrameGraphRecorder {
	positiveInteger(bodyNodeCount, 'bodyNodeCount');
	const recorder = runtime.beginFrame();
	switch (scenario) {
		case 'linear-chain':
			recordLinearChain(recorder, bodyNodeCount);
			break;
		case 'buffer-ranges':
			recordBufferRanges(recorder, bodyNodeCount);
			break;
		case 'texture-subresources':
			recordTextureSubresources(recorder, bodyNodeCount);
			break;
		case 'allocation-aliasing':
			recordAllocationAliasing(recorder, bodyNodeCount);
			break;
		default:
			throw new Error(`Unknown FrameGraph compile benchmark scenario: ${scenario as string}.`);
	}
	return recorder;
}

function recordLinearChain(recorder: FrameGraphRecorder, bodyNodeCount: number): void {
	let previous = recorder.createTexture({
		label: 'linear-texture-0',
		format: 'rgba8unorm',
		size: [16, 16],
	});
	recorder.command({
		label: 'linear-node-0',
		uses: [recorder.use(previous, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		sideEffect: false,
	});

	for (let index = 1; index < bodyNodeCount; index++) {
		const next = recorder.createTexture({
			label: `linear-texture-${index}`,
			format: 'rgba8unorm',
			size: [16, 16],
		});
		recorder.command({
			label: `linear-node-${index}`,
			uses: [
				recorder.use(previous, TextureAccess.Sampled),
				recorder.use(next, TextureAccess.StorageWrite, { contents: 'overwrite' }),
			],
			sideEffect: false,
		});
		previous = next;
	}
	recorder.markOutput(previous);

	const culled = recorder.createTexture({
		label: 'linear-culled-texture',
		format: 'rgba8unorm',
		size: [16, 16],
	});
	recorder.command({
		label: 'linear-culled-node',
		uses: [recorder.use(culled, TextureAccess.StorageWrite, { contents: 'overwrite' })],
		sideEffect: false,
	});
}

function recordBufferRanges(recorder: FrameGraphRecorder, bodyNodeCount: number): void {
	const bytesPerRange = 16;
	const buffer = recorder.createBuffer({
		label: 'range-buffer',
		size: bodyNodeCount * bytesPerRange,
	});
	recorder.command({
		label: 'range-initialize',
		uses: [recorder.use(buffer, BufferAccess.StorageWrite, { contents: 'overwrite' })],
		sideEffect: false,
	});

	for (let index = 0; index < bodyNodeCount - 1; index++) {
		const range = { offset: index * bytesPerRange, size: bytesPerRange };
		recorder.command({
			label: `range-node-${index}`,
			uses: [
				recorder.use(buffer, BufferAccess.StorageRead, { range }),
				recorder.use(buffer, BufferAccess.StorageWrite, { contents: 'overwrite', range }),
			],
			sideEffect: false,
		});
	}
	recorder.markOutput(buffer);
}

function recordTextureSubresources(recorder: FrameGraphRecorder, bodyNodeCount: number): void {
	const texture = recorder.createTexture({
		label: 'layered-texture',
		format: 'rgba8unorm',
		size: [1, 1, bodyNodeCount],
	});
	for (let index = 0; index < bodyNodeCount; index++) {
		const layer = recorder.createTextureView(texture, {
			label: `layer-view-${index}`,
			baseArrayLayer: index,
			arrayLayerCount: 1,
		});
		recorder.command({
			label: `layer-producer-${index}`,
			uses: [recorder.use(layer, TextureAccess.StorageWrite, { contents: 'overwrite' })],
			sideEffect: false,
		});
	}

	const output = recorder.createBuffer({ label: 'layer-fan-in-output', size: 16 });
	recorder.command({
		label: 'layer-fan-in',
		uses: [
			recorder.use(texture, TextureAccess.Sampled),
			recorder.use(output, BufferAccess.StorageWrite, { contents: 'overwrite' }),
		],
		sideEffect: false,
	});
	recorder.markOutput(output);
}

function recordAllocationAliasing(recorder: FrameGraphRecorder, bodyNodeCount: number): void {
	for (let index = 0; index < bodyNodeCount; index++) {
		const texture = recorder.createTexture({
			label: `alias-texture-${index}`,
			format: 'rgba8unorm',
			size: [64, 64],
		});
		recorder.command({
			label: `alias-node-${index}`,
			uses: [recorder.use(texture, TextureAccess.StorageWrite, { contents: 'overwrite' })],
			sideEffect: true,
		});
	}
}

export function summarizeFrameGraphCompileReport(
	report: FrameGraphCompilationReport,
): FrameGraphCompileBenchmarkStructure {
	return {
		nodeCount: report.nodes.length + report.culledNodes.length,
		retainedNodeCount: report.nodes.length,
		culledNodeCount: report.culledNodes.length,
		resourceCount: report.resources.length,
		accessCount: report.accesses.length,
		dependencyCount: report.dependencies.length,
		allocationCount: report.allocations.length,
		executionSegmentCount: report.executionSegments.length,
	};
}

export function nearestRank(values: readonly number[], fraction: number): number {
	if (values.length === 0) {
		throw new Error('nearestRank requires at least one value.');
	}
	if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
		throw new Error('nearestRank fraction must be within (0, 1].');
	}
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.ceil(sorted.length * fraction) - 1]!;
}

export function calculateFrameGraphCompileStatistics(
	durationsMicros: readonly number[],
): FrameGraphCompileBenchmarkStatistics {
	if (durationsMicros.length === 0) {
		throw new Error('At least one measured duration is required.');
	}
	for (const duration of durationsMicros) {
		if (!Number.isFinite(duration) || duration < 0) {
			throw new Error('Measured durations must be finite and non-negative.');
		}
	}
	const sorted = [...durationsMicros].sort((left, right) => left - right);
	return {
		sampleCount: sorted.length,
		minMicros: sorted[0]!,
		p50Micros: nearestRank(sorted, 0.5),
		p95Micros: nearestRank(sorted, 0.95),
		maxMicros: sorted[sorted.length - 1]!,
	};
}

export function runFrameGraphCompileBenchmarkCase(options: {
	readonly scenario: FrameGraphCompileBenchmarkScenario;
	readonly mode: FrameGraphCompileBenchmarkMode;
	readonly operation?: FrameGraphCompileBenchmarkOperation;
	readonly bodyNodeCount: number;
	readonly warmupCount: number;
	readonly sampleCount: number;
	readonly clock?: FrameGraphCompileBenchmarkClock;
}): FrameGraphCompileBenchmarkResult {
	installCompileOnlyWebGpuConstants();
	const bodyNodeCount = positiveInteger(options.bodyNodeCount, 'bodyNodeCount');
	const warmupCount = positiveInteger(options.warmupCount, 'warmupCount');
	const sampleCount = positiveInteger(options.sampleCount, 'sampleCount');
	const runtime = new FrameGraph(createBenchmarkDevice());
	const clock = options.clock ?? { nowNanoseconds: () => process.hrtime.bigint() };
	const operation = options.operation ?? 'compile-only';
	const compile = (recorder: FrameGraphRecorder): CompiledFrame => {
		if (options.mode === 'report') {
			return recorder.compile({ report: true });
		}
		return recorder.compile();
	};
	type Prepared = FrameGraphRecorder | CompiledFrame;
	const prepare = (): Prepared => {
		const recorder = createFrameGraphCompileBenchmarkRecorder(runtime, options.scenario, bodyNodeCount);
		return operation === 'execute-repeated' ? compile(recorder) : recorder;
	};
	const run = (prepared: Prepared): void => {
		if (operation === 'execute-repeated') {
			(prepared as CompiledFrame).execute();
			return;
		}
		const compiled = compile(prepared as FrameGraphRecorder);
		if (operation !== 'compile-only') compiled.execute();
	};
	const preparationTiming: FrameGraphBenchmarkPreparationTiming = operation === 'execute-repeated'
		? 'once'
		: operation === 'record-compile-execute'
			? 'inside-timer'
			: 'before-timer';

	const structure = summarizeFrameGraphCompileReport(
		createFrameGraphCompileBenchmarkRecorder(runtime, options.scenario, bodyNodeCount)
			.compile({ report: true }).compilationReport,
	);

	const durationsMicros = measureFrameGraphBenchmarkSamples({
		prepare,
		run,
		preparationTiming,
		warmupCount,
		sampleCount,
		clock,
	});

	return {
		scenario: options.scenario,
		mode: options.mode,
		operation,
		bodyNodeCount,
		warmupCount,
		statistics: calculateFrameGraphCompileStatistics(durationsMicros),
		structure,
	};
}
