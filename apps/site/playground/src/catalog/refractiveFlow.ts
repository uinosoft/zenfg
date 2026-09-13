import type { PlaygroundExampleDefinition } from '../types.ts';

export const refractiveFlowExample: PlaygroundExampleDefinition = {
	id: 'refractive-flow', title: 'Refractive Flow', group: 'Showcases',
	tags: ['webgpu', 'compute', 'render'], readyState: 'live',
	description: 'Four folded Catmull–Rom surfaces, each peeling into three transparent films, with transported frames, GPU curl perturbation and damped springs. Foreground reflections and softer distant layers reveal the depth. Move your pointer to bend and energize the optics. Inspect weighted transparency, the HDR emission layer and the three-level bloom pyramid in the eight-pass graph.',
	entrySourceId: 'surface-main',
	sourceFiles: [
		{ id: 'surface-main', label: 'main.ts', path: 'apps/site/examples/refractive-flow/src/main.ts', role: 'example', language: 'typescript', loadSource: async () => (await import('../../../examples/refractive-flow/src/main.ts?raw')).default },
		{ id: 'surface-graph', label: 'graph.ts', path: 'apps/site/examples/refractive-flow/src/graph.ts', role: 'example', language: 'typescript', loadSource: async () => (await import('../../../examples/refractive-flow/src/graph.ts?raw')).default },
		{ id: 'surface-shaders', label: 'shaders.ts', path: 'apps/site/examples/refractive-flow/src/shaders.ts', role: 'shader', language: 'typescript', loadSource: async () => (await import('../../../examples/refractive-flow/src/shaders.ts?raw')).default },
		{ id: 'surface-resources', label: 'resources.ts', path: 'apps/site/examples/refractive-flow/src/resources.ts', role: 'example', language: 'typescript', loadSource: async () => (await import('../../../examples/refractive-flow/src/resources.ts?raw')).default },
		{ id: 'surface-host', label: 'host.ts', path: 'apps/site/examples/refractive-flow/src/host.ts', role: 'host', language: 'typescript', loadSource: async () => (await import('../../../examples/refractive-flow/src/host.ts?raw')).default },
		{ id: 'surface-interaction', label: 'pointer pressure (shared)', path: 'apps/site/examples/interactive-background/src/backgroundInteraction.ts', role: 'host', language: 'typescript', loadSource: async () => (await import('../../../examples/interactive-background/src/backgroundInteraction.ts?raw')).default },
		{ id: 'flow-curves', label: 'curves.ts', path: 'apps/site/examples/refractive-flow/src/curves.ts', role: 'example', language: 'typescript', loadSource: async () => (await import('../../../examples/refractive-flow/src/curves.ts?raw')).default },
	],
	async mount(context) {
		const { startRefractiveFlow } = await import('../../../examples/refractive-flow/src/main.ts');
		if (context.signal?.aborted) return undefined;
		const surface = await startRefractiveFlow(context.canvas, {
			theme: context.theme?.get() ?? 'dark',
			onFrame: context.onFrame, onReady: context.onReady, onError: context.onError,
		});
		if (!surface) return undefined;
		if (context.signal?.aborted) { surface.dispose(); return undefined; }
		surface.setTheme(context.theme?.get() ?? 'dark');
		const unsubscribe = context.theme?.subscribe(mode => surface.setTheme(mode));
		return { captureSnapshot: () => surface.captureSnapshot(), dispose() { unsubscribe?.(); surface.dispose(); } };
	},
};
