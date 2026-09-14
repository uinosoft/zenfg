import type { ExamplesSourceFile } from '../../types.ts';

export const recipeHostSourceFile: ExamplesSourceFile = {
	id: 'examples-recipe-host',
	label: 'Host · recipeHost.ts',
	path: 'apps/site/playground/src/catalog/webgpu/recipeHost.ts',
	role: 'host',
	language: 'typescript',
	loadSource: async () => (await import('./recipeHost.ts?raw')).default,
};

export const recipeShaderSourceFile: ExamplesSourceFile = {
	id: 'examples-recipe-shaders',
	label: 'Shader · recipeShaders.ts',
	path: 'apps/site/playground/src/catalog/webgpu/recipeShaders.ts',
	role: 'shader',
	language: 'typescript',
	loadSource: async () => (await import('./recipeShaders.ts?raw')).default,
};
