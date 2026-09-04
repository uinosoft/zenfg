import type { PlaygroundExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile, recipeShaderSourceFile } from './sources.ts';

export const transientToPresentExample: PlaygroundExampleDefinition = {
	id: 'transient-to-present',
	title: 'Transient to Present',
	group: '@zenfg/webgpu basics',
	summary: 'WebGPU · Transient texture · 2 passes',
	readyMessage: 'Ready · transient texture presented',
	footerHint: 'Inspect the transient lifetime between scene and present passes',
	sourceFiles: [
		{
			id: 'transient-to-present-recipe',
			label: 'Recipe · transient-to-present.ts',
			path: 'packages/webgpu/examples/transient-to-present.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../packages/webgpu/examples/transient-to-present.ts?raw')).default,
		},
		{
			id: 'transient-to-present-adapter',
			label: 'Host · transientToPresent.ts',
			path: 'apps/playground/src/catalog/webgpu/transientToPresent.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./transientToPresent.ts?raw')).default,
		},
		recipeHostSourceFile,
		recipeShaderSourceFile,
	],
	async mount(context) {
		const [recipe, hostTools, shaders] = await Promise.all([
			import('../../../../../packages/webgpu/examples/transient-to-present.ts'),
			import('./recipeHost.ts'),
			import('./recipeShaders.ts'),
		]);
		const { createRenderPipeline, createWebGpuRecipeHost } = hostTools;
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		const scenePipeline = createRenderPipeline(host.device, 'rgba16float', shaders.colorShader, 'sceneFragment');
		const presentPipeline = createRenderPipeline(host.device, host.format, shaders.presentShader, 'fragmentMain');
		const sampler = host.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const record = (recorder: Parameters<typeof recipe.recordTransientToPresent>[0]['recorder']): void => {
			const size = host.size();
			recipe.recordTransientToPresent({
				recorder,
				backbufferTexture: host.context.getCurrentTexture(),
				scenePipeline,
				presentPipeline,
				sampler,
				...size,
			});
		};
		const stopResize = host.renderOnResize((size) => {
			recipe.renderTransientToPresent({
				graph: host.graph,
				context: host.context,
				scenePipeline,
				presentPipeline,
				sampler,
				...size,
				frameIndex: host.nextFrameIndex(),
			});
			context.onReady();
		});
		return {
			captureSnapshot: () => host.capture(record),
			dispose() {
				stopResize();
				host.dispose();
			},
		};
	},
};
