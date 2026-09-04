import type { PlaygroundExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile, recipeShaderSourceFile } from './sources.ts';

const outputSize = 16 * Uint32Array.BYTES_PER_ELEMENT;

export const computeOutputExample: PlaygroundExampleDefinition = {
	id: 'compute-output',
	title: 'Compute Output',
	group: '@zenfg/webgpu basics',
	summary: 'WebGPU · Compute · Storage output',
	readyMessage: 'Ready · 16 values written by compute',
	footerHint: 'Inspector shows a storage write retained by an output root',
	sourceFiles: [
		{
			id: 'compute-output-recipe',
			label: 'Recipe · compute-output.ts',
			path: 'packages/webgpu/examples/compute-output.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../packages/webgpu/examples/compute-output.ts?raw')).default,
		},
		{
			id: 'compute-output-adapter',
			label: 'Host · computeOutput.ts',
			path: 'apps/playground/src/catalog/webgpu/computeOutput.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./computeOutput.ts?raw')).default,
		},
		recipeHostSourceFile,
		recipeShaderSourceFile,
	],
	async mount(context) {
		const [recipe, hostTools, shaders] = await Promise.all([
			import('../../../../../packages/webgpu/examples/compute-output.ts'),
			import('./recipeHost.ts'),
			import('./recipeShaders.ts'),
		]);
		const {
			createComputePipeline,
			createRenderPipeline,
			createWebGpuRecipeHost,
			presentStorageBuffer,
		} = hostTools;
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		const pipeline = createComputePipeline(host.device, shaders.computeOutputShader);
		const presentationPipeline = createRenderPipeline(
			host.device,
			host.format,
			shaders.computePresentationShader,
			'fragmentMain',
		);
		const outputBuffer = host.own(host.device.createBuffer({
			label: 'playground-compute-output',
			size: outputSize,
			usage: GPUBufferUsage.STORAGE,
		}));
		const render = (): void => {
			recipe.computeOutput({
				graph: host.graph,
				pipeline,
				outputBuffer,
				outputSize,
				workgroupCount: 1,
				frameIndex: host.nextFrameIndex(),
			});
			presentStorageBuffer(host, presentationPipeline, outputBuffer);
			context.onReady();
		};
		const stopResize = host.renderOnResize(render);
		return {
			async captureSnapshot() {
				const snapshot = await host.capture((recorder) => {
					recipe.recordComputeOutput({
						recorder,
						pipeline,
						outputBuffer,
						outputSize,
						workgroupCount: 1,
					});
				});
				presentStorageBuffer(host, presentationPipeline, outputBuffer);
				return snapshot;
			},
			dispose() {
				stopResize();
				host.dispose();
			},
		};
	},
};
