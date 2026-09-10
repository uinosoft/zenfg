import type { PlaygroundExampleDefinition } from '../types.ts';

export const interactiveBackgroundExample: PlaygroundExampleDefinition = {
	id: 'interactive-background',
	title: 'Interactive FrameGraph Background',
	group: 'Showcases',
	tags: ['webgpu', 'compute', 'render'],
	readyState: 'live',
	description: 'Move your pointer to disturb the field',
	entrySourceId: 'interactive-background-entry',
	sourceFiles: [
		{
			id: 'interactive-background-entry', label: 'main.ts', role: 'example', language: 'typescript',
			path: 'examples/interactive-background/src/main.ts',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/main.ts?raw')).default,
		},
		{
			id: 'background',
			label: 'backgroundGraph.ts',
			path: 'examples/interactive-background/src/backgroundGraph.ts',
			role: 'example',
			language: 'typescript',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/backgroundGraph.ts?raw')).default,
		},
		{
			id: 'background-resources.ts', label: 'resources.ts', path: 'examples/interactive-background/src/resources.ts',
			role: 'example', language: 'typescript',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/resources.ts?raw')).default
		},
		{
			id: 'background-backgroundInteraction.ts', label: 'backgroundInteraction.ts', path: 'examples/interactive-background/src/backgroundInteraction.ts',
			role: 'example', language: 'typescript',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/backgroundInteraction.ts?raw')).default
		},
		{
			id: 'background-backgroundLayout.ts', label: 'backgroundLayout.ts', path: 'examples/interactive-background/src/backgroundLayout.ts',
			role: 'example', language: 'typescript',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/backgroundLayout.ts?raw')).default
		},
		{
			id: 'background-shaders',
			label: 'backgroundShaders.ts',
			path: 'examples/interactive-background/src/backgroundShaders.ts',
			role: 'shader',
			language: 'typescript',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/backgroundShaders.ts?raw')).default,
		},
		{
			id: 'background-host.ts', label: 'host.ts', path: 'examples/interactive-background/src/host.ts',
			role: 'host', language: 'typescript',
			loadSource: async () => (await import('../../../../examples/interactive-background/src/host.ts?raw')).default
		},
	],
	async mount(context) {
		const { startZenBackground } = await import('@zenfg-example/interactive-background');
		return startZenBackground(context.canvas, {
			interactionTarget: context.canvas,
			onFrame: context.onFrame,
			onReady: context.onReady,
			onError: context.onError,
		});
	},
};
