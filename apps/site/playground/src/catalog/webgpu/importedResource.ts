import type { ExamplesExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile, recipeShaderSourceFile } from './sources.ts';

const uniformSize = 16;

export const importedResourceExample: ExamplesExampleDefinition = {
	id: 'imported-resource',
	title: 'Imported Resource',
	group: '@zenfg/webgpu basics',
	tags: ['webgpu', 'imported-resources', 'uniform-buffer'],
	readyState: 'ready',
	description: "Import a caller-owned uniform buffer into a render pass. Explore how the graph tracks its use while resource ownership stays with the caller.",
	entrySourceId: 'imported-resource-recipe',
	sourceFiles: [
		{
			id: 'imported-resource-recipe',
			label: 'Recipe · imported-resource.ts',
			path: 'packages/webgpu/examples/imported-resource.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../../packages/webgpu/examples/imported-resource.ts?raw')).default,
		},
		{
			id: 'imported-resource-adapter',
			label: 'Host · importedResource.ts',
			path: 'apps/site/playground/src/catalog/webgpu/importedResource.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./importedResource.ts?raw')).default,
		},
		recipeHostSourceFile,
		recipeShaderSourceFile,
	],
	async mount(context) {
		const [recipe, hostTools, shaders] = await Promise.all([
			import('../../../../../../packages/webgpu/examples/imported-resource.ts'),
			import('./recipeHost.ts'),
			import('./recipeShaders.ts'),
		]);
		const { createRenderPipeline, createWebGpuRecipeHost } = hostTools;
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		const pipeline = createRenderPipeline(host.device, host.format, shaders.importedUniformShader, 'fragmentMain');
		const uniformBuffer = host.own(host.device.createBuffer({
			label: 'examples-imported-uniform',
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
			captureSnapshot: (request = { timing: 'both' }) => host.capture(record, request),
			dispose() {
				stopResize();
				host.dispose();
			},
		};
	},
};
