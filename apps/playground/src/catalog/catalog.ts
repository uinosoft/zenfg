import { interactiveBackgroundExample } from './interactiveBackground.ts';
import type { PlaygroundExampleDefinition } from '../types.ts';

export const publicExamples = [interactiveBackgroundExample] as const satisfies readonly PlaygroundExampleDefinition[];

export function findPublicExample(id: string): PlaygroundExampleDefinition | undefined {
	return publicExamples.find((example) => example.id === id);
}
