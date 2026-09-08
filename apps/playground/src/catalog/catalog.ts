import { interactiveBackgroundExample } from './interactiveBackground.ts';
import { referenceRendererExample } from './referenceRenderer.ts';
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
import type { PlaygroundExampleDefinition } from '../types.ts';

export const publicExamples = [
	interactiveBackgroundExample,
	referenceRendererExample,
	threeInteropExample,
	typeGpuSlimeMoldExample,
	typeGpuMonocularLightInjectionExample,
	particles4AllExample,
	minimalFrameExample,
	transientToPresentExample,
	importedResourceExample,
	persistentStateExample,
	externalSubmissionExample,
	snapshotExportExample,
	gpuTimingExample,
	computeOutputExample,
] as const satisfies readonly PlaygroundExampleDefinition[];

for (const example of publicExamples) {
	if (example.hasControls && example.group !== 'Showcases') {
		throw new Error(`Only repository showcases may declare controls: ${example.id}`);
	}
}

export function findPublicExample(id: string): PlaygroundExampleDefinition | undefined {
	return publicExamples.find((example) => example.id === id);
}
