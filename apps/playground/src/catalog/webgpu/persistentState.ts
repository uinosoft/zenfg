import type { PlaygroundExampleDefinition } from '../../types.ts';
import type { RecipeCanvasSize } from './recipeHost.ts';
import { recipeHostSourceFile, recipeShaderSourceFile } from './sources.ts';

export const persistentStateExample: PlaygroundExampleDefinition = {
	id: 'persistent-state',
	title: 'Persistent State',
	group: '@zenfg/webgpu basics',
	summary: 'WebGPU · Imported texture · Persistent root',
	readyMessage: 'Ready · caller-owned history retained',
	footerHint: 'Capture again to see the imported state begin defined',
	sourceFiles: [
		{
			id: 'persistent-state-recipe',
			label: 'Recipe · persistent-state.ts',
			path: 'packages/webgpu/examples/persistent-state.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../packages/webgpu/examples/persistent-state.ts?raw')).default,
		},
		{
			id: 'persistent-state-adapter',
			label: 'Host · persistentState.ts',
			path: 'apps/playground/src/catalog/webgpu/persistentState.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./persistentState.ts?raw')).default,
		},
		recipeHostSourceFile,
		recipeShaderSourceFile,
	],
	async mount(context) {
		const [recipe, hostTools, shaders] = await Promise.all([
			import('../../../../../packages/webgpu/examples/persistent-state.ts'),
			import('./recipeHost.ts'),
			import('./recipeShaders.ts'),
		]);
		const { createRenderPipeline, createWebGpuRecipeHost, presentTexture } = hostTools;
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		const pipeline = createRenderPipeline(host.device, host.format, shaders.colorShader, 'persistentFragment');
		let historyTexture: GPUTexture | undefined;
		let historySize: RecipeCanvasSize | undefined;
		let hasPreviousValue = false;
		const ensureHistory = (size: RecipeCanvasSize): GPUTexture => {
			if (historyTexture && historySize?.width === size.width && historySize.height === size.height) return historyTexture;
			if (historyTexture) host.release(historyTexture);
			historyTexture = host.own(host.device.createTexture({
				label: 'playground-persistent-history',
				size,
				format: host.format,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
			}));
			historySize = size;
			hasPreviousValue = false;
			return historyTexture;
		};
		const encodeUpdate = (pass: GPURenderPassEncoder): undefined => {
			pass.setPipeline(pipeline);
			pass.draw(3);
			return undefined;
		};
		const stopResize = host.renderOnResize((size) => {
			const history = ensureHistory(size);
			recipe.updatePersistentState({
				graph: host.graph,
				historyTexture: history,
				hasPreviousValue,
				frameIndex: host.nextFrameIndex(),
				encodeUpdate,
			});
			hasPreviousValue = true;
			presentTexture(host, history, size);
			context.onReady();
		});
		return {
			async captureSnapshot() {
				const history = ensureHistory(host.size());
				const initialContentsDefined = hasPreviousValue;
				const snapshot = await host.capture((recorder) => {
					recipe.recordPersistentStateUpdate({
						recorder,
						historyTexture: history,
						hasPreviousValue: initialContentsDefined,
						encodeUpdate,
					});
				});
				hasPreviousValue = true;
				return snapshot;
			},
			dispose() {
				stopResize();
				host.dispose();
			},
		};
	},
};
