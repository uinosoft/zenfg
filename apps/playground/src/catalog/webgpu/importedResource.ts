import type { PlaygroundExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile, recipeShaderSourceFile } from './sources.ts';

const uniformSize = 16;

export const importedResourceExample: PlaygroundExampleDefinition = {
	id: 'imported-resource',
	title: 'Imported Resource',
	group: '@zenfg/webgpu basics',
	summary: 'WebGPU · Imported uniform · 1 pass',
	readyMessage: 'Ready · caller-owned uniform imported',
	footerHint: 'The native uniform stays caller-owned across graph execution',
	sourceFiles: [
		{
			id: 'imported-resource-recipe',
			label: 'Recipe · imported-resource.ts',
			path: 'packages/webgpu/examples/imported-resource.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../packages/webgpu/examples/imported-resource.ts?raw')).default,
		},
		{
			id: 'imported-resource-adapter',
			label: 'Host · importedResource.ts',
			path: 'apps/playground/src/catalog/webgpu/importedResource.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./importedResource.ts?raw')).default,
		},
		recipeHostSourceFile,
		recipeShaderSourceFile,
	],
	async mount(context) {
		const [recipe, hostTools, shaders] = await Promise.all([
			import('../../../../../packages/webgpu/examples/imported-resource.ts'),
			import('./recipeHost.ts'),
			import('./recipeShaders.ts'),
		]);
		const { createRenderPipeline, createWebGpuRecipeHost } = hostTools;
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		const pipeline = createRenderPipeline(host.device, host.format, shaders.importedUniformShader, 'fragmentMain');
		const uniformBuffer = host.own(host.device.createBuffer({
			label: 'playground-imported-uniform',
			size: uniformSize,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		}));
		host.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([0.12, 0.62, 0.9, 1]));
		const record = (recorder: Parameters<typeof recipe.recordImportedUniformFrame>[0]['recorder']): void => {
			recipe.recordImportedUniformFrame({
				recorder,
				backbufferTexture: host.context.getCurrentTexture(),
				pipeline,
				uniformBuffer,
				uniformSize,
			});
		};
		const stopResize = host.renderOnResize(() => {
			recipe.renderWithImportedUniform({
				graph: host.graph,
				context: host.context,
				pipeline,
				uniformBuffer,
				uniformSize,
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
