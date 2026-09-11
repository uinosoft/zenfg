import type { PlaygroundExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile } from './sources.ts';

export const gpuTimingExample: PlaygroundExampleDefinition = {
	id: 'gpu-timing',
	title: 'GPU Timing',
	group: '@zenfg/webgpu basics',
	tags: ['webgpu', 'gpu-timing', 'diagnostics'],
	readyState: 'ready',
	description: "Measure GPU execution time when timestamp queries are available. Inspect the timing result or the explicit unsupported status on other devices.",
	entrySourceId: 'gpu-timing-recipe',
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
				? `GPU time: ${timing.frameDurationMicros.toFixed(1)} µs` : undefined);
			context.onWarning?.(timing.status === 'available'
				? undefined : 'GPU timing is unavailable (' + timing.reason + '). Rendering and capture remain available.');
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
