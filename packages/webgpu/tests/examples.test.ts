import assert from 'node:assert/strict';
import test from 'node:test';

import { FrameGraph, type FrameGraphCompilationReport, type FrameGraphRecording } from '@zenfg/webgpu';

import { recordComputeOutput } from '../examples/compute-output.ts';
import { recordExternalSubmission } from '../examples/external-submission.ts';
import { recordTimedClearPass } from '../examples/gpu-timing.ts';
import { recordImportedUniformFrame } from '../examples/imported-resource.ts';
import { recordMinimalFrame } from '../examples/minimal-frame.ts';
import { recordPersistentStateUpdate } from '../examples/persistent-state.ts';
import { recordSnapshotFrame } from '../examples/snapshot-export.ts';
import { recordTransientToPresent } from '../examples/transient-to-present.ts';
import { buffer, bufferUsage, mockCommandEncoder, mockDevice, texture, textureUsage } from './testUtils.ts';

const renderPipeline = {
	getBindGroupLayout: () => ({}) as GPUBindGroupLayout,
} as unknown as GPURenderPipeline;
const computePipeline = {
	getBindGroupLayout: () => ({}) as GPUBindGroupLayout,
} as unknown as GPUComputePipeline;
const sampler = {} as GPUSampler;

function compile(record: (recorder: FrameGraphRecording) => void): FrameGraphCompilationReport {
	const recorder = new FrameGraph(mockDevice()).beginFrame();
	record(recorder);
	return recorder.compile({ report: true }).compilationReport;
}

const backbuffer = () => texture('backbuffer', textureUsage.RENDER_ATTACHMENT, {
	format: 'bgra8unorm',
	size: [64, 48],
});

test('canonical package recipes retain their teaching graph in compilation reports', () => {
	const cases: readonly {
		readonly name: string;
		readonly record: (recorder: FrameGraphRecording) => void;
		readonly nodeLabels: readonly string[];
		readonly origins: readonly string[];
		readonly rootReason: string;
	}[] = [
		{
			name: 'minimal-frame',
			record: (recorder) => recordMinimalFrame(recorder, backbuffer()),
			nodeLabels: ['clear-backbuffer'],
			origins: ['swapchain'],
			rootReason: 'present',
		},
		{
			name: 'transient-to-present',
			record: (recorder) => recordTransientToPresent({
				recorder,
				backbufferTexture: backbuffer(),
				scenePipeline: renderPipeline,
				presentPipeline: renderPipeline,
				sampler,
				width: 64,
				height: 48,
			}),
			nodeLabels: ['scene', 'present'],
			origins: ['transient', 'swapchain'],
			rootReason: 'present',
		},
		{
			name: 'imported-resource',
			record: (recorder) => recordImportedUniformFrame({
				recorder,
				backbufferTexture: backbuffer(),
				pipeline: renderPipeline,
				uniformBuffer: buffer('frame-uniforms', bufferUsage.UNIFORM, 16),
				uniformSize: 16,
			}),
			nodeLabels: ['draw-with-imported-uniforms'],
			origins: ['imported', 'swapchain'],
			rootReason: 'present',
		},
		{
			name: 'persistent-state',
			record: (recorder) => recordPersistentStateUpdate({
				recorder,
				historyTexture: texture('temporal-history'),
				hasPreviousValue: false,
				encodeUpdate: () => undefined,
			}),
			nodeLabels: ['update-history'],
			origins: ['imported'],
			rootReason: 'persistent-state',
		},
		{
			name: 'external-submission',
			record: (recorder) => recordExternalSubmission({
				recorder,
				backbufferTexture: backbuffer(),
				presentPipeline: renderPipeline,
				sampler,
				width: 64,
				height: 48,
				renderAndSubmit: () => undefined,
			}),
			nodeLabels: ['third-party-renderer', 'present-external-color'],
			origins: ['transient', 'swapchain'],
			rootReason: 'present',
		},
		{
			name: 'snapshot-export',
			record: (recorder) => recordSnapshotFrame(recorder, backbuffer()),
			nodeLabels: ['captured-clear'],
			origins: ['swapchain'],
			rootReason: 'present',
		},
		{
			name: 'gpu-timing',
			record: (recorder) => recordTimedClearPass(recorder, backbuffer()),
			nodeLabels: ['timed-clear'],
			origins: ['swapchain'],
			rootReason: 'present',
		},
		{
			name: 'compute-output',
			record: (recorder) => recordComputeOutput({
				recorder,
				pipeline: computePipeline,
				outputBuffer: buffer('compute-output', bufferUsage.STORAGE, 64),
				outputSize: 64,
				workgroupCount: 1,
			}),
			nodeLabels: ['write-output'],
			origins: ['imported'],
			rootReason: 'output',
		},
	];

	for (const recipe of cases) {
		const report = compile(recipe.record);
		assert.deepEqual(report.nodes.map((node) => node.label), recipe.nodeLabels, recipe.name);
		assert.deepEqual(report.resources.map((resource) => resource.origin), recipe.origins, recipe.name);
		assert.ok(report.roots.some((root) => root.reason === recipe.rootReason), recipe.name);
	}
});

test('transient and external recipes expose their defining dependency structure', () => {
	const transient = compile((recorder) => recordTransientToPresent({
		recorder,
		backbufferTexture: backbuffer(),
		scenePipeline: renderPipeline,
		presentPipeline: renderPipeline,
		sampler,
		width: 64,
		height: 48,
	}));
	assert.equal(transient.dependencies.length, 1);
	assert.equal(transient.executionSegments.length, 1);

	const external = compile((recorder) => recordExternalSubmission({
		recorder,
		backbufferTexture: backbuffer(),
		presentPipeline: renderPipeline,
		sampler,
		width: 64,
		height: 48,
		renderAndSubmit: () => undefined,
	}));
	assert.deepEqual(external.executionSegments.map((segment) => segment.kind), [
		'external-submission',
		'frame-graph',
	]);
});

test('imported-resource recipe forwards native extras through its normal MSAA render pass', () => {
	const descriptors: (GPURenderPassDescriptor & { resourceTable?: unknown })[] = [];
	const encoder = mockCommandEncoder({
		beginRenderPass(descriptor: GPURenderPassDescriptor) {
			descriptors.push(descriptor);
			return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
		},
	});
	const device = {
		...mockDevice(encoder),
		createBindGroup() { return {} as GPUBindGroup; },
	} as unknown as GPUDevice;
	const recorder = new FrameGraph(device).beginFrame();
	const table = { label: "application-table" };
	recordImportedUniformFrame({
		recorder, backbufferTexture: backbuffer(), pipeline: renderPipeline,
		uniformBuffer: buffer('uniforms', bufferUsage.UNIFORM, 16), uniformSize: 16,
		multisampleTexture: texture('msaa-color', textureUsage.RENDER_ATTACHMENT, {
			format: 'bgra8unorm', size: [64, 48], sampleCount: 4,
		}),
		webgpuDescriptor: { resourceTable: table },
	});
	const compiled = recorder.compile({ report: true });
	assert.deepEqual(compiled.compilationReport.nodes.map((node) => node.kind), ['render']);
	compiled.execute();
	assert.equal(descriptors[0].resourceTable, table);
	const attachments = Array.from(descriptors[0].colorAttachments);
	assert.equal(attachments.length, 1);
	assert.equal(attachments[0]?.storeOp, 'discard');
	assert.ok(attachments[0]?.resolveTarget);
});
