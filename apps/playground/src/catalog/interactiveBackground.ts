import type { PlaygroundExampleDefinition } from '../types.ts';

export const interactiveBackgroundExample: PlaygroundExampleDefinition = {
	id: 'interactive-background',
	title: 'Interactive FrameGraph Background',
	summary: 'WebGPU · Compute + Render · 5 passes',
	sourceFiles: [
		{
			id: 'background',
			label: 'background.ts',
			path: 'examples/interactive-background/src/background.ts',
			language: 'typescript',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/background.ts?raw')).default,
		},
		{
			id: 'background-shaders',
			label: 'backgroundShaders.ts',
			path: 'examples/interactive-background/src/backgroundShaders.ts',
			language: 'typescript',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/backgroundShaders.ts?raw')).default,
		},
	],
	async mount(context) {
		const { startZenBackground } = await import('@zenfg-example/interactive-background');
		return startZenBackground(context.canvas, {
			interactionTarget: context.canvas,
			onReady: context.onReady,
			onError: context.onError,
		});
	},
};
