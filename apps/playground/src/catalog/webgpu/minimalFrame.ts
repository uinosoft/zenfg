import type { PlaygroundExampleDefinition } from '../../types.ts';
import { recipeHostSourceFile } from './sources.ts';

export const minimalFrameExample: PlaygroundExampleDefinition = {
	id: 'minimal-frame',
	title: 'Minimal Frame',
	group: '@zenfg/webgpu basics',
	summary: 'WebGPU · Render · 1 pass',
	readyMessage: 'Ready · 1 retained render pass',
	footerHint: 'Open Inspector to see why the clear pass is retained',
	sourceFiles: [
		{
			id: 'minimal-frame-recipe',
			label: 'Recipe · minimal-frame.ts',
			path: 'packages/webgpu/examples/minimal-frame.ts',
			role: 'recipe',
			language: 'typescript',
			loadSource: async () => (await import('../../../../../packages/webgpu/examples/minimal-frame.ts?raw')).default,
		},
		{
			id: 'minimal-frame-adapter',
			label: 'Host · minimalFrame.ts',
			path: 'apps/playground/src/catalog/webgpu/minimalFrame.ts',
			role: 'host',
			language: 'typescript',
			loadSource: async () => (await import('./minimalFrame.ts?raw')).default,
		},
		recipeHostSourceFile,
	],
	async mount(context) {
		const [recipe, { createWebGpuRecipeHost }] = await Promise.all([
			import('../../../../../packages/webgpu/examples/minimal-frame.ts'),
			import('./recipeHost.ts'),
		]);
		const host = await createWebGpuRecipeHost(context);
		if (!host) return undefined;
		const stopResize = host.renderOnResize(() => {
			recipe.renderMinimalFrame(host.graph, host.context, host.nextFrameIndex());
			context.onReady();
		});
		return {
			captureSnapshot: () => host.capture((recorder) => {
				recipe.recordMinimalFrame(recorder, host.context.getCurrentTexture());
			}),
			dispose() {
				stopResize();
				host.dispose();
			},
		};
	},
};
