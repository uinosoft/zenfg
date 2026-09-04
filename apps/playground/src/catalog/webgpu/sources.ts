import type { PlaygroundSourceFile } from '../../types.ts';

export const recipeHostSourceFile: PlaygroundSourceFile = {
	id: 'playground-recipe-host',
	label: 'Host · recipeHost.ts',
	path: 'apps/playground/src/catalog/webgpu/recipeHost.ts',
	role: 'host',
	language: 'typescript',
	loadSource: async () => (await import('./recipeHost.ts?raw')).default,
};

export const recipeShaderSourceFile: PlaygroundSourceFile = {
	id: 'playground-recipe-shaders',
	label: 'Shader · recipeShaders.ts',
	path: 'apps/playground/src/catalog/webgpu/recipeShaders.ts',
	role: 'shader',
	language: 'typescript',
	loadSource: async () => (await import('./recipeShaders.ts?raw')).default,
};
