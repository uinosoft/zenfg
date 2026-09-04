import type { PlaygroundExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile } from './sources.ts';

export const gpuTimingExample: PlaygroundExampleDefinition = {
	id: 'gpu-timing',
	title: 'GPU Timing',
	group: '@zenfg/webgpu basics',
	summary: 'WebGPU · Timestamp query · 1 pass',
	readyMessage: 'Ready · GPU timing requested',
	footerHint: 'Unsupported timing remains a valid, inspectable result',
	sourceFiles: [
		{
			id: 'gpu-timing-recipe',
			label: 'Recipe · gpu-timing.ts',
			path: 'packages/webgpu/examples/gpu-timing.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../packages/webgpu/examples/gpu-timing.ts?raw')).default,
		},
		{
			id: 'gpu-timing-adapter',
			label: 'Host · gpuTiming.ts',
			path: 'apps/playground/src/catalog/webgpu/gpuTiming.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./gpuTiming.ts?raw')).default,
		},
		recipeHostSourceFile,
	],
	async mount(context) {
		const [recipe, { createWebGpuRecipeHost }] = await Promise.all([
			import('../../../../../packages/webgpu/examples/gpu-timing.ts'),
			import('./recipeHost.ts'),
		]);
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		const stopResize = host.renderOnResize(async () => {
			const timing = await recipe.measureClearPass(host.graph, host.context, host.nextFrameIndex());
			context.onReady(timing.status === 'available'
				? `Ready · ${timing.frameDurationMicros.toFixed(1)} µs GPU time`
				: `Ready · timing ${timing.reason}`);
		});
		return {
			captureSnapshot: () => host.capture((recorder) => {
				recipe.recordTimedClearPass(recorder, host.context.getCurrentTexture());
			}),
			dispose() {
				stopResize();
				host.dispose();
			},
		};
	},
};
