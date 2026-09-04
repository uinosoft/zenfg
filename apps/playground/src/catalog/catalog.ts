import { interactiveBackgroundExample } from './interactiveBackground.ts';
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
	minimalFrameExample,
	transientToPresentExample,
	importedResourceExample,
	persistentStateExample,
	externalSubmissionExample,
	snapshotExportExample,
	gpuTimingExample,
	computeOutputExample,
] as const satisfies readonly PlaygroundExampleDefinition[];

export function findPublicExample(id: string): PlaygroundExampleDefinition | undefined {
	return publicExamples.find((example) => example.id === id);
}
