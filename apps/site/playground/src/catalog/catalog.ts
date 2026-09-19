import { glyphInteropExample } from './glyphInterop.ts';
import { playCanvasGsplatInteropExample } from './playCanvasGsplatInterop.ts';
import { playCanvasGsplatStreamingInteropExample } from './playCanvasGsplatStreamingInterop.ts';
import { refractiveFlowExample } from './refractiveFlow.ts';
import { orderedSourceFiles } from '../sourceView.ts';
import { interactiveBackgroundExample } from './interactiveBackground.ts';
import { referenceRendererExample } from './referenceRenderer.ts';
import { babylonLiteInteropExample } from './babylonLiteInterop.ts';
import { babylonInteropExample } from './babylonInterop.ts';
import { threeInteropExample } from './threeInterop.ts';
import { typeGpuSlimeMoldExample } from './typeGpuSlimeMold.ts';
import { typeGpuMonocularLightInjectionExample } from './typeGpuMonocularLightInjection.ts';
import { particles4AllExample } from './particles4All.ts';
import { computeOutputExample } from './webgpu/computeOutput.ts';
import { externalSubmissionExample } from './webgpu/externalSubmission.ts';
import { gpuTimingExample } from './webgpu/gpuTiming.ts';
import { importedResourceExample } from './webgpu/importedResource.ts';
import { minimalFrameExample } from './webgpu/minimalFrame.ts';
import { persistentStateExample } from './webgpu/persistentState.ts';
import { snapshotExportExample } from './webgpu/snapshotExport.ts';
import { transientToPresentExample } from './webgpu/transientToPresent.ts';
import type { ExamplesExampleDefinition } from '../types.ts';

export const publicExamples = [
	referenceRendererExample,
	threeInteropExample,
	babylonInteropExample,
	babylonLiteInteropExample,
	playCanvasGsplatInteropExample,
	playCanvasGsplatStreamingInteropExample,
	glyphInteropExample,
	typeGpuSlimeMoldExample,
	typeGpuMonocularLightInjectionExample,
	particles4AllExample,
	interactiveBackgroundExample,
	refractiveFlowExample,
	minimalFrameExample,
	transientToPresentExample,
	importedResourceExample,
	persistentStateExample,
	externalSubmissionExample,
	snapshotExportExample,
	gpuTimingExample,
	computeOutputExample,
] as const satisfies readonly ExamplesExampleDefinition[];

for (const example of publicExamples) {
	orderedSourceFiles(example);
	if (example.hasControls && example.group !== 'Showcases') {
		throw new Error(`Only repository showcases may declare controls: ${example.id}`);
	}
}

export function findPublicExample(id: string): ExamplesExampleDefinition | undefined {
	return publicExamples.find((example) => example.id === id);
}
